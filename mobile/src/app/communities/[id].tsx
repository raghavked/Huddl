import Feather from "@expo/vector-icons/Feather";
import {
  Redirect,
  router,
  useFocusEffect,
  useLocalSearchParams,
} from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { PinnedNote } from "@/components/illustrations";
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
  COMMUNITY_RULES_MAX,
  createCommunityPost,
  fetchCommunity,
  fetchCommunityMembers,
  fetchCommunityRooms,
  fetchFeedPage,
  fetchMyRole,
  fetchMySavedPostIds,
  fetchMyVotes,
  fetchPinnedPosts,
  fetchUpcomingEvents,
  isMine,
  joinCommunity,
  leaveCommunity,
  makeSteward,
  MEMBERS_PAGE,
  membersLabel,
  POST_BODY_MAX,
  POST_TITLE_MAX,
  POST_TITLE_MIN,
  POSTS_PAGE,
  removeCommunityMember,
  removeCommunityPost,
  savePost,
  setPostPinned,
  unsavePost,
  updateCommunityRules,
  type Community,
  type CommunityMember,
  type CommunityPost,
  type CommunityRole,
  type CommunityRoom,
  type PostEvent,
  type PostSort,
  type VoteValue,
} from "@/lib/communities";
import {
  CourseArchiveError,
  fetchMyCourses,
  type MyCourse,
} from "@/lib/course-archive";
import { tapSuccess } from "@/lib/haptics";
import { amIModerator } from "@/lib/moderation";
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
 *
 * The roster sits under the rooms: sixty people a page, stewards first. A
 * steward manages every row but their own, promoting a member (stewards can
 * share the trowel; several is a healthy sign, not a conflict) or removing
 * one, both behind confirmations that name the consequence out loud.
 *
 * Migration 0071's craft lands here too. Pinned posts sit above the feed
 * under either sort, fetched on their own so the pages never echo them. A
 * post can carry an event or a course out of the composer's two pickers.
 * The steward writes rules from the tools sheet, and The Quad, the campus
 * default, offers no Leave and no Close: a door the whole campus walks
 * through doesn't get a lock.
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

/**
 * The vote capsule: both arrows and the score in one warm pill, so the
 * feed's most-used control reads as a crafted object rather than loose
 * icons. The up arrow lights in ember, the down arrow in danger, and the
 * score wears the lit color while a vote of yours is on it. Twin of the
 * one on the post screen, kept in step by hand the way timeAgo already is.
 */
function VotePill({
  score,
  myVote,
  onVote,
}: {
  score: number;
  myVote: VoteValue | null;
  onVote: (value: VoteValue) => void;
}) {
  const theme = useTheme();
  const scoreColor =
    myVote === 1 ? theme.brand : myVote === -1 ? theme.danger : undefined;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.surface2,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Upvote"
        accessibilityState={{ selected: myVote === 1 }}
        onPress={() => onVote(1)}
        hitSlop={{ top: 6, bottom: 6, left: 6 }}
        style={({ pressed }) => ({
          width: 40,
          height: 38,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Feather
          name="arrow-up"
          size={17}
          color={myVote === 1 ? theme.brand : theme.muted}
        />
      </Pressable>
      <AppText
        variant="bodySemi"
        style={{
          minWidth: 22,
          textAlign: "center",
          ...(scoreColor ? { color: scoreColor } : {}),
        }}
      >
        {score}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Downvote"
        accessibilityState={{ selected: myVote === -1 }}
        onPress={() => onVote(-1)}
        hitSlop={{ top: 6, bottom: 6, right: 6 }}
        style={({ pressed }) => ({
          width: 40,
          height: 38,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Feather
          name="arrow-down"
          size={17}
          color={myVote === -1 ? theme.danger : theme.muted}
        />
      </Pressable>
    </View>
  );
}

/* The roster row and the manage sheet must call the same person by the
   same name, so the naming lives in one place. toAuthor has already
   stripped a private classmate to their handle before the row arrives. */
function memberName(row: CommunityMember): string {
  return row.profile?.display_name ?? "A student";
}

/** "Sat, Aug 23" for a carried event. Pure. */
function eventDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * The event a post carries, at arm's length: a compact card that walks to
 * the event itself. Twin of the one on the post screen, kept in step by
 * hand the way timeAgo already is.
 */
function EventCarry({ event }: { event: PostEvent }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        `Open the event ${event.title}`,
        eventDay(event.starts_at),
        event.location,
      ]
        .filter(Boolean)
        .join(", ")}
      onPress={() => router.push(`/event/${event.id}`)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.close,
        minHeight: 44,
        padding: space.room,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: radius.control,
        backgroundColor: theme.surface2,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 32,
          height: 32,
          borderRadius: radius.control,
          backgroundColor: theme.accentSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name="calendar" size={15} color={theme.accent} />
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ flex: 1, minWidth: 0, gap: space.hair }}
      >
        <AppText variant="bodyMedium" numberOfLines={1}>
          {event.title}
        </AppText>
        <AppText variant="caption" muted numberOfLines={1}>
          {eventDay(event.starts_at)}
          {event.location ? ` · ${event.location}` : ""}
        </AppText>
      </View>
      <Feather
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        name="chevron-right"
        size={16}
        color={theme.muted}
      />
    </Pressable>
  );
}

/**
 * One post at arm's length, built like a note left on the table: who and
 * when across the top the way a letter opens, the headline in the house
 * display face, the first lines of the body, then the shelf along the
 * bottom that makes a feed a feed: the vote capsule, the comment pill, a
 * bookmark within reach, and the overflow. A folded or removed post keeps
 * its bones and says what happened to it, because only the people who can
 * act on it receive it at all. A pinned post wears its chip, and a carried
 * event or tagged course rides along in miniature.
 */
function FeedRow({
  post,
  index,
  now,
  mine,
  myVote,
  saved,
  onOpen,
  onVote,
  onSave,
  onMenu,
}: {
  post: CommunityPost;
  /** Position in the list, for the staggered arrival. */
  index: number;
  now: Date;
  mine: boolean;
  myVote: VoteValue | null;
  saved: boolean;
  onOpen: () => void;
  onVote: (value: VoteValue) => void;
  onSave: () => void;
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
      style={{ marginBottom: space.card }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${post.title}, by ${author}, ${timeAgo(post.created_at, now)}${post.pinned_at !== null ? ". Pinned." : ""}${removed ? ". This post was removed." : folded ? ". Hidden by downvotes." : ""}`}
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

        {/* The dateline: a real face and a real name, because that's the
            whole difference between this feed and an anonymous one. */}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.cosy,
          }}
        >
          <Avatar
            url={post.author?.avatar_url ?? null}
            name={author}
            size={28}
          />
          <AppText
            variant="bodyMedium"
            numberOfLines={1}
            style={{ flexShrink: 1 }}
          >
            {author}
          </AppText>
          <AppText variant="caption" muted>
            {timeAgo(post.created_at, now)}
          </AppText>
          <View style={{ flex: 1 }} />
          {post.pinned_at !== null ? (
            <Chip label="Pinned" tone="brand" icon="map-pin" />
          ) : post.course ? (
            <Chip label={post.course.code} tone="brand" icon="book" />
          ) : null}
        </View>

        <AppText variant="title" numberOfLines={2}>
          {post.title}
        </AppText>

        {removed ? (
          <AppText variant="caption" muted>
            This post was removed.
          </AppText>
        ) : post.body ? (
          <AppText muted numberOfLines={3}>
            {post.body}
          </AppText>
        ) : null}

        {/* A pinned post that also wears a course tag keeps both: the pin
            took the dateline seat, so the course chip files in down here. */}
        {post.pinned_at !== null && post.course && !removed ? (
          <View style={{ flexDirection: "row" }}>
            <Chip label={post.course.code} tone="brand" icon="book" />
          </View>
        ) : null}

        {!removed && post.event ? <EventCarry event={post.event} /> : null}
      </Pressable>

      {/* The shelf. The arrows keep working on a folded post: recovery is
          the campus voting it back up, so taking the vote away would seal
          the fold. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.cosy,
          paddingHorizontal: space.close,
          paddingTop: space.room,
          paddingBottom: space.close,
        }}
      >
        <VotePill score={post.score} myVote={myVote} onVote={onVote} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open comments, ${commentsLabel(post.comment_count)}`}
          onPress={onOpen}
          hitSlop={{ top: 6, bottom: 6 }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: space.snug,
            height: 38,
            paddingHorizontal: space.close,
            borderRadius: radius.full,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surface2,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="message-circle" size={15} color={theme.muted} />
          <AppText variant="caption" muted>
            {commentsLabel(post.comment_count)}
          </AppText>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={saved ? "Unsave post" : "Save post"}
          accessibilityState={{ selected: saved }}
          onPress={onSave}
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
            name="bookmark"
            size={17}
            color={saved ? theme.brand : theme.muted}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Post options"
          onPress={onMenu}
          hitSlop={4}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            marginLeft: -space.cosy,
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

  /* The roster: null while it hasn't loaded (or wouldn't), so a fetch that
     failed never masquerades as an empty community. */
  const [members, setMembers] = useState<CommunityMember[] | null>(null);
  const [membersHasMore, setMembersHasMore] = useState(false);
  const [membersLoadingMore, setMembersLoadingMore] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [manageTarget, setManageTarget] = useState<CommunityMember | null>(
    null
  );
  const [manageBusy, setManageBusy] = useState(false);
  /* The page the roster is on, a ref for the same reason the feed's is. */
  const memberPageRef = useRef(0);

  const [sort, setSort] = useState<PostSort>("new");
  const [posts, setPosts] = useState<CommunityPost[] | null>(null);
  const [pinnedPosts, setPinnedPosts] = useState<CommunityPost[]>([]);
  const [votes, setVotes] = useState<Record<string, VoteValue>>({});
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
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

  /* The composer's two carries and the pickers that fill them. The picker
     lists load once per visit, on first open, because the campus calendar
     and my class list don't shift under a half-written post. */
  const [carryEvent, setCarryEvent] = useState<PostEvent | null>(null);
  const [carryCourse, setCarryCourse] = useState<MyCourse | null>(null);
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [pickerEvents, setPickerEvents] = useState<PostEvent[] | null>(null);
  const [eventPickerError, setEventPickerError] = useState<string | null>(null);
  const [coursePickerOpen, setCoursePickerOpen] = useState(false);
  const [myCourses, setMyCourses] = useState<MyCourse[] | null>(null);
  const [coursePickerError, setCoursePickerError] = useState<string | null>(
    null
  );

  const [toolsOpen, setToolsOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [menuPost, setMenuPost] = useState<CommunityPost | null>(null);

  /* The rules editor: the steward's inline card, opened from the tools. */
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rulesDraft, setRulesDraft] = useState("");
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);

  /* The page the feed is on, held in a ref because pagination mutates it
     without wanting a re-render of its own. */
  const pageRef = useRef(0);

  const steward = myRole === "steward";
  const member = myRole !== null;

  /* Whether this account carries the moderator badge, because pinning is
     theirs too. False until known; a menu row appearing a beat late beats
     one that vanishes. */
  const [moderator, setModerator] = useState(false);
  useEffect(() => {
    let live = true;
    amIModerator()
      .then((yes) => {
        if (live) setModerator(yes);
      })
      .catch(() => {
        if (live) setModerator(false);
      });
    return () => {
      live = false;
    };
  }, []);
  const canPin = steward || moderator;

  /* The block-list promise reaches the feed too: a blocked classmate's
     posts stay out of sight, refreshed alongside the list. */
  const { blocked, refresh: refreshBlocked } = useBlockedIds();

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/communities");
  }, []);

  /** The doorway: the community, my seat, its rooms, and its roster. */
  const load = useCallback(async () => {
    if (!communityId) {
      setStatus("notFound");
      return;
    }
    try {
      const [row, role, roomRows, memberRows] = await Promise.all([
        fetchCommunity(communityId),
        fetchMyRole(communityId),
        fetchCommunityRooms(communityId).catch((): CommunityRoom[] => []),
        // A roster that won't load shouldn't take the doorway down with it;
        // null keeps the failure honest and the section says so in a line.
        fetchCommunityMembers(communityId, 0).catch(
          (): CommunityMember[] | null => null
        ),
      ]);
      if (!row) {
        setStatus("notFound");
        return;
      }
      setCommunity(row);
      setMyRole(role);
      setRooms(roomRows);
      memberPageRef.current = 0;
      setMembers(memberRows);
      setMembersHasMore(
        memberRows !== null && memberRows.length === MEMBERS_PAGE
      );
      setRosterError(
        memberRows === null
          ? "We couldn't load the members. Pull down to try again."
          : null
      );
      setStatus("ready");
    } catch {
      setStatus((current) => (current === "ready" ? current : "error"));
    }
  }, [communityId]);

  /**
   * One page of the feed, and the caller's own votes and saves on it,
   * merged in. `reset` starts over at page zero (the first load, a sort
   * change, a pull-to-refresh) and refetches the pinned posts with it;
   * anything else appends, and the pins stand where they are.
   */
  const loadFeed = useCallback(
    async (reset: boolean) => {
      if (!communityId) return;
      const page = reset ? 0 : pageRef.current + 1;
      try {
        const [rows, pinnedRows] = await Promise.all([
          fetchFeedPage(communityId, sort, page),
          reset ? fetchPinnedPosts(communityId) : Promise.resolve(null),
        ]);
        const ids = [
          ...rows.map((row) => row.id),
          ...(pinnedRows ?? []).map((row) => row.id),
        ];
        const [pageVotes, pageSaves] = await Promise.all([
          fetchMyVotes(ids),
          fetchMySavedPostIds(ids),
        ]);
        pageRef.current = page;
        setHasMore(rows.length === POSTS_PAGE);
        setNow(new Date());
        setFeedError(null);
        setVotes((prev) => (reset ? pageVotes : { ...prev, ...pageVotes }));
        setSavedIds((prev) => {
          if (reset) return pageSaves;
          const out = new Set(prev);
          for (const id of pageSaves) out.add(id);
          return out;
        });
        if (pinnedRows) setPinnedPosts(pinnedRows);
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
      // The roster below now has a new name on it: yours. Refetch quietly.
      void load();
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
  }, [membershipBusy, communityId, load]);

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
      // And your name comes off the roster below. Refetch quietly.
      void load();
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
  }, [membershipBusy, myRole, communityId, load]);

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

  /* ----------------------------- the roster ----------------------------- */

  const loadMoreMembers = useCallback(() => {
    if (membersLoadingMore || members === null) return;
    setMembersLoadingMore(true);
    const page = memberPageRef.current + 1;
    fetchCommunityMembers(communityId, page)
      .then((rows) => {
        memberPageRef.current = page;
        setMembersHasMore(rows.length === MEMBERS_PAGE);
        setRosterError(null);
        setMembers((prev) => {
          if (prev === null) return rows;
          // Someone joining mid-scroll can straddle two pages; keep the
          // first copy, drop the echo.
          const seen = new Set(prev.map((row) => row.user_id));
          return [...prev, ...rows.filter((row) => !seen.has(row.user_id))];
        });
      })
      .catch((caught: unknown) => {
        setRosterError(
          caught instanceof CommunityError
            ? caught.message
            : "We couldn't load the members. Give it another go."
        );
      })
      .finally(() => setMembersLoadingMore(false));
  }, [communityId, membersLoadingMore, members]);

  /* Promote through the trowel-sharing policy. Not optimistic: a role is a
     permission, and a chip that lies about permissions is worse than a
     beat of waiting. */
  const promote = useCallback(
    async (target: CommunityMember) => {
      if (manageBusy) return;
      setRosterError(null);
      setManageBusy(true);
      try {
        await makeSteward(communityId, target.user_id);
        setMembers((prev) =>
          prev === null
            ? prev
            : prev.map((row) =>
                row.user_id === target.user_id
                  ? { ...row, role: "steward" }
                  : row
              )
        );
      } catch (caught) {
        setRosterError(
          caught instanceof CommunityError
            ? caught.message
            : "We couldn't make them a steward just now. Give it another go."
        );
      } finally {
        setManageBusy(false);
      }
    },
    [communityId, manageBusy]
  );

  const confirmPromote = useCallback(
    (target: CommunityMember) => {
      if (!community) return;
      const name = memberName(target);
      Alert.alert(
        `Make ${name} a steward?`,
        `They gain every steward power: pinning and removing posts, managing this roster, writing the rules, and closing ${community.name}. You keep yours; stewards share the trowel.`,
        [
          { text: "Not now", style: "cancel" },
          { text: "Make steward", onPress: () => void promote(target) },
        ]
      );
    },
    [community, promote]
  );

  const removeMember = useCallback(
    async (target: CommunityMember) => {
      if (manageBusy) return;
      setRosterError(null);
      setManageBusy(true);
      try {
        await removeCommunityMember(communityId, target.user_id);
        setMembers((prev) =>
          prev === null
            ? prev
            : prev.filter((row) => row.user_id !== target.user_id)
        );
        setCommunity((prev) =>
          prev
            ? { ...prev, member_count: Math.max(prev.member_count - 1, 0) }
            : prev
        );
      } catch (caught) {
        setRosterError(
          caught instanceof CommunityError
            ? caught.message
            : "We couldn't remove them just now. Give it another go."
        );
      } finally {
        setManageBusy(false);
      }
    },
    [communityId, manageBusy]
  );

  const confirmRemoveMember = useCallback(
    (target: CommunityMember) => {
      if (!community) return;
      const name = memberName(target);
      Alert.alert(
        `Remove ${name} from ${community.name}?`,
        "They come off the roster and stop being able to post. Nothing bars the way back: they can rejoin like anyone else.",
        [
          { text: "Keep them", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => void removeMember(target),
          },
        ]
      );
    },
    [community, removeMember]
  );

  /* ------------------------------ voting ------------------------------ */

  /**
   * One patch to one post, wherever it stands: a post lives either above
   * the feed or in it, and every optimistic write goes through here so
   * neither list is left holding the stale copy.
   */
  const patchPost = useCallback(
    (postId: string, patch: Partial<CommunityPost>) => {
      const apply = <T extends CommunityPost[] | null>(prev: T): T =>
        (prev === null
          ? prev
          : prev.map((row) =>
              row.id === postId ? { ...row, ...patch } : row
            )) as T;
      setPosts(apply);
      setPinnedPosts(apply);
    },
    []
  );

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
        const apply = <T extends CommunityPost[] | null>(prev: T): T =>
          (prev === null
            ? prev
            : prev.map((row) =>
                row.id === post.id ? { ...row, score: row.score + by } : row
              )) as T;
        setPosts(apply);
        setPinnedPosts(apply);
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

  /* ------------------------------ pinning ------------------------------ */

  /**
   * Pin or unpin, optimistically: the post crosses between the feed and
   * the shelf above it right away. A refusal refetches both halves rather
   * than untangling the move by hand; the honest state is one query away.
   */
  const applyPin = useCallback(
    (post: CommunityPost, pin: boolean) => {
      setFeedError(null);
      if (pin) {
        const stamp = new Date().toISOString();
        setPosts((prev) =>
          prev === null ? prev : prev.filter((row) => row.id !== post.id)
        );
        setPinnedPosts((prev) => [{ ...post, pinned_at: stamp }, ...prev]);
      } else {
        setPinnedPosts((prev) => prev.filter((row) => row.id !== post.id));
        // Back onto the top of the page; the next refresh files it where
        // the sort actually wants it.
        setPosts((prev) => {
          const freed = { ...post, pinned_at: null, pinned_by: null };
          return prev === null ? [freed] : [freed, ...prev];
        });
      }
      void setPostPinned(post.id, pin).catch((caught: unknown) => {
        setFeedError(
          caught instanceof CommunityError
            ? caught.message
            : "That didn't save just now. Give it another go."
        );
        void loadFeed(true);
      });
    },
    [loadFeed]
  );

  /* ----------------------------- the shelf ------------------------------ */

  /** Save or unsave, optimistically; the bookmark is the reader's own. */
  const toggleSave = useCallback(
    (post: CommunityPost) => {
      const wasSaved = savedIds.has(post.id);
      setFeedError(null);
      setSavedIds((prev) => {
        const out = new Set(prev);
        if (wasSaved) out.delete(post.id);
        else out.add(post.id);
        return out;
      });
      void (wasSaved ? unsavePost(post.id) : savePost(post.id)).catch(
        (caught: unknown) => {
          setSavedIds((prev) => {
            const out = new Set(prev);
            if (wasSaved) out.add(post.id);
            else out.delete(post.id);
            return out;
          });
          setFeedError(
            caught instanceof CommunityError
              ? caught.message
              : "That didn't save just now. Give it another try."
          );
        }
      );
    },
    [savedIds]
  );

  /* ---------------------------- the composer ---------------------------- */

  const handlePost = useCallback(async () => {
    if (posting) return;
    setComposerError(null);
    setPosting(true);
    try {
      const post = await createCommunityPost(
        communityId,
        draftTitle,
        draftBody,
        {
          eventId: carryEvent?.id ?? null,
          courseId: carryCourse?.course_id ?? null,
        }
      );
      // It's on the feed: the completion moment.
      tapSuccess();
      setDraftTitle("");
      setDraftBody("");
      setCarryEvent(null);
      setCarryCourse(null);
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
  }, [
    posting,
    communityId,
    draftTitle,
    draftBody,
    carryEvent,
    carryCourse,
    sort,
  ]);

  /** The event picker's list, fetched on first open and kept for the visit. */
  const openEventPicker = useCallback(() => {
    setEventPickerOpen(true);
    if (pickerEvents !== null) return;
    setEventPickerError(null);
    fetchUpcomingEvents()
      .then(setPickerEvents)
      .catch((caught: unknown) => {
        setEventPickerError(
          caught instanceof CommunityError
            ? caught.message
            : "We couldn't load the calendar. Give it another go."
        );
      });
  }, [pickerEvents]);

  /** The course picker's list: my active classes, same bargain as above. */
  const openCoursePicker = useCallback(() => {
    setCoursePickerOpen(true);
    if (myCourses !== null) return;
    setCoursePickerError(null);
    fetchMyCourses()
      .then((mine) => setMyCourses(mine.active))
      .catch((caught: unknown) => {
        setCoursePickerError(
          caught instanceof CourseArchiveError
            ? caught.message
            : "We couldn't load your classes. Give it another go."
        );
      });
  }, [myCourses]);

  /* ----------------------------- the rules ------------------------------ */

  const handleSaveRules = useCallback(async () => {
    if (!community || rulesSaving) return;
    setRulesError(null);
    setRulesSaving(true);
    try {
      await updateCommunityRules(community.id, rulesDraft);
      // They're on the doorway: the completion moment.
      tapSuccess();
      const clean = rulesDraft.trim();
      setCommunity((prev) => (prev ? { ...prev, rules: clean || null } : prev));
      setRulesOpen(false);
    } catch (caught) {
      setRulesError(
        caught instanceof CommunityError
          ? caught.message
          : "We couldn't save the rules just now. Give it another go."
      );
    } finally {
      setRulesSaving(false);
    }
  }, [community, rulesSaving, rulesDraft]);

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
              patchPost(post.id, { deleted_at: stamp });
              void removeCommunityPost(post.id).catch((caught: unknown) => {
                patchPost(post.id, { deleted_at: null });
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
    [patchPost]
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

  /* Pins first, then the feed, one list: the block-list promise covers
     both halves, and a pinned post from a blocked classmate stays hidden
     no matter whose hand pinned it. */
  const visiblePosts = useMemo(() => {
    const keep = (post: CommunityPost) => !blocked.has(post.author_id);
    return [...pinnedPosts.filter(keep), ...(posts ?? []).filter(keep)];
  }, [pinnedPosts, posts, blocked]);

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
        saved={savedIds.has(item.id)}
        onOpen={() => openPost(item)}
        onVote={(value) => applyVote(item, value)}
        onSave={() => toggleSave(item)}
        onMenu={() => setMenuPost(item)}
      />
    ),
    [now, myId, votes, savedIds, openPost, applyVote, toggleSave]
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
          {/* The doorplate: the place's mark beside its name. The campus
              feed wears the home; every other community wears the globe. */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.close,
            }}
          >
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                width: 48,
                height: 48,
                borderRadius: radius.control,
                backgroundColor: theme.brandSoft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Feather
                name={community.is_default ? "home" : "globe"}
                size={22}
                color={theme.brand}
              />
            </View>
            <AppText
              variant="display"
              numberOfLines={2}
              style={{ flex: 1, minWidth: 0 }}
            >
              {community.name}
            </AppText>
          </View>
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
            ) : community.is_default ? (
              /* Nobody chose this membership, so "Joined" would be a fib.
                 The chip says what the place is instead. */
              <Chip label="Your campus" tone="brand" icon="home" />
            ) : member ? (
              <Chip label="Joined" tone="accent" icon="check" />
            ) : null}
          </View>
          {community.description ? (
            <AppText muted>{community.description}</AppText>
          ) : null}
          {/* The first faces through the door, and the count of the rest.
              The whole roster lives below the feed, under "Who's here". */}
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.cosy,
            }}
          >
            {members !== null && members.length > 0 ? (
              <View style={{ flexDirection: "row" }}>
                {members.slice(0, 5).map((entry, index) => (
                  <View
                    key={entry.user_id}
                    style={{
                      marginLeft: index === 0 ? 0 : -space.cosy,
                      borderRadius: radius.full,
                      borderWidth: 2,
                      // The ring is the page showing through, so the
                      // overlap reads as faces around one table.
                      borderColor: theme.background,
                      backgroundColor: theme.background,
                    }}
                  >
                    <Avatar
                      url={entry.profile?.avatar_url}
                      name={memberName(entry)}
                      size={26}
                    />
                  </View>
                ))}
              </View>
            ) : (
              <Feather name="user" size={12} color={theme.muted} />
            )}
            <AppText variant="caption" muted>
              {membersLabel(community.member_count)}
            </AppText>
          </View>
          {community.rules ? (
            <View style={{ gap: space.tight }}>
              <AppText variant="title">Rules</AppText>
              <AppText muted>{community.rules}</AppText>
            </View>
          ) : null}
        </View>

        {!member ? (
          <Button
            label="Join"
            pending={membershipBusy}
            icon={<Feather name="user-plus" size={16} color={theme.brandFg} />}
            onPress={() => void handleJoin()}
          />
        ) : community.is_default ? (
          /* The campus feed has no Leave and no Close: everyone is in it
             from their first day, and the door has no lock to offer. */
          <AppText variant="caption" muted>
            The whole campus is in this one, from day one.
          </AppText>
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

        {steward && rulesOpen ? (
          /* The rules editor, inline like the composer: a steward writing
             house rules is still just writing. */
          <Card style={{ gap: space.close }}>
            <AppText variant="title">Community rules</AppText>
            <TextInput
              value={rulesDraft}
              onChangeText={(text) => {
                setRulesDraft(text);
                if (rulesError) setRulesError(null);
              }}
              placeholder="What keeps this place good"
              placeholderTextColor={theme.muted + "b3"}
              accessibilityLabel="Community rules"
              maxLength={COMMUNITY_RULES_MAX}
              multiline
              editable={!rulesSaving}
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
            {rulesError ? (
              <AppText variant="caption" style={{ color: theme.danger }}>
                {rulesError}
              </AppText>
            ) : null}
            <View style={{ flexDirection: "row", gap: space.cosy }}>
              <Button
                label="Save rules"
                size="sm"
                pending={rulesSaving}
                onPress={() => void handleSaveRules()}
              />
              <Button
                label="Never mind"
                variant="ghost"
                size="sm"
                disabled={rulesSaving}
                onPress={() => {
                  setRulesOpen(false);
                  setRulesError(null);
                }}
              />
            </View>
          </Card>
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
        /* The rooms as a shelf of doors: a sideways stroll instead of a
           column standing between the doorway and the feed. */
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: space.cosy,
            paddingVertical: space.hair,
          }}
        >
          {rooms.map((room) => {
            const title = roomTitle(room.name, room.slug);
            return (
              <Pressable
                key={room.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${title}`}
                onPress={() => router.push(`/channel/${room.id}`)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.cosy,
                  height: 44,
                  paddingLeft: space.snug,
                  paddingRight: space.close,
                  borderRadius: radius.full,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.surface,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <RoomTile
                  kind="topic"
                  name={room.name ?? room.slug}
                  slug={room.slug}
                  size={30}
                />
                <AppText variant="bodyMedium" numberOfLines={1}>
                  {title}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
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
    </View>
  );

  /* The roster: stewards first, then everyone in the order they came. A
     steward gets the overflow on every row but their own. It lives below
     the feed on purpose: the homely reading order is the doorway, then
     what people are saying, then who's here. */
  const whoIsHere = (
    <View>
      <SectionLabel text="Who's here" />
      {rosterError ? (
        <AppText
          variant="caption"
          accessibilityLiveRegion="polite"
          style={{ color: theme.danger, marginBottom: space.room }}
        >
          {rosterError}
        </AppText>
      ) : null}
      {members === null ? (
        rosterError ? null : <SkeletonRow />
      ) : members.length === 0 ? (
        <EmptyState
          compact
          icon="users"
          title="No members yet"
          body="Join, and yours is the first name on it."
        />
      ) : (
        <>
          <Card padded={false}>
            {members.map((entry, index) => {
              const isMe = myId !== null && entry.user_id === myId;
              const name = memberName(entry);
              const locked = entry.profile?.locked === true;
              const handle = entry.profile?.handle ?? null;
              /* Stewards manage everyone but themselves; leaving is a
                 different door and it already exists up top. */
              const manageable = steward && !isMe;
              const row = (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.close,
                    paddingHorizontal: space.card,
                    paddingVertical: space.room,
                    minHeight: 56,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: theme.border,
                  }}
                >
                  <Avatar
                    url={entry.profile?.avatar_url}
                    name={name}
                    size={36}
                  />
                  <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.snug,
                        flexWrap: "wrap",
                      }}
                    >
                      <AppText
                        variant="bodySemi"
                        numberOfLines={1}
                        style={{ flexShrink: 1 }}
                      >
                        {name}
                      </AppText>
                      {isMe ? <Chip label="You" tone="brand" /> : null}
                      {entry.role === "steward" ? (
                        <Chip label="Steward" tone="brand" icon="feather" />
                      ) : null}
                    </View>
                    {handle ? (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: space.tight,
                        }}
                      >
                        {locked ? (
                          <Feather
                            name="lock"
                            size={11}
                            color={theme.muted}
                          />
                        ) : null}
                        <AppText variant="caption" muted numberOfLines={1}>
                          {locked ? "Private profile" : `@${handle}`}
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                  {manageable ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Manage ${name}`}
                      accessibilityHint="Make them a steward or remove them"
                      onPress={() => setManageTarget(entry)}
                      hitSlop={8}
                      style={({ pressed }) => ({
                        width: 44,
                        height: 44,
                        marginRight: -space.cosy,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <Feather
                        name="more-vertical"
                        size={18}
                        color={theme.muted}
                      />
                    </Pressable>
                  ) : null}
                </View>
              );
              return handle ? (
                <Pressable
                  key={entry.user_id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${name}'s profile`}
                  onPress={() => router.push(`/u/${handle}`)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                >
                  {row}
                </Pressable>
              ) : (
                <View key={entry.user_id}>{row}</View>
              );
            })}
          </Card>
          {membersLoadingMore ? (
            <ActivityIndicator
              size="small"
              color={theme.brand}
              style={{ marginTop: space.close }}
            />
          ) : membersHasMore ? (
            <Button
              label="Show more people"
              variant="soft"
              size="sm"
              onPress={loadMoreMembers}
              style={{ alignSelf: "center", marginTop: space.close }}
            />
          ) : null}
        </>
      )}

    </View>
  );

  /* The composer and the feed's inline notices, rendered right under the
     header so a half-written post sits beside the feed it's about to join. */
  const feedLead = (
    <View>
      {member && composerOpen ? (
        <Card style={{ gap: space.close, marginBottom: space.close }}>
          <AppText variant="title">New post</AppText>
          <TextInput
            value={draftTitle}
            onChangeText={(text) => {
              setDraftTitle(text);
              if (composerError) setComposerError(null);
            }}
            placeholder="What's the headline?"
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
          {/* The two carries: each ghost button trades places with the
              removable chip it earns. Tapping the chip takes it back off. */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.cosy,
              flexWrap: "wrap",
            }}
          >
            {carryEvent ? (
              <Chip
                label={carryEvent.title}
                tone="accent"
                icon="calendar"
                size="md"
                onPress={() => setCarryEvent(null)}
                accessibilityLabel={`Remove the event ${carryEvent.title}`}
              />
            ) : (
              <Button
                label="Attach an event"
                variant="ghost"
                size="sm"
                disabled={posting}
                icon={<Feather name="calendar" size={14} color={theme.muted} />}
                onPress={openEventPicker}
              />
            )}
            {carryCourse ? (
              <Chip
                label={carryCourse.code}
                tone="brand"
                icon="book"
                size="md"
                onPress={() => setCarryCourse(null)}
                accessibilityLabel={`Remove the course tag ${carryCourse.code}`}
              />
            ) : (
              <Button
                label="Tag a course"
                variant="ghost"
                size="sm"
                disabled={posting}
                icon={<Feather name="book" size={14} color={theme.muted} />}
                onPress={openCoursePicker}
              />
            )}
          </View>
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
        ListHeaderComponent={
          <View>
            {header}
            {feedLead}
          </View>
        }
        ListEmptyComponent={
          posts === null ? (
            <View>
              <SkeletonRow avatar={false} lines={2} />
              <SkeletonRow avatar={false} lines={2} />
            </View>
          ) : (
            <EmptyState
              illustration={PinnedNote}
              title="The board is up. Nothing's on it yet."
              body={
                member
                  ? "Whatever goes up first is what the campus reads."
                  : "Join, and whatever you post first is what the campus reads."
              }
              action={
                member && !composerOpen
                  ? {
                      label: "Write the first post",
                      onPress: () => setComposerOpen(true),
                    }
                  : undefined
              }
            />
          )
        }
        ListFooterComponent={
          <View>
            {loadingMore ? (
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
            ) : posts !== null && visiblePosts.length > 0 ? (
              /* The bottom of the pot: say so warmly instead of just
                 running out of cards. */
              <AppText
                variant="caption"
                muted
                style={{ textAlign: "center", marginTop: space.close }}
              >
                That's everything for now. Pull down for fresh posts.
              </AppText>
            ) : null}
            {whoIsHere}
          </View>
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

      {/* Steward tools: the rules, and, anywhere but the campus feed, the
          one destructive thing a steward can do here. */}
      <Sheet
        visible={toolsOpen}
        onClose={() => setToolsOpen(false)}
        title={community.name}
      >
        <Sheet.Row
          icon="file-text"
          label="Community rules"
          onPress={() => {
            setToolsOpen(false);
            setRulesDraft(community.rules ?? "");
            setRulesError(null);
            setRulesOpen(true);
          }}
        />
        {!community.is_default ? (
          <Sheet.Row
            icon="x-circle"
            label="Close community"
            danger
            onPress={() => {
              setToolsOpen(false);
              confirmClose();
            }}
          />
        ) : null}
      </Sheet>

      {/* The roster's manage sheet: what a steward can do with the row they
          pressed. It never opens on their own row, so there's no seat here
          for stepping down or slipping out. */}
      <Sheet
        visible={manageTarget !== null}
        onClose={() => setManageTarget(null)}
        title={manageTarget ? memberName(manageTarget) : "Member"}
      >
        {manageTarget?.role === "member" ? (
          <Sheet.Row
            icon="feather"
            label="Make steward"
            onPress={() => {
              const target = manageTarget;
              setManageTarget(null);
              if (target) confirmPromote(target);
            }}
          />
        ) : null}
        <Sheet.Row
          icon="user-x"
          label="Remove from community"
          danger
          onPress={() => {
            const target = manageTarget;
            setManageTarget(null);
            if (target) confirmRemoveMember(target);
          }}
        />
      </Sheet>

      {/* The overflow on one post: anyone's to save, yours to edit or take
          down, the steward's to pin or remove, anyone else's to report. */}
      <Sheet
        visible={menuPost !== null}
        onClose={() => setMenuPost(null)}
        title={menuPost?.title ?? "This post"}
      >
        {menuPost ? (
          <>
            <Sheet.Row
              icon="bookmark"
              label={savedIds.has(menuPost.id) ? "Unsave post" : "Save post"}
              onPress={() => {
                const post = menuPost;
                setMenuPost(null);
                toggleSave(post);
              }}
            />
            {isMine(menuPost, myId) && menuPost.deleted_at === null ? (
              <Sheet.Row
                icon="edit-2"
                label="Edit post"
                onPress={() => {
                  const post = menuPost;
                  setMenuPost(null);
                  // The editor lives on the post screen, beside the whole
                  // body it's about to change.
                  router.push({
                    pathname: "/communities/post",
                    params: { communityId, postId: post.id, edit: "1" },
                  });
                }}
              />
            ) : null}
            {canPin && menuPost.deleted_at === null ? (
              <Sheet.Row
                icon="map-pin"
                label={menuPost.pinned_at !== null ? "Unpin post" : "Pin post"}
                onPress={() => {
                  const post = menuPost;
                  setMenuPost(null);
                  applyPin(post, post.pinned_at === null);
                }}
              />
            ) : null}
            {isMine(menuPost, myId) ? (
              <Sheet.Row
                icon="trash-2"
                label="Delete post"
                danger
                onPress={() => {
                  const post = menuPost;
                  setMenuPost(null);
                  if (post.deleted_at === null) {
                    confirmRemovePost(post, false);
                  }
                }}
              />
            ) : (
              <>
                {steward && menuPost.deleted_at === null ? (
                  <Sheet.Row
                    icon="trash-2"
                    label="Remove post"
                    danger
                    onPress={() => {
                      const post = menuPost;
                      setMenuPost(null);
                      confirmRemovePost(post, true);
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
                    openReport(post);
                  }}
                />
              </>
            )}
          </>
        ) : null}
      </Sheet>

      {/* The event picker: upcoming campus events, soonest first. */}
      <Sheet
        visible={eventPickerOpen}
        onClose={() => setEventPickerOpen(false)}
        title="Attach an event"
      >
        {eventPickerError ? (
          <AppText
            variant="caption"
            style={{ color: theme.danger, paddingVertical: space.room }}
          >
            {eventPickerError}
          </AppText>
        ) : pickerEvents === null ? (
          <ActivityIndicator
            size="small"
            color={theme.brand}
            style={{ marginVertical: space.card }}
          />
        ) : pickerEvents.length === 0 ? (
          <AppText
            variant="caption"
            muted
            style={{ paddingVertical: space.room }}
          >
            Nothing on the campus calendar yet. Plan something, then carry it
            here.
          </AppText>
        ) : (
          <ScrollView style={{ maxHeight: 360 }}>
            {pickerEvents.map((event) => (
              <Sheet.Row
                key={event.id}
                icon="calendar"
                label={`${event.title} · ${eventDay(event.starts_at)}`}
                selected={carryEvent?.id === event.id}
                onPress={() => {
                  setCarryEvent(event);
                  setEventPickerOpen(false);
                }}
              />
            ))}
          </ScrollView>
        )}
      </Sheet>

      {/* The course picker: my active classes, code first. */}
      <Sheet
        visible={coursePickerOpen}
        onClose={() => setCoursePickerOpen(false)}
        title="Tag a course"
      >
        {coursePickerError ? (
          <AppText
            variant="caption"
            style={{ color: theme.danger, paddingVertical: space.room }}
          >
            {coursePickerError}
          </AppText>
        ) : myCourses === null ? (
          <ActivityIndicator
            size="small"
            color={theme.brand}
            style={{ marginVertical: space.card }}
          />
        ) : myCourses.length === 0 ? (
          <AppText
            variant="caption"
            muted
            style={{ paddingVertical: space.room }}
          >
            No classes on your list yet. Add a course and tag away.
          </AppText>
        ) : (
          <ScrollView style={{ maxHeight: 360 }}>
            {myCourses.map((course) => (
              <Sheet.Row
                key={course.course_id}
                icon="book"
                label={`${course.code} · ${course.title}`}
                selected={carryCourse?.course_id === course.course_id}
                onPress={() => {
                  setCarryCourse(course);
                  setCoursePickerOpen(false);
                }}
              />
            ))}
          </ScrollView>
        )}
      </Sheet>
    </View>
  );
}
