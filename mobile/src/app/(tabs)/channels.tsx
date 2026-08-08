import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  View,
} from "react-native";
import { Screen } from "@/components/screen";
import { AppText, Button, Card } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

type FeatherName = ComponentProps<typeof Feather>["name"];

type ChannelKind = "campus" | "course" | "topic" | "club";

/** Minimal local row shapes — the web app's types live outside this tsconfig. */
type ChannelRow = {
  id: string;
  kind: ChannelKind;
  name: string;
  slug: string;
  description: string | null;
  is_main: boolean;
  course: { id: string; code: string; title: string } | null;
};

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

export default function ChannelsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;

  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error: queryError } = await supabase
      .from("channel_members")
      .select(
        "channel:channels(id, kind, name, slug, description, is_main, course:courses(id, code, title))"
      )
      .eq("user_id", userId);
    if (queryError) {
      setError("We couldn't load your channels. Pull down to try again.");
      return;
    }
    const rows = ((data ?? []) as unknown as { channel: ChannelRow | null }[])
      .map((row) => row.channel)
      .filter((c): c is ChannelRow => Boolean(c))
      .sort((a, b) => channelTitle(a).localeCompare(channelTitle(b)));
    setError(null);
    setChannels(rows);
  }, [userId]);

  // Refetch on every focus so new joins (courses, clubs) show up right away.
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      void load().finally(() => setLoading(false));
    }, [userId, load])
  );

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

  return (
    <Screen title="Channels" scroll={false}>
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
            gap: 10,
            padding: 24,
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
            <Feather name="wifi-off" size={22} color={theme.brand} />
          </View>
          <AppText variant="title">Something hiccuped</AppText>
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
          contentContainerStyle={{ paddingBottom: 32, flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.brand}
              colors={[theme.brand]}
            />
          }
          ListHeaderComponent={
            error ? (
              <AppText
                variant="caption"
                style={{ color: theme.danger, marginBottom: 8 }}
              >
                {error}
              </AppText>
            ) : null
          }
          ListEmptyComponent={
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                padding: 24,
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
                <Feather name="hash" size={22} color={theme.brand} />
              </View>
              <AppText variant="title">No channels yet</AppText>
              <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
                Add your courses and you'll land in a channel for each class
                automatically — campus channels come free with your profile.
              </AppText>
            </View>
          }
          renderSectionHeader={({ section }) => (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                marginTop: 18,
                marginBottom: 8,
              }}
            >
              <Feather name={section.icon} size={13} color={theme.muted} />
              <AppText variant="label" muted>
                {section.title}
              </AppText>
            </View>
          )}
          renderItem={({ item }) => {
            if (item.type === "room") {
              // An indented side room under its course's main row.
              const room = item.channel;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${room.name}`}
                  onPress={() => router.push(`/channel/${room.id}`)}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.85 : 1,
                    marginLeft: 24,
                    marginBottom: 8,
                  })}
                >
                  <Card
                    padded={false}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      minHeight: 48,
                    }}
                  >
                    <Feather
                      name="corner-down-right"
                      size={15}
                      color={theme.muted}
                    />
                    <AppText
                      variant="bodyMedium"
                      numberOfLines={1}
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      {room.name}
                    </AppText>
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
                  hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    alignSelf: "flex-start",
                    marginLeft: 24,
                    marginBottom: 12,
                    paddingHorizontal: 6,
                    paddingVertical: 4,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Feather name="plus" size={14} color={theme.brand} />
                  <AppText variant="label" style={{ color: theme.brand }}>
                    room
                  </AppText>
                </Pressable>
              );
            }
            const channel = item.channel;
            const subtitle = channelSubtitle(channel);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${channelTitle(channel)}`}
                onPress={() => router.push(`/channel/${channel.id}`)}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.85 : 1,
                  marginBottom: 10,
                })}
              >
                <Card
                  padded={false}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
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
                    <AppText variant="bodySemi" numberOfLines={1}>
                      {channelTitle(channel)}
                    </AppText>
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
    </Screen>
  );
}
