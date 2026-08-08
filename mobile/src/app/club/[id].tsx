import Feather from "@expo/vector-icons/Feather";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { AppText, Button, Card } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* The club home: who's in it, what's coming up, and the door to the chat.
   Joining inserts the club_members row — a DB trigger mirrors membership
   into the club's channel, exactly like the web app. Leaving deletes it
   (same trigger cleans up the chat); owners can't leave, only disband. */

type ClubCategory =
  | "academic"
  | "professional"
  | "cultural"
  | "sports"
  | "social"
  | "service"
  | "other";

type ClubRole = "member" | "officer" | "owner";

type ClubRow = {
  id: string;
  name: string;
  description: string | null;
  category: ClubCategory;
};

type MemberProfile = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  major: string | null;
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

/** "academic" -> "Academic" — every category is a single word. */
function categoryLabel(category: ClubCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/* Owner first, then officers, then members — each group oldest-first,
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

/** "Sat, Aug 9 · 3:00 PM" — how upcoming events read on the club page. */
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

function Pill({
  label,
  tone,
}: {
  label: string;
  tone: "brand" | "accent";
}) {
  const theme = useTheme();
  const colors =
    tone === "brand"
      ? { bg: theme.brandSoft, fg: theme.brandInk }
      : { bg: theme.accentSoft, fg: theme.accent };
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: radius.full,
        backgroundColor: colors.bg,
      }}
    >
      <AppText variant="label" style={{ color: colors.fg, fontSize: 11 }}>
        {label}
      </AppText>
    </View>
  );
}

function CategoryPill({ category }: { category: ClubCategory }) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: 9,
        paddingVertical: 3,
        borderRadius: radius.full,
        backgroundColor: theme.brandSoft,
      }}
    >
      <AppText variant="label" style={{ color: theme.brandInk }}>
        {categoryLabel(category)}
      </AppText>
    </View>
  );
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
        gap: 10,
        padding: 28,
      }}
    >
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
  const [channel, setChannel] = useState<{ id: string; slug: string } | null>(
    null
  );
  const [events, setEvents] = useState<ClubEventRow[]>([]);
  const [myProfile, setMyProfile] = useState<MemberProfile | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

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
            .select("id, name, description, category")
            .eq("id", clubId)
            .maybeSingle(),
          supabase
            .from("club_members")
            .select(
              "user_id, role, joined_at, profile:profiles(id, handle, display_name, avatar_url, major)"
            )
            .eq("club_id", clubId),
          supabase
            .from("channels")
            .select("id, slug")
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
            .select("id, handle, display_name, avatar_url, major")
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
      setRoster(sortRoster((membersRes.data ?? []) as unknown as MemberRow[]));
      setChannel(
        (channelRes.data as unknown as { id: string; slug: string } | null) ??
          null
      );
      // Events are a bonus — a hiccup there shouldn't block the club.
      setEvents((eventsRes.data ?? []) as unknown as ClubEventRow[]);
      setMyProfile((meRes.data as unknown as MemberProfile | null) ?? null);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [clubId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  const me = roster.find((m) => m.user_id === userId) ?? null;
  const myRole = me?.role ?? null;
  const isMember = myRole !== null;
  const isOfficer = myRole === "officer" || myRole === "owner";

  const handleJoin = useCallback(async () => {
    if (!userId || busy) return;
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
      Alert.alert(
        "That didn't go through",
        "We couldn't add you to the club just now — give it another try."
      );
    }
  }, [userId, busy, roster, myProfile, clubId]);

  const doLeave = useCallback(async () => {
    if (!userId || busy) return;
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
      Alert.alert(
        "That didn't go through",
        "We couldn't take you off the roster just now — give it another try."
      );
    }
  }, [userId, busy, roster, clubId]);

  const confirmLeave = useCallback(() => {
    if (!club) return;
    Alert.alert(
      `Leave ${club.name}?`,
      "You'll be removed from the roster and the club chat. You can rejoin any time.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Leave club", style: "destructive", onPress: () => void doLeave() },
      ]
    );
  }, [club, doLeave]);

  const renderMember = useCallback(
    ({ item }: ListRenderItemInfo<MemberRow>) => {
      const name = item.profile?.display_name ?? "A student";
      const isMe = item.user_id === userId;
      const caption = item.profile
        ? `@${item.profile.handle}${item.profile.major ? ` · ${item.profile.major}` : ""}`
        : null;
      const row = (
        <Card
          padded={false}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            padding: 12,
            minHeight: 64,
            marginBottom: 10,
          }}
        >
          <Avatar url={item.profile?.avatar_url} name={name} size={40} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
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
              {isMe ? <Pill label="You" tone="brand" /> : null}
              {item.role === "owner" ? (
                <Pill label="Owner" tone="brand" />
              ) : item.role === "officer" ? (
                <Pill label="Officer" tone="accent" />
              ) : null}
            </View>
            {caption ? (
              <AppText variant="caption" muted numberOfLines={1}>
                {caption}
              </AppText>
            ) : null}
          </View>
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
    [userId, router]
  );

  // Deep links land here directly — signed-out visitors get a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  if (status !== "ready" || !club) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + 8,
        }}
      >
        <View style={{ paddingHorizontal: 12 }}>
          <BackChevron onPress={goBack} />
        </View>
        {status === "loading" ? (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
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
        paddingTop: insets.top + 8,
      }}
    >
      <View style={{ paddingHorizontal: 12 }}>
        <BackChevron onPress={goBack} />
      </View>

      <FlatList
        data={roster}
        keyExtractor={(item) => item.user_id}
        renderItem={renderMember}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 32,
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
          <View style={{ gap: 12, marginBottom: 14 }}>
            <View style={{ gap: 8 }}>
              <AppText variant="display">{club.name}</AppText>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <CategoryPill category={club.category} />
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                >
                  <Feather name="user" size={12} color={theme.muted} />
                  <AppText variant="caption" muted>
                    {roster.length} {roster.length === 1 ? "member" : "members"}
                  </AppText>
                </View>
                {myRole ? (
                  <Pill
                    label={
                      myRole === "owner"
                        ? "Owner"
                        : myRole === "officer"
                          ? "Officer"
                          : "Joined"
                    }
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

            {!isMember ? (
              <View style={{ gap: 8 }}>
                <Button
                  label="Join club"
                  pending={busy}
                  icon={
                    <Feather name="user-plus" size={16} color={theme.brandFg} />
                  }
                  onPress={() => void handleJoin()}
                />
                {channel ? (
                  <AppText variant="caption" muted>
                    Join to get into #{channel.slug} and meet the members.
                  </AppText>
                ) : null}
              </View>
            ) : myRole !== "owner" ? (
              <Button
                label="Leave club"
                variant="secondary"
                size="sm"
                pending={busy}
                icon={<Feather name="log-out" size={14} color={theme.muted} />}
                onPress={confirmLeave}
                style={{ alignSelf: "flex-start" }}
              />
            ) : null}

            {/* Upcoming events — the club's next three plans. */}
            <View style={{ gap: 10, marginTop: 2 }}>
              <AppText variant="title">Upcoming events</AppText>
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
                          gap: 10,
                          paddingHorizontal: 14,
                          paddingVertical: 10,
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
                        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
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
                <Card
                  style={{
                    alignItems: "center",
                    gap: 6,
                    paddingVertical: 20,
                    borderStyle: "dashed",
                  }}
                >
                  <AppText variant="bodySemi">No upcoming events</AppText>
                  <AppText
                    variant="caption"
                    muted
                    style={{ textAlign: "center", maxWidth: 260 }}
                  >
                    {isOfficer
                      ? "Plan the first one — members will see it here and on the events board."
                      : "Nothing on the calendar yet. Check back soon."}
                  </AppText>
                </Card>
              )}
              {isOfficer ? (
                <Button
                  label="Plan an event"
                  variant="soft"
                  size="sm"
                  icon={
                    <Feather
                      name="calendar"
                      size={14}
                      color={theme.brandInk}
                    />
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

            <AppText variant="title" style={{ marginTop: 2 }}>
              Members · {roster.length}
            </AppText>
          </View>
        }
        ListEmptyComponent={
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
              <Feather name="users" size={18} color={theme.brand} />
            </View>
            <AppText variant="bodySemi">No members yet</AppText>
            <AppText
              variant="caption"
              muted
              style={{ textAlign: "center", maxWidth: 260 }}
            >
              Join to get this club going.
            </AppText>
          </Card>
        }
      />
    </View>
  );
}
