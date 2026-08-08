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
import { AppText, Button, Card } from "@/components/ui";
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
  "id, handle, display_name, avatar_url, bio, major, grad_year, phone_verified_at, is_public, university:universities(short_name)";

/** "Ada Lovelace" -> "AL" for the avatar circle. */
function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function Avatar({ name, size = 72 }: { name: string; size?: number }) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      style={{
        width: size,
        height: size,
        borderRadius: radius.full,
        backgroundColor: theme.brandSoft,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <AppText
        variant="title"
        style={{
          color: theme.brandInk,
          fontSize: size * 0.34,
          lineHeight: size * 0.44,
        }}
      >
        {initialsOf(name) || "?"}
      </AppText>
    </View>
  );
}

function Badge({
  label,
  icon,
  bg,
  fg,
}: {
  label: string;
  icon?: FeatherName;
  bg: string;
  fg: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 9,
        paddingVertical: 3,
        borderRadius: radius.full,
        backgroundColor: bg,
      }}
    >
      {icon ? <Feather name={icon} size={11} color={fg} /> : null}
      <AppText variant="label" style={{ color: fg, fontSize: 11 }}>
        {label}
      </AppText>
    </View>
  );
}

/** Tappable pill chip — shared courses and campus channels in common. */
function Chip({
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
      accessibilityLabel={label}
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
      <Feather name={icon} size={14} color={fg} />
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
      <Feather name={icon} size={16} color={color} />
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
      <AppText variant="bodySemi">{title}</AppText>
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
      <Feather name="chevron-left" size={26} color={theme.foreground} />
    </Pressable>
  );

  const isOtherPerson = Boolean(profile && userId && profile.id !== userId);

  const overflowButton = isOtherPerson ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="More options"
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
      <Feather name="more-horizontal" size={22} color={theme.foreground} />
    </Pressable>
  ) : null;

  /* Overflow dropdown + a full-screen backdrop that dismisses it. */
  const menuOverlay =
    menuOpen && isOtherPerson ? (
      <>
        <Pressable
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
        <Feather name="slash" size={12} color={theme.muted} />
        <AppText variant="label" style={{ color: theme.muted }}>
          Blocked
        </AppText>
      </View>
      <Button
        label="Unblock"
        variant="secondary"
        size="sm"
        pending={unblocking}
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
            <ActivityIndicator size="large" color={theme.brand} />
          ) : status === "notFound" ? (
            <>
              <View
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
              <AppText variant="title">Nobody's here</AppText>
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
              <AppText variant="title">Something hiccuped</AppText>
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

  const messageButton = (
    <View style={{ gap: 8, alignItems: "center" }}>
      <Button
        label="Message"
        pending={messaging}
        onPress={() => void handleMessage()}
        icon={
          <Feather name="message-circle" size={16} color={theme.brandFg} />
        }
      />
      {messageError ? (
        <AppText
          variant="caption"
          style={{ color: theme.danger, textAlign: "center" }}
        >
          {messageError}
        </AppText>
      ) : null}
    </View>
  );

  /* Private profile viewed by someone else: handle + avatar only. */
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
          <Avatar name={profile.handle} size={72} />
          <AppText variant="display" style={{ fontSize: 22, lineHeight: 28 }}>
            @{profile.handle}
          </AppText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Feather name="lock" size={14} color={theme.muted} />
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
        {/* Hero */}
        <Card style={{ alignItems: "center", gap: 10, paddingVertical: 24 }}>
          <Avatar name={profile.display_name} size={72} />
          <View style={{ alignItems: "center", gap: 6 }}>
            <AppText
              variant="display"
              style={{ fontSize: 24, lineHeight: 30, textAlign: "center" }}
            >
              {profile.display_name}
            </AppText>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: 6,
              }}
            >
              {profile.phone_verified_at ? (
                <Badge
                  label="Verified"
                  icon="check-circle"
                  bg={theme.accentSoft}
                  fg={theme.success}
                />
              ) : null}
              {isMe && !profile.is_public ? (
                <Badge
                  label="Private"
                  icon="lock"
                  bg={theme.surface2}
                  fg={theme.muted}
                />
              ) : null}
            </View>
            <AppText variant="caption" muted>
              @{profile.handle}
              {universityName ? ` · ${universityName}` : ""}
            </AppText>
          </View>
          {profile.major || profile.grad_year ? (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: 6,
              }}
            >
              {profile.major ? (
                <Badge
                  label={profile.major}
                  icon="book"
                  bg={theme.surface2}
                  fg={theme.foreground}
                />
              ) : null}
              {profile.grad_year ? (
                <Badge
                  label={`Class of ${profile.grad_year}`}
                  bg={theme.surface2}
                  fg={theme.foreground}
                />
              ) : null}
            </View>
          ) : null}
          {profile.bio ? (
            <AppText style={{ textAlign: "center", maxWidth: 300 }}>
              {profile.bio}
            </AppText>
          ) : null}
          <View style={{ marginTop: 6 }}>
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
          </View>
        </Card>

        {sectionsError ? (
          <AppText
            variant="caption"
            style={{ color: theme.danger, marginTop: 12 }}
          >
            We couldn't load courses and channels just now — pull down to try
            again.
          </AppText>
        ) : null}

        {/* Shared courses */}
        <AppText variant="title" style={{ marginTop: 24, marginBottom: 10 }}>
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
              <Chip
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
        <AppText variant="title" style={{ marginTop: 24, marginBottom: 10 }}>
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
              <Chip
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
