import Feather from "@expo/vector-icons/Feather";
import {
  Redirect,
  router,
  useFocusEffect,
  useLocalSearchParams,
} from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  TextInput,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import {
  AppText,
  Button,
  Card,
  EmptyState,
  Sheet,
  Skeleton,
} from "@/components/ui";
import { fonts, radius, space } from "@/constants/theme";
import { useBlockedIds } from "@/hooks/use-blocked";
import { useTheme } from "@/hooks/use-theme";
import {
  addComment,
  castVote,
  clearVote,
  COMMENT_MAX,
  CommunityError,
  commentsLabel,
  fetchComments,
  fetchCommunityPost,
  fetchMyRole,
  fetchMyVotes,
  isMine,
  removeComment,
  removeCommunityPost,
  type CommunityPost,
  type PostComment,
  type VoteValue,
} from "@/lib/communities";
import { tapSuccess } from "@/lib/haptics";
import { useAuth } from "@/providers/auth-provider";

/* One post, held up to the light: the whole body, the arrows, and the
 * conversation underneath.
 *
 * Comments arrive oldest first because a thread is read top to bottom, and
 * a removed one stays as a tombstone so the replies around it keep making
 * sense. The composer sits under the list, one field and one button,
 * because the distance between reading a post and answering it should be
 * as short as the app can make it.
 *
 * The notification trigger writes links in this screen's shape
 * (`/communities/<id>/posts/<id>`), so a tap on "someone commented" lands
 * here with both params in hand.
 */

type Status = "loading" | "error" | "missing" | "ready";

/** "Just now", "5m ago", "3h ago", "2d ago", then "Aug 2". Pure. */
function timeAgo(iso: string, now: Date): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** One 44px arrow. Lit in ember going up, in danger going down. */
function VoteArrow({
  direction,
  lit,
  onPress,
}: {
  direction: "up" | "down";
  lit: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const litColor = direction === "up" ? theme.brand : theme.danger;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={direction === "up" ? "Upvote" : "Downvote"}
      accessibilityState={{ selected: lit }}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Feather
        name={direction === "up" ? "arrow-up" : "arrow-down"}
        size={20}
        color={lit ? litColor : theme.muted}
      />
    </Pressable>
  );
}

/**
 * One comment: who, when, what. A removed one keeps its place and its
 * shape and says only that it was removed, so the thread stays legible.
 */
function CommentRow({
  comment,
  now,
  mine,
  onMenu,
}: {
  comment: PostComment;
  now: Date;
  mine: boolean;
  onMenu: () => void;
}) {
  const theme = useTheme();
  const removed = comment.deleted_at !== null;
  const name = mine
    ? "You"
    : (comment.author?.display_name ?? "Someone on campus");

  if (removed) {
    return (
      <View
        style={{
          borderWidth: 1,
          borderStyle: "dashed",
          borderColor: theme.border,
          borderRadius: radius.control,
          paddingHorizontal: space.close,
          paddingVertical: space.room,
          marginBottom: space.room,
        }}
      >
        <AppText variant="caption" muted>
          This comment was removed.
        </AppText>
      </View>
    );
  }

  return (
    <Card
      padded={false}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: space.close,
        padding: space.close,
        marginBottom: space.room,
      }}
    >
      <Avatar
        url={comment.author?.avatar_url}
        name={
          comment.author
            ? comment.author.locked
              ? comment.author.handle
              : comment.author.display_name
            : name
        }
        size={32}
      />
      <View style={{ flex: 1, minWidth: 0, gap: space.tight }}>
        <AppText variant="caption" muted numberOfLines={1}>
          {name} · {timeAgo(comment.created_at, now)}
        </AppText>
        <AppText>{comment.body}</AppText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Options for ${name}'s comment`}
        onPress={onMenu}
        hitSlop={8}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          marginTop: -space.snug,
          marginRight: -space.snug,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Feather name="more-horizontal" size={16} color={theme.muted} />
      </Pressable>
    </Card>
  );
}

export default function CommunityPostScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const myId = session?.user.id ?? null;
  const params = useLocalSearchParams<{
    communityId?: string;
    postId?: string;
  }>();
  const postId = typeof params.postId === "string" ? params.postId : "";
  const communityIdParam =
    typeof params.communityId === "string" ? params.communityId : "";

  const [status, setStatus] = useState<Status>("loading");
  const [post, setPost] = useState<CommunityPost | null>(null);
  const [steward, setSteward] = useState(false);
  const [comments, setComments] = useState<PostComment[] | null>(null);
  const [myVote, setMyVote] = useState<VoteValue | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const [postMenuOpen, setPostMenuOpen] = useState(false);
  const [menuComment, setMenuComment] = useState<PostComment | null>(null);

  /* A link or a notification can land straight on one post, and the block
     list's promise has to hold here too. */
  const { blocked, refresh: refreshBlocked } = useBlockedIds();

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else if (communityIdParam) router.replace(`/communities/${communityIdParam}`);
    else router.replace("/communities");
  }, [communityIdParam]);

  const load = useCallback(async () => {
    if (!postId) {
      setStatus("missing");
      return;
    }
    try {
      const row = await fetchCommunityPost(postId);
      setNow(new Date());
      if (!row) {
        setStatus("missing");
        return;
      }
      const [commentRows, votes, role] = await Promise.all([
        fetchComments(postId).catch((): PostComment[] | null => null),
        fetchMyVotes([postId]),
        fetchMyRole(row.community_id).catch(() => null),
      ]);
      setPost(row);
      setComments(commentRows);
      setMyVote(votes[postId] ?? null);
      setSteward(role === "steward");
      setPageError(
        commentRows === null
          ? "We couldn't load the comments. Pull down to try again."
          : null
      );
      setStatus("ready");
    } catch (caught) {
      // A post already on screen stays on screen; a failed refresh says so
      // in one line rather than throwing the reader out of it.
      setPageError(
        caught instanceof CommunityError
          ? caught.message
          : "We couldn't open that post. Check your connection and give it another go."
      );
      setStatus((current) => (current === "ready" ? current : "error"));
    }
  }, [postId]);

  useFocusEffect(
    useCallback(() => {
      void refreshBlocked();
      void load();
    }, [load, refreshBlocked])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  /* ------------------------------ voting ------------------------------ */

  /** Cast, flip, or take back, optimistically, with the rollback held here. */
  const applyVote = useCallback(
    (tapped: VoteValue) => {
      if (!post) return;
      const current = myVote;
      const next = current === tapped ? null : tapped;
      const delta = (next ?? 0) - (current ?? 0);
      setPageError(null);
      setMyVote(next);
      setPost((prev) =>
        prev ? { ...prev, score: prev.score + delta } : prev
      );
      void (next === null ? clearVote(post.id) : castVote(post.id, next))
        .catch((caught: unknown) => {
          setMyVote(current);
          setPost((prev) =>
            prev ? { ...prev, score: prev.score - delta } : prev
          );
          setPageError(
            caught instanceof CommunityError
              ? caught.message
              : "That vote didn't land. Give it another tap."
          );
        });
    },
    [post, myVote]
  );

  /* ----------------------------- comments ------------------------------ */

  const handleComment = useCallback(async () => {
    if (!post || sending) return;
    setCommentError(null);
    setSending(true);
    try {
      const comment = await addComment(post.id, draft);
      // It's in the thread: the completion moment.
      tapSuccess();
      setDraft("");
      setNow(new Date());
      setComments((prev) => (prev === null ? [comment] : [...prev, comment]));
      setPost((prev) =>
        prev ? { ...prev, comment_count: prev.comment_count + 1 } : prev
      );
    } catch (caught) {
      setCommentError(
        caught instanceof CommunityError
          ? caught.message
          : "That didn't send just now. Give it another go."
      );
    } finally {
      setSending(false);
    }
  }, [post, sending, draft]);

  const confirmRemoveComment = useCallback(
    (comment: PostComment, asSteward: boolean) => {
      Alert.alert(
        asSteward ? "Remove this comment?" : "Take this comment down?",
        "It stays in the thread as a removed comment, with the words gone.",
        [
          { text: "Keep it", style: "cancel" },
          {
            text: asSteward ? "Remove" : "Take it down",
            style: "destructive",
            onPress: () => {
              // Optimistic: the tombstone lands now, the words come back
              // with a warm line if the server refuses.
              const stamp = new Date().toISOString();
              setPageError(null);
              setComments((prev) =>
                prev === null
                  ? prev
                  : prev.map((row) =>
                      row.id === comment.id
                        ? { ...row, deleted_at: stamp }
                        : row
                    )
              );
              setPost((prev) =>
                prev
                  ? {
                      ...prev,
                      comment_count: Math.max(prev.comment_count - 1, 0),
                    }
                  : prev
              );
              void removeComment(comment.id).catch((caught: unknown) => {
                setComments((prev) =>
                  prev === null
                    ? prev
                    : prev.map((row) =>
                        row.id === comment.id
                          ? { ...row, deleted_at: null }
                          : row
                      )
                );
                setPost((prev) =>
                  prev
                    ? { ...prev, comment_count: prev.comment_count + 1 }
                    : prev
                );
                setPageError(
                  caught instanceof CommunityError
                    ? caught.message
                    : "We couldn't take that comment down. Give it another go."
                );
              });
            },
          },
        ]
      );
    },
    []
  );

  /* ---------------------------- post actions ---------------------------- */

  const confirmRemovePost = useCallback(
    (asSteward: boolean) => {
      if (!post) return;
      Alert.alert(
        asSteward ? "Remove this post?" : "Take this post down?",
        "It comes off the feed for the campus. You, the author, and moderators can still see it was there.",
        [
          { text: "Keep it", style: "cancel" },
          {
            text: asSteward ? "Remove" : "Take it down",
            style: "destructive",
            onPress: () => {
              const stamp = new Date().toISOString();
              setPageError(null);
              setPost((prev) =>
                prev ? { ...prev, deleted_at: stamp } : prev
              );
              void removeCommunityPost(post.id).catch((caught: unknown) => {
                setPost((prev) =>
                  prev ? { ...prev, deleted_at: null } : prev
                );
                setPageError(
                  caught instanceof CommunityError
                    ? caught.message
                    : "We couldn't take that post down. Give it another go."
                );
              });
            },
          },
        ]
      );
    },
    [post]
  );

  const reportPost = useCallback(() => {
    if (!post) return;
    router.push({
      pathname: "/report",
      params: {
        communityPostId: post.id,
        userId: post.author_id,
        label: post.title,
      },
    });
  }, [post]);

  const reportComment = useCallback((comment: PostComment) => {
    router.push({
      pathname: "/report",
      params: {
        postCommentId: comment.id,
        userId: comment.author_id,
        label: comment.body.slice(0, 80),
      },
    });
  }, []);

  /* ------------------------------ render ------------------------------ */

  const visibleComments = useMemo(
    () =>
      (comments ?? []).filter(
        // A removed comment stays: the tombstone carries no words. A blocked
        // classmate's live words are exactly what the promise hides.
        (comment) =>
          comment.deleted_at !== null || !blocked.has(comment.author_id)
      ),
    [comments, blocked]
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<PostComment>) => (
      <CommentRow
        comment={item}
        now={now}
        mine={isMine(item, myId)}
        onMenu={() => setMenuComment(item)}
      />
    ),
    [now, myId]
  );

  // A deep link can land here signed out. Send them to a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  const backChevron = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={goBack}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Feather name="chevron-left" size={26} color={theme.foreground} />
    </Pressable>
  );

  const scaffold = (children: React.ReactNode, action?: React.ReactNode) => (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ flex: 1, paddingTop: insets.top + space.close }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: space.close,
          }}
        >
          {backChevron}
          {action}
        </View>
        {children}
      </View>
    </KeyboardAvoidingView>
  );

  if (status === "loading" && !post) {
    /* Every post has the same bones: a headline, a byline, the words, the
       arrows. The page draws itself first and the words land into it. */
    return scaffold(
      <View
        style={{
          paddingHorizontal: space.gutter,
          paddingTop: space.tight,
          gap: space.close,
        }}
      >
        <Skeleton width="86%" height={30} />
        <Skeleton width={132} height={11} radius={radius.full} />
        <View style={{ gap: space.cosy, marginTop: space.tight }}>
          <Skeleton width="100%" height={12} radius={radius.full} />
          <Skeleton width="93%" height={12} radius={radius.full} />
          <Skeleton width="56%" height={12} radius={radius.full} />
        </View>
        <View style={{ flexDirection: "row", gap: space.close }}>
          <Skeleton width={44} height={44} radius={radius.control} />
          <Skeleton width={44} height={44} radius={radius.control} />
        </View>
      </View>
    );
  }

  if (status === "missing") {
    return scaffold(
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          paddingHorizontal: space.gutter,
        }}
      >
        <EmptyState
          icon="file-text"
          title="That post isn't there"
          body="It may have been taken down, or folded away by downvotes. The feed has everything still standing."
          action={{ label: "Back to the feed", onPress: goBack }}
        />
      </View>
    );
  }

  if (status === "error" || !post) {
    return scaffold(
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: space.room,
          paddingHorizontal: space.rest,
          paddingBottom: 80,
        }}
      >
        <Feather name="cloud-off" size={28} color={theme.muted} />
        <AppText variant="bodySemi">Something hiccuped</AppText>
        <AppText
          variant="caption"
          muted
          style={{ textAlign: "center", maxWidth: 280 }}
        >
          {pageError ??
            "We couldn't open that post. Check your connection and give it another go."}
        </AppText>
        <Button
          label="Try again"
          variant="soft"
          size="sm"
          onPress={() => {
            setStatus("loading");
            void load();
          }}
        />
      </View>
    );
  }

  const mine = isMine(post, myId);

  if (!mine && blocked.has(post.author_id)) {
    return scaffold(
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          paddingHorizontal: space.gutter,
        }}
      >
        <EmptyState
          icon="slash"
          title="This one's from someone you blocked"
          body="Their posts stay out of sight while they're on your list. Blocked people, in Settings, is where that comes undone."
          action={{ label: "Back to the feed", onPress: goBack }}
        />
      </View>
    );
  }

  const removed = post.deleted_at !== null;
  const folded = post.hidden_at !== null;
  const authorName = mine
    ? "You"
    : post.author
      ? post.author.locked
        ? `@${post.author.handle}`
        : post.author.display_name
      : "Someone on campus";

  const overflow = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Post options"
      onPress={() => setPostMenuOpen(true)}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Feather name="more-horizontal" size={22} color={theme.foreground} />
    </Pressable>
  );

  const header = (
    <View style={{ paddingTop: space.tight }}>
      {pageError ? (
        <AppText
          variant="caption"
          accessibilityLiveRegion="polite"
          style={{ color: theme.danger, marginBottom: space.room }}
        >
          {pageError}
        </AppText>
      ) : null}

      <AppText variant="display">{post.title}</AppText>
      <AppText variant="caption" muted style={{ marginTop: space.snug }}>
        {authorName} · {timeAgo(post.created_at, now)}
        {post.edited_at ? " · Edited" : ""}
      </AppText>

      {removed ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: space.room,
            padding: space.close,
            borderRadius: radius.control,
            backgroundColor: theme.surface2,
            marginTop: space.card,
          }}
        >
          <Feather
            name="trash-2"
            size={14}
            color={theme.muted}
            style={{ marginTop: space.hair }}
          />
          <AppText variant="caption" muted style={{ flex: 1, lineHeight: 17 }}>
            This post was removed.
          </AppText>
        </View>
      ) : folded ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: space.room,
            padding: space.close,
            borderRadius: radius.control,
            backgroundColor: theme.surface2,
            marginTop: space.card,
          }}
        >
          <Feather
            name="eye-off"
            size={14}
            color={theme.muted}
            style={{ marginTop: space.hair }}
          />
          <AppText variant="caption" muted style={{ flex: 1, lineHeight: 17 }}>
            Hidden by downvotes. The campus doesn't see it unless the score
            recovers.
          </AppText>
        </View>
      ) : null}

      {!removed && post.body ? (
        <AppText style={{ marginTop: space.card, lineHeight: 22 }}>
          {post.body}
        </AppText>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginTop: space.close,
          marginLeft: -space.close,
        }}
      >
        <VoteArrow
          direction="up"
          lit={myVote === 1}
          onPress={() => applyVote(1)}
        />
        <AppText
          variant="bodySemi"
          style={{ minWidth: 20, textAlign: "center" }}
        >
          {post.score}
        </AppText>
        <VoteArrow
          direction="down"
          lit={myVote === -1}
          onPress={() => applyVote(-1)}
        />
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.snug,
            paddingHorizontal: space.cosy,
          }}
        >
          <Feather name="message-circle" size={14} color={theme.muted} />
          <AppText variant="caption" muted>
            {commentsLabel(post.comment_count)}
          </AppText>
        </View>
      </View>
    </View>
  );

  return (
    <>
      {scaffold(
        <>
          <FlatList
            data={visibleComments}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: space.gutter,
              paddingBottom: space.rest,
            }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListHeaderComponent={
              <View style={{ marginBottom: space.card }}>{header}</View>
            }
            ListEmptyComponent={
              comments === null ? null : (
                <EmptyState
                  compact
                  icon="message-circle"
                  title="No comments yet"
                  body="Whatever you say first sets the tone."
                />
              )
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.brand}
                colors={[theme.brand]}
              />
            }
          />

          {/* The composer: pinned under the thread, one thought long. */}
          <View
            style={{
              paddingHorizontal: space.gutter,
              paddingTop: space.cosy,
              paddingBottom: insets.bottom + space.cosy,
              borderTopWidth: 1,
              borderTopColor: theme.border,
              backgroundColor: theme.background,
              gap: space.cosy,
            }}
          >
            {commentError ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={{ color: theme.danger }}
              >
                {commentError}
              </AppText>
            ) : null}
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-end",
                gap: space.cosy,
              }}
            >
              <TextInput
                value={draft}
                onChangeText={(text) => {
                  setDraft(text);
                  if (commentError) setCommentError(null);
                }}
                placeholder="Add a comment"
                placeholderTextColor={theme.muted + "b3"}
                accessibilityLabel="Add a comment"
                maxLength={COMMENT_MAX}
                multiline
                editable={!sending}
                cursorColor={theme.brand}
                selectionColor={theme.brandSoft}
                style={{
                  flex: 1,
                  minHeight: 44,
                  maxHeight: 120,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: radius.control,
                  backgroundColor: theme.surface,
                  paddingHorizontal: 14,
                  paddingVertical: 11,
                  fontFamily: fonts.body,
                  fontSize: 15,
                  color: theme.foreground,
                }}
              />
              {sending ? (
                <View
                  style={{
                    width: 44,
                    height: 44,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <ActivityIndicator size="small" color={theme.brand} />
                </View>
              ) : (
                <Button
                  label="Comment"
                  size="sm"
                  disabled={draft.trim().length === 0}
                  onPress={() => void handleComment()}
                />
              )}
            </View>
          </View>
        </>,
        overflow
      )}

      {/* The post's own overflow: yours to take down, the steward's to
          remove, anyone's to report. */}
      <Sheet
        visible={postMenuOpen}
        onClose={() => setPostMenuOpen(false)}
        title={post.title}
      >
        {mine ? (
          <Sheet.Row
            icon="trash-2"
            label="Delete post"
            danger
            onPress={() => {
              setPostMenuOpen(false);
              if (!removed) confirmRemovePost(false);
            }}
          />
        ) : (
          <>
            {steward && !removed ? (
              <Sheet.Row
                icon="trash-2"
                label="Remove post"
                danger
                onPress={() => {
                  setPostMenuOpen(false);
                  confirmRemovePost(true);
                }}
              />
            ) : null}
            <Sheet.Row
              icon="flag"
              label="Report post"
              danger
              onPress={() => {
                setPostMenuOpen(false);
                reportPost();
              }}
            />
          </>
        )}
      </Sheet>

      {/* One comment's overflow, same three-way split as the post's. */}
      <Sheet
        visible={menuComment !== null}
        onClose={() => setMenuComment(null)}
        title="This comment"
      >
        {menuComment && isMine(menuComment, myId) ? (
          <Sheet.Row
            icon="trash-2"
            label="Delete comment"
            danger
            onPress={() => {
              const comment = menuComment;
              setMenuComment(null);
              if (comment && comment.deleted_at === null) {
                confirmRemoveComment(comment, false);
              }
            }}
          />
        ) : (
          <>
            {steward && menuComment?.deleted_at === null ? (
              <Sheet.Row
                icon="trash-2"
                label="Remove comment"
                danger
                onPress={() => {
                  const comment = menuComment;
                  setMenuComment(null);
                  if (comment) confirmRemoveComment(comment, true);
                }}
              />
            ) : null}
            <Sheet.Row
              icon="flag"
              label="Report comment"
              danger
              onPress={() => {
                const comment = menuComment;
                setMenuComment(null);
                if (comment) reportComment(comment);
              }}
            />
          </>
        )}
      </Sheet>
    </>
  );
}
