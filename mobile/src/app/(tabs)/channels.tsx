import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect, useRouter } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
} from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  RefreshControl,
  SectionList,
  View,
  type AccessibilityActionEvent,
} from "react-native";
import { Doorway } from "@/components/illustrations";
import { Screen } from "@/components/screen";
import { AppText, Button, Card, Sheet } from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

type FeatherName = ComponentProps<typeof Feather>["name"];

type ChannelKind = "campus" | "course" | "topic" | "club";

/** Minimal local row shapes: the web app's types live outside this tsconfig. */
type ChannelRow = {
  id: string;
  kind: ChannelKind;
  name: string;
  slug: string;
  description: string | null;
  is_main: boolean;
  course: { id: string; code: string; title: string } | null;
};

/** My membership extras per channel. Unread and mute both hang off these. */
type MemberMeta = { lastReadAt: string; muted: boolean };

type MemberJoinRow = {
  channel_id: string;
  last_read_at: string;
  muted: boolean;
  channel: ChannelRow | null;
};

type LatestMessage = { createdAt: string; authorId: string };

/** A course is a home now: its main chat row, indented side rooms under it,
    and a small "+ room" door per course. Other kinds stay one row each. */
type Row =
  | { key: string; type: "channel"; channel: ChannelRow }
  | { key: string; type: "room"; channel: ChannelRow }
  | { key: string; type: "addRoom"; courseId: string; courseCode: string };

type Section = {
  kind: ChannelKind;
  title: string;
  icon: FeatherName;
  data: Row[];
};

const GROUPS: { kind: ChannelKind; title: string; icon: FeatherName }[] = [
  { kind: "campus", title: "Campus", icon: "volume-2" },
  { kind: "course", title: "Courses", icon: "book-open" },
  { kind: "club", title: "Clubs", icon: "users" },
  { kind: "topic", title: "Topics", icon: "hash" },
];

function channelTitle(channel: ChannelRow): string {
  if (channel.kind === "course") return channel.course?.code ?? channel.name;
  if (channel.kind === "club") return channel.name;
  return `#${channel.slug}`;
}

function channelSubtitle(channel: ChannelRow): string | null {
  if (channel.kind === "course") {
    // A side room surfaced without its main row keeps its own name visible.
    if (!channel.is_main) return channel.name;
    return channel.course?.title ?? channel.description;
  }
  return channel.description;
}

/** Muted rows get a small crossed-out speaker; unread rows get a brand dot.
    A muted channel never shows a dot.

    Both marks are shape and colour with no words in them, so both are hidden
    from the screen reader and said instead by the row's own label. See
    {@link stateWords}. */
function RowIndicator({ muted, unread }: { muted: boolean; unread: boolean }) {
  const theme = useTheme();
  if (muted) {
    return (
      <Feather
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        name="volume-x"
        size={13}
        color={theme.muted}
      />
    );
  }
  if (!unread) return null;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 8,
        height: 8,
        borderRadius: radius.full,
        backgroundColor: theme.brand,
      }}
    />
  );
}

/** The dot and the crossed-out speaker, in words, for a row's label. */
function stateWords(muted: boolean, unread: boolean): string {
  if (muted) return ", muted";
  if (unread) return ", unread messages";
  return "";
}

export default function ChannelsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;

  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [memberMeta, setMemberMeta] = useState<Record<string, MemberMeta>>({});
  const [latest, setLatest] = useState<Record<string, LatestMessage>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when a mute flip had to be rolled back, so the list can say so. */
  const [muteError, setMuteError] = useState<string | null>(null);
  /** The channel whose long-press menu is open, or null. */
  const [menu, setMenu] = useState<ChannelRow | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error: queryError } = await supabase
      .from("channel_members")
      .select(
        "channel_id, last_read_at, muted, channel:channels(id, kind, name, slug, description, is_main, course:courses(id, code, title))"
      )
      .eq("user_id", userId);
    if (queryError) {
      setError("We couldn't load your channels. Pull down to try again.");
      return;
    }
    const memberRows = (data ?? []) as unknown as MemberJoinRow[];
    const rows = memberRows
      .map((row) => row.channel)
      .filter((c): c is ChannelRow => Boolean(c))
      .sort((a, b) => channelTitle(a).localeCompare(channelTitle(b)));
    const meta: Record<string, MemberMeta> = {};
    for (const row of memberRows) {
      meta[row.channel_id] = { lastReadAt: row.last_read_at, muted: row.muted };
    }
    setError(null);
    setChannels(rows);
    setMemberMeta(meta);

    // Newest message per joined channel: one tiny indexed lookup each
    // ((channel_id, created_at desc)), all in flight together.
    //
    // This used to be a single windowed query: the newest 300 messages
    // across every channel, reduced client-side. Cheaper, and wrong in the
    // direction that costs the most: a chatty #general fills the window, a
    // quiet course room falls out of it entirely, and a room with no entry
    // reads as "nothing new". The dot went dark on exactly the rooms where
    // one message a week is the message you were waiting for.
    if (rows.length === 0) {
      setLatest({});
      return;
    }
    const newest: Record<string, LatestMessage> = {};
    await Promise.all(
      rows.map(async (channel) => {
        // A lookup that fails just leaves the channel out. Its dot goes
        // quiet for a beat rather than the screen growing an error state.
        const { data: message } = await supabase
          .from("messages")
          .select("created_at, author_id")
          .eq("channel_id", channel.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!message) return;
        const row = message as unknown as {
          created_at: string;
          author_id: string;
        };
        newest[channel.id] = {
          createdAt: row.created_at,
          authorId: row.author_id,
        };
      })
    );
    setLatest(newest);
  }, [userId]);

  // Unread = the channel's newest message is newer than my last_read_at and
  // isn't mine. Opening a room marks it read (the room screen's job); the
  // focus refetch below is what clears the dot when you come back here.
  const isUnread = useCallback(
    (channelId: string) => {
      const meta = memberMeta[channelId];
      const newest = latest[channelId];
      if (!meta || !newest || meta.muted) return false;
      if (newest.authorId === userId) return false;
      return (
        new Date(newest.createdAt).getTime() >
        new Date(meta.lastReadAt).getTime()
      );
    },
    [memberMeta, latest, userId]
  );

  // Long-press a joined row → the mute sheet. Every other long-press in the
  // app opens a warm Sheet; this one used to open a grey OS alert.
  const onLongPressChannel = useCallback((channel: ChannelRow) => {
    setMenu(channel);
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  /** Flip mute on the open channel, optimistically, and roll back on failure. */
  const toggleMuted = useCallback(async () => {
    if (!userId || !menu) return;
    const channelId = menu.id;
    const wasMuted = memberMeta[channelId]?.muted ?? false;
    // A side room goes by its own name, the way the sheet titles it.
    const name =
      menu.kind === "course" && !menu.is_main ? menu.name : channelTitle(menu);
    const applyMuted = (muted: boolean) =>
      setMemberMeta((prev) => {
        const current = prev[channelId];
        return current ? { ...prev, [channelId]: { ...current, muted } } : prev;
      });
    setMuteError(null);
    closeMenu();
    applyMuted(!wasMuted);
    const { error: writeError } = await supabase
      .from("channel_members")
      .update({ muted: !wasMuted })
      .eq("channel_id", channelId)
      .eq("user_id", userId);
    // Roll the optimistic flip back if the write didn't land, and say so,
    // because a row that quietly un-mutes itself looks like a bug.
    if (writeError) {
      applyMuted(wasMuted);
      const verb = wasMuted ? "unmute" : "mute";
      setMuteError(
        `We couldn't ${verb} ${name} just now. Press and hold to try again.`
      );
    }
  }, [menu, memberMeta, userId, closeMenu]);

  /* Long-press is the only route to mute, and a long press is invisible to a
     screen reader, so every joined row also offers it as a named action and
     says so in its hint. */
  const muteProps = useCallback(
    (channel: ChannelRow, muted: boolean) => ({
      accessibilityHint: muted
        ? "Press and hold to unmute"
        : "Press and hold to mute",
      accessibilityActions: [
        { name: "longpress", label: muted ? "Unmute" : "Mute" },
      ],
      onAccessibilityAction: (event: AccessibilityActionEvent) => {
        if (event.nativeEvent.actionName === "longpress") {
          onLongPressChannel(channel);
        }
      },
    }),
    [onLongPressChannel]
  );

  // Refetch on every focus so new joins (courses, clubs) show up right away.
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      void load().finally(() => setLoading(false));
    }, [userId, load])
  );

  /* Focus is not foreground: a phone locked on this tab never blurs it, so
     the dots would sit exactly as they were until something else took the
     screen. Coming back from the background re-pulls them, quietly. */
  useEffect(() => {
    if (!userId) return;
    let away = false;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        away = true;
        return;
      }
      if (!away) return;
      away = false;
      void load();
    });
    return () => sub.remove();
  }, [userId, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  const sections = useMemo<Section[]>(() => {
    // Courses group by course: the main room leads, side rooms indent under
    // it. `channels` is already sorted by title, so groups land in code order.
    const courseRows: Row[] = [];
    const grouped = new Map<string, ChannelRow[]>();
    for (const channel of channels) {
      if (channel.kind !== "course") continue;
      const key = channel.course?.id ?? `solo-${channel.id}`;
      const list = grouped.get(key);
      if (list) list.push(channel);
      else grouped.set(key, [channel]);
    }
    for (const group of grouped.values()) {
      const sorted = [...group].sort((a, b) =>
        a.is_main === b.is_main
          ? a.name.localeCompare(b.name)
          : a.is_main
            ? -1
            : 1
      );
      const [head, ...rest] = sorted;
      if (!head) continue;
      courseRows.push({ key: head.id, type: "channel", channel: head });
      for (const room of rest) {
        courseRows.push({ key: room.id, type: "room", channel: room });
      }
      if (head.course) {
        courseRows.push({
          key: `add-room-${head.course.id}`,
          type: "addRoom",
          courseId: head.course.id,
          courseCode: head.course.code,
        });
      }
    }
    return GROUPS.map((group) => ({
      ...group,
      data:
        group.kind === "course"
          ? courseRows
          : channels
              .filter((c) => c.kind === group.kind)
              .map<Row>((c) => ({ key: c.id, type: "channel", channel: c })),
    })).filter((section) => section.data.length > 0);
  }, [channels]);

  const menuMuted = menu ? (memberMeta[menu.id]?.muted ?? false) : false;
  const muteSheet = (
    <Sheet
      visible={menu !== null}
      onClose={closeMenu}
      title={
        menu
          ? menu.kind === "course" && !menu.is_main
            ? menu.name
            : channelTitle(menu)
          : undefined
      }
    >
      <Sheet.Row
        icon={menuMuted ? "volume-2" : "volume-x"}
        label={menuMuted ? "Turn notifications back on" : "Mute this channel"}
        onPress={() => void toggleMuted()}
      />
      <AppText variant="caption" muted style={{ marginTop: space.tight }}>
        {menuMuted
          ? "You'll hear about new messages here again."
          : "It stays in your list. You won't hear about new messages."}
      </AppText>
    </Sheet>
  );

  return (
    <Screen
      title="Channels"
      scroll={false}
      action={
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search"
            onPress={() => router.push("/search")}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Feather name="search" size={22} color={theme.muted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Browse channels"
            onPress={() => router.push("/channels/browse")}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Feather name="compass" size={22} color={theme.muted} />
          </Pressable>
        </View>
      }
    >
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={theme.brand} />
        </View>
      ) : error && channels.length === 0 ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: space.room,
            padding: space.chapter,
          }}
        >
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              width: 52,
              height: 52,
              borderRadius: radius.control,
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
          <AppText muted style={{ textAlign: "center" }}>
            {error}
          </AppText>
          <Button
            label="Try again"
            variant="soft"
            size="sm"
            onPress={() => {
              setLoading(true);
              void load().finally(() => setLoading(false));
            }}
          />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.key}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: space.rest, flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.brand}
              colors={[theme.brand]}
            />
          }
          ListHeaderComponent={
            muteError || error ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={{ color: theme.danger, marginBottom: space.cosy }}
              >
                {muteError ?? error}
              </AppText>
            ) : null
          }
          ListEmptyComponent={
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                gap: space.room,
                padding: space.chapter,
              }}
            >
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Doorway
                  size={96}
                  color={theme.muted}
                  softColor={theme.surface2}
                />
              </View>
              <AppText variant="title" accessibilityRole="header">
                No channels yet
              </AppText>
              <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
                Add your courses and you'll land in a channel for each class.
                Campus channels come free with your profile.
              </AppText>
            </View>
          }
          renderSectionHeader={({ section }) => (
            <View
              accessible
              accessibilityRole="header"
              accessibilityLabel={section.title}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.snug,
                marginTop: space.gutter,
                marginBottom: space.cosy,
              }}
            >
              <Feather
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                name={section.icon}
                size={13}
                color={theme.muted}
              />
              <AppText variant="label" muted>
                {section.title}
              </AppText>
            </View>
          )}
          renderItem={({ item, index }) => {
            if (item.type === "room") {
              // An indented side room under its course's main row.
              const room = item.channel;
              const roomMuted = memberMeta[room.id]?.muted ?? false;
              const roomUnread = isUnread(room.id);
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${room.name}${stateWords(
                    roomMuted,
                    roomUnread
                  )}`}
                  {...muteProps(room, roomMuted)}
                  onPress={() => router.push(`/channel/${room.id}`)}
                  onLongPress={() => onLongPressChannel(room)}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.85 : 1,
                    marginLeft: space.chapter,
                    marginBottom: space.cosy,
                  })}
                >
                  <Card
                    padded={false}
                    entrance={index}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.room,
                      paddingHorizontal: space.close,
                      paddingVertical: space.room,
                      minHeight: 48,
                    }}
                  >
                    <Feather
                      name="corner-down-right"
                      size={15}
                      color={theme.muted}
                    />
                    <View
                      style={{
                        flex: 1,
                        minWidth: 0,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.snug,
                      }}
                    >
                      <AppText
                        variant={roomUnread ? "bodySemi" : "bodyMedium"}
                        numberOfLines={1}
                        style={{ flexShrink: 1 }}
                      >
                        {room.name}
                      </AppText>
                      <RowIndicator muted={roomMuted} unread={roomUnread} />
                    </View>
                    <Feather
                      name="chevron-right"
                      size={14}
                      color={theme.muted}
                    />
                  </Card>
                </Pressable>
              );
            }
            if (item.type === "addRoom") {
              // A small door into the course's rooms screen.
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Add a room to ${item.courseCode}`}
                  onPress={() =>
                    router.push({
                      pathname: "/course/rooms",
                      params: {
                        courseId: item.courseId,
                        courseCode: item.courseCode,
                      },
                    })
                  }
                  // The pill is 24px of ink; the slop takes the target to 44.
                  hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.snug,
                    alignSelf: "flex-start",
                    marginLeft: space.chapter,
                    marginBottom: space.close,
                    paddingHorizontal: space.snug,
                    paddingVertical: space.tight,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Feather
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    name="plus"
                    size={14}
                    color={theme.brand}
                  />
                  <AppText variant="label" style={{ color: theme.brand }}>
                    room
                  </AppText>
                </Pressable>
              );
            }
            const channel = item.channel;
            const subtitle = channelSubtitle(channel);
            const channelMuted = memberMeta[channel.id]?.muted ?? false;
            const channelUnread = isUnread(channel.id);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${channelTitle(channel)}${
                  subtitle ? `, ${subtitle}` : ""
                }${stateWords(channelMuted, channelUnread)}`}
                {...muteProps(channel, channelMuted)}
                onPress={() => router.push(`/channel/${channel.id}`)}
                onLongPress={() => onLongPressChannel(channel)}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.85 : 1,
                  marginBottom: space.room,
                })}
              >
                <Card
                  padded={false}
                  entrance={index}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.close,
                    paddingHorizontal: space.card,
                    paddingVertical: space.close,
                    minHeight: 60,
                  }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: radius.control,
                      backgroundColor: theme.brandSoft,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Feather
                      name={
                        GROUPS.find((g) => g.kind === channel.kind)?.icon ??
                        "hash"
                      }
                      size={18}
                      color={theme.brand}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.snug,
                      }}
                    >
                      <AppText
                        variant="bodySemi"
                        numberOfLines={1}
                        style={{ flexShrink: 1 }}
                      >
                        {channelTitle(channel)}
                      </AppText>
                      <RowIndicator
                        muted={channelMuted}
                        unread={channelUnread}
                      />
                    </View>
                    {subtitle ? (
                      <AppText variant="caption" muted numberOfLines={1}>
                        {subtitle}
                      </AppText>
                    ) : null}
                  </View>
                  <Feather name="chevron-right" size={16} color={theme.muted} />
                </Card>
              </Pressable>
            );
          }}
        />
      )}
      {muteSheet}
    </Screen>
  );
}
