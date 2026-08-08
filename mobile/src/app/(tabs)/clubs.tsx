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
import { Screen } from "@/components/screen";
import { AppText, Button, Card } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Minimal local row shapes — the web app's types live outside this tsconfig.
   The directory with one-tap join, mirroring the web clubs page: each row
   opens the club home, and the header plus starts a brand-new club. */

type ClubCategory =
  | "academic"
  | "professional"
  | "cultural"
  | "sports"
  | "social"
  | "service"
  | "other";

type ClubRole = "member" | "officer" | "owner";

/** Raw select shape: `club_members(count)` comes back as [{ count }]. */
type RawClubRow = {
  id: string;
  name: string;
  description: string | null;
  category: ClubCategory;
  club_members: { count: number }[];
};

type ClubItem = {
  id: string;
  name: string;
  description: string | null;
  category: ClubCategory;
  memberCount: number;
};

/** "academic" -> "Academic" — every category is a single word. */
function categoryLabel(category: ClubCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function roleLabel(role: ClubRole): string {
  if (role === "owner") return "Owner";
  if (role === "officer") return "Officer";
  return "Joined";
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

function RolePill({ role }: { role: ClubRole }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: radius.full,
        backgroundColor: theme.brandSoft,
      }}
    >
      <Feather name="check" size={12} color={theme.brandInk} />
      <AppText variant="label" style={{ color: theme.brandInk }}>
        {roleLabel(role)}
      </AppText>
    </View>
  );
}

function ClubRow({
  club,
  myRole,
  joining,
  joinDisabled,
  joinError,
  onJoin,
  onOpen,
}: {
  club: ClubItem;
  myRole: ClubRole | null;
  joining: boolean;
  joinDisabled: boolean;
  joinError: string | null;
  onJoin: () => void;
  onOpen: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${club.name}`}
      onPress={onOpen}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Card padded={false} style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
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
            <Feather name="users" size={18} color={theme.brand} />
          </View>
          <AppText
            variant="bodySemi"
            numberOfLines={2}
            style={{ flex: 1, minWidth: 0 }}
          >
            {club.name}
          </AppText>
          {myRole ? (
            <RolePill role={myRole} />
          ) : (
            <Button
              label="Join"
              variant="soft"
              pending={joining}
              disabled={joinDisabled}
              accessibilityLabel={`Join ${club.name}`}
              icon={
                <Feather name="user-plus" size={15} color={theme.brandInk} />
              }
              onPress={onJoin}
            />
          )}
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <CategoryPill category={club.category} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Feather name="user" size={12} color={theme.muted} />
            <AppText variant="caption" muted>
              {club.memberCount} {club.memberCount === 1 ? "member" : "members"}
            </AppText>
          </View>
        </View>

        {club.description ? (
          <AppText variant="caption" muted numberOfLines={2}>
            {club.description}
          </AppText>
        ) : null}

        {joinError ? (
          <AppText variant="caption" style={{ color: theme.danger }}>
            {joinError}
          </AppText>
        ) : null}
      </Card>
    </Pressable>
  );
}

export default function ClubsScreen() {
  const theme = useTheme();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [clubs, setClubs] = useState<ClubItem[]>([]);
  const [roles, setRoles] = useState<Record<string, ClubRole>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<{
    clubId: string;
    message: string;
  } | null>(null);

  const fetchClubs = useCallback(async () => {
    if (!userId) throw new Error("Not signed in");

    // Same shape as the web clubs page: my university, clubs with member
    // counts, plus my membership roles for the Joined chips.
    const profileRes = await supabase
      .from("profiles")
      .select("university_id")
      .eq("id", userId)
      .single();
    if (profileRes.error) throw profileRes.error;
    const { university_id: universityId } = profileRes.data as unknown as {
      university_id: string;
    };

    const [clubsRes, membershipRes] = await Promise.all([
      supabase
        .from("clubs")
        .select("id, name, description, category, club_members(count)")
        .eq("university_id", universityId)
        .order("name"),
      supabase
        .from("club_members")
        .select("club_id, role")
        .eq("user_id", userId),
    ]);
    if (clubsRes.error) throw clubsRes.error;
    if (membershipRes.error) throw membershipRes.error;

    const rows = (clubsRes.data ?? []) as unknown as RawClubRow[];
    const myRoles: Record<string, ClubRole> = {};
    for (const m of (membershipRes.data ?? []) as unknown as {
      club_id: string;
      role: ClubRole;
    }[]) {
      myRoles[m.club_id] = m.role;
    }

    return {
      clubs: rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        category: row.category,
        memberCount: row.club_members?.[0]?.count ?? 0,
      })),
      roles: myRoles,
    };
  }, [userId]);

  const run = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      try {
        const result = await fetchClubs();
        setClubs(result.clubs);
        setRoles(result.roles);
        setError(null);
      } catch {
        setError("We couldn't load the clubs right now.");
      } finally {
        if (mode === "initial") setLoading(false);
        else setRefreshing(false);
      }
    },
    [fetchClubs]
  );

  useEffect(() => {
    if (!userId) return;
    void run("initial");
  }, [userId, run]);

  const handleJoin = useCallback(
    async (clubId: string) => {
      if (!userId || joiningId) return;
      setJoinError(null);
      setJoiningId(clubId);
      // RLS lets students join clubs at their own university; the default
      // role is "member" — same insert as the web joinClub action.
      const { error: insertError } = await supabase
        .from("club_members")
        .insert({ club_id: clubId, user_id: userId });
      setJoiningId(null);
      if (insertError) {
        setJoinError({
          clubId,
          message: "Couldn't join just now. Give it another try.",
        });
        return;
      }
      setRoles((prev) => ({ ...prev, [clubId]: "member" }));
      setClubs((prev) =>
        prev.map((c) =>
          c.id === clubId ? { ...c, memberCount: c.memberCount + 1 } : c
        )
      );
    },
    [userId, joiningId]
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ClubItem>) => (
      <View style={{ marginBottom: 10 }}>
        <ClubRow
          club={item}
          myRole={roles[item.id] ?? null}
          joining={joiningId === item.id}
          joinDisabled={joiningId !== null}
          joinError={
            joinError && joinError.clubId === item.id ? joinError.message : null
          }
          onJoin={() => void handleJoin(item.id)}
          onOpen={() => router.push(`/club/${item.id}`)}
        />
      </View>
    ),
    [roles, joiningId, joinError, handleJoin]
  );

  return (
    <Screen
      title="Clubs"
      scroll={false}
      action={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start a club"
          onPress={() => router.push("/club/new")}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: radius.full,
            backgroundColor: theme.brandSoft,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Feather name="plus" size={20} color={theme.brandInk} />
        </Pressable>
      }
    >
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
          <AppText variant="caption" muted>
            Rounding up the clubs…
          </AppText>
        </View>
      ) : error && clubs.length === 0 ? (
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
            onPress={() => void run("initial")}
          />
        </View>
      ) : (
        <FlatList
          data={clubs}
          keyExtractor={(club) => club.id}
          renderItem={renderItem}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 40, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={{ gap: 6, marginBottom: 14 }}>
              <AppText muted>
                Student orgs on your campus — find your people.
              </AppText>
              {error ? (
                <AppText variant="caption" style={{ color: theme.danger }}>
                  We couldn't refresh just now — pull down to try again.
                </AppText>
              ) : null}
            </View>
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
              <AppText variant="bodySemi">No clubs yet</AppText>
              <AppText
                variant="caption"
                muted
                style={{ textAlign: "center", maxWidth: 260 }}
              >
                Nobody's founded a club at your school yet — yours could be
                the first.
              </AppText>
              <Button
                label="Start a club"
                variant="soft"
                size="sm"
                icon={<Feather name="plus" size={14} color={theme.brandInk} />}
                onPress={() => router.push("/club/new")}
                style={{ marginTop: 4 }}
              />
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
    </Screen>
  );
}
