import Feather from "@expo/vector-icons/Feather";
import { router, type Href } from "expo-router";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { Lantern } from "@/components/illustrations";
import { RoomTile } from "@/components/room-tile";
import { AppText, Button, Card, Chip, Field, SectionLabel } from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useBlockedIds } from "@/hooks/use-blocked";
import { useTheme } from "@/hooks/use-theme";
import {
  clearRecents,
  fetchRecents,
  pushRecent,
  removeRecent,
  withRecent,
  withoutRecent,
} from "@/lib/recent-searches";
import { roomKindLabel, roomTitle, type RoomKind } from "@/lib/room-identity";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* One warm search box for the whole campus: people, rooms, courses,
   clubs, and upcoming events, queried in parallel and shown in sections.

   Two things matter beyond the box itself. A filter rail narrows the fan-out
   to one corner of campus and, because only one query goes out, lets that
   corner return four times as many rows, so a filtered search is genuinely
   deeper rather than the same five results with the others hidden. And the idle screen remembers:
   queries that actually found something come back as tappable rows under the
   lantern, kept on the device by `@/lib/recent-searches`. */

type FeatherName = ComponentProps<typeof Feather>["name"];

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

/** Rows per source when we're asking all five at once. */
const PER_SOURCE_LIMIT = 5;

/** Rows when a filter is on and there's only one question to ask. */
const FOCUSED_LIMIT = 20;

/* -------------------------------- sources --------------------------------- */

/** The five corners of campus this box knows how to look in. */
type SourceKey = "people" | "channels" | "courses" | "clubs" | "events";

/** Which corner we're limited to, or null for all of them. */
type Filter = SourceKey | null;

type Source = {
  key: SourceKey;
  /** The filter chip, and the section header above its results. */
  label: string;
  icon: FeatherName;
  /** The "nothing matched" line when this source is the only one asked. */
  empty: string;
};

const SOURCES: readonly Source[] = [
  {
    key: "people",
    label: "People",
    icon: "user",
    empty: "Nobody on campus matches that. Yet.",
  },
  {
    key: "channels",
    label: "Channels",
    icon: "message-circle",
    empty: "No rooms match that. Yet.",
  },
  {
    key: "courses",
    label: "Courses",
    icon: "book-open",
    empty: "No courses match that. Check the code, or try the title.",
  },
  {
    key: "clubs",
    label: "Clubs",
    icon: "users",
    empty: "No clubs match that. Yet.",
  },
  {
    key: "events",
    label: "Events",
    icon: "calendar",
    empty: "Nothing coming up matches that. Past events don't show here.",
  },
];

/* ------------------------------- row shapes ------------------------------- */

type PersonRow = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  is_public: boolean;
  major: string | null;
  grad_year: number | null;
};

type ChannelRow = {
  id: string;
  name: string;
  slug: string;
  kind: RoomKind;
  course_id: string | null;
};

type CourseRow = { id: string; code: string; title: string };
type ClubRow = { id: string; name: string; category: string };
type EventRow = { id: string; title: string; starts_at: string };

/** One rendered result row, whatever campus corner it came from. */
type Hit = {
  key: string;
  /** The fallback glyph tile, for rows that are neither a person nor a room. */
  icon?: FeatherName;
  avatar: { url: string | null; name: string } | null;
  /** Set for channel rows: the room wears its identity tile, not a glyph. */
  room: { kind: RoomKind; name: string | null; slug: string } | null;
  title: string;
  caption: string | null;
  locked: boolean;
  href: Href;
};

type ResultSection = { title: string; data: Hit[] };

/* -------------------------------- escaping -------------------------------- */

/** Literal `%`, `_`, and `\` in the query shouldn't act as ilike wildcards. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** The plain-filter form: safe to hand straight to `.ilike(column, …)`. */
function likePattern(raw: string): string {
  return `%${escapeLike(raw)}%`;
}

/**
 * An `or=` filter matching any of `columns`. The pattern rides inside a
 * double-quoted PostgREST string (backslashes and quotes escaped) so
 * free-typed commas, parens, and quotes can't break the filter syntax.
 */
function orIlike(columns: string[], raw: string): string {
  const quoted = likePattern(raw)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  return columns.map((column) => `${column}.ilike."${quoted}"`).join(",");
}

/* ------------------------------- formatting ------------------------------- */

/** "sports" -> "Sports" for the club caption. */
function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function formatWhen(startIso: string): string {
  const start = new Date(startIso);
  const datePart = start.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timePart = start.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart} · ${timePart}`;
}

/**
 * The one extra thing worth knowing about a classmate in a list of matches:
 * their major, or their year if they haven't filled a major in. Null when
 * they've told us neither. A handle on its own is a fine row.
 *
 * A nonsense `grad_year` (a stray 0, a typo'd 20255) is dropped rather than
 * rendered as "Class of 20255".
 */
function personLine(major: string | null, gradYear: number | null): string | null {
  const written = (major ?? "").trim();
  if (written.length > 0) return written;
  if (
    typeof gradYear === "number" &&
    Number.isInteger(gradYear) &&
    gradYear >= 1900 &&
    gradYear <= 2100
  ) {
    return `Class of ${gradYear}`;
  }
  return null;
}

/* --------------------------------- pieces --------------------------------- */

function CenteredState({
  icon,
  title,
  message,
  art,
  children,
}: {
  icon: FeatherName;
  title: string;
  message: string;
  /** A hand-drawn mark shown in place of the icon circle. */
  art?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      /* Each of these replaces the whole results area the moment the screen
         changes state (nothing matched, the network dropped, the box is
         empty again), so it announces itself instead of waiting to be
         found. The count line above stays quiet in those states. */
      accessibilityLiveRegion="polite"
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: space.room,
        padding: space.rest,
        paddingBottom: 96,
      }}
    >
      {/* The mark is the mood, and the words underneath already carry it. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {art ?? (
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
        )}
      </View>
      <AppText variant="title" accessibilityRole="header">
        {title}
      </AppText>
      <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
        {message}
      </AppText>
      {children}
    </View>
  );
}

/** One remembered query: tap the row to run it again, tap the x to forget it. */
function RecentRow({
  query,
  divided,
  onPress,
  onForget,
}: {
  query: string;
  /** Hairline above every row but the first, so the group reads as one card. */
  divided: boolean;
  onPress: () => void;
  onForget: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderTopWidth: divided ? 1 : 0,
        borderTopColor: theme.border,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Search for ${query} again`}
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: space.room,
          minHeight: 48,
          paddingLeft: space.card,
          paddingRight: space.tight,
          paddingVertical: space.cosy,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Feather
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          name="clock"
          size={15}
          color={theme.muted}
        />
        <AppText variant="bodyMedium" numberOfLines={1} style={{ flex: 1 }}>
          {query}
        </AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Forget ${query}`}
        onPress={onForget}
        hitSlop={6}
        style={({ pressed }) => ({
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
    </View>
  );
}

/**
 * The whole row in one sentence: what it is, then the line under it. The
 * lock is drawn and nothing else says it, so the caption ("Private profile")
 * is what carries it into the words.
 */
function hitLabel(hit: Hit): string {
  return [`Open ${hit.title}`, hit.caption].filter(Boolean).join(", ");
}

function HitRow({ hit, index }: { hit: Hit; index: number }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hitLabel(hit)}
      onPress={() => router.push(hit.href)}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
        marginBottom: space.cosy,
      })}
    >
      <Card
        padded={false}
        entrance={index}
        // An icon tile, a title, a caption and a chevron are one result.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.close,
          paddingHorizontal: space.card,
          paddingVertical: space.room,
          minHeight: 60,
        }}
      >
        {hit.avatar ? (
          <Avatar url={hit.avatar.url} name={hit.avatar.name} size={40} />
        ) : hit.room ? (
          <RoomTile
            kind={hit.room.kind}
            name={hit.room.name}
            slug={hit.room.slug}
            size={32}
          />
        ) : (
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
            <Feather name={hit.icon ?? "search"} size={18} color={theme.brand} />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
          <AppText variant="bodySemi" numberOfLines={1}>
            {hit.title}
          </AppText>
          {hit.caption ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.tight,
              }}
            >
              {hit.locked ? (
                <Feather name="lock" size={11} color={theme.muted} />
              ) : null}
              <AppText variant="caption" muted numberOfLines={1}>
                {hit.caption}
              </AppText>
            </View>
          ) : null}
        </View>
        <Feather name="chevron-right" size={16} color={theme.muted} />
      </Card>
    </Pressable>
  );
}

/* --------------------------------- screen --------------------------------- */

export default function SearchScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(null);
  const [sections, setSections] = useState<ResultSection[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const requestRef = useRef(0);

  /* Somebody you blocked shouldn't come back up in a search for a name.
     Mirrored into a ref so the in-flight query reads the current set without
     `runSearch` changing identity, and re-running, every time the block
     list refreshes. */
  const { blocked } = useBlockedIds();
  const blockedRef = useRef(blocked);
  useEffect(() => {
    blockedRef.current = blocked;
  }, [blocked]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  }, []);

  /* The device's memory, read once. A search that lands before this resolves
     wins, so we only take the stored list if nothing's been remembered yet. */
  useEffect(() => {
    let alive = true;
    void fetchRecents().then((stored) => {
      if (!alive) return;
      setRecents((current) => (current.length === 0 ? stored : current));
    });
    return () => {
      alive = false;
    };
  }, []);

  /* Every history change moves the list here first and lets storage catch up
     behind it, so the rows are right even on a phone that can't write. */
  const remember = useCallback((q: string) => {
    setRecents((current) => withRecent(current, q));
    void pushRecent(q);
  }, []);

  const forget = useCallback((q: string) => {
    setRecents((current) => withoutRecent(current, q));
    void removeRecent(q);
  }, []);

  const forgetAll = useCallback(() => {
    setRecents([]);
    void clearRecents();
  }, []);

  const runSearch = useCallback(
    async (q: string, only: Filter) => {
      const ticket = ++requestRef.current;
      const nowIso = new Date().toISOString();
      // With a filter on there's one question instead of five, so the one
      // source we're asking gets to answer at length.
      const limit = only === null ? PER_SOURCE_LIMIT : FOCUSED_LIMIT;
      const asks = (key: SourceKey): boolean => only === null || only === key;

      // The corners of campus we're asking, at once. RLS keeps every one of
      // these scoped to the signed-in student's university.
      const [peopleRes, channelsRes, coursesRes, clubsRes, eventsRes] =
        await Promise.all([
          asks("people")
            ? supabase
                .from("profiles")
                .select(
                  "id, handle, display_name, avatar_url, is_public, major, grad_year"
                )
                .or(orIlike(["display_name", "handle"], q))
                .order("display_name", { ascending: true })
                .limit(limit)
            : null,
          asks("channels")
            ? supabase
                .from("channels")
                .select("id, name, slug, kind, course_id")
                .or(orIlike(["name", "slug"], q))
                .order("name", { ascending: true })
                .limit(limit)
            : null,
          asks("courses")
            ? supabase
                .from("courses")
                .select("id, code, title")
                .or(orIlike(["code", "title"], q))
                .order("code", { ascending: true })
                .limit(limit)
            : null,
          asks("clubs")
            ? supabase
                .from("clubs")
                .select("id, name, category")
                .ilike("name", likePattern(q))
                .order("name", { ascending: true })
                .limit(limit)
            : null,
          asks("events")
            ? supabase
                .from("events")
                .select("id, title, starts_at")
                .ilike("title", likePattern(q))
                .gte("starts_at", nowIso)
                .order("starts_at", { ascending: true })
                .limit(limit)
            : null,
        ]);
      if (ticket !== requestRef.current) return; // a newer keystroke won
      setSearching(false);
      if (
        peopleRes?.error ||
        channelsRes?.error ||
        coursesRes?.error ||
        clubsRes?.error ||
        eventsRes?.error
      ) {
        setFailed(true);
        return;
      }
      setFailed(false);

      const people = ((peopleRes?.data ?? []) as unknown as PersonRow[])
        .filter((p) => p.id === userId || !blockedRef.current.has(p.id))
        .map((p): Hit => {
          // Private profiles show up as a handle behind a lock, nothing more.
          const open = p.is_public || p.id === userId;
          const line = personLine(p.major, p.grad_year);
          return {
            key: `person-${p.id}`,
            icon: "user",
            room: null,
            avatar: {
              url: p.avatar_url,
              name: open ? p.display_name : p.handle,
            },
            title: open ? p.display_name : `@${p.handle}`,
            caption: open
              ? line
                ? `@${p.handle} · ${line}`
                : `@${p.handle}`
              : "Private profile",
            locked: !open,
            href: `/u/${p.handle}`,
          };
        });
      const channels = (
        (channelsRes?.data ?? []) as unknown as ChannelRow[]
      ).map(
        (c): Hit => ({
          key: `channel-${c.id}`,
          avatar: null,
          room: { kind: c.kind, name: c.name, slug: c.slug },
          title: roomTitle(c.name, c.slug),
          caption: roomKindLabel(c.kind),
          locked: false,
          href: `/channel/${c.id}`,
        })
      );
      const courses = ((coursesRes?.data ?? []) as unknown as CourseRow[]).map(
        (c): Hit => ({
          key: `course-${c.id}`,
          icon: "book-open",
          avatar: null,
          room: null,
          title: c.code,
          caption: c.title,
          locked: false,
          href: `/course/${c.id}`,
        })
      );
      const clubs = ((clubsRes?.data ?? []) as unknown as ClubRow[]).map(
        (c): Hit => ({
          key: `club-${c.id}`,
          icon: "users",
          avatar: null,
          room: null,
          title: c.name,
          caption: capitalize(c.category),
          locked: false,
          href: `/club/${c.id}`,
        })
      );
      const events = ((eventsRes?.data ?? []) as unknown as EventRow[]).map(
        (e): Hit => ({
          key: `event-${e.id}`,
          icon: "calendar",
          avatar: null,
          room: null,
          title: e.title,
          caption: formatWhen(e.starts_at),
          locked: false,
          href: `/event/${e.id}`,
        })
      );

      const byKey: Record<SourceKey, Hit[]> = {
        people,
        channels,
        courses,
        clubs,
        events,
      };
      const next = SOURCES.map(
        (source): ResultSection => ({
          title: source.label,
          data: byKey[source.key],
        })
      ).filter((section) => section.data.length > 0);
      setSections(next);

      // Worth remembering only once it found something. A query that turned
      // up nothing is a shortcut to a dead end.
      if (next.length > 0) remember(q);
    },
    [userId, remember]
  );

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      requestRef.current += 1; // cancel anything in flight
      setSections(null);
      setSearching(false);
      setFailed(false);
      return;
    }
    setSearching(true);
    setFailed(false);
    const timer = setTimeout(() => void runSearch(q, filter), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, filter, runSearch]);

  const retry = useCallback(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) return;
    setSearching(true);
    setFailed(false);
    void runSearch(q, filter);
  }, [query, filter, runSearch]);

  const active = SOURCES.find((source) => source.key === filter) ?? null;

  /* Results appear, change and vanish under the cursor without the page
     moving, so the count is said out loud rather than left to the eye. The
     line holds its height whether or not it has words in it, and stays quiet
     when nothing matched, because the empty state below says that itself. */
  const found =
    sections?.reduce((total, section) => total + section.data.length, 0) ?? 0;
  const status =
    query.trim().length < MIN_QUERY_LENGTH
      ? ""
      : searching
        ? "Searching…"
        : failed || sections === null || found === 0
          ? ""
          : `${found} ${found === 1 ? "result" : "results"}${
              active ? ` in ${active.label.toLowerCase()}` : ""
            }`;

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
        style={{ marginTop: space.hair, marginBottom: space.close }}
      >
        Search
      </AppText>

      <Field
        label="Search your campus"
        value={query}
        onChangeText={setQuery}
        placeholder="Try a name, a class, a club…"
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />

      {/* The rail bleeds into both gutters so the last chip runs off the edge
          instead of stopping short of it. `handled` keeps a chip tappable in
          one go while the keyboard is up. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={{ flexGrow: 0, marginTop: space.close, marginHorizontal: -20 }}
        contentContainerStyle={{
          alignItems: "center",
          gap: space.cosy,
          paddingHorizontal: space.gutter,
          paddingVertical: space.hair,
        }}
      >
        <Chip
          label="All"
          tone="brand"
          size="md"
          selected={filter === null}
          onPress={() => setFilter(null)}
          accessibilityLabel="Search everything"
        />
        {SOURCES.map((source) => (
          <Chip
            key={source.key}
            label={source.label}
            icon={source.icon}
            tone="brand"
            size="md"
            selected={filter === source.key}
            onPress={() => setFilter(source.key)}
            accessibilityLabel={`Search ${source.label.toLowerCase()} only`}
          />
        ))}
      </ScrollView>

      <AppText
        variant="caption"
        muted
        accessibilityLiveRegion="polite"
        style={{
          minHeight: 16,
          marginTop: space.cosy,
          marginBottom: space.tight,
        }}
      >
        {status}
      </AppText>

      {searching ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: space.close,
            paddingBottom: 96,
          }}
        >
          {/* The status line above already said "Searching…". */}
          <ActivityIndicator
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            size="large"
            color={theme.brand}
          />
        </View>
      ) : failed ? (
        <CenteredState
          icon="wifi-off"
          title="Something hiccuped"
          message="We couldn't search just now. Check your connection and give it another go."
        >
          <Button label="Try again" variant="soft" size="sm" onPress={retry} />
        </CenteredState>
      ) : sections === null ? (
        recents.length === 0 ? (
          <CenteredState
            icon="search"
            title="Find your people and places"
            message="Search your campus: people, rooms, courses, clubs, events"
            art={
              <Lantern size={96} color={theme.muted} softColor={theme.surface2} />
            }
          />
        ) : (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            style={{ flex: 1, marginTop: space.tight }}
            contentContainerStyle={{
              paddingBottom: insets.bottom + space.rest,
            }}
            showsVerticalScrollIndicator={false}
          >
            <View
              style={{
                alignItems: "center",
                gap: space.room,
                paddingTop: space.gutter,
                paddingHorizontal: space.cosy,
              }}
            >
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Lantern
                  size={84}
                  color={theme.muted}
                  softColor={theme.surface2}
                />
              </View>
              <AppText variant="title" accessibilityRole="header">
                Find your people and places
              </AppText>
              <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
                Search your campus: people, rooms, courses, clubs, events
              </AppText>
            </View>

            <SectionLabel
              text="Recent"
              action={{ label: "Clear", onPress: forgetAll }}
            />
            <Card padded={false} style={{ overflow: "hidden" }}>
              {recents.map((entry, index) => (
                <RecentRow
                  key={entry}
                  query={entry}
                  divided={index > 0}
                  onPress={() => setQuery(entry)}
                  onForget={() => forget(entry)}
                />
              ))}
            </Card>
          </ScrollView>
        )
      ) : sections.length === 0 ? (
        <CenteredState
          icon="compass"
          title="No matches"
          message={active ? active.empty : "Nothing on campus matches that. Yet."}
        >
          {active ? (
            <Button
              label="Search everything"
              variant="soft"
              size="sm"
              onPress={() => setFilter(null)}
            />
          ) : null}
        </CenteredState>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.key}
          renderItem={({ item, index }) => <HitRow hit={item} index={index} />}
          /* With a filter on, the chip above already names the section, so a
             header would just repeat it over a single list. */
          renderSectionHeader={({ section }) =>
            filter === null ? (
              <AppText
                variant="label"
                muted
                accessibilityRole="header"
                style={{ marginTop: space.card, marginBottom: space.cosy }}
              >
                {section.title}
              </AppText>
            ) : null
          }
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          /* Campus moves while you're reading: a club goes up, a classmate
             joins, an event gets scheduled. So a pull asks the same question
             again rather than making you retype it. */
          refreshControl={
            <RefreshControl
              refreshing={searching}
              onRefresh={retry}
              tintColor={theme.brand}
              colors={[theme.brand]}
            />
          }
          style={{ flex: 1, marginTop: space.tight }}
          contentContainerStyle={{
            paddingTop: filter === null ? 0 : 12,
            paddingBottom: insets.bottom + space.rest,
          }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}
