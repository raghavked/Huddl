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
  course: { id: string; code: string; title: string } | null;
};

type Section = {
  kind: ChannelKind;
  title: string;
  icon: FeatherName;
  data: ChannelRow[];
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
        "channel:channels(id, kind, name, slug, description, course:courses(id, code, title))"
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

  const sections = useMemo<Section[]>(
    () =>
      GROUPS.map((group) => ({
        ...group,
        data: channels.filter((c) => c.kind === group.kind),
      })).filter((section) => section.data.length > 0),
    [channels]
  );

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
          keyExtractor={(item) => item.id}
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
            const subtitle = channelSubtitle(item);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${channelTitle(item)}`}
                onPress={() => router.push(`/channel/${item.id}`)}
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
                        GROUPS.find((g) => g.kind === item.kind)?.icon ?? "hash"
                      }
                      size={18}
                      color={theme.brand}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <AppText variant="bodySemi" numberOfLines={1}>
                      {channelTitle(item)}
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
