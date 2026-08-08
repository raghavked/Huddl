import Feather from "@expo/vector-icons/Feather";
import { router, type Href } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { Lantern } from "@/components/illustrations";
import { AppText, Button, Card, Field } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* One warm search box for the whole campus: people, channels, courses,
   clubs, and upcoming events, queried in parallel and shown in sections. */

type FeatherName = ComponentProps<typeof Feather>["name"];

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;
const PER_SOURCE_LIMIT = 5;

/* ------------------------------- row shapes ------------------------------- */

type PersonRow = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  is_public: boolean;
};

type ChannelKind = "campus" | "course" | "topic" | "club";

type ChannelRow = {
  id: string;
  name: string;
  slug: string;
  kind: ChannelKind;
  course_id: string | null;
};

type CourseRow = { id: string; code: string; title: string };
type ClubRow = { id: string; name: string; category: string };
type EventRow = { id: string; title: string; starts_at: string };

/** One rendered result row, whatever campus corner it came from. */
type Hit = {
  key: string;
  icon: FeatherName;
  avatar: { url: string | null; name: string } | null;
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

const CHANNEL_KIND_LABEL: Record<ChannelKind, string> = {
  campus: "Campus channel",
  course: "Course chat",
  topic: "Topic channel",
  club: "Club channel",
};

function channelTitle(channel: ChannelRow): string {
  if (channel.kind === "course" || channel.kind === "club") return channel.name;
  return `#${channel.slug}`;
}

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
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: 28,
        paddingBottom: 96,
      }}
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
      <AppText variant="title">{title}</AppText>
      <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
        {message}
      </AppText>
      {children}
    </View>
  );
}

function HitRow({ hit }: { hit: Hit }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        hit.locked ? `${hit.title}, private profile` : `Open ${hit.title}`
      }
      onPress={() => router.push(hit.href)}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, marginBottom: 8 })}
    >
      <Card
        padded={false}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 14,
          paddingVertical: 10,
          minHeight: 60,
        }}
      >
        {hit.avatar ? (
          <Avatar url={hit.avatar.url} name={hit.avatar.name} size={40} />
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
            <Feather name={hit.icon} size={18} color={theme.brand} />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <AppText variant="bodySemi" numberOfLines={1}>
            {hit.title}
          </AppText>
          {hit.caption ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
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
  const [sections, setSections] = useState<ResultSection[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestRef = useRef(0);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  }, []);

  const runSearch = useCallback(
    async (q: string) => {
      const ticket = ++requestRef.current;
      const nowIso = new Date().toISOString();
      // Five corners of campus, asked at once. RLS keeps every one of these
      // scoped to the signed-in student's university.
      const [peopleRes, channelsRes, coursesRes, clubsRes, eventsRes] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id, handle, display_name, avatar_url, is_public")
            .or(orIlike(["display_name", "handle"], q))
            .order("display_name", { ascending: true })
            .limit(PER_SOURCE_LIMIT),
          supabase
            .from("channels")
            .select("id, name, slug, kind, course_id")
            .or(orIlike(["name", "slug"], q))
            .order("name", { ascending: true })
            .limit(PER_SOURCE_LIMIT),
          supabase
            .from("courses")
            .select("id, code, title")
            .or(orIlike(["code", "title"], q))
            .order("code", { ascending: true })
            .limit(PER_SOURCE_LIMIT),
          supabase
            .from("clubs")
            .select("id, name, category")
            .ilike("name", likePattern(q))
            .order("name", { ascending: true })
            .limit(PER_SOURCE_LIMIT),
          supabase
            .from("events")
            .select("id, title, starts_at")
            .ilike("title", likePattern(q))
            .gte("starts_at", nowIso)
            .order("starts_at", { ascending: true })
            .limit(PER_SOURCE_LIMIT),
        ]);
      if (ticket !== requestRef.current) return; // a newer keystroke won
      setSearching(false);
      if (
        peopleRes.error ||
        channelsRes.error ||
        coursesRes.error ||
        clubsRes.error ||
        eventsRes.error
      ) {
        setFailed(true);
        return;
      }
      setFailed(false);

      const people = ((peopleRes.data ?? []) as unknown as PersonRow[]).map(
        (p): Hit => {
          // Private profiles show up as a handle behind a lock — nothing more.
          const open = p.is_public || p.id === userId;
          return {
            key: `person-${p.id}`,
            icon: "user",
            avatar: {
              url: p.avatar_url,
              name: open ? p.display_name : p.handle,
            },
            title: open ? p.display_name : `@${p.handle}`,
            caption: open ? `@${p.handle}` : "Private profile",
            locked: !open,
            href: `/u/${p.handle}`,
          };
        }
      );
      const channels = ((channelsRes.data ?? []) as unknown as ChannelRow[]).map(
        (c): Hit => ({
          key: `channel-${c.id}`,
          icon: "hash",
          avatar: null,
          title: channelTitle(c),
          caption: CHANNEL_KIND_LABEL[c.kind] ?? null,
          locked: false,
          href: `/channel/${c.id}`,
        })
      );
      const courses = ((coursesRes.data ?? []) as unknown as CourseRow[]).map(
        (c): Hit => ({
          key: `course-${c.id}`,
          icon: "book-open",
          avatar: null,
          title: c.code,
          caption: c.title,
          locked: false,
          href: `/course/${c.id}`,
        })
      );
      const clubs = ((clubsRes.data ?? []) as unknown as ClubRow[]).map(
        (c): Hit => ({
          key: `club-${c.id}`,
          icon: "users",
          avatar: null,
          title: c.name,
          caption: capitalize(c.category),
          locked: false,
          href: `/club/${c.id}`,
        })
      );
      const events = ((eventsRes.data ?? []) as unknown as EventRow[]).map(
        (e): Hit => ({
          key: `event-${e.id}`,
          icon: "calendar",
          avatar: null,
          title: e.title,
          caption: formatWhen(e.starts_at),
          locked: false,
          href: `/event/${e.id}`,
        })
      );

      setSections(
        (
          [
            { title: "People", data: people },
            { title: "Channels", data: channels },
            { title: "Courses", data: courses },
            { title: "Clubs", data: clubs },
            { title: "Events", data: events },
          ] as ResultSection[]
        ).filter((section) => section.data.length > 0)
      );
    },
    [userId]
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
    const timer = setTimeout(() => void runSearch(q), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const retry = useCallback(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) return;
    setSearching(true);
    setFailed(false);
    void runSearch(q);
  }, [query, runSearch]);

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

      <AppText variant="display" style={{ marginTop: 2, marginBottom: 12 }}>
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

      {searching ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            paddingBottom: 96,
          }}
        >
          <ActivityIndicator size="large" color={theme.brand} />
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
        <CenteredState
          icon="search"
          title="Find your people and places"
          message="Search your campus — people, channels, courses, clubs, events"
          art={
            <Lantern size={96} color={theme.muted} softColor={theme.surface2} />
          }
        />
      ) : sections.length === 0 ? (
        <CenteredState
          icon="compass"
          title="No matches"
          message="Nothing on campus matches that — yet."
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => <HitRow hit={item} />}
          renderSectionHeader={({ section }) => (
            <AppText
              variant="label"
              muted
              style={{ marginTop: 16, marginBottom: 8 }}
            >
              {section.title}
            </AppText>
          )}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          style={{ flex: 1, marginTop: 4 }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}
