import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Bell, CalendarClock, ChevronDown, FilePlus2 } from "lucide-react";
import { PageHeader, buttonClasses } from "@/components/ui";
import {
  CalendarSection,
  type CalendarItemRow,
} from "@/features/study/calendar-section";
import {
  ReminderControl,
  type ReminderItemRow,
} from "@/features/study/reminder-control";
import { getCurrentUser } from "@/lib/auth";
import {
  LEAD_MIN_MINUTES,
  fetchReminders,
  reminderFiresAt,
  type Reminder,
} from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";
import {
  listSyllabusImports,
  winningImportId,
  type SyllabusImportSummary,
} from "@/lib/syllabus-consensus";
import type { Course } from "@/lib/types";

export const metadata: Metadata = { title: "Class calendar" };

/**
 * The shared class calendar: due dates, exams, and lectures, syllabus-imported
 * or hand-added by classmates, with private check-offs on top. RLS scopes
 * items to enrolled classmates.
 *
 * Two private layers sit over that shared list. Check-offs live inside
 * {@link CalendarSection}; reminders live in the panel above it, because a
 * nudge only makes sense for something still ahead and the ladder needs more
 * room than a row has. Neither is ever visible to a classmate.
 */
export default async function ClassCalendarPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const [{ courseId }, user] = await Promise.all([params, getCurrentUser()]);
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: courseRow } = await supabase
    .from("courses")
    .select("id, code, title")
    .eq("id", courseId)
    .maybeSingle();
  const course = courseRow as Pick<Course, "id" | "code" | "title"> | null;
  if (!course) notFound();

  const [{ data: enrollment }, { data: itemRows }] = await Promise.all([
    supabase
      .from("enrollments")
      .select("id")
      .eq("course_id", course.id)
      .eq("user_id", user.userId)
      .maybeSingle(),
    supabase
      .from("course_calendar_items")
      .select("id, created_by, kind, title, due_at, source")
      .eq("course_id", course.id)
      .order("due_at", { ascending: true }),
  ]);

  // The calendar is for classmates. The course page has the join door.
  if (!enrollment) redirect(`/courses/${course.id}`);

  const items = (itemRows ?? []) as CalendarItemRow[];

  /* The syllabus versions this class has, and which one the calendar is
     showing. The items above are already filtered to the winner by the read
     policy; this pair only lets the section say so out loud, endorse, and
     withdraw. A hiccup here shouldn't take the calendar down with it. */
  let imports: SyllabusImportSummary[] = [];
  let winnerId: string | null = null;
  try {
    [imports, winnerId] = await Promise.all([
      listSyllabusImports(course.id, {
        client: supabase,
        userId: user.userId,
      }),
      winningImportId(course.id, { client: supabase }),
    ]);
  } catch {
    /* The versions panel simply doesn't render this visit. */
  }

  // Your own check-offs: private, one query, keyed by item.
  let checkedIds: string[] = [];
  if (items.length > 0) {
    const { data: checks } = await supabase
      .from("study_checkoffs")
      .select("item_id")
      .eq("user_id", user.userId)
      .in(
        "item_id",
        items.map((item) => item.id)
      );
    checkedIds = ((checks ?? []) as { item_id: string }[]).map(
      (row) => row.item_id
    );
  }

  /* Your own reminders across every item on this calendar: one query, and a
     failure here is worth saying out loud rather than drawing empty bells. */
  let reminders: Reminder[] = [];
  let reminderError: string | null = null;
  if (items.length > 0) {
    try {
      const byItem = await fetchReminders(
        items.map((item) => item.id),
        { client: supabase, userId: user.userId }
      );
      reminders = [...byItem.values()];
    } catch {
      reminderError =
        "We couldn't load your reminders. Check your connection and give it another go.";
    }
  }

  /* What the bell can honestly be offered on: anything whose closest possible
     nudge is still ahead, plus anything already carrying a reminder so it can
     be read and turned off. The sweep only sends before a deadline, so a bell
     on anything else would be a promise we can't keep. */
  const now = new Date();
  const armed = new Set(reminders.map((reminder) => reminder.item_id));
  const remindable: ReminderItemRow[] = items
    .filter(
      (item) =>
        armed.has(item.id) ||
        !reminderFiresAt(new Date(item.due_at), LEAD_MIN_MINUTES, now).past
    )
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      due_at: item.due_at,
    }));

  const setCount = reminders.length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref={`/courses/${course.id}`}
        backLabel={course.code}
        title="Class calendar"
        description={`${course.code} · shared with everyone in the class. Check off what you've handled.`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/courses/${course.id}/series`}
              className={buttonClasses({
                variant: "secondary",
                size: "sm",
                className: "gap-1.5",
              })}
            >
              <CalendarClock className="size-4" aria-hidden />
              Weekly pattern
            </Link>
            <Link
              href={`/courses/${course.id}/syllabus`}
              className={buttonClasses({
                variant: "soft",
                size: "sm",
                className: "gap-1.5",
              })}
            >
              <FilePlus2 className="size-4" aria-hidden />
              Import syllabus
            </Link>
          </div>
        }
      />

      {remindable.length > 0 || reminderError ? (
        <details className="group mt-6" open={setCount > 0}>
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full px-1 py-2 text-xs font-bold uppercase tracking-widest text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <ChevronDown
              className="size-4 transition-transform group-open:rotate-180"
              aria-hidden
            />
            <Bell className="size-3.5" aria-hidden />
            Reminders
            {setCount > 0 ? ` · ${setCount} set` : ""}
          </summary>

          <p className="mt-2 px-1 text-xs leading-relaxed text-muted text-pretty">
            One nudge before a deadline, however far ahead you like. Only you
            see these. The dates belong to the class; who wants reminding
            doesn&apos;t.
          </p>

          <div className="mt-3">
            <ReminderControl
              items={remindable}
              initialReminders={reminders}
              loadError={reminderError}
            />
          </div>
        </details>
      ) : null}

      <div className="mt-6">
        <CalendarSection
          courseId={course.id}
          userId={user.userId}
          initialItems={items}
          initialCheckedIds={checkedIds}
          initialImports={imports}
          initialWinnerId={winnerId}
        />
      </div>
    </div>
  );
}
