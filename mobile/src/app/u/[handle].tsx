import Feather from "@expo/vector-icons/Feather";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
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
import { AppText, Button, Card, Chip } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useBlockedIds } from "@/hooks/use-blocked";
import { useTheme } from "@/hooks/use-theme";
import { blockUser, unblockUser } from "@/lib/blocks";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

type FeatherName = keyof typeof Feather.glyphMap;

/* ---- local row types (mirror the web /u/[handle] page's query shapes) ---- */

type ProfileRow = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  major: string | null;
  grad_year: number | null;
  interests: string[] | null;
  looking_for: string | null;
  phone_verified_at: string | null;
  is_public: boolean;
  university: { short_name: string } | null;
};

type SharedCourse = { id: string; code: string; title: string };
type SharedChannel = { id: string; name: string; kind: string };

type EnrollmentCourseRow = { course: SharedCourse | null };
type MemberChannelRow = { channel: SharedChannel | null };

type Status = "loading" | "error" | "notFound" | "ready";

const PROFILE_SELECT =
  "id, handle, display_name, avatar_url, bio, major, grad_year, interests, looking_for, phone_verified_at, is_public, university:universities(short_name)";

/** text[] from PostgREST, kept honest before it reaches the chips. */
function interestsOf(row: ProfileRow): string[] {
  return Array.isArray(row.interests)
    ? row.interests.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0
      )
    : [];
}

/**
 * The navigational pill: a shared course or a channel in common, tapped to
 * go there. Deliberately not the `Chip` primitive — these are destinations
 * rather than filters, so they carry a real 44px drawn height and body-sized
 * text instead of a hairline and `accessibilityState.selected`.
 */
function LinkPill({
  icon,
  label,
  tint,
  onPress,
}: {
  icon: FeatherName;
  label: string;
  tint: "brand" | "accent";
  onPress: () => void;
}) {
  const theme = useTheme();
  const bg = tint === "brand" ? theme.brandSoft : theme.accentSoft;
  const fg = tint === "brand" ? theme.brandInk : theme.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${label}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 14,
        borderRadius: radius.full,
        backgroundColor: bg,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Feather
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        name={icon}
        size={14}
        color={fg}
      />
      <AppText variant="bodySemi" style={{ color: fg, fontSize: 14 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** One row of the profile overflow menu — 44px tall, icon + label. */
function MenuItem({
  icon,
  label,
  first = false,
  danger = false,
  onPress,
}: {
  icon: FeatherName;
  label: string;
  first?: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const color = danger ? theme.danger : theme.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 16,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Feather
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        name={icon}
        size={16}
        color={color}
      />
      <AppText variant="bodySemi" style={{ color }}>
        {label}
      </AppText>
    </Pressable>
  );
}

function EmptySection({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: FeatherName;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <Card
      style={{
        alignItems: "center",
        gap: 6,
        paddingVertical: 24,
        borderStyle: "dashed",
      }}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.full,
          backgroundColor: theme.brandSoft,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 2,
        }}
      >
        <Feather name={icon} size={18} color={theme.brand} />
      </View>
      <AppText variant="bodySemi" accessibilityRole="header">
        {title}
      </AppText>
      <AppText
        variant="caption"
        muted
        style={{ textAlign: "center", maxWidth: 280 }}
      >
        {description}
      </AppText>
      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          variant="soft"
          size="sm"
          onPress={onAction}
          style={{ marginTop: 4 }}
        />
      ) : null}
    </Card>
  );
}

export default function ProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const params = useLocalSearchParams<{ handle: string }>();
  const handle = typeof params.handle === "string" ? params.handle : "";

  const [status, setStatus] = useState<Status>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [sharedCourses, setSharedCourses] = useState<SharedCourse[]>([]);
  const [sharedChannels, setSharedChannels] = useState<SharedChannel[]>([]);
  const [sectionsError, setSectionsError] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unblocking, setUnblocking] = useState(false);

  const { blocked, refresh: refreshBlocked } = useBlockedIds();
  const isBlocked = profile ? blocked.has(profile.id) : false;

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/people");
  }, []);

  const load = useCallback(async () => {
    if (!userId || !handle) {
      setStatus("notFound");
      return;
    }
    // handle is citext in the database, so .eq() is already case-insensitive.
    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("handle", handle)
      .maybeSingle();
    if (error) {
      setStatus("error");
      return;
    }
    const row = data as unknown as ProfileRow | null;
    if (!row) {
      setStatus("notFound");
      return;
    }
    setProfile(row);

    const isMe = row.id === userId;
    // Private profile viewed by someone else: handle + avatar only — don't
    // even fetch the shared sections.
    if (!row.is_public && !isMe) {
      setSharedCourses([]);
      setSharedChannels([]);
      setStatus("ready");
      return;
    }

    // Shared courses fall out of RLS (classmate enrollments are only visible
    // for courses I'm enrolled in), but we still intersect with my own rows
    // explicitly — including on my own profile, where "shared" means "all
    // mine". Same four queries as the web page.
    const [theirCoursesRes, myCoursesRes, theirChannelsRes, myChannelsRes] =
      await Promise.all([
        supabase
          .from("enrollments")
          .select("course:courses(id, code, title)")
          .eq("user_id", row.id),
        supabase.from("enrollments").select("course_id").eq("user_id", userId),
        supabase
          .from("channel_members")
          .select("channel:channels(id, name, kind)")
          .eq("user_id", row.id),
        supabase
          .from("channel_members")
          .select("channel_id")
          .eq("user_id", userId),
      ]);

    setSectionsError(
      Boolean(
        theirCoursesRes.error ??
          myCoursesRes.error ??
          theirChannelsRes.error ??
          myChannelsRes.error
      )
    );

    const myCourseIds = new Set(
      ((myCoursesRes.data ?? []) as { course_id: string }[]).map(
        (r) => r.course_id
      )
    );
    const myChannelIds = new Set(
      ((myChannelsRes.data ?? []) as { channel_id: string }[]).map(
        (r) => r.channel_id
      )
    );

    setSharedCourses(
      ((theirCoursesRes.data ?? []) as unknown as EnrollmentCourseRow[])
        .map((r) => r.course)
        .filter((c): c is SharedCourse => c !== null && myCourseIds.has(c.id))
        .sort((a, b) => a.code.localeCompare(b.code))
    );
    setSharedChannels(
      ((theirChannelsRes.data ?? []) as unknown as MemberChannelRow[])
        .map((r) => r.channel)
        .filter(
          (c): c is SharedChannel =>
            c !== null && c.kind === "campus" && myChannelIds.has(c.id)
        )
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    setStatus("ready");
  }, [userId, handle]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  /**
   * Find-or-create the 1:1 thread, then land in it. The existing-thread check
   * runs client-side against dm_participants (RLS lets me see membership of
   * my own threads, both directions). Creation can't be a plain insert —
   * 0005_direct_messages.sql gives dm_threads/dm_participants no INSERT
   * policies — so it goes through the security-definer create_dm_thread RPC,
   * exactly like the web's /messages/new route. The RPC is idempotent, so a
   * race just reuses the existing thread.
   */
  const handleMessage = useCallback(async () => {
    if (!userId || !profile || messaging) return;
    setMessageError(null);
    setMessaging(true);
    try {
      const mine = await supabase
        .from("dm_participants")
        .select("thread_id")
        .eq("user_id", userId);
      if (mine.error) throw mine.error;
      const myThreadIds = (
        (mine.data ?? []) as { thread_id: string }[]
      ).map((r) => r.thread_id);

      let threadId: string | null = null;
      if (myThreadIds.length > 0) {
        const existing = await supabase
          .from("dm_participants")
          .select("thread_id")
          .eq("user_id", profile.id)
          .in("thread_id", myThreadIds)
          .limit(1)
          .maybeSingle();
        if (existing.error) throw existing.error;
        threadId =
          (existing.data as { thread_id: string } | null)?.thread_id ?? null;
      }

      if (!threadId) {
        const { data: created, error: rpcError } = await supabase.rpc(
          "create_dm_thread",
          { other_user: profile.id }
        );
        if (rpcError || !created) throw rpcError ?? new Error("No thread");
        threadId = created as string;
      }

      router.push(`/dm/${threadId}`);
    } catch {
      setMessageError("Couldn't start that conversation. Give it another try.");
    } finally {
      setMessaging(false);
    }
  }, [userId, profile, messaging]);

  /* ----------------------- block / report actions ----------------------- */

  // Private profiles only show a handle, so alerts and the report header use
  // whichever name the viewer can actually see.
  const visibleName = profile
    ? profile.is_public || profile.id === userId
      ? profile.display_name
      : `@${profile.handle}`
    : "";

  const openReport = useCallback(() => {
    if (!profile) return;
    setMenuOpen(false);
    router.push({
      pathname: "/report",
      params: { userId: profile.id, label: visibleName },
    });
  }, [profile, visibleName]);

  const doBlock = useCallback(async () => {
    if (!userId || !profile) return;
    try {
      await blockUser(userId, profile.id);
      await refreshBlocked();
    } catch {
      Alert.alert(
        "That didn't go through",
        "We couldn't block them just now — give it another try."
      );
    }
  }, [userId, profile, refreshBlocked]);

  const confirmBlock = useCallback(() => {
    if (!profile) return;
    setMenuOpen(false);
    Alert.alert(
      `Block ${visibleName}?`,
      "They won't be able to DM you, and you won't see their posts. They won't know.",
      [
        { text: "Never mind", style: "cancel" },
        { text: "Block", style: "destructive", onPress: () => void doBlock() },
      ]
    );
  }, [profile, visibleName, doBlock]);

  const doUnblock = useCallback(async () => {
    if (!userId || !profile || unblocking) return;
    setMenuOpen(false);
    setUnblocking(true);
    try {
      await unblockUser(userId, profile.id);
      await refreshBlocked();
    } catch {
      Alert.alert(
        "That didn't go through",
        "We couldn't unblock them just now — give it another try."
      );
    } finally {
      setUnblocking(false);
    }
  }, [userId, profile, unblocking, refreshBlocked]);

  const backChevron = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={goBack}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        marginLeft: -10,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Feather
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        name="chevron-left"
        size={26}
        color={theme.foreground}
      />
    </Pressable>
  );

  const isOtherPerson = Boolean(profile && userId && profile.id !== userId);

  const overflowButton = isOtherPerson ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="More options"
      accessibilityState={{ expanded: menuOpen }}
      onPress={() => setMenuOpen((open) => !open)}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        marginRight: -10,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Feather
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        name="more-horizontal"
        size={22}
        color={theme.foreground}
      />
    </Pressable>
  ) : null;

  /* Overflow dropdown + a full-screen backdrop that dismisses it. */
  const menuOverlay =
    menuOpen && isOtherPerson ? (
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          onPress={() => setMenuOpen(false)}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 10,
          }}
        />
        <Card
          padded={false}
          // While the menu is up it is the only thing on screen worth
          // reaching — the page behind it stays out of the reader's way.
          accessibilityViewIsModal
          style={{
            position: "absolute",
            top: insets.top + 56,
            right: 20,
            zIndex: 11,
            minWidth: 180,
            elevation: 6,
            shadowOpacity: 0.14,
          }}
        >
          <MenuItem icon="flag" label="Report" first onPress={openReport} />
          {isBlocked ? (
            <MenuItem
              icon="rotate-ccw"
              label="Unblock"
              onPress={() => void doUnblock()}
            />
          ) : (
            <MenuItem
              icon="slash"
              label="Block"
              danger
              onPress={confirmBlock}
            />
          )}
        </Card>
      </>
    ) : null;

  /* Quiet blocked chip + the way back, shown in place of the Message button. */
  const blockedActions = (
    <View style={{ alignItems: "center", gap: 10 }}>
      <View
        accessible
        accessibilityLabel="You've blocked them"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: radius.full,
          backgroundColor: theme.surface2,
        }}
      >
        <Feather
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          name="slash"
          size={12}
          color={theme.muted}
        />
        <AppText variant="label" style={{ color: theme.muted }}>
          Blocked
        </AppText>
      </View>
      <Button
        label="Unblock"
        variant="secondary"
        size="sm"
        pending={unblocking}
        accessibilityLabel={visibleName ? `Unblock ${visibleName}` : "Unblock"}
        accessibilityState={{ busy: unblocking, disabled: unblocking }}
        onPress={() => void doUnblock()}
      />
    </View>
  );

  /* ------------------------- pre-profile states ------------------------- */

  if (status !== "ready" || !profile) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
        }}
      >
        {backChevron}
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            paddingBottom: 80,
          }}
        >
          {status === "loading" ? (
            <ActivityIndicator
              accessibilityLabel="Loading this profile"
              size="large"
              color={theme.brand}
            />
          ) : status === "notFound" ? (
            <>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 16,
                  backgroundColor: theme.brandSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Feather name="user-x" size={22} color={theme.brand} />
              </View>
              <AppText variant="title" accessibilityRole="header">
                Nobody's here
              </AppText>
              <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
                There's nobody at @{handle || "that handle"} — maybe they
                changed their handle.
              </AppText>
              <Button
                label="Back to people"
                variant="soft"
                size="sm"
                onPress={goBack}
              />
            </>
          ) : (
            <>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 16,
                  backgroundColor: theme.brandSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Feather name="wifi-off" size={22} color={theme.brand} />
              </View>
              <AppText variant="title" accessibilityRole="header">
                Something hiccuped
              </AppText>
              <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
                We couldn't load this profile. Give it another try.
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
            </>
          )}
        </View>
      </View>
    );
  }

  /* --------------------------- ready states --------------------------- */

  const isMe = profile.id === userId;
  const limited = !profile.is_public && !isMe;
  const universityName = profile.university?.short_name ?? null;
  const firstName = profile.display_name.split(/\s+/)[0] ?? profile.handle;
  const interests = interestsOf(profile);

  /* No `alignItems` on purpose: this hugs inside the centered private card
     and stretches to full width under the hero, where it's the main move. */
  const messageButton = (
    <View style={{ gap: 8 }}>
      <Button
        label="Message"
        pending={messaging}
        accessibilityLabel={visibleName ? `Message ${visibleName}` : "Message"}
        accessibilityState={{ busy: messaging, disabled: messaging }}
        onPress={() => void handleMessage()}
        icon={
          <Feather name="message-circle" size={16} color={theme.brandFg} />
        }
      />
      {messageError ? (
        <AppText
          variant="caption"
          accessibilityLiveRegion="polite"
          style={{ color: theme.danger, textAlign: "center" }}
        >
          {messageError}
        </AppText>
      ) : null}
    </View>
  );

  /* Private profile viewed by someone else: handle + avatar only. Everything
     else on the row — name, bio, major, grad year, interests, looking_for —
     stays off this screen. Interests and looking_for are profile columns like
     any other, so they're hidden here too. */
  if (limited) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {backChevron}
          {overflowButton}
        </View>
        <Card
          style={{ alignItems: "center", gap: 12, paddingVertical: 32 }}
        >
          {/* Initials from the handle — no photo, same as the directory. */}
          <Avatar name={profile.handle} size={72} />
          <AppText
            variant="display"
            accessibilityRole="header"
            style={{ fontSize: 22, lineHeight: 28 }}
          >
            @{profile.handle}
          </AppText>
          <View
            accessible
            accessibilityLabel="This profile is private"
            style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
          >
            <Feather
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              name="lock"
              size={14}
              color={theme.muted}
            />
            <AppText variant="bodyMedium" muted>
              This profile is private
            </AppText>
          </View>
          <AppText
            variant="caption"
            muted
            style={{ textAlign: "center", maxWidth: 280 }}
          >
            {isBlocked
              ? "Only their handle and avatar are visible."
              : "Only their handle and avatar are visible, but you can still say hi."}
          </AppText>
          {isBlocked ? blockedActions : messageButton}
        </Card>
        {menuOverlay}
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + 8,
      }}
    >
      <View
        style={{
          paddingHorizontal: 20,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {backChevron}
        {overflowButton}
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 32,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={theme.brand}
            colors={[theme.brand]}
          />
        }
      >
        {/* Hero — the person first: their face, their name set against it,
            then the quiet facts, then what they're actually after. */}
        <Card style={{ gap: 16 }}>
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 16 }}
          >
            <Avatar
              url={profile.avatar_url}
              name={profile.display_name}
              size={80}
            />
            <View style={{ flex: 1, gap: 4 }}>
              <AppText
                variant="display"
                accessibilityRole="header"
                style={{ fontSize: 24, lineHeight: 30 }}
              >
                {profile.display_name}
              </AppText>
              <AppText variant="caption" muted>
                @{profile.handle}
                {universityName ? ` · ${universityName}` : ""}
              </AppText>
              {profile.phone_verified_at || (isMe && !profile.is_public) ? (
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 6,
                    marginTop: 2,
                  }}
                >
                  {profile.phone_verified_at ? (
                    <Chip label="Verified" icon="check-circle" tone="accent" />
                  ) : null}
                  {isMe && !profile.is_public ? (
                    <Chip label="Private" icon="lock" tone="neutral" />
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>

          {profile.major || profile.grad_year ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {profile.major ? (
                <Chip
                  label={profile.major}
                  icon="book"
                  tone="neutral"
                  size="md"
                />
              ) : null}
              {profile.grad_year ? (
                <Chip
                  label={`Class of ${profile.grad_year}`}
                  tone="neutral"
                  size="md"
                />
              ) : null}
            </View>
          ) : null}

          {/* Body type, left-aligned, with the card's 16px gaps either side —
              a paragraph, not a caption under a portrait. */}
          {profile.bio ? <AppText>{profile.bio}</AppText> : null}

          {/* The one line on this page somebody can act on, so it gets the
              ember and sits directly above the button that answers it. */}
          {profile.looking_for ? (
            <View
              accessible
              accessibilityLabel={`Looking for: ${profile.looking_for}`}
              style={{
                gap: 6,
                padding: 14,
                borderRadius: radius.control,
                backgroundColor: theme.brandSoft,
              }}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <Feather
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  name="compass"
                  size={13}
                  color={theme.brand}
                />
                <AppText variant="label" style={{ color: theme.brandInk }}>
                  Looking for
                </AppText>
              </View>
              <AppText variant="title" style={{ color: theme.brandInk }}>
                {profile.looking_for}
              </AppText>
            </View>
          ) : null}

          {isMe ? (
            <Button
              label="Edit profile"
              variant="secondary"
              onPress={() => router.push("/account")}
              icon={<Feather name="edit-2" size={15} color={theme.foreground} />}
            />
          ) : isBlocked ? (
            blockedActions
          ) : (
            messageButton
          )}
        </Card>

        {/* Interests — hidden entirely on someone else's profile when they
            haven't added any; on your own it's an invitation. */}
        {isMe || interests.length > 0 ? (
          <>
            <AppText
              variant="title"
              accessibilityRole="header"
              style={{ marginTop: 24, marginBottom: 10 }}
            >
              {isMe ? "What you're into" : `What ${firstName}'s into`}
            </AppText>
            {interests.length === 0 ? (
              <EmptySection
                icon="compass"
                title="Nothing on here yet"
                description={
                  profile.looking_for
                    ? "Add a few things you're into — it's how classmates spot the overlap."
                    : "A few things you're into, plus a line on what you're looking for, is how classmates know where to start."
                }
                actionLabel="Edit profile"
                onAction={() => router.push("/account")}
              />
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {interests.map((interest) => (
                  <Chip
                    key={interest}
                    label={interest}
                    tone="brand"
                    size="md"
                  />
                ))}
              </View>
            )}
          </>
        ) : null}

        {sectionsError ? (
          <AppText
            variant="caption"
            accessibilityLiveRegion="polite"
            style={{ color: theme.danger, marginTop: 24 }}
          >
            We couldn't load courses and channels just now — pull down to try
            again.
          </AppText>
        ) : null}

        {/* Shared courses */}
        <AppText
          variant="title"
          accessibilityRole="header"
          style={{ marginTop: 24, marginBottom: 10 }}
        >
          {isMe ? "Your courses" : "Courses together"}
        </AppText>
        {sharedCourses.length === 0 ? (
          <EmptySection
            icon="book-open"
            title={isMe ? "No courses yet" : "No courses together"}
            description={
              isMe
                ? "Add your classes to unlock course chat and notes."
                : `You and ${firstName} don't share any courses this term.`
            }
            actionLabel={isMe ? "Add your classes" : undefined}
            onAction={isMe ? () => router.push("/courses/add") : undefined}
          />
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {sharedCourses.map((course) => (
              <LinkPill
                key={course.id}
                icon="book-open"
                label={course.code}
                tint="brand"
                onPress={() => router.push(`/course/${course.id}`)}
              />
            ))}
          </View>
        )}

        {/* Campus channels in common */}
        <AppText
          variant="title"
          accessibilityRole="header"
          style={{ marginTop: 24, marginBottom: 10 }}
        >
          {isMe ? "Your campus channels" : "Campus channels in common"}
        </AppText>
        {sharedChannels.length === 0 ? (
          <EmptySection
            icon="hash"
            title={isMe ? "No campus channels yet" : "No channels in common"}
            description={
              isMe
                ? "Browse the campus channels and join the conversations you care about."
                : `No campus channels in common with ${firstName} yet.`
            }
            actionLabel={isMe ? "Browse channels" : undefined}
            onAction={isMe ? () => router.push("/(tabs)/channels") : undefined}
          />
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {sharedChannels.map((channel) => (
              <LinkPill
                key={channel.id}
                icon="hash"
                label={channel.name}
                tint="accent"
                onPress={() => router.push(`/channel/${channel.id}`)}
              />
            ))}
          </View>
        )}
      </ScrollView>
      {menuOverlay}
    </View>
  );
}
