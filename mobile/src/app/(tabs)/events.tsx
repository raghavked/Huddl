import Feather from "@expo/vector-icons/Feather";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { Screen } from "@/components/screen";
import { AppText, Button, Card, Chip, type ChipTone } from "@/components/ui";
import { fonts, radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Minimal local row shapes: the web app's types live outside this tsconfig.
   Mirrors the web events page query, simplified: upcoming only, no kind
   filters in v1. */

type RsvpStatus = "going" | "maybe" | "declined";

type RsvpLite = { user_id: string; status: RsvpStatus };

/** Raw select shape, with the joined rsvps rows and the hosting club. */
type RawEventRow = {
  id: string;
  kind: "study_session" | "meetup";
  title: string;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  capacity: number | null;
  rsvps: RsvpLite[];
  /** The club running it, or null for a student-planned event. */
  club: { name: string } | null;
};

type EventItem = {
  id: string;
  kind: "study_session" | "meetup";
  title: string;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  capacity: number | null;
  goingCount: number;
  isFull: boolean;
  /** Who's hosting, when a club is. */
  clubName: string | null;
  /**
   * My own answer, straight out of the rows the list already fetched. Without
   * it the list is a wall of events with no memory of the three you said yes
   * to yesterday.
   */
  myStatus: RsvpStatus | null;
};

/** The chip on a row I've answered: fern for yes, quiet for a maybe. A "no"
    needs no pill, since the row is just an event I'm not going to. */
function statusChip(
  status: RsvpStatus
): { label: string; tone: ChipTone } | null {
  if (status === "going") return { label: "Going", tone: "accent" };
  if (status === "maybe") return { label: "Maybe", tone: "neutral" };
  return null;
}

/** "Sat, Aug 9 · 3:00 PM–5:00 PM" in local device time, like the web. */
function formatEventTime(startIso: string, endIso: string | null): string {
  const start = new Date(startIso);
  const datePart = start.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const startTime = start.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (!endIso) return `${datePart} · ${startTime}`;
  const endTime = new Date(endIso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart} · ${startTime}–${endTime}`;
}

/** Weekday-over-day tile, accent, per the calendar-row convention. */
function DateTile({ iso }: { iso: string }) {
  const theme = useTheme();
  const d = new Date(iso);
  return (
    <View
      // The date is in the row's label in full; the tile is the picture of it.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 48,
        height: 48,
        borderRadius: radius.control,
        backgroundColor: theme.accentSoft,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <AppText
        variant="label"
        style={{
          color: theme.accent,
          fontSize: 10,
          lineHeight: 12,
          textTransform: "uppercase",
          letterSpacing: 0.8,
        }}
      >
        {d.toLocaleDateString([], { weekday: "short" })}
      </AppText>
      <AppText
        style={{
          color: theme.accent,
          fontFamily: fonts.bodyBold,
          fontSize: 18,
          lineHeight: 22,
        }}
      >
        {String(d.getDate())}
      </AppText>
    </View>
  );
}

/**
 * One sentence for the whole row: what it is, when and where, how full it is.
 * "Full" is drawn in `danger` and nothing else says it, so it goes into the
 * words too.
 */
function eventLabel(event: EventItem): string {
  const headcount = `${event.goingCount} going${
    event.capacity !== null && !event.isFull ? ` of ${event.capacity}` : ""
  }`;
  const mine =
    event.myStatus === "going"
      ? "you're going"
      : event.myStatus === "maybe"
        ? "you said maybe"
        : null;
  return [
    `Open ${event.title}`,
    mine,
    event.clubName ? `hosted by ${event.clubName}` : null,
    formatEventTime(event.starts_at, event.ends_at),
    event.location,
    headcount,
    event.isFull ? "full" : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function EventRow({ event, index }: { event: EventItem; index: number }) {
  const theme = useTheme();
  const mine = event.myStatus ? statusChip(event.myStatus) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={eventLabel(event)}
      onPress={() => router.push(`/event/${event.id}`)}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card
        padded={false}
        entrance={index}
        // A date tile, a title, a time, a headcount: one thing, not four.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.close,
          padding: space.card,
          minHeight: 76,
        }}
      >
        <DateTile iso={event.starts_at} />
        <View style={{ flex: 1, minWidth: 0, gap: space.tight }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: space.cosy,
            }}
          >
            <AppText
              variant="bodySemi"
              numberOfLines={2}
              style={{ flex: 1, minWidth: 0 }}
            >
              {event.title}
            </AppText>
            {mine ? <Chip label={mine.label} tone={mine.tone} /> : null}
          </View>
          <AppText variant="caption" muted numberOfLines={1}>
            {formatEventTime(event.starts_at, event.ends_at)}
            {event.location ? ` · ${event.location}` : ""}
          </AppText>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.tight,
            }}
          >
            <Feather name="user" size={12} color={theme.muted} />
            <AppText
              variant="caption"
              muted
              numberOfLines={1}
              style={{ flexShrink: 1 }}
            >
              {event.goingCount} going
              {event.capacity !== null && !event.isFull
                ? ` of ${event.capacity}`
                : ""}
              {event.clubName ? ` · ${event.clubName}` : ""}
            </AppText>
            {event.isFull ? (
              <AppText variant="label" style={{ color: theme.danger }}>
                · Full
              </AppText>
            ) : null}
          </View>
        </View>
        <Feather name="chevron-right" size={18} color={theme.muted} />
      </Card>
    </Pressable>
  );
}

export default function EventsScreen() {
  const theme = useTheme();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async (): Promise<EventItem[]> => {
    if (!userId) throw new Error("Not signed in");

    const profileRes = await supabase
      .from("profiles")
      .select("university_id")
      .eq("id", userId)
      .single();
    if (profileRes.error) throw profileRes.error;
    const { university_id: universityId } = profileRes.data as unknown as {
      university_id: string;
    };

    const eventsRes = await supabase
      .from("events")
      .select(
        "id, kind, title, location, starts_at, ends_at, capacity, rsvps:event_rsvps(user_id, status), club:clubs(name)"
      )
      .eq("university_id", universityId)
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(50);
    if (eventsRes.error) throw eventsRes.error;

    const rows = (eventsRes.data ?? []) as unknown as RawEventRow[];
    return rows.map((row) => {
      const rsvps = row.rsvps ?? [];
      const goingCount = rsvps.filter((r) => r.status === "going").length;
      // Every row already arrives carrying my own answer; it just used to be
      // counted and thrown away.
      const mine = rsvps.find((r) => r.user_id === userId);
      return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        location: row.location,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        capacity: row.capacity,
        goingCount,
        isFull: row.capacity !== null && goingCount >= row.capacity,
        clubName: row.club?.name ?? null,
        myStatus: mine?.status ?? null,
      };
    });
  }, [userId]);

  const run = useCallback(
    async (mode: "initial" | "refresh" | "silent") => {
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      try {
        setEvents(await fetchEvents());
        setError(null);
      } catch {
        setError("We couldn't load the calendar right now.");
      } finally {
        if (mode === "initial") setLoading(false);
        if (mode === "refresh") setRefreshing(false);
      }
    },
    [fetchEvents]
  );

  /* Tabs stay mounted, so a fetch on mount is a fetch once a session: plan an
     event, tap back, and it wasn't in the list. First focus loads with a
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

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<EventItem>) => (
      <View style={{ marginBottom: space.room }}>
        <EventRow event={item} index={index} />
      </View>
    ),
    []
  );

  return (
    <Screen
      title="Events"
      scroll={false}
      action={
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.cosy,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Your calendar"
            onPress={() => router.push("/calendar")}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: radius.full,
              backgroundColor: theme.accentSoft,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Feather name="calendar" size={20} color={theme.accent} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Plan an event"
            onPress={() => router.push("/event/new")}
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
        </View>
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
            Checking the calendar…
          </AppText>
        </View>
      ) : error && events.length === 0 ? (
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
          data={events}
          keyExtractor={(event) => event.id}
          renderItem={renderItem}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 40, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={{ gap: space.snug, marginBottom: space.card }}>
              <AppText muted>
                Study sessions and meetups coming up on campus.
              </AppText>
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
                  width: 40,
                  height: 40,
                  borderRadius: radius.full,
                  backgroundColor: theme.accentSoft,
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: space.hair,
                }}
              >
                <Feather name="calendar" size={18} color={theme.accent} />
              </View>
              <AppText variant="bodySemi" accessibilityRole="header">
                Nothing on the calendar yet
              </AppText>
              <AppText
                variant="caption"
                muted
                style={{ textAlign: "center", maxWidth: 260 }}
              >
                When someone plans a study session or meetup, it'll land right
                here.
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
    </Screen>
  );
}
