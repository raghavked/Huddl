import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { unblockUser } from "@/lib/blocks";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Your block list: everyone you've blocked, with a one-tap way back.
   Unblocking is optimistic — the row leaves immediately and returns
   (with a gentle note) only if the server disagrees. */

type BlockedProfile = {
  id: string;
  handle: string;
  display_name: string;
};

type BlockRow = {
  blocked_id: string;
  created_at: string;
  profile: { handle: string; display_name: string } | null;
};

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

function BlockedRowCard({
  person,
  unblocking,
  onUnblock,
}: {
  person: BlockedProfile;
  unblocking: boolean;
  onUnblock: () => void;
}) {
  const theme = useTheme();
  return (
    <Card
      padded={false}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        minHeight: 68,
        marginBottom: 10,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.full,
          backgroundColor: theme.surface2,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <AppText variant="title" style={{ color: theme.muted, fontSize: 16 }}>
          {initialsOf(person.display_name) || "?"}
        </AppText>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodySemi" numberOfLines={1}>
          {person.display_name}
        </AppText>
        <AppText variant="caption" muted numberOfLines={1}>
          @{person.handle}
        </AppText>
      </View>
      <Button
        label="Unblock"
        variant="secondary"
        size="sm"
        pending={unblocking}
        onPress={onUnblock}
      />
    </Card>
  );
}

export default function BlockedPeopleScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [people, setPeople] = useState<BlockedProfile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  }, []);

  const fetchBlocked = useCallback(async (): Promise<BlockedProfile[]> => {
    if (!userId) throw new Error("Not signed in");
    const { data, error: queryError } = await supabase
      .from("blocks")
      .select(
        "blocked_id, created_at, profile:profiles!blocks_blocked_id_fkey(handle, display_name)"
      )
      .eq("blocker_id", userId)
      .order("created_at", { ascending: false });
    if (queryError) throw queryError;
    return ((data ?? []) as unknown as BlockRow[])
      .map((row) =>
        row.profile
          ? {
              id: row.blocked_id,
              handle: row.profile.handle,
              display_name: row.profile.display_name,
            }
          : null
      )
      .filter((p): p is BlockedProfile => p !== null);
  }, [userId]);

  const run = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      try {
        setPeople(await fetchBlocked());
        setError(null);
      } catch {
        setError("We couldn't load your block list right now.");
      } finally {
        if (mode === "initial") setLoading(false);
        if (mode === "refresh") setRefreshing(false);
      }
    },
    [fetchBlocked]
  );

  useEffect(() => {
    if (!userId) return;
    void run("initial");
  }, [userId, run]);

  const handleUnblock = useCallback(
    async (person: BlockedProfile) => {
      if (!userId || unblockingId) return;
      setRowError(null);
      setUnblockingId(person.id);
      // Optimistic: the row leaves right away, and comes back on failure.
      const previous = people ?? [];
      setPeople(previous.filter((p) => p.id !== person.id));
      try {
        await unblockUser(userId, person.id);
      } catch {
        setPeople(previous);
        setRowError(
          `We couldn't unblock ${person.display_name} just now — give it another try.`
        );
      } finally {
        setUnblockingId(null);
      }
    },
    [userId, unblockingId, people]
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<BlockedProfile>) => (
      <BlockedRowCard
        person={item}
        unblocking={unblockingId === item.id}
        onUnblock={() => void handleUnblock(item)}
      />
    ),
    [unblockingId, handleUnblock]
  );

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + 8,
        paddingHorizontal: 20,
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
          marginLeft: -10,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Feather name="chevron-left" size={26} color={theme.foreground} />
      </Pressable>

      <AppText variant="display" style={{ marginTop: 2 }}>
        Blocked people
      </AppText>
      <AppText variant="caption" muted style={{ marginTop: 4, marginBottom: 16 }}>
        They can't DM you, and their posts stay out of sight. They were never
        told.
      </AppText>

      {loading ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            paddingBottom: 80,
          }}
        >
          <ActivityIndicator size="large" color={theme.brand} />
        </View>
      ) : error && people === null ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            paddingBottom: 80,
          }}
        >
          <Feather name="cloud-off" size={28} color={theme.muted} />
          <AppText variant="bodySemi">Something went sideways</AppText>
          <AppText
            variant="caption"
            muted
            style={{ textAlign: "center", maxWidth: 260 }}
          >
            {error} Check your connection and give it another go.
          </AppText>
          <Button
            label="Try again"
            variant="soft"
            size="sm"
            onPress={() => void run("initial")}
          />
        </View>
      ) : (
        <FlatList
          data={people ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            rowError || error ? (
              <AppText
                variant="caption"
                style={{ color: theme.danger, marginBottom: 10 }}
              >
                {rowError ?? "We couldn't refresh just now — pull down to try again."}
              </AppText>
            ) : null
          }
          ListEmptyComponent={
            <Card
              style={{
                alignItems: "center",
                gap: 6,
                paddingVertical: 28,
                borderStyle: "dashed",
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: radius.full,
                  backgroundColor: theme.brandSoft,
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 2,
                }}
              >
                <Feather name="smile" size={20} color={theme.brand} />
              </View>
              <AppText variant="bodySemi">No one on the list</AppText>
              <AppText
                variant="caption"
                muted
                style={{ textAlign: "center", maxWidth: 280 }}
              >
                You haven't blocked anyone. Hopefully it stays that way.
              </AppText>
            </Card>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void run("refresh")}
              tintColor={theme.brand}
              colors={[theme.brand]}
            />
          }
        />
      )}
    </View>
  );
}
