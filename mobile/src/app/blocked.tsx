import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Mug } from "@/components/illustrations";
import {
  AppText,
  Button,
  Card,
  EmptyState,
  SkeletonRow,
} from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { unblockUser } from "@/lib/blocks";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Your block list: everyone you've blocked, with a one-tap way back.
   Unblocking is optimistic: the row leaves immediately and returns
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

/** "Ada Lovelace" -> "AL" for the muted circle. See {@link MutedInitials}. */
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

/**
 * A deliberate exception to "`Avatar` is the one way we draw a person": a
 * neutral `surface2` circle with muted initials, no photo and no tint.
 *
 * `Avatar` colors its initials circle by a stable hash of the name, which is
 * exactly right everywhere you want to recognize someone at a glance, and
 * wrong here. This list is a settings chore, not a room full of people: a
 * column of ember and fern circles turns "who I've quietly blocked" into
 * something that looks like a friends list, and we deliberately don't render
 * their photo either. The row stays quiet and unremarkable on purpose.
 *
 * If a second screen ever needs this, that's the signal to give `Avatar` a
 * documented quiet variant instead of copying this circle again. Recorded in
 * `docs/DESIGN.md` §4 so it reads as a decision, not drift.
 */
function MutedInitials({ name }: { name: string }) {
  const theme = useTheme();
  return (
    <View
      // Two letters standing in for a face; the name is right beside it.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
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
        {initialsOf(name) || "?"}
      </AppText>
    </View>
  );
}

function BlockedRowCard({
  person,
  index,
  unblocking,
  onUnblock,
}: {
  person: BlockedProfile;
  /** Position in the list, for the staggered arrival. */
  index: number;
  unblocking: boolean;
  onUnblock: () => void;
}) {
  return (
    <Card
      padded={false}
      entrance={index}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.close,
        paddingHorizontal: space.card,
        paddingVertical: space.close,
        minHeight: 68,
        marginBottom: space.room,
      }}
    >
      {/* Not `Avatar` on purpose. See MutedInitials above. */}
      <MutedInitials name={person.display_name} />
      {/* One person, said once. The button beside it stays its own target. */}
      <View
        accessible
        accessibilityLabel={`${person.display_name}, @${person.handle}`}
        style={{ flex: 1, gap: space.hair }}
      >
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
        accessibilityLabel={`Unblock ${person.display_name}`}
        accessibilityState={{ busy: unblocking, disabled: unblocking }}
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
          `We couldn't unblock ${person.display_name} just now. Give it another try.`
        );
      } finally {
        setUnblockingId(null);
      }
    },
    [userId, unblockingId, people]
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<BlockedProfile>) => (
      <BlockedRowCard
        person={item}
        index={index}
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
        paddingTop: insets.top + space.close,
        paddingHorizontal: space.gutter,
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
        <Feather
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          name="chevron-left"
          size={26}
          color={theme.foreground}
        />
      </Pressable>

      <AppText
        variant="display"
        accessibilityRole="header"
        style={{ marginTop: space.hair }}
      >
        Blocked people
      </AppText>
      <AppText variant="caption" muted style={{ marginTop: space.tight, marginBottom: space.card }}>
        They can't DM you, and their posts stay out of sight. They were never
        told.
      </AppText>

      {loading ? (
        // The row shape is honest here, so ghost it rather than spin.
        <View style={{ flex: 1 }}>
          {[0, 1, 2].map((index) => (
            <SkeletonRow key={index} />
          ))}
        </View>
      ) : error && people === null ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: space.room,
            paddingBottom: 80,
          }}
        >
          <Feather
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            name="cloud-off"
            size={28}
            color={theme.muted}
          />
          <AppText variant="bodySemi" accessibilityRole="header">
            Something went sideways
          </AppText>
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
          contentContainerStyle={{ paddingBottom: insets.bottom + space.rest }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            rowError || error ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={{ color: theme.danger, marginBottom: space.room }}
              >
                {rowError ?? "We couldn't refresh just now. Pull down to try again."}
              </AppText>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              illustration={Mug}
              title="No one on the list"
              body="You haven't blocked anyone. Hopefully it stays that way."
            />
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
