import Feather from "@expo/vector-icons/Feather";
import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { MagnifyingGlass } from "@/components/illustrations";
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  Sheet,
  Skeleton,
} from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useBlockedIds } from "@/hooks/use-blocked";
import { useTheme } from "@/hooks/use-theme";
import {
  BoardError,
  categoryInfo,
  closePost,
  deletePost,
  fetchPost,
  isMine,
  parseBoardDay,
  priceLabel,
  reopenPost,
  rideLabel,
  type BoardPost,
} from "@/lib/board";
import { tapSuccess } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* One post on the campus board, and the two things that can happen to it.
 *
 * For a reader, the point of this screen is the Message button: a board post
 * is only ever half an arrangement, and the other half is a conversation. It
 * goes through the same find-or-create `create_dm_thread` RPC the profile and
 * study-partner screens use, so "message the person with the couch" lands in
 * the same thread as every other time you've talked.
 *
 * For the author, the point is the sheet. Marking a post sorted is the
 * ordinary end of its life — the row stays readable, greyed, at the bottom of
 * the board — and it's optimistic, because the author already knows the ride
 * filled. Delete is the narrow case of a post that shouldn't have been
 * written, and its confirmation says what's actually lost.
 */

type FeatherName = ComponentProps<typeof Feather>["name"];

type Status = "loading" | "error" | "missing" | "ready";

/** "Friday, October 14" — the long form under a ride's short label. */
function longDay(day: Date): string {
  return day.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

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

/** One line of the details card: a soft ember icon and whatever it labels. */
function MetaRow({ icon, children }: { icon: FeatherName; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: radius.control,
          backgroundColor: theme.brandSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name={icon} size={14} color={theme.brand} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2, paddingTop: 3 }}>
        {children}
      </View>
    </View>
  );
}

export default function BoardPostScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const myId = session?.user.id ?? null;
  const params = useLocalSearchParams<{ id: string }>();
  const postId = typeof params.id === "string" ? params.id : "";

  const [post, setPost] = useState<BoardPost | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const [menuOpen, setMenuOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [messaging, setMessaging] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);

  /* Filtering the board list isn't enough on its own: a link, a share, or a
     back-button can still land on one post. The block list says "their posts
     stay out of sight", and this is the other half of keeping that. */
  const { blocked } = useBlockedIds();

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/board");
  }, []);

  const load = useCallback(async () => {
    if (postId === "") {
      setStatus("missing");
      return;
    }
    try {
      const row = await fetchPost(postId);
      setNow(new Date());
      setLoadError(null);
      if (!row) {
        setStatus("missing");
        return;
      }
      setPost(row);
      setStatus("ready");
    } catch (caught) {
      // A post already on screen stays on screen — a failed refresh says so
      // in one line at the top rather than throwing the reader out of it.
      setLoadError(
        caught instanceof BoardError
          ? caught.message
          : "We couldn't open that post. Check your connection and give it another go."
      );
      setStatus((current) => (current === "ready" ? current : "error"));
    }
  }, [postId]);

  // Reload on focus, not just on mount — coming back from the composer should
  // show the edit that was just saved.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  /**
   * Mark it sorted, or put it back up. Optimistic: the author already knows
   * the ride filled, so the chip lands immediately and only a refusal takes
   * it back — with a line saying so.
   *
   * `closePost` and `reopenPost` are guarded on the server, so a second tap
   * resolves with null rather than moving the time it closed. Null here means
   * "already in that state", which is exactly what the screen is showing.
   */
  const toggleSorted = useCallback(async () => {
    if (!post || working) return;
    const previous = post;
    const wasClosed = previous.closed_at !== null;
    setActionError(null);
    setWorking(true);
    setPost({
      ...previous,
      closed_at: wasClosed ? null : new Date().toISOString(),
    });
    try {
      const saved = wasClosed
        ? await reopenPost(previous.id)
        : await closePost(previous.id);
      if (saved) setPost(saved);
      if (!wasClosed) tapSuccess();
    } catch (caught) {
      setPost(previous);
      setActionError(
        caught instanceof BoardError
          ? caught.message
          : "That didn't save just now. Give it another tap."
      );
    } finally {
      setWorking(false);
    }
  }, [post, working]);

  /** Take it down for good, once the author has heard what that costs. */
  const confirmDelete = useCallback(() => {
    if (!post || working) return;
    const target = post;
    Alert.alert(
      "Take this down?",
      "It comes off the board and nobody can read it again. Marking it sorted leaves it up for anyone still looking.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Take it down",
          style: "destructive",
          onPress: () => {
            setActionError(null);
            setWorking(true);
            void deletePost(target.id)
              .then(() => {
                goBack();
              })
              .catch((caught: unknown) => {
                setActionError(
                  caught instanceof BoardError
                    ? caught.message
                    : "We couldn't take that post down. Give it another go."
                );
              })
              .finally(() => setWorking(false));
          },
        },
      ]
    );
  }, [post, working, goBack]);

  /**
   * Open the 1:1 thread with whoever put this up. `create_dm_thread` is
   * find-or-create on the server, so one call covers both "we've talked
   * before" and "we haven't".
   *
   * Every failure reads the same on purpose. The server also refuses across a
   * block, and a block is one-way and private — a message that said "you two
   * can't message each other" would only ever be read by the person who got
   * blocked, which tells them exactly what they were never meant to learn.
   */
  const handleMessage = useCallback(async () => {
    if (!post || messaging) return;
    setMessageError(null);
    setMessaging(true);
    try {
      const { data, error } = await supabase.rpc("create_dm_thread", {
        other_user: post.author_id,
      });
      const threadId = typeof data === "string" ? data : null;
      if (error || !threadId) throw error ?? new Error("No thread");
      router.push(`/dm/${threadId}`);
    } catch {
      setMessageError("We couldn't open that conversation. Give it another go.");
    } finally {
      setMessaging(false);
    }
  }, [post, messaging]);

  /**
   * Report the post. `/report` writes `reports.board_post_id` and names the
   * post in its own words; the author rides along as well so the report keeps
   * a subject if the post itself is later deleted.
   */
  const openReport = useCallback(() => {
    if (!post) return;
    router.push({
      pathname: "/report",
      params: {
        boardPostId: post.id,
        userId: post.author_id,
        label: post.title,
      },
    });
  }, [post]);

  // A deep link can land here signed out — send them to a proper door.
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

  const scaffold = (children: ReactNode, action?: ReactNode) => (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        style={{
          paddingTop: insets.top + space.close,
          paddingHorizontal: 12,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        {backChevron}
        <View style={{ flex: 1 }} />
        {action}
      </View>
      {children}
    </View>
  );

  /* --------------------------- pre-post states --------------------------- */

  if (status === "loading" && !post) {
    /* Every post on the board has the same bones — a category chip, the
       headline, when it went up, and the card with whoever put it there — so
       the page draws itself first and the words land into it. */
    return scaffold(
      <View style={{ paddingHorizontal: 20, paddingTop: 4, gap: 12 }}>
        <Skeleton width={94} height={28} radius={radius.full} />
        <Skeleton width="86%" height={30} />
        <Skeleton width={118} height={11} radius={radius.full} />
        <View style={{ gap: 8, marginTop: 4 }}>
          <Skeleton width="100%" height={12} radius={radius.full} />
          <Skeleton width="93%" height={12} radius={radius.full} />
          <Skeleton width="56%" height={12} radius={radius.full} />
        </View>
        <Card
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            marginTop: 8,
          }}
        >
          <Skeleton width={44} height={44} radius={radius.full} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width="52%" height={13} radius={radius.full} />
            <Skeleton width="38%" height={11} radius={radius.full} />
          </View>
        </Card>
      </View>
    );
  }

  if (status === "missing") {
    return scaffold(
      <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 20 }}>
        <EmptyState
          illustration={MagnifyingGlass}
          title="That post isn't there"
          body="It may have already come down. The board has everything that's still up, and there's usually another ride."
          action={{ label: "Back to the board", onPress: goBack }}
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
          gap: 10,
          paddingHorizontal: 28,
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
          {loadError ??
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

  if (blocked.has(post.author_id)) {
    return scaffold(
      <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 20 }}>
        <EmptyState
          icon="slash"
          title="This one's from someone you blocked"
          body="Their posts stay out of sight while they're on your list. Blocked people, in Settings, is where that comes undone."
          action={{ label: "Back to the board", onPress: goBack }}
        />
      </View>
    );
  }

  /* ----------------------------- the post ------------------------------ */

  const info = categoryInfo(post.category);
  const mine = isMine(post, myId);
  const closed = post.closed_at !== null;
  const price = priceLabel(post.price_cents);
  const ride = rideLabel(post.happens_on, now);
  const rideDay = parseBoardDay(post.happens_on);
  const author = post.author;
  // "Just now" opens a sentence everywhere else in the app; here it finishes
  // one. Only that one label needs lowering — "Put up aug 2" would be worse.
  const posted = timeAgo(post.created_at, now);
  const postedLine = posted === "Just now" ? "Put up just now" : `Put up ${posted}`;
  const authorName = mine
    ? "You"
    : author
      ? author.locked
        ? `@${author.handle}`
        : author.display_name
      : "Someone on campus";

  const overflow = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={mine ? "Post options" : "Report this post"}
      onPress={() => setMenuOpen(true)}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {working ? (
        <ActivityIndicator size="small" color={theme.brand} />
      ) : (
        <Feather name="more-horizontal" size={22} color={theme.foreground} />
      )}
    </Pressable>
  );

  return (
    <>
      {scaffold(
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 4,
            paddingBottom: insets.bottom + space.rest,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.brand}
              colors={[theme.brand]}
            />
          }
        >
          {loadError ? (
            <AppText
              variant="caption"
              style={{ color: theme.danger, marginBottom: 10 }}
            >
              {loadError}
            </AppText>
          ) : null}

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 6,
              marginBottom: 10,
            }}
          >
            <Chip label={info.label} icon={info.icon} tone="brand" size="md" />
            {closed ? (
              <Chip label="Sorted" icon="check" tone="accent" size="md" />
            ) : null}
          </View>

          <AppText variant="display">{post.title}</AppText>

          <AppText variant="caption" muted style={{ marginTop: 6 }}>
            {postedLine}
          </AppText>

          {price !== null || ride !== null ? (
            <Card style={{ marginTop: 16, gap: 12 }}>
              {price !== null ? (
                <MetaRow icon="tag">
                  <AppText variant="bodySemi">{price}</AppText>
                </MetaRow>
              ) : null}
              {ride !== null ? (
                <MetaRow icon="calendar">
                  <AppText variant="bodyMedium">{ride}</AppText>
                  {rideDay ? (
                    <AppText variant="caption" muted>
                      {longDay(rideDay)}
                    </AppText>
                  ) : null}
                </MetaRow>
              ) : null}
            </Card>
          ) : null}

          {post.body ? (
            <AppText style={{ marginTop: 16, lineHeight: 22 }}>
              {post.body}
            </AppText>
          ) : null}

          {closed ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 9,
                padding: 12,
                borderRadius: radius.control,
                backgroundColor: theme.accentSoft,
                marginTop: 16,
              }}
            >
              <Feather
                name="check-circle"
                size={14}
                color={theme.accent}
                style={{ marginTop: 2 }}
              />
              <AppText variant="caption" style={{ flex: 1, lineHeight: 17 }}>
                {mine
                  ? "You marked this sorted. It stays on the board, at the bottom, so people can still read it."
                  : "This one's been sorted. It stays up so you can still see what happened."}
              </AppText>
            </View>
          ) : null}

          {/* Who's behind it, and the way to say something about it. */}
          <Card style={{ marginTop: 20, gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              {author && !mine ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${authorName}'s profile`}
                  onPress={() => router.push(`/u/${author.handle}`)}
                  style={({ pressed }) => ({
                    flex: 1,
                    minWidth: 0,
                    minHeight: 44,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Avatar
                    url={author.avatar_url}
                    name={author.locked ? author.handle : author.display_name}
                    size={44}
                  />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <AppText variant="bodySemi" numberOfLines={1}>
                      {authorName}
                    </AppText>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      {author.locked ? (
                        <Feather name="lock" size={11} color={theme.muted} />
                      ) : null}
                      <AppText variant="caption" muted numberOfLines={1}>
                        {author.locked ? "Private profile" : `@${author.handle}`}
                      </AppText>
                    </View>
                  </View>
                </Pressable>
              ) : (
                <View
                  style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 44,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <Avatar url={author?.avatar_url} name={authorName} size={44} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <AppText variant="bodySemi" numberOfLines={1}>
                      {authorName}
                    </AppText>
                    <AppText variant="caption" muted numberOfLines={1}>
                      {mine ? "This one's yours" : "Their profile isn't around"}
                    </AppText>
                  </View>
                </View>
              )}
              {mine ? <Chip label="You" tone="brand" /> : null}
            </View>

            {!mine ? (
              <Button
                label="Message"
                pending={messaging}
                onPress={() => void handleMessage()}
                icon={
                  <Feather
                    name="message-circle"
                    size={16}
                    color={theme.brandFg}
                  />
                }
              />
            ) : null}

            {messageError ? (
              <AppText variant="caption" style={{ color: theme.danger }}>
                {messageError}
              </AppText>
            ) : null}
          </Card>

          {actionError ? (
            <AppText
              variant="caption"
              style={{ color: theme.danger, marginTop: 12 }}
            >
              {actionError}
            </AppText>
          ) : null}
        </ScrollView>,
        overflow
      )}

      <Sheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={post.title}
      >
        {mine ? (
          <>
            <Sheet.Row
              icon="edit-2"
              label="Edit post"
              onPress={() => {
                setMenuOpen(false);
                router.push({
                  pathname: "/board/new",
                  params: { id: post.id },
                });
              }}
            />
            <Sheet.Row
              icon={closed ? "rotate-ccw" : "check-circle"}
              label={closed ? "Put it back up" : "Mark it sorted"}
              onPress={() => {
                setMenuOpen(false);
                void toggleSorted();
              }}
            />
            <Sheet.Row
              icon="trash-2"
              label="Delete post"
              danger
              onPress={() => {
                setMenuOpen(false);
                confirmDelete();
              }}
            />
          </>
        ) : (
          <Sheet.Row
            icon="flag"
            label="Report post"
            danger
            onPress={() => {
              setMenuOpen(false);
              openReport();
            }}
          />
        )}
      </Sheet>
    </>
  );
}
