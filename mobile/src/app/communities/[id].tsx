import Feather from "@expo/vector-icons/Feather";
import {
  Redirect,
  router,
  useFocusEffect,
  useLocalSearchParams,
} from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  TextInput,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RoomTile } from "@/components/room-tile";
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  SectionLabel,
  Sheet,
  SkeletonRow,
} from "@/components/ui";
import { fonts, radius, space } from "@/constants/theme";
import { useBlockedIds } from "@/hooks/use-blocked";
import { useTheme } from "@/hooks/use-theme";
import {
  castVote,
  clearVote,
  CommunityError,
  closeCommunity,
  commentsLabel,
  createCommunityPost,
  fetchCommunity,
  fetchCommunityRooms,
  fetchFeedPage,
  fetchMyRole,
  fetchMyVotes,
  isMine,
  joinCommunity,
  leaveCommunity,
  membersLabel,
  POST_BODY_MAX,
  POST_TITLE_MAX,
  POST_TITLE_MIN,
  POSTS_PAGE,
  removeCommunityPost,
  type Community,
  type CommunityPost,
  type CommunityRole,
  type CommunityRoom,
  type PostSort,
  type VoteValue,
} from "@/lib/communities";
import { tapSuccess } from "@/lib/haptics";
import { roomTitle } from "@/lib/room-identity";
import { useAuth } from "@/providers/auth-provider";

/* One community: its doorway, its feed, and its rooms.
 *
 * The doorway is the header: name, what it's about, who's in it, and Join
 * or Leave. The feed underneath is the campus reading it, thirty posts a
 * page, sorted New or Top, votes landing optimistically because a vote is
 * the reader's own opinion and they already know what it is. The composer
 * lives inline rather than on its own screen: a community post is a thought,
 * not a form, and members should be one tap from saying it.
 *
 * Rooms sit between the doorway and the feed. They are ordinary topic
 * channels wearing the community's id, so opening one is the normal channel
 * screen and starting one is the normal channel-create flow with the
 * community preset.
 */

type Status = "loading" | "error" | "notFound" | "ready";

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
 * One post at arm's length: headline, the first lines of the body, who and
 * when, then the row that makes a feed a feed: the arrows, the score, and
 * the comment count. A folded or removed post keeps its bones and says what
 * happened to it, because only the people who can act on it receive it at
 * all.
 */
function FeedRow({
  post,
  index,
  now,
  mine,
  myVote,
  onOpen,
  onVote,
  onMenu,
}: {
  post: CommunityPost;
  /** Position in the list, for the staggered arrival. */
  index: number;
  now: Date;
  mine: boolean;
  myVote: VoteValue | null;
  onOpen: () => void;
  onVote: (value: VoteValue) => void;
  onMenu: () => void;
}) {
  const theme = useTheme();
  const removed = post.deleted_at !== null;
  const folded = post.hidden_at !== null;
  const author = mine
    ? "You"
    : (post.author?.display_name ?? "Someone on campus");

  return (
    <Card
      padded={false}
      entrance={index}
      style={{ marginBottom: space.room }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${post.title}${removed ? ". This post was removed." : folded ? ". Hidden by downvotes." : ""}`}
        onPress={onOpen}
        style={({ pressed }) => ({
          gap: space.cosy,
          paddingHorizontal: space.card,
          paddingTop: space.card,
          opacity: (removed || folded ? 0.7 : 1) * (pressed ? 0.7 : 1),
        })}
      >
        {folded && !removed ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.snug,
            }}
          >
            <Feather name="eye-off" size={12} color={theme.muted} />
            <AppText variant="caption" muted>
              Hidden by downvotes.
            </AppText>
          </View>
        ) : null}

        <AppText variant="bodySemi" numberOfLines={2}>
          {post.title}
        </AppText>

        {removed ? (
          <AppText variant="caption" muted>
            This post was removed.
          </AppText>
        ) : post.body ? (
          <AppText muted numberOfLines={2}>
            {post.body}
          </AppText>
        ) : null}

        <AppText variant="caption" muted numberOfLines={1}>
          {author} · {timeAgo(post.created_at, now)}
        </AppText>
      </Pressable>

      {/* The arrows keep working on a folded post: recovery is the campus
          voting it back up, so taking the vote away would seal the fold. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: space.cosy,
          paddingBottom: space.tight,
        }}
      >
        <VoteArrow
          direction="up"
          lit={myVote === 1}
          onPress={() => onVote(1)}
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
          onPress={() => onVote(-1)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open comments, ${commentsLabel(post.comment_count)}`}
          onPress={onOpen}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: space.snug,
            minHeight: 44,
            paddingHorizontal: space.cosy,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="message-circle" size={14} color={theme.muted} />
          <AppText variant="caption" muted>
            {commentsLabel(post.comment_count)}
          </AppText>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Post options"
          onPress={onMenu}
          hitSlop={4}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="more-horizontal" size={18} color={theme.muted} />
        </Pressable>
      </View>
    </Card>
  );
}

export default function CommunityScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const myId = session?.user.id ?? null;
  const params = useLocalSearchParams<{ id: string }>();
  const communityId = typeof params.id === "string" ? params.id : "";

  const [status, setStatus] = useState<Status>("loading");
  const [community, setCommunity] = useState<Community | null>(null);
  const [myRole, setMyRole] = useState<CommunityRole | null>(null);
  const [rooms, setRooms] = useState<CommunityRoom[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [sort, setSort] = useState<PostSort>("new");
  const [posts, setPosts] = useState<CommunityPost[] | null>(null);
  const [votes, setVotes] = useState<Record<string, VoteValue>>({});
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  // Every relative label reads off one moment, refreshed with the list.
  const [now, setNow] = useState(() => new Date());

  const [membershipBusy, setMembershipBusy] = useState(false);
  const [membershipError, setMembershipError] = useState<string | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  const [toolsOpen, setToolsOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [menuPost, setMenuPost] = useState<CommunityPost | null>(null);

  /* The page the feed is on, held in a ref because pagination mutates it
     without wanting a re-render of its own. */
  const pageRef = useRef(0);

  const steward = myRole === "steward";
  const member = myRole !== null;

  /* The block-list promise reaches the feed too: a blocked classmate's
     posts stay out of sight, refreshed alongside the list. */
  const { blocked, refresh: refreshBlocked } = useBlockedIds();

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/communities");
  }, []);

  /** The doorway: the community, my seat in it, and its rooms, together. */
  const load = useCallback(async () => {
    if (!communityId) {
      setStatus("notFound");
      return;
    }
    try {
      const [row, role, roomRows] = await Promise.all([
        fetchCommunity(communityId),
        fetchMyRole(communityId),
        fetchCommunityRooms(communityId).catch((): CommunityRoom[] => []),
      ]);
      if (!row) {
        setStatus("notFound");
        return;
      }
      setCommunity(row);
      setMyRole(role);
      setRooms(roomRows);
      setStatus("ready");
    } catch {
      setStatus((current) => (current === "ready" ? current : "error"));
    }
  }, [communityId]);

  /**
   * One page of the feed, and the caller's own votes on it, merged in.
   * `reset` starts over at page zero: the first load, a sort change, a
   * pull-to-refresh. Anything else appends.
   */
  const loadFeed = useCallback(
    async (reset: boolean) => {
      if (!communityId) return;
      const page = reset ? 0 : pageRef.current + 1;
      try {
        const rows = await fetchFeedPage(communityId, sort, page);
        const pageVotes = await fetchMyVotes(rows.map((row) => row.id));
        pageRef.current = page;
        setHasMore(rows.length === POSTS_PAGE);
        setNow(new Date());
        setFeedError(null);
        setVotes((prev) => (reset ? pageVotes : { ...prev, ...pageVotes }));
        setPosts((prev) => {
          if (reset || prev === null) return rows;
          // A post can straddle two pages when the feed moved under us;
          // keep the first copy, drop the echo.
          const seen = new Set(prev.map((row) => row.id));
          return [...prev, ...rows.filter((row) => !seen.has(row.id))];
        });
      } catch (caught) {
        setFeedError(
          caught instanceof CommunityError
            ? caught.message
            : "We couldn't load the feed. Check your connection and give it another go."
        );
      }
    },
    [communityId, sort]
  );

  /* Both loads run on focus, so a post written on the post screen and a
     room started in the create flow are already here on the way back. */
  useFocusEffect(
    useCallback(() => {
      void refreshBlocked();
      void load();
      void loadFeed(true);
    }, [load, loadFeed, refreshBlocked])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Promise.all([load(), loadFeed(true)]).finally(() =>
      setRefreshing(false)
    );
  }, [load, loadFeed]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || posts === null) return;
    setLoadingMore(true);
    void loadFeed(false).finally(() => setLoadingMore(false));
  }, [hasMore, loadingMore, posts, loadFeed]);

  const pickSort = useCallback(
    (next: PostSort) => {
      if (next === sort) return;
      // A different order is a different query; say so with the skeletons.
      setPosts(null);
      setSort(next);
    },
    [sort]
  );

  /* ---------------------------- membership ---------------------------- */

  const handleJoin = useCallback(async () => {
    if (membershipBusy) return;
    setMembershipError(null);
    setMembershipBusy(true);
    // Optimistic: you're in right away, and step back out on a refusal.
    setMyRole("member");
    setCommunity((prev) =>
      prev ? { ...prev, member_count: prev.member_count + 1 } : prev
    );
    try {
      await joinCommunity(communityId);
    } catch (caught) {
      setMyRole(null);
      setCommunity((prev) =>
        prev
          ? { ...prev, member_count: Math.max(prev.member_count - 1, 0) }
          : prev
      );
      setMembershipError(
        caught instanceof CommunityError
          ? caught.message
          : "We couldn't add you just now. Give it another try."
      );
    } finally {
      setMembershipBusy(false);
    }
  }, [membershipBusy, communityId]);

  const doLeave = useCallback(async () => {
    if (membershipBusy) return;
    setMembershipError(null);
    setMembershipBusy(true);
    const previousRole = myRole;
    setMyRole(null);
    setComposerOpen(false);
    setCommunity((prev) =>
      prev
        ? { ...prev, member_count: Math.max(prev.member_count - 1, 0) }
        : prev
    );
    try {
      await leaveCommunity(communityId);
    } catch (caught) {
      setMyRole(previousRole);
      setCommunity((prev) =>
        prev ? { ...prev, member_count: prev.member_count + 1 } : prev
      );
      setMembershipError(
        caught instanceof CommunityError
          ? caught.message
          : "We couldn't take you off the roster just now. Give it another try."
      );
    } finally {
      setMembershipBusy(false);
    }
  }, [membershipBusy, myRole, communityId]);

  const confirmLeave = useCallback(() => {
    if (!community) return;
    Alert.alert(
      `Leave ${community.name}?`,
      "You come off the roster and stop being able to post. The feed stays readable, and you can rejoin any time.",
      [
        { text: "Stay", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: () => void doLeave() },
      ]
    );
  }, [community, doLeave]);

  /* --------------------------- steward tools --------------------------- */

  const confirmClose = useCallback(() => {
    if (!community || closing) return;
    Alert.alert(
      `Close ${community.name}?`,
      "The whole community comes down: the feed, the roster, everything. Nobody can read any of it again.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Close community",
          style: "destructive",
          onPress: () => {
            setClosing(true);
            void closeCommunity(community.id)
              .then(() => {
                goBack();
              })
              .catch((caught: unknown) => {
                setMembershipError(
                  caught instanceof CommunityError
                    ? caught.message
                    : "We couldn't close the community just now. Give it another go."
                );
              })
              .finally(() => setClosing(false));
          },
        },
      ]
    );
  }, [community, closing, goBack]);

  /* ------------------------------ voting ------------------------------ */

  /**
   * Tap an arrow: cast, flip, or take back, decided against the vote the
   * screen is already showing. The score moves immediately and only a
   * refusal moves it back, because the voter is the one person who already
   * knows how this vote goes.
   */
  const applyVote = useCallback(
    (post: CommunityPost, tapped: VoteValue) => {
      const current = votes[post.id] ?? null;
      const next = current === tapped ? null : tapped;
      const delta = (next ?? 0) - (current ?? 0);
      setFeedError(null);
      setVotes((prev) => {
        const out = { ...prev };
        if (next === null) delete out[post.id];
        else out[post.id] = next;
        return out;
      });
      const shift = (by: number) => {
        setPosts((prev) =>
          prev === null
            ? prev
            : prev.map((row) =>
                row.id === post.id ? { ...row, score: row.score + by } : row
              )
        );
      };
      shift(delta);
      void (next === null ? clearVote(post.id) : castVote(post.id, next))
        .catch((caught: unknown) => {
          setVotes((prev) => {
            const out = { ...prev };
            if (current === null) delete out[post.id];
            else out[post.id] = current;
            return out;
          });
          shift(-delta);
          setFeedError(
            caught instanceof CommunityError
              ? caught.message
              : "That vote didn't land. Give it another tap."
          );
        });
    },
    [votes]
  );

  /* ---------------------------- the composer ---------------------------- */

  const handlePost = useCallback(async () => {
    if (posting) return;
    setComposerError(null);
    setPosting(true);
    try {
      const post = await createCommunityPost(communityId, draftTitle, draftBody);
      // It's on the feed: the completion moment.
      tapSuccess();
      setDraftTitle("");
      setDraftBody("");
      setComposerOpen(false);
      setNow(new Date());
      // Newest-first shows it on top where it just landed; Top would bury a
      // zero-score newcomer, so flipping to New is the honest response.
      if (sort === "new") {
        setPosts((prev) => (prev === null ? [post] : [post, ...prev]));
      } else {
        setPosts(null);
        setSort("new");
      }
    } catch (caught) {
      setComposerError(
        caught instanceof CommunityError
          ? caught.message
          : "That didn't post just now. Give it another go."
      );
    } finally {
      setPosting(false);
    }
  }, [posting, communityId, draftTitle, draftBody, sort]);

  /* --------------------------- post overflow ---------------------------- */

  const confirmRemovePost = useCallback(
    (post: CommunityPost, asSteward: boolean) => {
      Alert.alert(
        asSteward ? "Remove this post?" : "Take this post down?",
        "It comes off the feed for the campus. You, the author, and moderators can still see it was there.",
        [
          { text: "Keep it", style: "cancel" },
          {
            text: asSteward ? "Remove" : "Take it down",
            style: "destructive",
            onPress: () => {
              // Optimistic: the row shows removed immediately, and comes
              // back whole with a warm line if the server refuses.
              const stamp = new Date().toISOString();
              setFeedError(null);
              setPosts((prev) =>
                prev === null
                  ? prev
                  : prev.map((row) =>
                      row.id === post.id ? { ...row, deleted_at: stamp } : row
                    )
              );
              void removeCommunityPost(post.id).catch((caught: unknown) => {
                setPosts((prev) =>
                  prev === null
                    ? prev
                    : prev.map((row) =>
                        row.id === post.id ? { ...row, deleted_at: null } : row
                      )
                );
                setFeedError(
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
    []
  );

  const openReport = useCallback((post: CommunityPost) => {
    router.push({
      pathname: "/report",
      params: {
        communityPostId: post.id,
        userId: post.author_id,
        label: post.title,
      },
    });
  }, []);

  /* ------------------------------ render ------------------------------ */

  const visiblePosts = useMemo(
    () => (posts ?? []).filter((post) => !blocked.has(post.author_id)),
    [posts, blocked]
  );

  const openPost = useCallback(
    (post: CommunityPost) => {
      router.push({
        pathname: "/communities/post",
        params: { communityId, postId: post.id },
      });
    },
    [communityId]
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<CommunityPost>) => (
      <FeedRow
        post={item}
        index={index}
        now={now}
        mine={isMine(item, myId)}
        myVote={votes[item.id] ?? null}
        onOpen={() => openPost(item)}
        onVote={(value) => applyVote(item, value)}
        onMenu={() => setMenuPost(item)}
      />
    ),
    [now, myId, votes, openPost, applyVote]
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

  if (status !== "ready" || !community) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + space.close,
        }}
      >
        <View style={{ paddingHorizontal: space.close }}>{backChevron}</View>
        {status === "loading" ? (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: space.close,
            }}
          >
            <ActivityIndicator size="large" color={theme.brand} />
            <AppText variant="caption" muted>
              Opening the community…
            </AppText>
          </View>
        ) : status === "notFound" ? (
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              paddingHorizontal: space.gutter,
            }}
          >
            <EmptyState
              icon="globe"
              title="That community isn't there"
              body="It may have closed, or it belongs to another campus. The list has everything that's still open."
              action={{
                label: "Back to communities",
                onPress: () => router.replace("/communities"),
              }}
            />
          </View>
        ) : (
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
              We couldn't load this community. Check your connection and give
              it another go.
            </AppText>
            <Button
              label="Try again"
              variant="soft"
              size="sm"
              onPress={() => {
                setStatus("loading");
                void load();
                void loadFeed(true);
              }}
            />
          </View>
        )}
      </View>
    );
  }

  const canPost = draftTitle.trim().length >= POST_TITLE_MIN;

  const header = (
    <View>
      <View style={{ gap: space.close }}>
        <View style={{ gap: space.cosy }}>
          <AppText variant="display">{community.name}</AppText>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.cosy,
              flexWrap: "wrap",
            }}
          >
            {steward ? (
              <Chip label="Steward" tone="brand" icon="feather" />
            ) : member ? (
              <Chip label="Joined" tone="accent" icon="check" />
            ) : null}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.tight,
              }}
            >
              <Feather name="user" size={12} color={theme.muted} />
              <AppText variant="caption" muted>
                {membersLabel(community.member_count)}
              </AppText>
            </View>
          </View>
          {community.description ? (
            <AppText muted>{community.description}</AppText>
          ) : null}
        </View>

        {!member ? (
          <Button
            label="Join"
            pending={membershipBusy}
            icon={<Feather name="user-plus" size={16} color={theme.brandFg} />}
            onPress={() => void handleJoin()}
          />
        ) : steward ? (
          /* The steward closes the doors rather than slipping out of them:
             a community whose steward left is a room nobody tends. */
          <AppText variant="caption" muted>
            You tend this community. Closing it lives behind the tools, up
            top.
          </AppText>
        ) : (
          <Button
            label="Leave"
            variant="secondary"
            size="sm"
            pending={membershipBusy}
            icon={<Feather name="log-out" size={14} color={theme.muted} />}
            onPress={confirmLeave}
            style={{ alignSelf: "flex-start" }}
          />
        )}
        {membershipError ? (
          <AppText
            variant="caption"
            accessibilityLiveRegion="polite"
            style={{ color: theme.danger }}
          >
            {membershipError}
          </AppText>
        ) : null}
      </View>

      {/* The rooms: live talk stemming off the feed. */}
      <SectionLabel
        text="Rooms"
        action={
          member
            ? {
                label: "Start a room",
                onPress: () =>
                  router.push({
                    pathname: "/channels/new",
                    params: { communityId: community.id },
                  }),
              }
            : undefined
        }
      />
      {rooms.length > 0 ? (
        <Card padded={false}>
          {rooms.map((room, index) => {
            const title = roomTitle(room.name, room.slug);
            return (
              <Pressable
                key={room.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${title}`}
                onPress={() => router.push(`/channel/${room.id}`)}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.close,
                    paddingHorizontal: space.card,
                    paddingVertical: space.room,
                    minHeight: 52,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: theme.border,
                  }}
                >
                  <RoomTile
                    kind="topic"
                    name={room.name ?? room.slug}
                    slug={room.slug}
                    size={32}
                  />
                  <AppText
                    variant="bodyMedium"
                    numberOfLines={1}
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    {title}
                  </AppText>
                  <Feather name="chevron-right" size={16} color={theme.muted} />
                </View>
              </Pressable>
            );
          })}
        </Card>
      ) : (
        <EmptyState
          compact
          icon="message-circle"
          title="No rooms yet"
          body={
            member
              ? "When the feed isn't fast enough, start a room and talk live."
              : "Members can start rooms here for live talk."
          }
          action={
            member
              ? {
                  label: "Start a room",
                  onPress: () =>
                    router.push({
                      pathname: "/channels/new",
                      params: { communityId: community.id },
                    }),
                }
              : undefined
          }
        />
      )}

      {/* The feed's controls: how it's sorted, and the way onto it. */}
      <SectionLabel text="Feed" />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.cosy,
          marginBottom: space.close,
        }}
      >
        <Chip
          label="New"
          tone="brand"
          size="md"
          selected={sort === "new"}
          onPress={() => pickSort("new")}
          accessibilityLabel="Sort by newest"
        />
        <Chip
          label="Top"
          tone="brand"
          size="md"
          selected={sort === "top"}
          onPress={() => pickSort("top")}
          accessibilityLabel="Sort by score"
        />
        <View style={{ flex: 1 }} />
        {member && !composerOpen ? (
          <Button
            label="New post"
            size="sm"
            icon={<Feather name="edit-3" size={14} color={theme.brandFg} />}
            onPress={() => setComposerOpen(true)}
          />
        ) : null}
      </View>

      {member && composerOpen ? (
        <Card style={{ gap: space.close, marginBottom: space.close }}>
          <AppText variant="title">New post</AppText>
          <TextInput
            value={draftTitle}
            onChangeText={(text) => {
              setDraftTitle(text);
              if (composerError) setComposerError(null);
            }}
            placeholder="Title"
            placeholderTextColor={theme.muted + "b3"}
            accessibilityLabel="Title"
            maxLength={POST_TITLE_MAX}
            editable={!posting}
            cursorColor={theme.brand}
            selectionColor={theme.brandSoft}
            style={{
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: radius.control,
              backgroundColor: theme.surface,
              paddingHorizontal: 14,
              paddingVertical: 12,
              fontFamily: fonts.body,
              fontSize: 15,
              color: theme.foreground,
            }}
          />
          <TextInput
            value={draftBody}
            onChangeText={(text) => {
              setDraftBody(text);
              if (composerError) setComposerError(null);
            }}
            placeholder="Say more (optional)"
            placeholderTextColor={theme.muted + "b3"}
            accessibilityLabel="Say more (optional)"
            maxLength={POST_BODY_MAX}
            multiline
            editable={!posting}
            cursorColor={theme.brand}
            selectionColor={theme.brandSoft}
            style={{
              minHeight: 96,
              textAlignVertical: "top",
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: radius.control,
              backgroundColor: theme.surface,
              paddingHorizontal: 14,
              paddingVertical: 12,
              fontFamily: fonts.body,
              fontSize: 15,
              color: theme.foreground,
            }}
          />
          {composerError ? (
            <AppText variant="caption" style={{ color: theme.danger }}>
              {composerError}
            </AppText>
          ) : null}
          <View style={{ flexDirection: "row", gap: space.cosy }}>
            <Button
              label="Post"
              size="sm"
              pending={posting}
              disabled={!canPost}
              onPress={() => void handlePost()}
            />
            <Button
              label="Never mind"
              variant="ghost"
              size="sm"
              disabled={posting}
              onPress={() => {
                setComposerOpen(false);
                setComposerError(null);
              }}
            />
          </View>
        </Card>
      ) : null}

      {!member ? (
        <AppText variant="caption" muted style={{ marginBottom: space.close }}>
          Join to post.
        </AppText>
      ) : null}

      {feedError ? (
        <AppText
          variant="caption"
          accessibilityLiveRegion="polite"
          style={{ color: theme.danger, marginBottom: space.room }}
        >
          {feedError}
        </AppText>
      ) : null}
    </View>
  );

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + space.close,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: space.close,
        }}
      >
        {backChevron}
        {steward ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Community tools"
            accessibilityHint="Steward actions for this community"
            onPress={() => setToolsOpen(true)}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            {closing ? (
              <ActivityIndicator size="small" color={theme.brand} />
            ) : (
              <Feather name="settings" size={20} color={theme.foreground} />
            )}
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={posts === null ? [] : visiblePosts}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingBottom: insets.bottom + space.rest,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={header}
        ListEmptyComponent={
          posts === null ? (
            <View>
              <SkeletonRow avatar={false} lines={2} />
              <SkeletonRow avatar={false} lines={2} />
            </View>
          ) : (
            <EmptyState
              compact
              icon="edit-3"
              title="Nothing posted yet. Be the first."
              body={
                member
                  ? "Whatever goes up first is what the campus reads."
                  : "Join, and whatever you post first is what the campus reads."
              }
            />
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator
              size="small"
              color={theme.brand}
              style={{ marginTop: space.close }}
            />
          ) : hasMore ? (
            <Button
              label="Show more posts"
              variant="soft"
              size="sm"
              onPress={loadMore}
              style={{ alignSelf: "center", marginTop: space.close }}
            />
          ) : null
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

      {/* Steward tools: the one destructive thing a steward can do here. */}
      <Sheet
        visible={toolsOpen}
        onClose={() => setToolsOpen(false)}
        title={community.name}
      >
        <Sheet.Row
          icon="x-circle"
          label="Close community"
          danger
          onPress={() => {
            setToolsOpen(false);
            confirmClose();
          }}
        />
      </Sheet>

      {/* The overflow on one post: yours to take down, the steward's to
          remove, anyone's to report. */}
      <Sheet
        visible={menuPost !== null}
        onClose={() => setMenuPost(null)}
        title={menuPost?.title ?? "This post"}
      >
        {menuPost && isMine(menuPost, myId) ? (
          <Sheet.Row
            icon="trash-2"
            label="Delete post"
            danger
            onPress={() => {
              const post = menuPost;
              setMenuPost(null);
              if (post && post.deleted_at === null) {
                confirmRemovePost(post, false);
              }
            }}
          />
        ) : (
          <>
            {steward && menuPost?.deleted_at === null ? (
              <Sheet.Row
                icon="trash-2"
                label="Remove post"
                danger
                onPress={() => {
                  const post = menuPost;
                  setMenuPost(null);
                  if (post) confirmRemovePost(post, true);
                }}
              />
            ) : null}
            <Sheet.Row
              icon="flag"
              label="Report post"
              danger
              onPress={() => {
                const post = menuPost;
                setMenuPost(null);
                if (post) openReport(post);
              }}
            />
          </>
        )}
      </Sheet>
    </View>
  );
}
