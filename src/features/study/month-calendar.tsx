"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CloudOff,
} from "lucide-react";
import { Button, Card, cardClasses } from "@/components/ui";
import { KindChip } from "@/features/study/kind-chip";
import { createClient } from "@/lib/supabase/client";
import type { CalendarKind } from "@/lib/syllabus";
import { cn } from "@/lib/utils";

/* Your calendar — one warm month of everything: class due dates from every
   enrolled course, plus the events you said you'd show up to. Weeks start on
   Monday — the class-schedule rhythm — the same on every device, no locale
   guessing. Mirrors the native calendar screen. */

/* --------------------------- serializable rows --------------------------- */

/** A class due date inside the month, course code already resolved. */
export type MonthClassDate = {
  id: string;
  courseCode: string;
  kind: CalendarKind;
  title: string;
  due_at: string;
};

/** An event you RSVP'd to (going/maybe) or one tied to one of your courses. */
export type MonthEvent = {
  id: string;
  kind: "study_session" | "meetup";
  title: string;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  courseCode: string | null;
};

export type MonthRows = { classDates: MonthClassDate[]; events: MonthEvent[] };

type EnrollmentJoin = { course: { id: string; code: string } | null };

type ItemRow = {
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

type AgendaRow =
  | { type: "class"; item: MonthClassDate }
  | { type: "event"; item: MonthEvent };

const EVENT_SELECT = "id, kind, title, location, starts_at, ends_at, course_id";

/* ------------------------------ date helpers ------------------------------ */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
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
  return new Date(
    monthStart.getFullYear(),
    monthStart.getMonth() + 1,
    0
  ).getDate();
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** A due time only shows when someone set one — 11:59 PM is the quiet default. */
function classTimeLabel(dueAt: Date): string {
  if (dueAt.getHours() === 23 && dueAt.getMinutes() === 59) {
    return "Due by end of day";
  }
  return `Due at ${formatTime(dueAt)}`;
}

function eventTimeLabel(ev: MonthEvent): string {
  const start = formatTime(new Date(ev.starts_at));
  const range = ev.ends_at
    ? `${start}–${formatTime(new Date(ev.ends_at))}`
    : start;
  return ev.location ? `${range} · ${ev.location}` : range;
}

function rowTime(row: AgendaRow): number {
  return row.type === "class"
    ? new Date(row.item.due_at).getTime()
    : new Date(row.item.starts_at).getTime();
}

/* ------------------------------ month fetch ------------------------------ */

/** One month of calendar data: class dates across every enrolled course,
    events you RSVP'd to (going/maybe) plus course-linked ones (deduped by
    id), and your private check-off state for the month's class dates. */
async function fetchMonth(
  userId: string,
  start: Date
): Promise<{ month: MonthRows; doneIds: string[] }> {
  const supabase = createClient();
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const enrollRes = await supabase
    .from("enrollments")
    .select("course:courses(id, code)")
    .eq("user_id", userId);
  if (enrollRes.error) throw enrollRes.error;
  const courses = ((enrollRes.data ?? []) as unknown as EnrollmentJoin[])
    .map((row) => row.course)
    .filter((c): c is { id: string; code: string } => c !== null);
  const codeById = new Map(courses.map((c) => [c.id, c.code]));
  const courseIds = [...codeById.keys()];

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

  const classDates = ((itemsRes.data ?? []) as unknown as ItemRow[]).map(
    (row): MonthClassDate => ({
      id: row.id,
      courseCode: codeById.get(row.course_id) ?? "Course",
      kind: row.kind,
      title: row.title,
      due_at: row.due_at,
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
      (ev): MonthEvent => ({
        id: ev.id,
        kind: ev.kind,
        title: ev.title,
        location: ev.location,
        starts_at: ev.starts_at,
        ends_at: ev.ends_at,
        courseCode:
          ev.course_id !== null ? codeById.get(ev.course_id) ?? null : null,
      })
    )
    .sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    );

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

  return { month: { classDates, events }, doneIds };
}

/* ------------------------------ tiny pieces ------------------------------ */

function Chip({ text, className }: { text: string; className: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        className
      )}
    >
      {text}
    </span>
  );
}

function Dot({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-[5px] shrink-0 rounded-full", className)}
    />
  );
}

function WeekdayHeader() {
  return (
    <div className="mb-1 grid grid-cols-7">
      {WEEKDAYS.map((w) => (
        <span
          key={w}
          className="text-center text-[11px] font-semibold text-muted"
        >
          {w}
        </span>
      ))}
    </div>
  );
}

/** The quiet grid that holds the room while a month loads. */
function GhostGrid() {
  return (
    <div aria-hidden>
      <WeekdayHeader />
      <div className="grid grid-cols-7">
        {Array.from({ length: 35 }, (_, i) => (
          <div key={i} className="flex min-h-[58px] justify-center pt-0.5">
            <span className="size-11 animate-pulse rounded-full bg-surface-2" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------- component ------------------------------- */

/**
 * The signed-in student's whole month: a Monday-start grid with ember dots
 * for class due dates and fern dots for events, a tappable agenda for the
 * selected day with private check-offs, and month paging that refetches
 * client-side (first month arrives server-rendered). Check-offs flip
 * optimistically and roll back if the write fails.
 */
export function MonthCalendar({
  userId,
  nowIso,
  initialMonth,
  initialCheckedIds,
}: {
  userId: string;
  /** The server's "now" — keeps the first render deterministic across SSR + hydration. */
  nowIso: string;
  initialMonth: MonthRows;
  initialCheckedIds: string[];
}) {
  const today = useMemo(() => startOfDay(new Date(nowIso)), [nowIso]);
  const initialStart = useMemo(() => firstOfMonth(today), [today]);

  const [monthStart, setMonthStart] = useState<Date>(initialStart);
  const [selectedDay, setSelectedDay] = useState<Date>(today);
  const [data, setData] = useState<MonthRows | null>(initialMonth);
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(initialCheckedIds)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /** Months we've already fetched, so paging back is instant. */
  const cacheRef = useRef<Map<string, MonthRows>>(
    new Map([[monthKey(initialStart), initialMonth]])
  );
  /** The month currently on screen — late responses for old months stay quiet. */
  const activeKeyRef = useRef<string>(monthKey(initialStart));

  const run = useCallback(
    async (start: Date) => {
      const key = monthKey(start);
      activeKeyRef.current = key;
      const cached = cacheRef.current.get(key);
      if (cached) {
        setData(cached);
        setLoading(false);
        setError(null);
        return;
      }
      setLoading(true);
      setData(null);
      setError(null);
      try {
        const { month, doneIds } = await fetchMonth(userId, start);
        cacheRef.current.set(key, month);
        if (activeKeyRef.current !== key) return; // paged on — stay quiet
        setData(month);
        setChecked((prev) => {
          const next = new Set(prev);
          for (const item of month.classDates) next.delete(item.id);
          for (const id of doneIds) next.add(id);
          return next;
        });
      } catch {
        if (activeKeyRef.current === key) {
          setError("We couldn't load this month right now.");
        }
      } finally {
        if (activeKeyRef.current === key) setLoading(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    void run(monthStart);
  }, [monthStart, run]);

  /** Land on today when the month holds it, otherwise on the 1st. */
  const goToMonth = useCallback(
    (start: Date) => {
      setMonthStart(start);
      setSelectedDay(sameMonth(today, start) ? today : start);
      setActionError(null);
    },
    [today]
  );

  const shiftMonth = useCallback(
    (delta: number) => {
      goToMonth(
        new Date(monthStart.getFullYear(), monthStart.getMonth() + delta, 1)
      );
    },
    [monthStart, goToMonth]
  );

  /** Optimistic check-off: flip locally, persist, roll back if it fails. */
  async function toggleCheck(item: MonthClassDate) {
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
    const supabase = createClient();
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
  }

  /* ------------------------------- derived ------------------------------- */

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

  const dayMarks = useMemo(() => {
    const map = new Map<string, { hasClass: boolean; hasEvent: boolean }>();
    if (!data) return map;
    for (const item of data.classDates) {
      const key = dayKey(new Date(item.due_at));
      const mark = map.get(key) ?? { hasClass: false, hasEvent: false };
      mark.hasClass = true;
      map.set(key, mark);
    }
    for (const ev of data.events) {
      const key = dayKey(new Date(ev.starts_at));
      const mark = map.get(key) ?? { hasClass: false, hasEvent: false };
      mark.hasEvent = true;
      map.set(key, mark);
    }
    return map;
  }, [data]);

  const agenda = useMemo<AgendaRow[]>(() => {
    if (!data) return [];
    const key = dayKey(selectedDay);
    const rows: AgendaRow[] = [];
    for (const item of data.classDates) {
      if (dayKey(new Date(item.due_at)) === key) {
        rows.push({ type: "class", item });
      }
    }
    for (const item of data.events) {
      if (dayKey(new Date(item.starts_at)) === key) {
        rows.push({ type: "event", item });
      }
    }
    rows.sort((a, b) => rowTime(a) - rowTime(b));
    return rows;
  }, [data, selectedDay]);

  const todayKey = dayKey(today);
  const selectedKey = dayKey(selectedDay);
  const onCurrentMonth = sameMonth(monthStart, today);
  const monthLabel = monthStart.toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });
  const selectedLabel = selectedDay.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  /* -------------------------------- render -------------------------------- */

  return (
    <div>
      {/* Month header: label, Today shortcut, paging. */}
      <div className="flex items-center gap-1">
        <h2 className="min-w-0 flex-1 truncate font-bold tracking-tight">
          {monthLabel}
        </h2>
        {onCurrentMonth ? null : (
          <button
            type="button"
            onClick={() => goToMonth(initialStart)}
            className="flex min-h-11 items-center rounded-full px-2.5 text-sm font-semibold text-brand-ink transition-colors hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Today
          </button>
        )}
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
          className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-foreground transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
          className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-foreground transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </div>

      {/* The grid. */}
      <Card padding="none" className="mt-3 px-1.5 py-3">
        {error && data === null && !loading ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <CloudOff className="size-7 text-muted" aria-hidden />
            <div>
              <p className="font-bold tracking-tight">
                Something went sideways
              </p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-muted">
                {error} Check your connection and give it another go.
              </p>
            </div>
            <Button
              variant="soft"
              size="sm"
              onClick={() => void run(monthStart)}
            >
              Try again
            </Button>
          </div>
        ) : data === null ? (
          <GhostGrid />
        ) : (
          <div>
            <WeekdayHeader />
            <div className="grid grid-cols-7" role="group" aria-label={monthLabel}>
              {cells.map((date, index) => {
                if (date === null) {
                  return <span key={`blank-${index}`} className="min-h-[58px]" />;
                }
                const key = dayKey(date);
                const isToday = key === todayKey;
                const isSelected = key === selectedKey;
                const marks = dayMarks.get(key);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={date.toLocaleDateString([], {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                    onClick={() => {
                      setSelectedDay(date);
                      setActionError(null);
                    }}
                    className="flex min-h-[58px] flex-col items-center pt-0.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                  >
                    <span
                      className={cn(
                        // The espresso ring — selection sits on the foreground token.
                        "flex size-11 items-center justify-center rounded-full border-2 text-sm transition-colors",
                        isSelected ? "border-foreground" : "border-transparent",
                        isToday
                          ? "bg-brand-soft font-semibold text-brand-ink"
                          : "font-medium text-foreground"
                      )}
                    >
                      {date.getDate()}
                    </span>
                    <span className="mt-0.5 flex h-1.5 items-center gap-1">
                      {marks?.hasClass ? <Dot className="bg-brand" /> : null}
                      {marks?.hasEvent ? <Dot className="bg-accent" /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* The selected day's agenda. */}
      {data !== null ? (
        <section className="mt-6" aria-label={selectedLabel}>
          <h2 className="font-bold tracking-tight">{selectedLabel}</h2>

          {actionError ? (
            <p
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {actionError}
            </p>
          ) : null}

          {agenda.length === 0 ? (
            <div className="mt-3 rounded-card border border-dashed border-border px-6 py-8 text-center">
              <p className="text-sm font-semibold">Nothing on this day.</p>
              <p className="mt-1 text-sm text-muted">
                Save it for something good.
              </p>
            </div>
          ) : (
            <ul className="mt-3 flex flex-col gap-2.5">
              {agenda.map((row) => {
                if (row.type === "class") {
                  const item = row.item;
                  const done = checked.has(item.id);
                  return (
                    <li
                      key={`class-${item.id}`}
                      className={cardClasses({
                        padding: "none",
                        className: "flex items-center gap-1 py-3 pl-1 pr-4",
                      })}
                    >
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={done}
                        aria-label={`${item.courseCode} ${item.title}`}
                        onClick={() => void toggleCheck(item)}
                        className="flex size-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      >
                        {done ? (
                          <span className="flex size-6 items-center justify-center rounded-full bg-brand text-brand-fg">
                            <Check className="size-3.5" aria-hidden />
                          </span>
                        ) : (
                          <span className="size-6 rounded-full border-2 border-border" />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Chip
                            text={item.courseCode}
                            className="bg-brand-soft text-brand-ink"
                          />
                          <KindChip kind={item.kind} />
                        </div>
                        <p
                          className={cn(
                            "mt-1 text-sm font-semibold",
                            done && "text-muted line-through"
                          )}
                        >
                          {item.title}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {classTimeLabel(new Date(item.due_at))}
                        </p>
                      </div>
                    </li>
                  );
                }
                const ev = row.item;
                return (
                  <li key={`event-${ev.id}`}>
                    <Link
                      href={`/events/${ev.id}`}
                      className={cardClasses({
                        padding: "sm",
                        interactive: true,
                        className: "flex items-center gap-3",
                      })}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Chip
                            text={
                              ev.kind === "study_session"
                                ? "Study session"
                                : "Meetup"
                            }
                            className="bg-accent-soft text-accent"
                          />
                          {ev.courseCode ? (
                            <Chip
                              text={ev.courseCode}
                              className="bg-brand-soft text-brand-ink"
                            />
                          ) : null}
                        </span>
                        <span className="mt-1 block text-sm font-semibold">
                          {ev.title}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted">
                          {eventTimeLabel(ev)}
                        </span>
                      </span>
                      <ChevronRight
                        className="size-4 shrink-0 text-muted"
                        aria-hidden
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Legend */}
          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted">
            <Dot className="bg-brand" />
            <span>Class dates</span>
            <span aria-hidden>·</span>
            <Dot className="bg-accent" />
            <span>Your events</span>
          </p>
        </section>
      ) : null}

    </div>
  );
}
