import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card } from "@/components/ui";
import {
  courseTintsFor,
  radius,
  type CourseTintColors,
  type Palette,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { colorForCourse, type CourseTint } from "@/lib/course-color";
import { tapLight, tapSuccess } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { kindLabel, type CalendarKind } from "@/lib/syllabus";
import { useAuth } from "@/providers/auth-provider";
import { useResolvedScheme } from "@/providers/display-provider";

/* Your calendar — one warm month of everything: class due dates from every
   enrolled course, plus the events you said you'd show up to. Weeks start on
   Monday — the class-schedule rhythm — the same on every device, no locale
   guessing. */

/* Minimal local row shapes — the web app's types live outside this tsconfig. */

type EnrollmentJoin = {
  archived_at: string | null;
  /** The student's own tint for this course; null means "let the app choose". */
  color: string | null;
  course: { id: string; code: string } | null;
};

type CalendarItemRow = {
  id: string;
  course_id: string;
  kind: CalendarKind;
  title: string;
  due_at: string;
};

type EventRow = {
  id: string;
  kind: "study_session" | "meetup";
  title: string;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  course_id: string | null;
};

type RsvpJoin = { event: EventRow | null };

type ClassDate = {
  id: string;
  courseCode: string;
  kind: CalendarKind;
  title: string;
  dueAt: Date;
};

type DayEvent = {
  id: string;
  kindLabel: string;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  location: string | null;
  courseCode: string | null;
};

type MonthData = { classDates: ClassDate[]; events: DayEvent[] };

/** Course code → the tint that course wears for this student. Codes, not
    ids, because a code is all a `ClassDate` or a `DayEvent` carries. */
type TintByCode = ReadonlyMap<string, CourseTint>;

/**
 * How many class dots one day can show. Past three the day is simply busy,
 * and the agenda underneath is the honest answer — a row of six dots in a
 * 47px cell is confetti, not information.
 */
const MAX_DAY_DOTS = 3;

/** Shared empty list, so a quiet day doesn't allocate one per cell per paint. */
const NO_TINTS: readonly CourseTint[] = [];

type AgendaRow =
  | { type: "class"; item: ClassDate }
  | { type: "event"; item: DayEvent };

const EVENT_SELECT = "id, kind, title, location, starts_at, ends_at, course_id";

/* ------------------------------ date helpers ------------------------------ */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** Blank cells before the 1st, for a Monday-start grid (Mon = 0 … Sun = 6). */
function leadingBlanks(monthStart: Date): number {
  return (monthStart.getDay() + 6) % 7;
}

function daysInMonth(monthStart: Date): number {
  return new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** A due time only shows when someone set one — 11:59 PM is the quiet default. */
function classTimeLabel(dueAt: Date): string {
  if (dueAt.getHours() === 23 && dueAt.getMinutes() === 59) {
    return "Due by end of day";
  }
  return `Due at ${formatTime(dueAt)}`;
}

function eventTimeLabel(ev: DayEvent): string {
  const start = formatTime(ev.startsAt);
  const range = ev.endsAt ? `${start}–${formatTime(ev.endsAt)}` : start;
  return ev.location ? `${range} · ${ev.location}` : range;
}

function rowTime(row: AgendaRow): number {
  return row.type === "class"
    ? row.item.dueAt.getTime()
    : row.item.startsAt.getTime();
}

/** Same quiet chip palette as course/calendar.tsx: exams glow ember-clay,
    quizzes/projects lean sage, the rest stay neutral. */
function kindColors(kind: CalendarKind, theme: Palette): { bg: string; fg: string } {
  switch (kind) {
    case "exam":
      return { bg: theme.brandSoft, fg: theme.brandInk };
    case "quiz":
    case "project":
      return { bg: theme.accentSoft, fg: theme.accent };
    default:
      return { bg: theme.surface2, fg: theme.muted };
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ------------------------------ tiny pieces ------------------------------ */

function Chip({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: radius.full,
        backgroundColor: bg,
      }}
    >
      <AppText variant="label" style={{ color: fg, fontSize: 11, lineHeight: 14 }}>
        {text}
      </AppText>
    </View>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <View
      style={{
        width: 5,
        height: 5,
        borderRadius: radius.full,
        backgroundColor: color,
      }}
    />
  );
}

function DayCell({
  date,
  isToday,
  isSelected,
  classTints,
  hasEvent,
  onSelect,
}: {
  date: Date;
  isToday: boolean;
  isSelected: boolean;
  /** One tint per course with something due that day, already capped. */
  classTints: readonly CourseTint[];
  hasEvent: boolean;
  onSelect: () => void;
}) {
  const theme = useTheme();
  const tints = courseTintsFor(useResolvedScheme());
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      })}
      onPress={onSelect}
      style={({ pressed }) => ({
        width: `${100 / 7}%`,
        minHeight: 54,
        alignItems: "center",
        paddingTop: 2,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.full,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: isToday ? theme.brandSoft : "transparent",
          // The espresso ring — selection sits on the foreground token.
          borderWidth: 2,
          borderColor: isSelected ? theme.foreground : "transparent",
        }}
      >
        <AppText
          variant={isToday ? "bodySemi" : "bodyMedium"}
          style={isToday ? { color: theme.brandInk } : undefined}
        >
          {String(date.getDate())}
        </AppText>
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 3,
          height: 6,
          marginTop: 3,
        }}
      >
        {/* A dot per course, in that course's ink — a soft wash at 5px would
            vanish against the card. Events keep fern, always last. */}
        {classTints.map((tint) => (
          <Dot key={tint} color={tints[tint].ink} />
        ))}
        {hasEvent ? <Dot color={theme.accent} /> : null}
      </View>
    </Pressable>
  );
}

function WeekdayHeader() {
  return (
    <View style={{ flexDirection: "row", marginBottom: 4 }}>
      {WEEKDAYS.map((w) => (
        <View key={w} style={{ width: `${100 / 7}%`, alignItems: "center" }}>
          <AppText variant="label" muted style={{ fontSize: 11 }}>
            {w}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/** The quiet grid that holds the room while a month loads. */
function GhostGrid() {
  const theme = useTheme();
  return (
    <View>
      <WeekdayHeader />
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {Array.from({ length: 35 }, (_, i) => (
          <View
            key={`ghost-${i}`}
            style={{
              width: `${100 / 7}%`,
              minHeight: 54,
              alignItems: "center",
              paddingTop: 2,
            }}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: radius.full,
                backgroundColor: theme.surface2,
              }}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

/* -------------------------------- screen -------------------------------- */

export default function YourCalendarScreen() {
  const theme = useTheme();
  const tints = courseTintsFor(useResolvedScheme());
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [monthStart, setMonthStart] = useState<Date>(() => firstOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const [data, setData] = useState<MonthData | null>(null);
  /* Kept beside the month rather than inside it: the tints belong to the
     enrolments, not to March, so a colour changed elsewhere lands on every
     cached month the next time any month loads. */
  const [tintByCode, setTintByCode] = useState<TintByCode>(
    () => new Map<string, CourseTint>()
  );
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /** Months we've already fetched, so paging back is instant. */
  const cacheRef = useRef<Map<string, MonthData>>(new Map());
  /** The month currently on screen — late responses for old months stay quiet. */
  const activeKeyRef = useRef<string>("");

  const fetchMonth = useCallback(
    async (
      start: Date
    ): Promise<{
      month: MonthData;
      doneIds: string[];
      tintByCode: TintByCode;
    }> => {
      if (!userId) throw new Error("Not signed in");
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      const startIso = start.toISOString();
      const endIso = end.toISOString();

      // Two-step like plan.tsx: enrollments first, then an id → code map.
      // Shelved classes come back too, but only for their codes: every course
      // that ever labelled something stays nameable, while the month's dots
      // and agenda fan out from the active classes alone.
      const enrollRes = await supabase
        .from("enrollments")
        .select("archived_at, color, course:courses(id, code)")
        .eq("user_id", userId);
      if (enrollRes.error) throw enrollRes.error;
      const codeById = new Map<string, string>();
      const activeIds = new Set<string>();
      // Shelved classes keep their tint too — a chip on an old date should
      // still be the colour that class always was.
      const readTints = new Map<string, CourseTint>();
      for (const row of (enrollRes.data ?? []) as unknown as EnrollmentJoin[]) {
        const course = row.course;
        if (course === null) continue;
        codeById.set(course.id, course.code);
        readTints.set(course.code, colorForCourse(row.color, course.code));
        if (row.archived_at === null) activeIds.add(course.id);
      }
      const courseIds = [...activeIds];

      const none = { data: [] as unknown[], error: null };
      const [itemsRes, rsvpRes, courseEventsRes] = await Promise.all([
        // Class due dates inside the month, across every enrolled course.
        courseIds.length > 0
          ? supabase
              .from("course_calendar_items")
              .select("id, course_id, kind, title, due_at")
              .in("course_id", courseIds)
              .gte("due_at", startIso)
              .lt("due_at", endIso)
              .order("due_at", { ascending: true })
          : Promise.resolve(none),
        // Everything you RSVP'd to — filtered to the month below.
        supabase
          .from("event_rsvps")
          .select(`event:events(${EVENT_SELECT})`)
          .eq("user_id", userId)
          .in("status", ["going", "maybe"]),
        // Plus anything tied to one of your courses, RSVP or not.
        courseIds.length > 0
          ? supabase
              .from("events")
              .select(EVENT_SELECT)
              .in("course_id", courseIds)
              .gte("starts_at", startIso)
              .lt("starts_at", endIso)
          : Promise.resolve(none),
      ]);
      if (itemsRes.error) throw itemsRes.error;
      if (rsvpRes.error) throw rsvpRes.error;
      if (courseEventsRes.error) throw courseEventsRes.error;

      const classDates = ((itemsRes.data ?? []) as unknown as CalendarItemRow[]).map(
        (row): ClassDate => ({
          id: row.id,
          courseCode: codeById.get(row.course_id) ?? "Course",
          kind: row.kind,
          title: row.title,
          dueAt: new Date(row.due_at),
        })
      );

      // Merge RSVP'd and course-linked events, deduped by event id.
      const eventById = new Map<string, EventRow>();
      for (const row of (rsvpRes.data ?? []) as unknown as RsvpJoin[]) {
        const ev = row.event;
        if (!ev) continue;
        const at = new Date(ev.starts_at);
        if (at < start || at >= end) continue;
        eventById.set(ev.id, ev);
      }
      for (const ev of (courseEventsRes.data ?? []) as unknown as EventRow[]) {
        eventById.set(ev.id, ev);
      }
      const events = [...eventById.values()]
        .map(
          (ev): DayEvent => ({
            id: ev.id,
            kindLabel: ev.kind === "study_session" ? "Study session" : "Meetup",
            title: ev.title,
            startsAt: new Date(ev.starts_at),
            endsAt: ev.ends_at ? new Date(ev.ends_at) : null,
            location: ev.location,
            courseCode:
              ev.course_id !== null ? codeById.get(ev.course_id) ?? null : null,
          })
        )
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

      // Your check-off state for this month's class dates — private, one query.
      let doneIds: string[] = [];
      if (classDates.length > 0) {
        const checksRes = await supabase
          .from("study_checkoffs")
          .select("item_id")
          .eq("user_id", userId)
          .in(
            "item_id",
            classDates.map((item) => item.id)
          );
        if (checksRes.error) throw checksRes.error;
        doneIds = ((checksRes.data ?? []) as { item_id: string }[]).map(
          (row) => row.item_id
        );
      }

      return {
        month: { classDates, events },
        doneIds,
        tintByCode: readTints,
      };
    },
    [userId]
  );

  const run = useCallback(
    async (start: Date, mode: "page" | "refresh") => {
      const key = monthKey(start);
      activeKeyRef.current = key;
      const cached = cacheRef.current.get(key);
      if (mode === "page" && cached) {
        setData(cached);
        setLoading(false);
        setError(null);
        return;
      }
      if (mode === "refresh") setRefreshing(true);
      else {
        setLoading(true);
        setData(null);
      }
      try {
        const { month, doneIds, tintByCode: fresh } = await fetchMonth(start);
        cacheRef.current.set(key, month);
        if (activeKeyRef.current !== key) return; // paged on — stay quiet
        setData(month);
        setTintByCode(fresh);
        setChecked((prev) => {
          const next = new Set(prev);
          for (const item of month.classDates) next.delete(item.id);
          for (const id of doneIds) next.add(id);
          return next;
        });
        setError(null);
      } catch {
        if (activeKeyRef.current === key) {
          setError("We couldn't load this month right now.");
        }
      } finally {
        if (activeKeyRef.current === key) {
          if (mode === "refresh") setRefreshing(false);
          else setLoading(false);
        }
      }
    },
    [fetchMonth]
  );

  useEffect(() => {
    if (!userId) return;
    void run(monthStart, "page");
  }, [userId, monthStart, run]);

  /** Land on today when the month holds it, otherwise on the 1st. */
  const goToMonth = useCallback((start: Date) => {
    const now = new Date();
    setMonthStart(start);
    setSelectedDay(
      sameMonth(now, start)
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
        : start
    );
    setActionError(null);
  }, []);

  const shiftMonth = useCallback(
    (delta: number) => {
      goToMonth(
        new Date(monthStart.getFullYear(), monthStart.getMonth() + delta, 1)
      );
    },
    [monthStart, goToMonth]
  );

  /** Optimistic check-off: flip locally, persist, roll back if it fails. */
  const toggle = useCallback(
    async (item: ClassDate) => {
      if (!userId) return;
      const wasDone = checked.has(item.id);
      setActionError(null);
      const flip = (add: boolean) =>
        setChecked((prev) => {
          const next = new Set(prev);
          if (add) next.add(item.id);
          else next.delete(item.id);
          return next;
        });
      flip(!wasDone);
      if (wasDone) tapLight();
      else tapSuccess();
      const res = wasDone
        ? await supabase
            .from("study_checkoffs")
            .delete()
            .eq("user_id", userId)
            .eq("item_id", item.id)
        : await supabase
            .from("study_checkoffs")
            .upsert(
              { user_id: userId, item_id: item.id },
              { onConflict: "user_id,item_id", ignoreDuplicates: true }
            );
      if (res.error) {
        flip(wasDone); // roll back
        setActionError("That check-off didn't save — give it another tap.");
      }
    },
    [userId, checked]
  );

  /* ------------------------------ derived ------------------------------ */

  const cells = useMemo<(Date | null)[]>(() => {
    const out: (Date | null)[] = [];
    const blanks = leadingBlanks(monthStart);
    for (let i = 0; i < blanks; i += 1) out.push(null);
    const total = daysInMonth(monthStart);
    for (let day = 1; day <= total; day += 1) {
      out.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), day));
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [monthStart]);

  /** The tint name a course code wears — the student's pick where they made
      one, and the stable hash of the code everywhere else. */
  const tintNameFor = useCallback(
    (courseCode: string): CourseTint =>
      tintByCode.get(courseCode) ?? colorForCourse(null, courseCode),
    [tintByCode]
  );

  const tintFor = useCallback(
    (courseCode: string): CourseTintColors => tints[tintNameFor(courseCode)],
    [tints, tintNameFor]
  );

  const dayMarks = useMemo(() => {
    const map = new Map<string, { classTints: CourseTint[]; hasEvent: boolean }>();
    if (!data) return map;
    for (const item of data.classDates) {
      const key = dayKey(item.dueAt);
      const mark = map.get(key) ?? { classTints: [], hasEvent: false };
      const tint = tintNameFor(item.courseCode);
      // One dot per colour, in due order. Two courses that share a tint
      // share a dot — a second dot in the same colour says nothing.
      if (
        mark.classTints.length < MAX_DAY_DOTS &&
        !mark.classTints.includes(tint)
      ) {
        mark.classTints.push(tint);
      }
      map.set(key, mark);
    }
    for (const ev of data.events) {
      const key = dayKey(ev.startsAt);
      const mark = map.get(key) ?? { classTints: [], hasEvent: false };
      mark.hasEvent = true;
      map.set(key, mark);
    }
    return map;
  }, [data, tintNameFor]);

  const agenda = useMemo<AgendaRow[]>(() => {
    if (!data) return [];
    const key = dayKey(selectedDay);
    const rows: AgendaRow[] = [];
    for (const item of data.classDates) {
      if (dayKey(item.dueAt) === key) rows.push({ type: "class", item });
    }
    for (const item of data.events) {
      if (dayKey(item.startsAt) === key) rows.push({ type: "event", item });
    }
    rows.sort((a, b) => rowTime(a) - rowTime(b));
    return rows;
  }, [data, selectedDay]);

  const today = new Date();
  const todayKey = dayKey(today);
  const selectedKey = dayKey(selectedDay);
  const onCurrentMonth = sameMonth(monthStart, today);
  const monthLabel = monthStart.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const selectedLabel = selectedDay.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  /* ------------------------------- render ------------------------------- */

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + 8,
      }}
    >
      <View style={{ paddingHorizontal: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)/home");
          }}
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
      </View>

      <View style={{ flex: 1, paddingHorizontal: 20 }}>
        <AppText variant="display" style={{ marginTop: 2, marginBottom: 14 }}>
          Your calendar
        </AppText>

        {error && !data && !loading ? (
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
              onPress={() => void run(monthStart, "page")}
            />
          </View>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void run(monthStart, "refresh")}
                tintColor={theme.brand}
                colors={[theme.brand]}
              />
            }
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                marginBottom: 10,
              }}
            >
              <AppText variant="title" style={{ flex: 1 }} numberOfLines={1}>
                {monthLabel}
              </AppText>
              {onCurrentMonth ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back to this month"
                  onPress={() => goToMonth(firstOfMonth(new Date()))}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    minHeight: 44,
                    justifyContent: "center",
                    paddingHorizontal: 10,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <AppText variant="label" style={{ color: theme.brandInk }}>
                    Today
                  </AppText>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous month"
                onPress={() => shiftMonth(-1)}
                hitSlop={4}
                style={({ pressed }) => ({
                  width: 44,
                  height: 44,
                  borderRadius: radius.full,
                  backgroundColor: theme.surface2,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Feather name="chevron-left" size={20} color={theme.foreground} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next month"
                onPress={() => shiftMonth(1)}
                hitSlop={4}
                style={({ pressed }) => ({
                  width: 44,
                  height: 44,
                  borderRadius: radius.full,
                  backgroundColor: theme.surface2,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Feather name="chevron-right" size={20} color={theme.foreground} />
              </Pressable>
            </View>

            <Card padded={false} style={{ paddingVertical: 12, paddingHorizontal: 6 }}>
              {data === null ? (
                <GhostGrid />
              ) : (
                <View>
                  <WeekdayHeader />
                  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    {cells.map((date, index) =>
                      date === null ? (
                        <View
                          key={`blank-${index}`}
                          style={{ width: `${100 / 7}%`, minHeight: 54 }}
                        />
                      ) : (
                        <DayCell
                          key={dayKey(date)}
                          date={date}
                          isToday={dayKey(date) === todayKey}
                          isSelected={dayKey(date) === selectedKey}
                          classTints={
                            dayMarks.get(dayKey(date))?.classTints ?? NO_TINTS
                          }
                          hasEvent={dayMarks.get(dayKey(date))?.hasEvent ?? false}
                          onSelect={() => setSelectedDay(date)}
                        />
                      )
                    )}
                  </View>
                </View>
              )}
            </Card>

            {error && data !== null ? (
              <AppText
                variant="caption"
                style={{ color: theme.danger, marginTop: 10 }}
              >
                We couldn't refresh just now — pull down to try again.
              </AppText>
            ) : null}

            {data !== null ? (
              <View style={{ marginTop: 18 }}>
                <AppText variant="title" style={{ marginBottom: 10 }}>
                  {selectedLabel}
                </AppText>
                {actionError ? (
                  <AppText
                    variant="caption"
                    style={{ color: theme.danger, marginBottom: 10 }}
                  >
                    {actionError}
                  </AppText>
                ) : null}

                {agenda.length === 0 ? (
                  <Card
                    style={{
                      alignItems: "center",
                      gap: 4,
                      paddingVertical: 22,
                      borderStyle: "dashed",
                    }}
                  >
                    <AppText variant="bodySemi">Nothing on this day.</AppText>
                    <AppText variant="caption" muted>
                      Save it for something good.
                    </AppText>
                  </Card>
                ) : (
                  agenda.map((row) => {
                    if (row.type === "class") {
                      const item = row.item;
                      const done = checked.has(item.id);
                      const colors = kindColors(item.kind, theme);
                      const courseTint = tintFor(item.courseCode);
                      return (
                        <Card
                          key={`class-${item.id}`}
                          padded={false}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 2,
                            paddingLeft: 4,
                            paddingRight: 14,
                            paddingVertical: 12,
                            minHeight: 64,
                            marginBottom: 8,
                          }}
                        >
                          <Pressable
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: done }}
                            accessibilityLabel={`${
                              done ? "Mark not done" : "Mark done"
                            } — ${item.courseCode} ${item.title}`}
                            onPress={() => void toggle(item)}
                            hitSlop={4}
                            style={({ pressed }) => ({
                              width: 44,
                              height: 44,
                              alignItems: "center",
                              justifyContent: "center",
                              opacity: pressed ? 0.6 : 1,
                            })}
                          >
                            {done ? (
                              <View
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: radius.full,
                                  backgroundColor: theme.brand,
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <Feather
                                  name="check"
                                  size={14}
                                  color={theme.brandFg}
                                />
                              </View>
                            ) : (
                              <View
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: radius.full,
                                  borderWidth: 2,
                                  borderColor: theme.border,
                                }}
                              />
                            )}
                          </Pressable>
                          <View style={{ flex: 1, gap: 4 }}>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 6,
                                flexWrap: "wrap",
                              }}
                            >
                              <Chip
                                text={item.courseCode}
                                bg={courseTint.soft}
                                fg={courseTint.ink}
                              />
                              <Chip
                                text={capitalize(kindLabel(item.kind))}
                                bg={colors.bg}
                                fg={colors.fg}
                              />
                            </View>
                            <AppText
                              variant="bodySemi"
                              numberOfLines={2}
                              muted={done}
                              style={
                                done
                                  ? { textDecorationLine: "line-through" }
                                  : undefined
                              }
                            >
                              {item.title}
                            </AppText>
                            <AppText variant="caption" muted>
                              {classTimeLabel(item.dueAt)}
                            </AppText>
                          </View>
                        </Card>
                      );
                    }
                    const ev = row.item;
                    return (
                      <Pressable
                        key={`event-${ev.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`${ev.kindLabel}: ${ev.title}`}
                        onPress={() => router.push(`/event/${ev.id}`)}
                        style={({ pressed }) => ({
                          opacity: pressed ? 0.85 : 1,
                        })}
                      >
                        <Card
                          padded={false}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 12,
                            padding: 14,
                            minHeight: 64,
                            marginBottom: 8,
                          }}
                        >
                          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 6,
                                flexWrap: "wrap",
                              }}
                            >
                              <Chip
                                text={ev.kindLabel}
                                bg={theme.accentSoft}
                                fg={theme.accent}
                              />
                              {ev.courseCode ? (
                                <Chip
                                  text={ev.courseCode}
                                  bg={tintFor(ev.courseCode).soft}
                                  fg={tintFor(ev.courseCode).ink}
                                />
                              ) : null}
                            </View>
                            <AppText variant="bodySemi" numberOfLines={2}>
                              {ev.title}
                            </AppText>
                            <AppText variant="caption" muted numberOfLines={1}>
                              {eventTimeLabel(ev)}
                            </AppText>
                          </View>
                          <Feather
                            name="chevron-right"
                            size={18}
                            color={theme.muted}
                          />
                        </Card>
                      </Pressable>
                    );
                  })
                )}

                {/* The class dot isn't one colour any more, so the legend
                    says what it is instead of drawing a sample that would
                    only be right for one course. */}
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "center",
                    columnGap: 6,
                    rowGap: 4,
                    marginTop: 14,
                  }}
                >
                  <AppText variant="caption" muted>
                    Class dates wear their course's colour
                  </AppText>
                  <AppText variant="caption" muted>
                    ·
                  </AppText>
                  <Dot color={theme.accent} />
                  <AppText variant="caption" muted>
                    Your events
                  </AppText>
                </View>
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>
    </View>
  );
}
