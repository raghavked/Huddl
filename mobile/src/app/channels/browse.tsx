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
import { RoomTile } from "@/components/room-tile";
import { AppText, Button, Card, EmptyState } from "@/components/ui";
import { space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { roomKindLabel, roomTitle } from "@/lib/room-identity";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* The campus channel directory: every campus and topic channel at your
   school, A to Z, with one-tap joining. Course chats live with your
   classes, so they stay out of this list.

   A new campus starts with four channels and every student is auto-joined to
   all four, so on move-in week this screen is a full list with nothing to do
   on it. The empty state that recruits the first channel never gets a turn,
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
        gap: space.room,
        padding: space.rest,
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
      setError("We couldn't load the room directory. Pull down to try again.");
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

  /** Standard membership insert; the university-scoped policy allows it. */
  const handleJoin = useCallback(
    async (channel: BrowseChannel) => {
      if (!userId || joiningId) return;
      setJoinError(null);
      setJoiningId(channel.id);
      const { error: insertError } = await supabase
        .from("channel_members")
        .insert({ channel_id: channel.id, user_id: userId });
      setJoiningId(null);
      // 23505 means we're already in, so treat it as a win and head on through.
      if (insertError && insertError.code !== "23505") {
        setJoinError("Couldn't join that room just now. Give it another try.");
        return;
      }
      setJoined((prev) => new Set(prev).add(channel.id));
      router.push(`/channel/${channel.id}`);
    },
    [userId, joiningId]
  );

  // Deep links land here directly, so a signed-out visitor gets a proper door.
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
          label="Start a room"
          variant="soft"
          size="sm"
          icon={<Feather name="plus" size={14} color={theme.brandInk} />}
          onPress={() => router.push("/channels/new")}
          style={{ marginRight: space.cosy }}
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
          gap: space.close,
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
        message="We couldn't load the room directory. Check your connection and give it another go."
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
        paddingHorizontal: space.gutter,
        paddingBottom: insets.bottom + space.rest,
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
        <View style={{ gap: space.tight, marginBottom: space.card }}>
          <AppText variant="display">Browse rooms</AppText>
          <AppText variant="caption" muted>
            Every campus and topic channel at your school. Join the ones that
            feel like home.
          </AppText>
          {error ? (
            <AppText
              variant="caption"
              style={{ color: theme.danger, marginTop: space.tight }}
            >
              {error}
            </AppText>
          ) : null}
          {joinError ? (
            <AppText
              variant="caption"
              style={{ color: theme.danger, marginTop: space.tight }}
            >
              {joinError}
            </AppText>
          ) : null}
          {allJoined ? (
            <EmptyState
              illustration={Pennant}
              title="You're in every channel here"
              body="That's the whole directory for now. Start one for anything your campus is missing: a class you're taking, a team you follow."
              action={{
                label: "Start a room",
                onPress: () => router.push("/channels/new"),
              }}
              style={{ marginTop: space.cosy }}
            />
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          illustration={Pennant}
          title="Nothing to browse yet"
          body="Your campus doesn't have any channels yet. You could be the first."
          action={{
            label: "Start a room",
            onPress: () => router.push("/channels/new"),
          }}
        />
      }
      renderItem={({ item, index }) => {
        const isJoined = joined.has(item.id);
        const joining = joiningId === item.id;
        const title = roomTitle(item.name, item.slug);
        const caption = item.description ?? roomKindLabel(item.kind);
        const row = (
          <Card
            padded={false}
            entrance={index}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.close,
              paddingHorizontal: space.card,
              paddingVertical: space.close,
              minHeight: 60,
            }}
          >
            <RoomTile
              kind={item.kind}
              name={item.name}
              slug={item.slug}
              size={32}
            />
            <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
              <AppText variant="bodySemi" numberOfLines={1}>
                {title}
              </AppText>
              <AppText variant="caption" muted numberOfLines={1}>
                {caption}
              </AppText>
            </View>
            {isJoined ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.snug,
                }}
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
          return <View style={{ marginBottom: space.room }}>{row}</View>;
        }
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${title}`}
            onPress={() => router.push(`/channel/${item.id}`)}
            style={({ pressed }) => ({
              opacity: pressed ? 0.85 : 1,
              marginBottom: space.room,
            })}
          >
            {row}
          </Pressable>
        );
      }}
    />
  );
}
