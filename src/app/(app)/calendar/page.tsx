import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import {
  MonthCalendar,
  type MonthClassDate,
  type MonthEvent,
  type MonthRows,
} from "@/features/study/month-calendar";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CalendarKind } from "@/lib/syllabus";

export const metadata: Metadata = { title: "Your calendar" };

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

const EVENT_SELECT = "id, kind, title, location, starts_at, ends_at, course_id";

/**
 * Your calendar: one month of everything, class due dates from every
 * enrolled course, plus the events you RSVP'd to (going/maybe) and any
 * event tied to one of your courses, deduped. The current month arrives
 * server-rendered; paging to other months refetches client-side.
 */
export default async function CalendarPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const { data: enrollRows } = await supabase
    .from("enrollments")
    .select("course:courses(id, code)")
    .eq("user_id", user.userId);
  const courses = ((enrollRows ?? []) as unknown as EnrollmentJoin[])
    .map((row) => row.course)
    .filter((c): c is { id: string; code: string } => c !== null);
  const codeById = new Map(courses.map((c) => [c.id, c.code]));
  const courseIds = [...codeById.keys()];

  const none = { data: [] as unknown[] };
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
    // Everything the student RSVP'd to, filtered to the month below.
    supabase
      .from("event_rsvps")
      .select(`event:events(${EVENT_SELECT})`)
      .eq("user_id", user.userId)
      .in("status", ["going", "maybe"]),
    // Plus anything tied to one of their courses, RSVP or not.
    courseIds.length > 0
      ? supabase
          .from("events")
          .select(EVENT_SELECT)
          .in("course_id", courseIds)
          .gte("starts_at", startIso)
          .lt("starts_at", endIso)
      : Promise.resolve(none),
  ]);

  const classDates: MonthClassDate[] = (
    (itemsRes.data ?? []) as unknown as ItemRow[]
  ).map((row) => ({
    id: row.id,
    courseCode: codeById.get(row.course_id) ?? "Course",
    kind: row.kind,
    title: row.title,
    due_at: row.due_at,
  }));

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
  const events: MonthEvent[] = [...eventById.values()]
    .map((ev) => ({
      id: ev.id,
      kind: ev.kind,
      title: ev.title,
      location: ev.location,
      starts_at: ev.starts_at,
      ends_at: ev.ends_at,
      courseCode:
        ev.course_id !== null ? codeById.get(ev.course_id) ?? null : null,
    }))
    .sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    );

  // The student's own check-offs for this month's class dates. Private.
  let checkedIds: string[] = [];
  if (classDates.length > 0) {
    const { data: checks } = await supabase
      .from("study_checkoffs")
      .select("item_id")
      .eq("user_id", user.userId)
      .in(
        "item_id",
        classDates.map((item) => item.id)
      );
    checkedIds = ((checks ?? []) as { item_id: string }[]).map(
      (row) => row.item_id
    );
  }

  const initialMonth: MonthRows = { classDates, events };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref="/events"
        backLabel="Events"
        title="Your calendar"
        description="Class due dates across your courses, plus every event you said you'd show up to."
      />

      <div className="mt-6 animate-fade-up">
        <MonthCalendar
          userId={user.userId}
          nowIso={now.toISOString()}
          initialMonth={initialMonth}
          initialCheckedIds={checkedIds}
        />
      </div>
    </div>
  );
}
