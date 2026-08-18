import Feather from "@expo/vector-icons/Feather";
import {
  Redirect,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  TextInput,
  View,
  type AccessibilityActionEvent,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
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
import { useTheme } from "@/hooks/use-theme";
import {
  ClubAnnouncementError,
  canDeleteAnnouncement,
  canPostAnnouncements,
  deleteAnnouncement,
  fetchAnnouncements,
  type ClubAnnouncement,
  type ClubRole,
} from "@/lib/club-announcements";
import {
  ClubInviteError,
  cardName,
  fetchMyClubInvite,
  fetchPendingClubInvites,
  respondToClubInvite,
  revokeClubInvite,
  roleTitle,
  searchClassmates,
  sendClubInvite,
  transferClubPresidency,
  type ClubPrivacy,
  type DirectoryCard,
  type MyClubInvite,
  type PendingClubInvite,
} from "@/lib/club-invites";
import { roomTitle } from "@/lib/room-identity";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* The club home: who's in it, what officers have posted, what's coming up,
   and the door to the chat.
   Joining inserts the club_members row, and a DB trigger mirrors membership
   into the club's channel, exactly like the web app. Leaving deletes it
   (same trigger cleans up the chat); the president can't leave while anyone
   else is still in the club, only hand the presidency off or disband, and
   the button says so instead of letting the delete bounce.
   Since migration 0069 the club also has a door: open clubs keep the join
   button, invite clubs show the invitee their Accept / Decline banner and
   everyone else a closed door. Officers of invite clubs get the guest list
   here too (search, send, revoke), and the roster manages roles: promote,
   demote, remove, and, for the president alone, the handoff. */

type ClubCategory =
  | "academic"
  | "professional"
  | "cultural"
  | "sports"
  | "social"
  | "service"
  | "other";

type ClubRow = {
  id: string;
  name: string;
  description: string | null;
  category: ClubCategory;
  privacy: ClubPrivacy;
};

type MemberProfile = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  major: string | null;
  is_public: boolean;
};

type MemberRow = {
  user_id: string;
  role: ClubRole;
  joined_at: string;
  profile: MemberProfile | null;
};

type ClubEventRow = {
  id: string;
  kind: "study_session" | "meetup";
  title: string;
  starts_at: string;
  location: string | null;
};

type Status = "loading" | "error" | "notFound" | "ready";

/** The board shows the three most recent; the rest live in notifications. */
const ANNOUNCEMENT_PREVIEW = 3;

/** "academic" -> "Academic". Every category is a single word. */
function categoryLabel(category: ClubCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/* Owner first, then officers, then members, each group oldest-first,
   mirroring the web roster sort. */
const ROLE_WEIGHT: Record<ClubRole, number> = {
  owner: 0,
  officer: 1,
  member: 2,
};

function sortRoster(entries: MemberRow[]): MemberRow[] {
  return [...entries].sort(
    (a, b) =>
      ROLE_WEIGHT[a.role] - ROLE_WEIGHT[b.role] ||
      a.joined_at.localeCompare(b.joined_at)
  );
}

/* A private classmate is a handle and a face here too. The roster and the
   role sheet must call the same person by the same name, so the naming
   lives in one place. */
function rosterName(row: MemberRow, viewerId: string | null): string {
  if (!row.profile) return "A student";
  const locked = !row.profile.is_public && row.user_id !== viewerId;
  return locked ? `@${row.profile.handle}` : row.profile.display_name;
}

/** "Sat, Aug 9 · 3:00 PM", how upcoming events read on the club page. */
function eventWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
}

/** "Just now", "5m ago", "3h ago", "2d ago", then "Aug 2". */
function timeAgo(iso: string): string {
  const then = new Date(iso);
  const minutes = Math.floor((Date.now() - then.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString([], { month: "short", day: "numeric" });
}

function BackChevron({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={onPress}
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
}

function CenteredState({
  icon,
  title,
  message,
  children,
}: {
  icon: "users" | "wifi-off";
  title: string;
  message: string;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: space.room,
        padding: space.rest,
      }}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: radius.control,
          backgroundColor: theme.brandSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name={icon} size={22} color={theme.brand} />
      </View>
      <AppText variant="title">{title}</AppText>
      <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
        {message}
      </AppText>
      {children}
    </View>
  );
}

/**
 * One notice on the club's board: headline, the first two lines of it, and
 * who posted when. Your own posts answer a long press with the action sheet
 * (and the same thing through the screen reader's long-press action).
 * Everyone else's are quiet text, because only an author can take one down.
 */
function AnnouncementRow({
  post,
  first,
  mine,
  onMenu,
}: {
  post: ClubAnnouncement;
  first: boolean;
  mine: boolean;
  onMenu: () => void;
}) {
  const theme = useTheme();
  const when = timeAgo(post.created_at);
  // A post outlives its author's account: the byline degrades, the notice
  // stays, because the club still needs to have read it.
  const who = post.author?.display_name ?? "A past officer";

  const content = (
    <View
      style={{
        gap: space.tight,
        paddingHorizontal: space.card,
        paddingVertical: space.close,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.border,
      }}
    >
      <AppText variant="bodySemi" numberOfLines={2}>
        {post.title}
      </AppText>
      <AppText muted numberOfLines={2}>
        {post.body}
      </AppText>
      <AppText variant="caption" muted numberOfLines={1}>
        {who} · {when}
      </AppText>
    </View>
  );

  if (!mine) return content;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${post.title}, posted ${when}`}
      accessibilityHint="Press and hold for options"
      accessibilityActions={[{ name: "longpress", label: "Post options" }]}
      onAccessibilityAction={(event: AccessibilityActionEvent) => {
        if (event.nativeEvent.actionName === "longpress") onMenu();
      }}
      onLongPress={onMenu}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {content}
    </Pressable>
  );
}

export default function ClubHomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const userId = session?.user.id ?? null;
  const { id } = useLocalSearchParams<{ id: string }>();
  const clubId = id ?? "";

  const [status, setStatus] = useState<Status>("loading");
  const [club, setClub] = useState<ClubRow | null>(null);
  const [roster, setRoster] = useState<MemberRow[]>([]);
  const [channel, setChannel] = useState<{
    id: string;
    name: string | null;
    slug: string;
  } | null>(null);
  const [events, setEvents] = useState<ClubEventRow[]>([]);
  const [myProfile, setMyProfile] = useState<MemberProfile | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [membershipError, setMembershipError] = useState<string | null>(null);

  const [announcements, setAnnouncements] = useState<ClubAnnouncement[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(true);
  const [announcementsError, setAnnouncementsError] = useState<string | null>(
    null
  );
  const [postError, setPostError] = useState<string | null>(null);
  const [menuPost, setMenuPost] = useState<ClubAnnouncement | null>(null);

  // The viewer's own pending invitation, when the door is invite-only.
  const [myInvite, setMyInvite] = useState<MyClubInvite | null>(null);
  const [inviteBusy, setInviteBusy] = useState<"accept" | "decline" | null>(
    null
  );
  const [inviteError, setInviteError] = useState<string | null>(null);

  // The officers' guest list: search, send, pending, revoke.
  const [pendingInvites, setPendingInvites] = useState<PendingClubInvite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [inviteQuery, setInviteQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DirectoryCard[]>([]);
  const [searching, setSearching] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const searchSeq = useRef(0);

  // Role management: the roster row a sheet is open on, and its errors.
  const [manageTarget, setManageTarget] = useState<MemberRow | null>(null);
  const [manageBusy, setManageBusy] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/clubs");
  }, [router]);

  const load = useCallback(async () => {
    if (!userId) return;
    if (!clubId) {
      setStatus("notFound");
      return;
    }
    try {
      const [clubRes, membersRes, channelRes, eventsRes, meRes] =
        await Promise.all([
          supabase
            .from("clubs")
            .select("id, name, description, category, privacy")
            .eq("id", clubId)
            .maybeSingle(),
          supabase
            .from("club_members")
            .select(
              "user_id, role, joined_at, profile:profiles(id, handle, display_name, avatar_url, major, is_public)"
            )
            .eq("club_id", clubId),
          supabase
            .from("channels")
            .select("id, name, slug")
            .eq("club_id", clubId)
            .maybeSingle(),
          supabase
            .from("events")
            .select("id, kind, title, starts_at, location")
            .eq("club_id", clubId)
            .gte("starts_at", new Date().toISOString())
            .order("starts_at", { ascending: true })
            .limit(3),
          // My own card, kept around so joining can paint the roster row
          // optimistically without a refetch.
          supabase
            .from("profiles")
            .select("id, handle, display_name, avatar_url, major, is_public")
            .eq("id", userId)
            .maybeSingle(),
        ]);
      if (clubRes.error || membersRes.error) {
        setStatus("error");
        return;
      }
      const clubRow = clubRes.data as unknown as ClubRow | null;
      // RLS hides other campuses' clubs, so "not found" covers both cases.
      if (!clubRow) {
        setStatus("notFound");
        return;
      }
      setClub(clubRow);
      const members = sortRoster(
        (membersRes.data ?? []) as unknown as MemberRow[]
      );
      setRoster(members);
      /* The invitation state rides the same load: a non-member of an invite
         club may hold a pending invite (the banner), and its officers keep a
         guest list (the panel). Either failing quietly costs a section, not
         the club. */
      const myRow = members.find((m) => m.user_id === userId) ?? null;
      if (clubRow.privacy === "invite" && !myRow) {
        try {
          setMyInvite(await fetchMyClubInvite(clubId));
        } catch {
          setMyInvite(null);
        }
      } else {
        setMyInvite(null);
      }
      if (
        clubRow.privacy === "invite" &&
        (myRow?.role === "owner" || myRow?.role === "officer")
      ) {
        setInvitesLoading(true);
        try {
          setPendingInvites(await fetchPendingClubInvites(clubId));
        } catch {
          setPanelError(
            "We couldn't load the invitations. Give it another go."
          );
        } finally {
          setInvitesLoading(false);
        }
      } else {
        setPendingInvites([]);
      }
      setChannel(
        (channelRes.data as unknown as {
          id: string;
          name: string | null;
          slug: string;
        } | null) ?? null
      );
      // Events are a bonus, so a hiccup there shouldn't block the club.
      setEvents((eventsRes.data ?? []) as unknown as ClubEventRow[]);
      setMyProfile((meRes.data as unknown as MemberProfile | null) ?? null);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [clubId, userId]);

  /* The board loads on its own track: RLS hands non-members an empty list
     rather than an error, and a hiccup here should cost the announcements
     section, not the whole club page. */
  const loadAnnouncements = useCallback(async () => {
    if (!clubId) return;
    try {
      setAnnouncements(await fetchAnnouncements(clubId, ANNOUNCEMENT_PREVIEW));
      setAnnouncementsError(null);
    } catch (caught) {
      setAnnouncementsError(
        caught instanceof ClubAnnouncementError
          ? caught.message
          : "We couldn't load this club's posts. Give it another go."
      );
    } finally {
      setAnnouncementsLoading(false);
    }
  }, [clubId]);

  /* Both loads run on focus rather than on mount, so anything done on a
     screen we pushed is already true when it hands us back: a notice written
     in the composer, a rename saved in settings, an event just planned. */
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      void load();
      void loadAnnouncements();
    }, [userId, load, loadAnnouncements])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setPostError(null);
    void Promise.all([load(), loadAnnouncements()]).finally(() =>
      setRefreshing(false)
    );
  }, [load, loadAnnouncements]);

  const me = roster.find((m) => m.user_id === userId) ?? null;
  const myRole = me?.role ?? null;
  const isMember = myRole !== null;
  const isOfficer = canPostAnnouncements(myRole);
  const inviteClub = club?.privacy === "invite";
  const showInvitePanel = inviteClub && isOfficer;

  /* Accept or decline, through the one RPC that can turn an invitation into
     a membership. Accepting reloads the club, since the roster, the board
     and the chat door all just changed. */
  const answerInvite = useCallback(
    async (accept: boolean) => {
      if (!myInvite || inviteBusy) return;
      setInviteError(null);
      setInviteBusy(accept ? "accept" : "decline");
      try {
        await respondToClubInvite(myInvite.id, accept);
        setMyInvite(null);
        if (accept) {
          await load();
          void loadAnnouncements();
        }
      } catch (caught) {
        setInviteError(
          caught instanceof ClubInviteError
            ? caught.message
            : "We couldn't answer that invitation. Give it another go."
        );
      } finally {
        setInviteBusy(null);
      }
    },
    [myInvite, inviteBusy, load, loadAnnouncements]
  );

  /* The guest-list search, debounced a beat behind the keyboard. The
     sequence counter keeps a slow early answer from landing on top of a
     fast late one. */
  useEffect(() => {
    if (!showInvitePanel) return;
    const needle = inviteQuery.trim();
    if (needle.length === 0) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      searchClassmates(needle)
        .then((cards) => {
          if (searchSeq.current !== seq) return;
          setSearchResults(cards);
        })
        .catch(() => {
          if (searchSeq.current !== seq) return;
          setPanelError("The search didn't go through. Give it another go.");
        })
        .finally(() => {
          if (searchSeq.current === seq) setSearching(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [inviteQuery, showInvitePanel]);

  /* The directory doesn't know which club is asking, so the people already
     inside it, already invited, or doing the asking are dropped here. */
  const invitableResults = searchResults.filter(
    (card) =>
      card.id !== userId &&
      !roster.some((m) => m.user_id === card.id) &&
      !pendingInvites.some((invite) => invite.user_id === card.id)
  );

  const handleInvite = useCallback(
    async (card: DirectoryCard) => {
      if (sendingId) return;
      setPanelError(null);
      setSendingId(card.id);
      try {
        const sent = await sendClubInvite(clubId, card.id);
        // Straight onto the pending list; the card already has their face.
        setPendingInvites((prev) => [
          {
            id: sent.id,
            user_id: card.id,
            created_at: sent.created_at,
            profile: card,
          },
          ...prev,
        ]);
      } catch (caught) {
        setPanelError(
          caught instanceof ClubInviteError
            ? caught.message
            : "We couldn't send that invitation. Give it another go."
        );
      } finally {
        setSendingId(null);
      }
    },
    [clubId, sendingId]
  );

  const handleRevoke = useCallback(
    (invite: PendingClubInvite) => {
      // Optimistic: the row leaves the guest list and returns on failure.
      const previous = pendingInvites;
      setPanelError(null);
      setPendingInvites(previous.filter((row) => row.id !== invite.id));
      void revokeClubInvite(invite.id).catch((caught: unknown) => {
        setPendingInvites(previous);
        setPanelError(
          caught instanceof ClubInviteError
            ? caught.message
            : "We couldn't take that invitation back. Give it another go."
        );
      });
    },
    [pendingInvites]
  );

  /* -------------------------- role management -------------------------- */

  /* Promote or demote through the officer update policy. Not optimistic: a
     role is a permission, and a chip that lies about permissions is worse
     than a beat of waiting. Zero rows back means RLS said no. */
  const changeRole = useCallback(
    async (target: MemberRow, role: ClubRole) => {
      if (manageBusy) return;
      setManageError(null);
      setManageBusy(true);
      const { data, error } = await supabase
        .from("club_members")
        .update({ role })
        .eq("club_id", clubId)
        .eq("user_id", target.user_id)
        .select("user_id");
      setManageBusy(false);
      if (error || !data || data.length === 0) {
        setManageError(
          "We couldn't change that role just now. Give it another go."
        );
        return;
      }
      setRoster((prev) =>
        sortRoster(
          prev.map((m) => (m.user_id === target.user_id ? { ...m, role } : m))
        )
      );
    },
    [clubId, manageBusy]
  );

  const removeMember = useCallback(
    async (target: MemberRow) => {
      if (manageBusy) return;
      setManageError(null);
      setManageBusy(true);
      const { data, error } = await supabase
        .from("club_members")
        .delete()
        .eq("club_id", clubId)
        .eq("user_id", target.user_id)
        .select("user_id");
      setManageBusy(false);
      if (error || !data || data.length === 0) {
        setManageError(
          "We couldn't remove them just now. Give it another go."
        );
        return;
      }
      // The DB trigger takes them out of the club chat.
      setRoster((prev) => prev.filter((m) => m.user_id !== target.user_id));
    },
    [clubId, manageBusy]
  );

  const confirmRemove = useCallback(
    (target: MemberRow) => {
      if (!club) return;
      const name = rosterName(target, userId);
      Alert.alert(
        `Remove ${name} from ${club.name}?`,
        "They come off the roster and out of the club chat.",
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
    [club, userId, removeMember]
  );

  /* The crown moves in one transaction: they become president, you step
     down to officer, and nobody ever sees a club without one. */
  const handOff = useCallback(
    async (target: MemberRow) => {
      if (manageBusy) return;
      setManageError(null);
      setManageBusy(true);
      try {
        await transferClubPresidency(clubId, target.user_id);
        await load();
      } catch (caught) {
        setManageError(
          caught instanceof ClubInviteError
            ? caught.message
            : "We couldn't hand off the presidency. Give it another go."
        );
      } finally {
        setManageBusy(false);
      }
    },
    [clubId, manageBusy, load]
  );

  const confirmHandOff = useCallback(
    (target: MemberRow) => {
      const name = rosterName(target, userId);
      Alert.alert(
        "Hand off presidency?",
        `The presidency moves to ${name}. You stay on as an officer.`,
        [
          { text: "Keep it", style: "cancel" },
          { text: "Hand off", onPress: () => void handOff(target) },
        ]
      );
    },
    [userId, handOff]
  );

  /* Officers and the owner get the gear. Both can edit the club's details;
     the disband half of that screen is the owner's alone, and it decides
     that for itself off the same roster row. */
  const openSettings = useCallback(() => {
    if (!club) return;
    router.push({ pathname: "/club/settings", params: { clubId: club.id } });
  }, [router, club]);

  const openComposer = useCallback(() => {
    if (!club) return;
    router.push({
      pathname: "/club/announce",
      params: { clubId: club.id, clubName: club.name },
    });
  }, [router, club]);

  const removePost = useCallback(
    (post: ClubAnnouncement) => {
      // Optimistic: the notice leaves the board immediately and comes back
      // with a warm note if the delete doesn't land.
      const previous = announcements;
      setPostError(null);
      setAnnouncements(previous.filter((row) => row.id !== post.id));
      void deleteAnnouncement(post.id).catch((caught: unknown) => {
        setAnnouncements(previous);
        setPostError(
          caught instanceof ClubAnnouncementError
            ? caught.message
            : "We couldn't take that post down. Give it another go."
        );
      });
    },
    [announcements]
  );

  const confirmRemovePost = useCallback(
    (post: ClubAnnouncement) => {
      Alert.alert(
        "Delete this post?",
        "It comes off the club's board for everyone. Notifications that already went out stay where they are.",
        [
          { text: "Keep it", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => removePost(post),
          },
        ]
      );
    },
    [removePost]
  );

  const handleJoin = useCallback(async () => {
    if (!userId || busy) return;
    setMembershipError(null);
    setBusy(true);
    // Optimistic: you're on the roster right away, and step back off if the
    // server disagrees. The DB trigger adds you to the club chat.
    const previous = roster;
    setRoster(
      sortRoster([
        ...previous,
        {
          user_id: userId,
          role: "member",
          joined_at: new Date().toISOString(),
          profile: myProfile,
        },
      ])
    );
    const { error } = await supabase
      .from("club_members")
      .insert({ club_id: clubId, user_id: userId });
    setBusy(false);
    // 23505 = already a member; let the optimistic row stand.
    if (error && error.code !== "23505") {
      setRoster(previous);
      setMembershipError(
        "We couldn't add you to the club just now. Give it another try."
      );
      return;
    }
    // The board is members-only, so it has words on it now.
    void loadAnnouncements();
  }, [userId, busy, roster, myProfile, clubId, loadAnnouncements]);

  const doLeave = useCallback(async () => {
    if (!userId || busy) return;
    setMembershipError(null);
    setBusy(true);
    // Optimistic: the row leaves immediately and returns on failure. The DB
    // trigger takes you out of the club chat.
    const previous = roster;
    setRoster(previous.filter((m) => m.user_id !== userId));
    const { error } = await supabase
      .from("club_members")
      .delete()
      .eq("club_id", clubId)
      .eq("user_id", userId);
    setBusy(false);
    if (error) {
      setRoster(previous);
      setMembershipError(
        "We couldn't take you off the roster just now. Give it another try."
      );
      return;
    }
    // The board goes back behind the door with the rest of the membership.
    setAnnouncements([]);
    setPostError(null);
  }, [userId, busy, roster, clubId]);

  const confirmLeave = useCallback(() => {
    if (!club) return;
    Alert.alert(
      `Leave ${club.name}?`,
      "You'll be removed from the roster and the club chat. You can rejoin any time.",
      [
        { text: "Stay", style: "cancel" },
        { text: "Leave club", style: "destructive", onPress: () => void doLeave() },
      ]
    );
  }, [club, doLeave]);

  const renderMember = useCallback(
    ({ item }: ListRenderItemInfo<MemberRow>) => {
      const isMe = item.user_id === userId;
      /* A private classmate is a handle and a face here too. The roster was
         the one list in the app that drew their real name and their major
         whatever they'd set, and being in a club isn't consent to that. */
      const locked = item.profile !== null && !item.profile.is_public && !isMe;
      const name = rosterName(item, userId);
      const caption = item.profile
        ? locked
          ? "Private profile"
          : `@${item.profile.handle}${item.profile.major ? ` · ${item.profile.major}` : ""}`
        : null;
      /* Officers manage everyone but themselves and the president: the DB
         refuses any change that touches the crown unless the president asks,
         so the button never appears where the write would bounce. */
      const manageable = isOfficer && !isMe && item.role !== "owner";
      const row = (
        <Card
          padded={false}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.close,
            padding: space.close,
            minHeight: 64,
            marginBottom: space.room,
          }}
        >
          <Avatar url={item.profile?.avatar_url} name={name} size={40} />
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
                style={{ flexShrink: 1 }}
                numberOfLines={1}
              >
                {name}
              </AppText>
              {isMe ? <Chip label="You" tone="brand" /> : null}
              {item.role === "owner" ? (
                <Chip label="President" tone="brand" />
              ) : item.role === "officer" ? (
                <Chip label="Officer" tone="accent" />
              ) : null}
            </View>
            {caption ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.tight,
                }}
              >
                {locked ? (
                  <Feather name="lock" size={11} color={theme.muted} />
                ) : null}
                <AppText variant="caption" muted numberOfLines={1}>
                  {caption}
                </AppText>
              </View>
            ) : null}
          </View>
          {manageable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Manage ${name}`}
              accessibilityHint="Change their role or remove them"
              onPress={() => setManageTarget(item)}
              hitSlop={8}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Feather name="more-vertical" size={18} color={theme.muted} />
            </Pressable>
          ) : null}
        </Card>
      );
      if (!item.profile) return row;
      const handle = item.profile.handle;
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${name}'s profile`}
          onPress={() => router.push(`/u/${handle}`)}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          {row}
        </Pressable>
      );
    },
    [userId, router, theme, isOfficer]
  );

  // Deep links land here directly, so signed-out visitors get a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  if (status !== "ready" || !club) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + space.close,
        }}
      >
        <View style={{ paddingHorizontal: space.close }}>
          <BackChevron onPress={goBack} />
        </View>
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
              Opening the club…
            </AppText>
          </View>
        ) : status === "notFound" ? (
          <CenteredState
            icon="users"
            title="Club not available"
            message="This club doesn't exist, or it belongs to another campus."
          >
            <Button
              label="Back to clubs"
              variant="soft"
              size="sm"
              onPress={goBack}
            />
          </CenteredState>
        ) : (
          <CenteredState
            icon="wifi-off"
            title="Something hiccuped"
            message="We couldn't load this club. Check your connection and give it another go."
          >
            <Button
              label="Try again"
              variant="soft"
              size="sm"
              onPress={() => {
                setStatus("loading");
                void load();
              }}
            />
          </CenteredState>
        )}
      </View>
    );
  }

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
        <BackChevron onPress={goBack} />
        {isOfficer ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Club settings"
            accessibilityHint="Edit the club's name, category and description"
            onPress={openSettings}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Feather name="settings" size={20} color={theme.foreground} />
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={roster}
        keyExtractor={(item) => item.user_id}
        renderItem={renderMember}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
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
        ListHeaderComponent={
          <View>
            <View style={{ gap: space.close }}>
              <View style={{ gap: space.cosy }}>
                <AppText variant="display">{club.name}</AppText>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.cosy,
                    flexWrap: "wrap",
                  }}
                >
                  <Chip
                    label={categoryLabel(club.category)}
                    tone="brand"
                    size="md"
                  />
                  {inviteClub ? (
                    <Chip
                      label="Invite only"
                      tone="neutral"
                      size="md"
                      icon="lock"
                    />
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
                      {roster.length}{" "}
                      {roster.length === 1 ? "member" : "members"}
                    </AppText>
                  </View>
                  {myRole ? (
                    <Chip
                      label={myRole === "member" ? "Joined" : roleTitle(myRole)}
                      tone="brand"
                    />
                  ) : null}
                </View>
                {club.description ? (
                  <AppText muted>{club.description}</AppText>
                ) : null}
              </View>

              {isMember && channel ? (
                <Button
                  label="Open club chat"
                  icon={
                    <Feather
                      name="message-circle"
                      size={16}
                      color={theme.brandFg}
                    />
                  }
                  onPress={() => router.push(`/channel/${channel.id}`)}
                />
              ) : null}

              {!isMember && myInvite ? (
                /* The invitee's moment: the club asked, they answer. */
                <Card style={{ gap: space.close }}>
                  <AppText variant="bodySemi">You're invited.</AppText>
                  <View style={{ flexDirection: "row", gap: space.cosy }}>
                    <Button
                      label="Accept"
                      size="sm"
                      pending={inviteBusy === "accept"}
                      disabled={inviteBusy === "decline"}
                      icon={
                        <Feather name="check" size={14} color={theme.brandFg} />
                      }
                      onPress={() => void answerInvite(true)}
                    />
                    <Button
                      label="Decline"
                      variant="secondary"
                      size="sm"
                      pending={inviteBusy === "decline"}
                      disabled={inviteBusy === "accept"}
                      onPress={() => void answerInvite(false)}
                    />
                  </View>
                  {inviteError ? (
                    <AppText
                      variant="caption"
                      accessibilityLiveRegion="polite"
                      style={{ color: theme.danger }}
                    >
                      {inviteError}
                    </AppText>
                  ) : null}
                </Card>
              ) : !isMember && inviteClub ? (
                /* The closed door, where the join button would stand. */
                <View style={{ gap: space.tight }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.cosy,
                    }}
                  >
                    <Feather name="lock" size={14} color={theme.muted} />
                    <AppText variant="bodySemi">Invite only</AppText>
                  </View>
                  <AppText variant="caption" muted>
                    An officer can invite you.
                  </AppText>
                </View>
              ) : !isMember ? (
                <View style={{ gap: space.cosy }}>
                  <Button
                    label="Join club"
                    pending={busy}
                    icon={
                      <Feather
                        name="user-plus"
                        size={16}
                        color={theme.brandFg}
                      />
                    }
                    onPress={() => void handleJoin()}
                  />
                  {membershipError ? (
                    <AppText
                      variant="caption"
                      accessibilityLiveRegion="polite"
                      style={{ color: theme.danger }}
                    >
                      {membershipError}
                    </AppText>
                  ) : null}
                  {channel ? (
                    <AppText variant="caption" muted>
                      Join to get into {roomTitle(channel.name, channel.slug)}{" "}
                      and meet the members.
                    </AppText>
                  ) : null}
                </View>
              ) : myRole === "owner" ? (
                /* The president leaves last: the button stays visible so the
                   rule is legible, and the caption says the way out. */
                <View style={{ gap: space.tight }}>
                  <Button
                    label="Leave club"
                    variant="secondary"
                    size="sm"
                    disabled
                    icon={
                      <Feather name="log-out" size={14} color={theme.muted} />
                    }
                    style={{ alignSelf: "flex-start" }}
                  />
                  <AppText variant="caption" muted>
                    Hand the presidency to someone first, or disband the club.
                  </AppText>
                </View>
              ) : (
                <>
                  <Button
                    label="Leave club"
                    variant="secondary"
                    size="sm"
                    pending={busy}
                    icon={
                      <Feather name="log-out" size={14} color={theme.muted} />
                    }
                    onPress={confirmLeave}
                    style={{ alignSelf: "flex-start" }}
                  />
                  {membershipError ? (
                    <AppText
                      variant="caption"
                      accessibilityLiveRegion="polite"
                      style={{ color: theme.danger }}
                    >
                      {membershipError}
                    </AppText>
                  ) : null}
                </>
              )}
            </View>

            {/* The board: officers writing to the whole club at once. It's
                members-only by RLS, so it stays behind the join button. */}
            {isMember ? (
              <>
                <SectionLabel
                  text="Announcements"
                  action={
                    isOfficer
                      ? { label: "Post", onPress: openComposer }
                      : undefined
                  }
                />
                {postError ? (
                  <AppText
                    variant="caption"
                    style={{ color: theme.danger, marginBottom: space.room }}
                  >
                    {postError}
                  </AppText>
                ) : null}
                {announcementsLoading ? (
                  <View>
                    <SkeletonRow avatar={false} lines={2} />
                    <SkeletonRow avatar={false} lines={2} />
                  </View>
                ) : announcementsError ? (
                  <Card style={{ alignItems: "center", gap: space.cosy }}>
                    <Feather name="cloud-off" size={20} color={theme.muted} />
                    <AppText
                      variant="caption"
                      muted
                      style={{ textAlign: "center", maxWidth: 260 }}
                    >
                      {announcementsError}
                    </AppText>
                    <Button
                      label="Try again"
                      variant="soft"
                      size="sm"
                      onPress={() => void loadAnnouncements()}
                    />
                  </Card>
                ) : announcements.length > 0 ? (
                  <Card padded={false}>
                    {announcements.map((post, index) => (
                      <AnnouncementRow
                        key={post.id}
                        post={post}
                        first={index === 0}
                        mine={canDeleteAnnouncement(post, userId)}
                        onMenu={() => setMenuPost(post)}
                      />
                    ))}
                  </Card>
                ) : (
                  <EmptyState
                    compact
                    icon="bell"
                    title={
                      isOfficer ? "Nothing posted yet" : "No announcements yet"
                    }
                    body={
                      isOfficer
                        ? "Tell the club what is happening. Everyone gets it once, in their notifications."
                        : "When an officer posts, it lands here and in your notifications."
                    }
                    action={
                      isOfficer
                        ? { label: "Write the first one", onPress: openComposer }
                        : undefined
                    }
                  />
                )}
              </>
            ) : null}

            {/* Upcoming events: the club's next three plans. */}
            <SectionLabel text="Upcoming events" />
            <View style={{ gap: space.room }}>
              {events.length > 0 ? (
                <Card padded={false}>
                  {events.map((event, index) => (
                    <Pressable
                      key={event.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${event.title}, ${eventWhen(event.starts_at)}`}
                      onPress={() => router.push(`/event/${event.id}`)}
                      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: space.room,
                          paddingHorizontal: space.card,
                          paddingVertical: space.room,
                          minHeight: 48,
                          borderTopWidth: index === 0 ? 0 : 1,
                          borderTopColor: theme.border,
                        }}
                      >
                        <Feather
                          name={
                            event.kind === "study_session"
                              ? "book-open"
                              : "smile"
                          }
                          size={15}
                          color={theme.accent}
                        />
                        <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
                          <AppText variant="bodyMedium" numberOfLines={1}>
                            {event.title}
                          </AppText>
                          <AppText variant="caption" muted numberOfLines={1}>
                            {eventWhen(event.starts_at)}
                            {event.location ? ` · ${event.location}` : ""}
                          </AppText>
                        </View>
                        <Feather
                          name="chevron-right"
                          size={16}
                          color={theme.muted}
                        />
                      </View>
                    </Pressable>
                  ))}
                </Card>
              ) : (
                <EmptyState
                  compact
                  icon="calendar"
                  title="No upcoming events"
                  body={
                    isOfficer
                      ? "Plan the first one. Members will see it here and on the events board."
                      : "Nothing on the calendar yet. Check back soon."
                  }
                />
              )}
              {isOfficer ? (
                <Button
                  label="Plan an event"
                  variant="soft"
                  size="sm"
                  icon={
                    <Feather name="calendar" size={14} color={theme.brandInk} />
                  }
                  onPress={() =>
                    router.push({
                      pathname: "/event/new",
                      params: { clubId: club.id, clubName: club.name },
                    })
                  }
                  style={{ alignSelf: "flex-start" }}
                />
              ) : null}
            </View>

            {/* The guest list: officers of an invite club search the campus
                directory, send invitations, and take pending ones back. */}
            {showInvitePanel ? (
              <>
                <SectionLabel text="Invitations" />
                <View style={{ gap: space.room }}>
                  <View style={{ justifyContent: "center" }}>
                    <Feather
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                      name="search"
                      size={16}
                      color={theme.muted}
                      style={{ position: "absolute", left: 14, zIndex: 1 }}
                    />
                    <TextInput
                      value={inviteQuery}
                      onChangeText={setInviteQuery}
                      placeholder="Invite a classmate"
                      placeholderTextColor={theme.muted + "b3"}
                      accessibilityLabel="Invite a classmate by name or handle"
                      autoCapitalize="none"
                      autoCorrect={false}
                      cursorColor={theme.brand}
                      selectionColor={theme.brandSoft}
                      style={{
                        height: 44,
                        borderWidth: 1,
                        borderColor: theme.border,
                        borderRadius: radius.full,
                        backgroundColor: theme.surface,
                        paddingLeft: 40,
                        paddingRight: 44,
                        fontFamily: fonts.body,
                        fontSize: 15,
                        color: theme.foreground,
                      }}
                    />
                    {inviteQuery.length > 0 ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Clear search"
                        onPress={() => setInviteQuery("")}
                        style={({ pressed }) => ({
                          position: "absolute",
                          right: 0,
                          width: 44,
                          height: 44,
                          alignItems: "center",
                          justifyContent: "center",
                          opacity: pressed ? 0.6 : 1,
                        })}
                      >
                        <Feather
                          accessibilityElementsHidden
                          importantForAccessibility="no-hide-descendants"
                          name="x"
                          size={16}
                          color={theme.muted}
                        />
                      </Pressable>
                    ) : null}
                  </View>

                  {searching ? (
                    <SkeletonRow />
                  ) : invitableResults.length > 0 ? (
                    <Card padded={false}>
                      {invitableResults.map((card, index) => {
                        const name = cardName(card);
                        return (
                          <View
                            key={card.id}
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
                              url={card.avatar_url}
                              name={name}
                              size={36}
                            />
                            <View
                              style={{ flex: 1, minWidth: 0, gap: space.hair }}
                            >
                              <AppText variant="bodySemi" numberOfLines={1}>
                                {name}
                              </AppText>
                              <AppText
                                variant="caption"
                                muted
                                numberOfLines={1}
                              >
                                {card.display_name
                                  ? `@${card.handle}`
                                  : "Private profile"}
                              </AppText>
                            </View>
                            <Button
                              label="Invite"
                              variant="soft"
                              size="sm"
                              pending={sendingId === card.id}
                              disabled={sendingId !== null}
                              accessibilityLabel={`Invite ${name}`}
                              onPress={() => void handleInvite(card)}
                            />
                          </View>
                        );
                      })}
                    </Card>
                  ) : inviteQuery.trim().length > 0 ? (
                    <AppText variant="caption" muted>
                      Nobody left to invite matched that.
                    </AppText>
                  ) : null}

                  {panelError ? (
                    <AppText
                      variant="caption"
                      accessibilityLiveRegion="polite"
                      style={{ color: theme.danger }}
                    >
                      {panelError}
                    </AppText>
                  ) : null}

                  {invitesLoading ? (
                    <SkeletonRow />
                  ) : pendingInvites.length > 0 ? (
                    <Card padded={false}>
                      {pendingInvites.map((invite, index) => {
                        const name = invite.profile
                          ? cardName(invite.profile)
                          : "A classmate";
                        return (
                          <View
                            key={invite.id}
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
                              url={invite.profile?.avatar_url}
                              name={name}
                              size={36}
                            />
                            <View
                              style={{ flex: 1, minWidth: 0, gap: space.hair }}
                            >
                              <AppText variant="bodySemi" numberOfLines={1}>
                                {name}
                              </AppText>
                              <AppText
                                variant="caption"
                                muted
                                numberOfLines={1}
                              >
                                Invited {timeAgo(invite.created_at)}
                              </AppText>
                            </View>
                            <Button
                              label="Revoke"
                              variant="secondary"
                              size="sm"
                              accessibilityLabel={`Revoke ${name}'s invitation`}
                              onPress={() => handleRevoke(invite)}
                            />
                          </View>
                        );
                      })}
                    </Card>
                  ) : (
                    <AppText variant="caption" muted>
                      No invitations out right now.
                    </AppText>
                  )}
                </View>
              </>
            ) : null}

            <SectionLabel text={`Members · ${roster.length}`} />
            {manageError ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={{ color: theme.danger, marginBottom: space.room }}
              >
                {manageError}
              </AppText>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="users"
            title="No members yet"
            body="Join to get this club going."
          />
        }
      />

      <Sheet
        visible={menuPost !== null}
        onClose={() => setMenuPost(null)}
        title={menuPost?.title ?? "Your post"}
      >
        <Sheet.Row
          icon="trash-2"
          label="Delete post"
          danger
          onPress={() => {
            const post = menuPost;
            setMenuPost(null);
            if (post) confirmRemovePost(post);
          }}
        />
      </Sheet>

      {/* The role sheet: what an officer can do with the row they pressed.
          The presidency handoff is the president's alone, and removal never
          appears on the president because the sheet never opens on one. */}
      <Sheet
        visible={manageTarget !== null}
        onClose={() => setManageTarget(null)}
        title={manageTarget ? rosterName(manageTarget, userId) : "Member"}
      >
        {manageTarget?.role === "member" ? (
          <Sheet.Row
            icon="award"
            label="Make officer"
            onPress={() => {
              const target = manageTarget;
              setManageTarget(null);
              if (target) void changeRole(target, "officer");
            }}
          />
        ) : null}
        {manageTarget?.role === "officer" ? (
          <Sheet.Row
            icon="user"
            label="Make member"
            onPress={() => {
              const target = manageTarget;
              setManageTarget(null);
              if (target) void changeRole(target, "member");
            }}
          />
        ) : null}
        {myRole === "owner" ? (
          <Sheet.Row
            icon="key"
            label="Hand off presidency"
            onPress={() => {
              const target = manageTarget;
              setManageTarget(null);
              if (target) confirmHandOff(target);
            }}
          />
        ) : null}
        <Sheet.Row
          icon="user-x"
          label="Remove from club"
          danger
          onPress={() => {
            const target = manageTarget;
            setManageTarget(null);
            if (target) confirmRemove(target);
          }}
        />
      </Sheet>
    </View>
  );
}
