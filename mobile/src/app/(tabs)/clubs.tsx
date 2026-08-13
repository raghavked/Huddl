import Feather from "@expo/vector-icons/Feather";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  TextInput,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { MagnifyingGlass, Pennant } from "@/components/illustrations";
import { Screen } from "@/components/screen";
import {
  AppText,
  Button,
  Card,
  EmptyState,
  SectionLabel,
} from "@/components/ui";
import { fonts, radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { type ClubRole } from "@/lib/club-announcements";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Minimal local row shapes. The web app's types live outside this tsconfig.
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

/** One row of the list: a group heading, or a club. */
type ListRow =
  | { type: "label"; key: string; text: string }
  | { type: "club"; key: string; club: ClubItem };

/** "academic" -> "Academic". Every category is a single word. */
function categoryLabel(category: ClubCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/**
 * Does this club answer what was typed? Name, category and blurb, all
 * case-insensitively: "photo" should find the photography club whether the
 * word is in its name or its one-line description.
 */
function matches(club: ClubItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return [club.name, categoryLabel(club.category), club.description ?? ""].some(
    (field) => field.toLowerCase().includes(needle)
  );
}

function roleLabel(role: ClubRole): string {
  if (role === "owner") return "Owner";
  if (role === "officer") return "Officer";
  return "Joined";
}

/** The role pill in words, for the row's own label. */
function roleWords(role: ClubRole): string {
  if (role === "owner") return "you're the owner";
  if (role === "officer") return "you're an officer";
  return "you've joined";
}

function CategoryPill({ category }: { category: ClubCategory }) {
  const theme = useTheme();
  return (
    <View
      // Both pills are said by the row's label; here they are only drawn.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        paddingHorizontal: space.room,
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
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.tight,
        paddingHorizontal: space.room,
        paddingVertical: space.snug,
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
  index,
  onJoin,
  onOpen,
}: {
  club: ClubItem;
  myRole: ClubRole | null;
  joining: boolean;
  joinDisabled: boolean;
  joinError: string | null;
  index: number;
  onJoin: () => void;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const members = `${club.memberCount} ${
    club.memberCount === 1 ? "member" : "members"
  }`;
  /* Everything drawn across the card, said once. The pills, the headcount
     and the blurb all live here so the reader meets one club, not five
     fragments of one. */
  const label = [
    `Open ${club.name}`,
    myRole ? roleWords(myRole) : null,
    categoryLabel(club.category),
    members,
    club.description,
  ]
    .filter(Boolean)
    .join(", ");

  /* The card is two tappable regions rather than one, and deliberately: a
     single accessible wrapper around the whole thing would swallow the Join
     button, and a button a reader cannot reach is a button that isn't
     there. Both regions open the club; Join stands on its own. */
  return (
    <Card
      padded={false}
      entrance={index}
      style={{ padding: space.card, gap: space.room }}
    >
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: space.close }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={onOpen}
          style={({ pressed }) => ({
            flex: 1,
            minWidth: 0,
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            gap: space.close,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
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
        </Pressable>
        {myRole ? (
          <RolePill role={myRole} />
        ) : (
          <Button
            label="Join"
            variant="soft"
            pending={joining}
            disabled={joinDisabled}
            accessibilityLabel={`Join ${club.name}`}
            accessibilityState={{ disabled: joinDisabled, busy: joining }}
            icon={<Feather name="user-plus" size={15} color={theme.brandInk} />}
            onPress={onJoin}
          />
        )}
      </View>

      <Pressable
        // The lower half opens the club too, and its words are already in the
        // label above, so it stays silent rather than repeating itself.
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onPress={onOpen}
        style={({ pressed }) => ({
          gap: space.room,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.cosy,
          }}
        >
          <CategoryPill category={club.category} />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.tight,
            }}
          >
            <Feather name="user" size={12} color={theme.muted} />
            <AppText variant="caption" muted>
              {members}
            </AppText>
          </View>
        </View>

        {club.description ? (
          <AppText variant="caption" muted numberOfLines={2}>
            {club.description}
          </AppText>
        ) : null}
      </Pressable>

      {joinError ? (
        <AppText
          variant="caption"
          accessibilityLiveRegion="polite"
          style={{ color: theme.danger }}
        >
          {joinError}
        </AppText>
      ) : null}
    </Card>
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
  const [query, setQuery] = useState("");

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
    async (mode: "initial" | "refresh" | "silent") => {
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      try {
        const result = await fetchClubs();
        setClubs(result.clubs);
        setRoles(result.roles);
        setError(null);
      } catch {
        setError("We couldn't load the clubs right now.");
      } finally {
        if (mode === "initial") setLoading(false);
        if (mode === "refresh") setRefreshing(false);
      }
    },
    [fetchClubs]
  );

  /* Tabs stay mounted, so a fetch on mount is a fetch once a session: start a
     club, tap back, and it wasn't in the list. First focus loads with a
     spinner; every focus after it refetches quietly. */
  const loadedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      if (loadedRef.current) {
        void run("silent");
      } else {
        loadedRef.current = true;
        void run("initial");
      }
    }, [userId, run])
  );

  const handleJoin = useCallback(
    async (clubId: string) => {
      if (!userId || joiningId) return;
      setJoinError(null);
      setJoiningId(clubId);
      // RLS lets students join clubs at their own university; the default
      // role is "member", the same insert as the web joinClub action.
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

  /**
   * The clubs you're already in, lifted to the top under their own heading,
   * then everything else. An alphabetical wall buries the three clubs a
   * student actually opens somewhere between Anime and Ultimate. With no
   * memberships there is nothing to separate, so the list stays unlabelled.
   */
  const rows = useMemo<ListRow[]>(() => {
    const visible = clubs.filter((club) => matches(club, query));
    const mine = visible.filter((club) => roles[club.id] !== undefined);
    const rest = visible.filter((club) => roles[club.id] === undefined);
    const out: ListRow[] = [];
    if (mine.length === 0) {
      for (const club of rest) out.push({ type: "club", key: club.id, club });
      return out;
    }
    out.push({ type: "label", key: "label-mine", text: "Your clubs" });
    for (const club of mine) out.push({ type: "club", key: club.id, club });
    if (rest.length > 0) {
      out.push({ type: "label", key: "label-rest", text: "More on campus" });
      for (const club of rest) out.push({ type: "club", key: club.id, club });
    }
    return out;
  }, [clubs, roles, query]);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ListRow>) => {
      if (item.type === "label") {
        return <SectionLabel text={item.text} first={index === 0} />;
      }
      const club = item.club;
      return (
        <View style={{ marginBottom: space.room }}>
          <ClubRow
            club={club}
            index={index}
            myRole={roles[club.id] ?? null}
            joining={joiningId === club.id}
            joinDisabled={joiningId !== null}
            joinError={
              joinError && joinError.clubId === club.id
                ? joinError.message
                : null
            }
            onJoin={() => void handleJoin(club.id)}
            onOpen={() => router.push(`/club/${club.id}`)}
          />
        </View>
      );
    },
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
            gap: space.close,
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
            onPress={() => void run("initial")}
          />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderItem}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 40, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={
            <View style={{ gap: space.room, marginBottom: space.card }}>
              <AppText muted>
                Student orgs on your campus. Find your people.
              </AppText>
              <View style={{ justifyContent: "center" }}>
                <Feather
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  name="search"
                  size={16}
                  color={theme.muted}
                  style={{ position: "absolute", left: 14, zIndex: 1 }}
                />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search clubs"
                  placeholderTextColor={theme.muted + "b3"}
                  accessibilityLabel="Search clubs by name, category or description"
                  autoCapitalize="none"
                  autoCorrect={false}
                  cursorColor={theme.brand}
                  selectionColor={theme.brandSoft}
                  style={{
                    height: 44,
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: radius.full,
                    backgroundColor: theme.surface,
                    paddingLeft: 40,
                    paddingRight: 44,
                    fontFamily: fonts.body,
                    fontSize: 15,
                    color: theme.foreground,
                  }}
                />
                {query.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                    onPress={() => setQuery("")}
                    style={({ pressed }) => ({
                      position: "absolute",
                      right: 0,
                      width: 44,
                      height: 44,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Feather
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                      name="x"
                      size={16}
                      color={theme.muted}
                    />
                  </Pressable>
                ) : null}
              </View>
              {error ? (
                <AppText
                  variant="caption"
                  accessibilityLiveRegion="polite"
                  style={{ color: theme.danger }}
                >
                  We couldn't refresh just now. Pull down to try again.
                </AppText>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            query.trim().length > 0 ? (
              <EmptyState
                illustration={MagnifyingGlass}
                title="Nothing matched that"
                body={`No club here answers to "${query.trim()}". Try a shorter word, or start the one that's missing.`}
                action={{
                  label: "Start a club",
                  onPress: () => router.push("/club/new"),
                }}
              />
            ) : (
              <EmptyState
                illustration={Pennant}
                title="No clubs yet"
                body="Nobody's started a club at your school yet. Be the first."
                action={{
                  label: "Start a club",
                  onPress: () => router.push("/club/new"),
                }}
              />
            )
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
