import Feather from "@expo/vector-icons/Feather";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  TextInput,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { AppText, Button, Card, Chip } from "@/components/ui";
import { fonts, radius, space } from "@/constants/theme";
import { useBlockedIds } from "@/hooks/use-blocked";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/**
 * One classmate as the directory draws them. A private profile arrives with
 * nothing but a handle and an avatar, because that is all the query asked
 * for. See {@link LIMITED_SELECT}. Nulling hidden columns in JavaScript
 * would still have put them on the wire.
 */
type DirectoryPerson = {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  major: string | null;
  grad_year: number | null;
  /** Always empty for a private classmate; drives the `?interest=` filter. */
  interests: string[];
  is_public: boolean;
};

/** A profile the viewer may read in full: a public one, or their own. */
type OpenRow = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  major: string | null;
  grad_year: number | null;
  interests: string[] | null;
  is_public: boolean;
};

/** A private classmate, exactly as much of them as the row draws. */
type LimitedRow = {
  id: string;
  handle: string;
  avatar_url: string | null;
};

const OPEN_SELECT =
  "id, handle, display_name, avatar_url, major, grad_year, interests, is_public";

/** Handle and avatar, and not one column more. */
const LIMITED_SELECT = "id, handle, avatar_url";

type MeRow = {
  university_id: string;
  university: { short_name: string } | null;
};

/** How much of the directory one fetch carries. */
const PAGE_SIZE = 60;

/** Where the walk stands: open profiles A to Z first, private handles after. */
type Paging = {
  openOffset: number;
  limitedOffset: number;
  openDone: boolean;
};

/* PostgREST's or() is a grammar of its own, and % _ , ( ) are its
   punctuation. A search term keeps none of them, so a term can only
   ever be a term. */
function sanitizeSearch(raw: string): string {
  return raw.trim().replace(/[%_,()]/g, "");
}

/**
 * Arriving from a chip on somebody's profile: show only the classmates who
 * put the same thing on theirs. A private profile never matches: we don't
 * have their interests, and we shouldn't.
 */
function sharesInterest(person: DirectoryPerson, interest: string): boolean {
  if (interest.length === 0) return true;
  const wanted = interest.toLowerCase();
  return person.interests.some((entry) => entry.toLowerCase() === wanted);
}

/** text[] from PostgREST, kept honest before it reaches the filter. */
function interestsOf(raw: string[] | null): string[] {
  return Array.isArray(raw)
    ? raw.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0
      )
    : [];
}

function Pill({
  label,
  icon,
  bg,
  fg,
}: {
  label: string;
  icon?: keyof typeof Feather.glyphMap;
  bg: string;
  fg: string;
}) {
  return (
    <View
      // "You" and "Private" are both in the row's own label; here they are
      // only drawn.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.tight,
        paddingHorizontal: space.cosy,
        paddingVertical: space.hair,
        borderRadius: radius.full,
        backgroundColor: bg,
      }}
    >
      {icon ? <Feather name={icon} size={10} color={fg} /> : null}
      <AppText variant="label" style={{ color: fg, fontSize: 11 }}>
        {label}
      </AppText>
    </View>
  );
}

/**
 * One classmate said in one sentence. The lock glyph, the "You" pill and the
 * "Private" pill are all drawing, so each of them is spelled out here.
 */
function personLabel(person: DirectoryPerson, isMe: boolean): string {
  if (person.display_name === null) {
    return `Open @${person.handle}, private profile`;
  }
  return [
    isMe
      ? `Open your profile, ${person.display_name}`
      : `Open ${person.display_name}`,
    isMe && !person.is_public ? "private profile" : null,
    `@${person.handle}`,
    person.major,
    person.grad_year ? `Class of ${person.grad_year}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function PersonRow({
  person,
  isMe,
  entrance,
}: {
  person: DirectoryPerson;
  isMe: boolean;
  /** Row index for the staggered arrival; omitted when nothing arrived. */
  entrance?: number;
}) {
  const theme = useTheme();
  const limited = person.display_name === null;
  const name = person.display_name ?? person.handle;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={personLabel(person, isMe)}
      onPress={() => router.push(`/u/${person.handle}`)}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
        marginBottom: space.room,
      })}
    >
      <Card
        padded={false}
        entrance={entrance}
        // Initials, a name, two pills and a chevron are one classmate.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.close,
          paddingHorizontal: space.card,
          paddingVertical: space.close,
          minHeight: 68,
        }}
      >
        <Avatar url={person.avatar_url} name={name} size={44} />
        <View style={{ flex: 1, gap: space.hair }}>
          {limited ? (
            <>
              <AppText variant="bodySemi" numberOfLines={1}>
                @{person.handle}
              </AppText>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.tight,
                }}
              >
                <Feather name="lock" size={11} color={theme.muted} />
                <AppText variant="caption" muted>
                  Private profile
                </AppText>
              </View>
            </>
          ) : (
            <>
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
                  {person.display_name}
                </AppText>
                {isMe ? (
                  <Pill label="You" bg={theme.brandSoft} fg={theme.brandInk} />
                ) : null}
                {isMe && !person.is_public ? (
                  <Pill
                    label="Private"
                    icon="lock"
                    bg={theme.surface2}
                    fg={theme.muted}
                  />
                ) : null}
              </View>
              <AppText variant="caption" muted numberOfLines={1}>
                @{person.handle}
              </AppText>
              {person.major || person.grad_year ? (
                <AppText variant="caption" muted numberOfLines={1}>
                  {[
                    person.major,
                    person.grad_year ? `Class of ${person.grad_year}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </AppText>
              ) : null}
            </>
          )}
        </View>
        <Feather name="chevron-right" size={18} color={theme.muted} />
      </Card>
    </Pressable>
  );
}

export default function PeopleScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [people, setPeople] = useState<DirectoryPerson[] | null>(null);
  const [uniName, setUniName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const pagingRef = useRef<Paging>({
    openOffset: 0,
    limitedOffset: 0,
    openDone: false,
  });
  /** The term the loaded pages actually belong to, so a stale walk is never extended. */
  const pagedQueryRef = useRef("");
  /** Only the newest fetch gets to speak; the ones it lapped stay quiet. */
  const fetchIdRef = useRef(0);
  const meRef = useRef<{
    userId: string;
    universityId: string;
    uniName: string | null;
  } | null>(null);
  const hasLoadedRef = useRef(false);

  // The keyboard runs ahead of the network; the wire waits for a pause.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(sanitizeSearch(query)), 300);
    return () => clearTimeout(timer);
  }, [query]);

  /* A tap on an interest chip over on somebody's profile lands here as
     `?interest=`. It reads as a chip above the list with its own way off,
     so the screen never gets stuck in a filter you didn't set yourself. */
  const params = useLocalSearchParams<{ interest?: string }>();
  const interestParam =
    typeof params.interest === "string" ? params.interest.trim() : "";
  const [interest, setInterest] = useState(interestParam);
  useEffect(() => {
    setInterest(interestParam);
  }, [interestParam]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  }, []);

  const fetchPage = useCallback(
    async (
      q: string,
      paging: Paging
    ): Promise<{
      rows: DirectoryPerson[];
      next: Paging;
      hasMore: boolean;
      uniName: string | null;
    }> => {
      if (!userId) throw new Error("Not signed in");

      // A first page re-reads who and where you are; later pages take it as read.
      const firstPage =
        paging.openOffset === 0 &&
        paging.limitedOffset === 0 &&
        !paging.openDone;
      let me = meRef.current;
      if (!me || me.userId !== userId || firstPage) {
        const { data: meData, error: meError } = await supabase
          .from("profiles")
          .select("university_id, university:universities(short_name)")
          .eq("id", userId)
          .maybeSingle();
        if (meError || !meData) throw meError ?? new Error("No profile");
        const row = meData as unknown as MeRow;
        me = {
          userId,
          universityId: row.university_id,
          uniName: row.university?.short_name ?? null,
        };
        meRef.current = me;
      }

      /* Two queries, because the difference between them is the whole point: a
         private classmate's name, major, year and interests are never asked
         for, so they never leave the database. Stripping them here instead
         would ship every hidden field to the phone first. The walk reads the
         open profiles A to Z, then the private handles, and every fetch cuts
         one page of sixty from wherever it stands. */
      const rows: DirectoryPerson[] = [];
      let { openOffset, limitedOffset, openDone } = paging;

      if (!openDone) {
        /* The A-to-Z walk streams the (university_id, display_name) index
           through PostgREST. A name search goes through search_directory
           instead: the definer function plans with the real campus and
           pattern in hand, where the same filter phrased as a PostgREST
           or() falls off the index at campus scale. */
        const openRes =
          q.length > 0
            ? await supabase.rpc("search_directory", {
                p_query: q,
                p_offset: openOffset,
                p_public_only: true,
              })
            : await supabase
                .from("profiles")
                .select(OPEN_SELECT)
                .eq("university_id", me.universityId)
                .or(`is_public.eq.true,id.eq.${userId}`)
                .order("display_name", { ascending: true })
                .range(openOffset, openOffset + PAGE_SIZE - 1);
        if (openRes.error) throw openRes.error;
        const open = (openRes.data ?? []) as unknown as OpenRow[];
        rows.push(
          ...open.map((p) => ({
            id: p.id,
            handle: p.handle,
            display_name: p.display_name,
            avatar_url: p.avatar_url,
            major: p.major,
            grad_year: p.grad_year,
            interests: interestsOf(p.interests),
            is_public: p.is_public,
          }))
        );
        openOffset += open.length;
        if (open.length < PAGE_SIZE) openDone = true;
      }

      if (openDone && rows.length < PAGE_SIZE) {
        const need = PAGE_SIZE - rows.length;
        let limitedQuery = supabase
          .from("profiles")
          .select(LIMITED_SELECT)
          .eq("university_id", me.universityId)
          .eq("is_public", false)
          .neq("id", userId);
        // Private profiles only expose their handle, so only the handle is searchable.
        if (q.length > 0) {
          limitedQuery = limitedQuery.ilike("handle", `%${q}%`);
        }
        const limitedRes = await limitedQuery
          .order("handle", { ascending: true })
          .range(limitedOffset, limitedOffset + need - 1);
        if (limitedRes.error) throw limitedRes.error;
        const limited = (limitedRes.data ?? []) as unknown as LimitedRow[];
        rows.push(
          ...limited.map((p) => ({
            id: p.id,
            handle: p.handle,
            display_name: null,
            avatar_url: p.avatar_url,
            major: null,
            grad_year: null,
            interests: [],
            is_public: false,
          }))
        );
        limitedOffset += limited.length;
      }

      return {
        rows,
        next: { openOffset, limitedOffset, openDone },
        // A full page means the walk may not be over; a short one means it is.
        hasMore: rows.length === PAGE_SIZE,
        uniName: me.uniName,
      };
    },
    [userId]
  );

  const run = useCallback(
    async (mode: "initial" | "refresh" | "search") => {
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      const fetchId = ++fetchIdRef.current;
      try {
        const result = await fetchPage(search, {
          openOffset: 0,
          limitedOffset: 0,
          openDone: false,
        });
        if (fetchIdRef.current !== fetchId) return;
        pagingRef.current = result.next;
        pagedQueryRef.current = search;
        setPeople(result.rows);
        setHasMore(result.hasMore);
        setUniName(result.uniName);
        setError(null);
      } catch {
        if (fetchIdRef.current !== fetchId) return;
        setError("We couldn't load the directory right now.");
      } finally {
        if (mode === "initial") setLoading(false);
        if (mode === "refresh") setRefreshing(false);
      }
    },
    [fetchPage, search]
  );

  const loadMore = useCallback(async () => {
    if (loading || refreshing || loadingMore || !hasMore) return;
    if (people === null || pagedQueryRef.current !== search) return;
    setLoadingMore(true);
    const fetchId = ++fetchIdRef.current;
    try {
      const result = await fetchPage(search, pagingRef.current);
      if (fetchIdRef.current !== fetchId) return;
      pagingRef.current = result.next;
      // A signup upstream can shift the walk mid-scroll; nobody appears twice.
      setPeople((prev) => {
        const seen = new Set((prev ?? []).map((p) => p.id));
        return [
          ...(prev ?? []),
          ...result.rows.filter((r) => !seen.has(r.id)),
        ];
      });
      setHasMore(result.hasMore);
    } catch {
      // The page never arrived; the button is still there to ask again.
    } finally {
      setLoadingMore(false);
    }
  }, [loading, refreshing, loadingMore, hasMore, people, search, fetchPage]);

  useEffect(() => {
    if (!userId) return;
    // The first load owns the spinner; a new term swaps the list in place.
    const mode = hasLoadedRef.current ? "search" : "initial";
    hasLoadedRef.current = true;
    void run(mode);
  }, [userId, run]);

  // Blocked classmates stay out of the directory; refreshed on focus so a
  // block made from a profile takes hold the moment you come back here.
  const { blocked, refresh: refreshBlocked } = useBlockedIds();
  useFocusEffect(
    useCallback(() => {
      void refreshBlocked();
    }, [refreshBlocked])
  );

  const visiblePeople = useMemo(
    () => (people ?? []).filter((p) => p.id === userId || !blocked.has(p.id)),
    [people, blocked, userId]
  );
  // The server already walked the search; only the interest chip narrows here.
  const filtered = useMemo(
    () => visiblePeople.filter((p) => sharesInterest(p, interest)),
    [visiblePeople, interest]
  );
  /** Either the box or the interest chip is standing between you and the list. */
  const narrowed = query.trim().length > 0 || interest.length > 0;
  const count = people === null ? 0 : visiblePeople.length;

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<DirectoryPerson>) => (
      <PersonRow
        person={item}
        isMe={item.id === userId}
        /* The stagger belongs to the first page's first paint, not to every
           keystroke, and not to pages that arrive mid-scroll. */
        entrance={narrowed || index >= PAGE_SIZE ? undefined : index}
      />
    ),
    [userId, narrowed]
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
      {/* Back + the one header action, on the same 44px line. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
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
        {/* The directory is where friendships start, so the way to the ones
            you already have sits right here. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Friends"
          accessibilityHint="Opens your friends and requests"
          onPress={() => router.push("/friends")}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            marginRight: -10,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            name="user-check"
            size={20}
            color={theme.foreground}
          />
        </Pressable>
      </View>

      <AppText
        variant="display"
        accessibilityRole="header"
        style={{ marginTop: space.hair }}
      >
        People
      </AppText>
      <AppText
        variant="caption"
        muted
        style={{ marginTop: space.tight, marginBottom: space.close }}
      >
        {people && uniName
          ? `${count} ${count === 1 ? "student" : "students"} at ${uniName}. Find classmates to trade notes or study with.`
          : "Find classmates to trade notes or study with."}
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
          placeholder="Search by name, handle or major"
          placeholderTextColor={theme.muted + "b3"}
          accessibilityLabel="Search people by name, handle or major"
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

      {interest.length > 0 ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.cosy,
            marginTop: space.room,
          }}
        >
          <AppText variant="caption" muted>
            Into
          </AppText>
          <Chip
            label={interest}
            tone="brand"
            size="md"
            icon="x"
            selected
            accessibilityLabel={`Stop showing only classmates into ${interest}`}
            onPress={() => setInterest("")}
          />
        </View>
      ) : null}

      {/* The list narrows under the cursor with nothing else moving, so the
          count says itself as it changes. */}
      <AppText
        variant="caption"
        muted
        accessibilityLiveRegion="polite"
        style={{
          minHeight: 16,
          marginTop: space.cosy,
          marginBottom: space.cosy,
        }}
      >
        {narrowed
          ? `${filtered.length} ${filtered.length === 1 ? "match" : "matches"}`
          : ""}
      </AppText>

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
          <ActivityIndicator
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            size="large"
            color={theme.brand}
          />
          <AppText variant="caption" muted accessibilityLiveRegion="polite">
            Finding your classmates…
          </AppText>
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
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: insets.bottom + space.rest }}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            error ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={{ color: theme.danger, marginBottom: space.room }}
              >
                We couldn't refresh just now. Pull down to try again.
              </AppText>
            ) : null
          }
          ListEmptyComponent={
            // With search on the server, an empty list under a term means
            // no matches, not an empty school.
            count === 0 && !narrowed ? (
              <Card
                style={{
                  alignItems: "center",
                  gap: space.snug,
                  paddingVertical: space.rest,
                  borderStyle: "dashed",
                }}
              >
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: radius.full,
                    backgroundColor: theme.brandSoft,
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: space.hair,
                  }}
                >
                  <Feather name="users" size={20} color={theme.brand} />
                </View>
                <AppText variant="bodySemi" accessibilityRole="header">
                  No one here yet
                </AppText>
                <AppText
                  variant="caption"
                  muted
                  style={{ textAlign: "center", maxWidth: 280 }}
                >
                  As classmates join with their school email, they'll show up
                  here automatically.
                </AppText>
              </Card>
            ) : (
              <Card
                style={{
                  alignItems: "center",
                  gap: space.snug,
                  paddingVertical: space.rest,
                  borderStyle: "dashed",
                }}
              >
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: radius.full,
                    backgroundColor: theme.brandSoft,
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: space.hair,
                  }}
                >
                  <Feather name="search" size={20} color={theme.brand} />
                </View>
                <AppText variant="bodySemi" accessibilityRole="header">
                  No matches
                </AppText>
                <AppText
                  variant="caption"
                  muted
                  style={{ textAlign: "center", maxWidth: 280 }}
                >
                  {query.trim().length > 0
                    ? `No one matches "${query.trim()}". Try a different name, handle or major.`
                    : `Nobody else has put ${interest} on their profile yet. Private profiles don't show their interests.`}
                </AppText>
                <Button
                  label={
                    query.trim().length > 0
                      ? "Clear search"
                      : "Show everyone again"
                  }
                  variant="soft"
                  size="sm"
                  onPress={() => {
                    setQuery("");
                    setInterest("");
                  }}
                />
              </Card>
            )
          }
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            // onEndReached can go missing on some devices; the button cannot.
            hasMore ? (
              <View style={{ alignItems: "center", marginTop: space.tight }}>
                {loadingMore ? (
                  <ActivityIndicator
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    color={theme.brand}
                  />
                ) : (
                  <Button
                    label="Show more people"
                    variant="soft"
                    size="sm"
                    onPress={() => void loadMore()}
                  />
                )}
              </View>
            ) : null
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
