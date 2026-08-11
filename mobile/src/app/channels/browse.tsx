import Feather from "@expo/vector-icons/Feather";
import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pennant } from "@/components/illustrations";
import { AppText, Button, Card, EmptyState } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* The campus channel directory: every campus and topic channel at your
   school, A to Z, with one-tap joining. Course chats live with your
   classes, so they stay out of this list.

   A new campus starts with four channels and every student is auto-joined to
   all four, so on move-in week this screen is a full list with nothing to do
   on it — the empty state that recruits the first channel never gets a turn,
   because the list isn't empty. So the recruit sits *above* the list whenever
   there's nothing left here to join, and the empty state stays for the case
   it was written for. Move-in week is the normal case, not the edge case. */

type FeatherName = ComponentProps<typeof Feather>["name"];

type BrowseChannel = {
  id: string;
  kind: "campus" | "topic";
  name: string;
  slug: string;
  description: string | null;
};

function CenteredState({
  icon,
  title,
  message,
  children,
}: {
  icon: FeatherName;
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

export default function BrowseChannelsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const userId = session?.user.id ?? null;

  const [channels, setChannels] = useState<BrowseChannel[]>([]);
  const [joined, setJoined] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/channels");
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    // RLS scopes both reads to the student's own university.
    const [channelsRes, mineRes] = await Promise.all([
      supabase
        .from("channels")
        .select("id, kind, name, slug, description")
        .in("kind", ["campus", "topic"])
        .order("name", { ascending: true }),
      supabase
        .from("channel_members")
        .select("channel_id")
        .eq("user_id", userId),
    ]);
    if (channelsRes.error || mineRes.error) {
      setError("We couldn't load the channel directory. Pull down to try again.");
      return;
    }
    setError(null);
    setChannels((channelsRes.data ?? []) as unknown as BrowseChannel[]);
    setJoined(
      new Set(
        ((mineRes.data ?? []) as { channel_id: string }[]).map(
          (row) => row.channel_id
        )
      )
    );
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    void load().finally(() => setLoading(false));
  }, [userId, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  /** Standard membership insert — the university-scoped policy allows it. */
  const handleJoin = useCallback(
    async (channel: BrowseChannel) => {
      if (!userId || joiningId) return;
      setJoinError(null);
      setJoiningId(channel.id);
      const { error: insertError } = await supabase
        .from("channel_members")
        .insert({ channel_id: channel.id, user_id: userId });
      setJoiningId(null);
      // 23505 means we're already in — treat it as a win and head on through.
      if (insertError && insertError.code !== "23505") {
        setJoinError("Couldn't join that channel just now. Give it another try.");
        return;
      }
      setJoined((prev) => new Set(prev).add(channel.id));
      router.push(`/channel/${channel.id}`);
    },
    [userId, joiningId]
  );

  // Deep links land here directly — a signed-out visitor gets a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  /** Nothing left to join: every channel the directory lists is already hers. */
  const allJoined =
    channels.length > 0 && channels.every((channel) => joined.has(channel.id));

  const scaffold = (children: React.ReactNode) => (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + 8,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 12,
        }}
      >
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
        <Button
          label="Start a channel"
          variant="soft"
          size="sm"
          icon={<Feather name="plus" size={14} color={theme.brandInk} />}
          onPress={() => router.push("/channels/new")}
          style={{ marginRight: 8 }}
        />
      </View>
      {children}
    </View>
  );

  if (loading) {
    return scaffold(
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
          Opening the directory…
        </AppText>
      </View>
    );
  }

  if (error && channels.length === 0) {
    return scaffold(
      <CenteredState
        icon="wifi-off"
        title="Something hiccuped"
        message="We couldn't load the channel directory. Check your connection and give it another go."
      >
        <Button
          label="Try again"
          variant="soft"
          size="sm"
          onPress={() => {
            setLoading(true);
            void load().finally(() => setLoading(false));
          }}
        />
      </CenteredState>
    );
  }

  return scaffold(
    <FlatList
      data={channels}
      keyExtractor={(channel) => channel.id}
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingBottom: insets.bottom + 32,
        flexGrow: 1,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.brand}
          colors={[theme.brand]}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: 4, marginBottom: 14 }}>
          <AppText variant="display">Browse channels</AppText>
          <AppText variant="caption" muted>
            Every campus and topic channel at your school — join the ones that
            feel like home.
          </AppText>
          {error ? (
            <AppText
              variant="caption"
              style={{ color: theme.danger, marginTop: 4 }}
            >
              {error}
            </AppText>
          ) : null}
          {joinError ? (
            <AppText
              variant="caption"
              style={{ color: theme.danger, marginTop: 4 }}
            >
              {joinError}
            </AppText>
          ) : null}
          {allJoined ? (
            <EmptyState
              illustration={Pennant}
              title="You're in every channel here"
              body="That's the whole directory for now. Start one for anything else your campus should have — a class you're taking, a team you follow, a thing you can't stop talking about."
              action={{
                label: "Start a channel",
                onPress: () => router.push("/channels/new"),
              }}
              style={{ marginTop: 8 }}
            />
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          illustration={Pennant}
          title="Nothing to browse yet"
          body="Be the first — start a channel for anything your campus cares about."
          action={{
            label: "Start a channel",
            onPress: () => router.push("/channels/new"),
          }}
        />
      }
      renderItem={({ item }) => {
        const isJoined = joined.has(item.id);
        const joining = joiningId === item.id;
        const title = `#${item.slug}`;
        const caption =
          item.description ??
          (item.kind === "campus" ? "Campus channel" : "Topic channel");
        const row = (
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
                name={item.kind === "campus" ? "volume-2" : "hash"}
                size={18}
                color={theme.brand}
              />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <AppText variant="bodySemi" numberOfLines={1}>
                {title}
              </AppText>
              <AppText variant="caption" muted numberOfLines={1}>
                {caption}
              </AppText>
            </View>
            {isJoined ? (
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <AppText variant="caption" muted>
                  Joined
                </AppText>
                <Feather name="chevron-right" size={16} color={theme.muted} />
              </View>
            ) : (
              <Button
                label="Join"
                variant="soft"
                size="sm"
                pending={joining}
                disabled={joiningId !== null}
                accessibilityLabel={`Join ${title}`}
                onPress={() => void handleJoin(item)}
              />
            )}
          </Card>
        );
        if (!isJoined) {
          return <View style={{ marginBottom: 10 }}>{row}</View>;
        }
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${title}`}
            onPress={() => router.push(`/channel/${item.id}`)}
            style={({ pressed }) => ({
              opacity: pressed ? 0.85 : 1,
              marginBottom: 10,
            })}
          >
            {row}
          </Pressable>
        );
      }}
    />
  );
}
