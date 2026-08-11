/* The personal study plan, as pure functions.
 *
 * "Am I on top of everything?" — this module answers that from three inputs:
 * the shared class calendar (flattened to PlanItems), the student's private
 * check-offs, and the current moment. No I/O, no Supabase, no Date.now():
 * callers pass `now`, so every result is deterministic and unit-testable.
 *
 * Screens feed it rows from course_calendar_items + study_checkoffs and get
 * back time-bucketed groups plus headline stats for the progress header and
 * the home card.
 *
 * It also owns {@link computeDayStreak} — the one definition of what a streak
 * is, shared by check-offs and focus sessions so the two numbers can never
 * disagree about where a day starts.
 */

/** Calendar-item kinds, mirroring the course_calendar_items check constraint. */
export type PlanKind =
  | "assignment"
  | "exam"
  | "quiz"
  | "lecture"
  | "reading"
  | "project"
  | "other";

const PLAN_KINDS: readonly PlanKind[] = [
  "assignment",
  "exam",
  "quiz",
  "lecture",
  "reading",
  "project",
  "other",
];

/** Narrow a raw kind string from the database; anything unknown is "other". */
export function toPlanKind(raw: string): PlanKind {
  return (PLAN_KINDS as readonly string[]).includes(raw)
    ? (raw as PlanKind)
    : "other";
}

/** One class-calendar item, flattened for planning. */
export type PlanItem = {
  id: string;
  courseCode: string;
  kind: PlanKind;
  title: string;
  dueAt: Date;
};

/**
 * A recommended study session ahead of an exam or quiz. Study blocks are
 * DERIVED, never persisted: they carry no database row and cannot be checked
 * off — only real calendar items reach study_checkoffs. The key exists purely
 * so lists can render them stably.
 */
export type StudyBlock = {
  /** Derived render key, `study:${itemId}:${n}` — never written anywhere. */
  key: string;
  /** Which of the three blocks this is (1-based); past blocks are skipped. */
  n: number;
  /** e.g. "Study block 2 of 3 — ECS 36A Midterm 1". */
  label: string;
  /** When to sit down: due minus 7, 3, or 1 days (same time of day). */
  at: Date;
};

/** A plan item plus the student's personal state and any study suggestions. */
export type PlanEntry = PlanItem & {
  done: boolean;
  /** Present only for exams/quizzes due within the next 14 days. */
  studyBlocks?: StudyBlock[];
};

export type PlanGroupLabel =
  | "Overdue"
  | "Today"
  | "Tomorrow"
  | "This week"
  | "Later";

export type PlanGroup = { label: PlanGroupLabel; entries: PlanEntry[] };

export type PlanStats = {
  /** Items the student has checked off, across the whole plan window. */
  handled: number;
  /** Every item in the plan window, however far out. */
  total: number;
  /**
   * Checked off among {@link weekTotal} — the numerator a screen prints.
   */
  weekHandled: number;
  /**
   * Items due between a week ago and the end of this week: everything except
   * the "Later" bucket. This is the honest denominator for "how am I doing",
   * and the reason both the home card and the plan screen print the same
   * number. Scoring the rest of the term instead turns a good week into "6 of
   * 74 handled", which says nothing about today.
   */
  weekTotal: number;
  /**
   * The next thing to actually do: the earliest-due unhandled item that isn't
   * a lecture, falling back to the earliest unhandled item of any kind.
   * Overdue items count — catching up on a missed deadline IS the next thing
   * to do. Absent when everything is handled (or the plan is empty).
   *
   * Lectures step aside because a weekly pattern expands into dozens of them
   * and nobody checks a lecture off, so the earliest unhandled item on a real
   * term is almost always a class that already met.
   */
  nextUp?: PlanEntry;
};

export type Plan = { groups: PlanGroup[]; stats: PlanStats };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Study blocks land at due − 7d, due − 3d, due − 1d, in that order. */
const STUDY_OFFSET_DAYS: readonly number[] = [7, 3, 1];

/** Only exams/quizzes due within this many days earn study blocks. */
const STUDY_WINDOW_DAYS = 14;

/**
 * Groups always render in this order; empty groups are dropped.
 *
 * Exported because a screen that files derived {@link StudyBlock}s by their
 * own moment can end up with a bucket {@link buildPlan} never made a group
 * for — a study block this week for an exam that's still "Later". Walk this
 * rather than the returned groups and the headings stay in time order.
 */
export const PLAN_GROUP_ORDER: readonly PlanGroupLabel[] = [
  "Overdue",
  "Today",
  "Tomorrow",
  "This week",
  "Later",
];

/** Local midnight for the given moment. */
function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Whole calendar days from `now`'s day to `due`'s day (local time).
 * Rounded so a DST hour shift can't produce an off-by-one.
 */
function calendarDaysUntil(now: Date, due: Date): number {
  return Math.round(
    (startOfDay(due).getTime() - startOfDay(now).getTime()) / DAY_MS
  );
}

/**
 * Which bucket a moment belongs to, relative to `now`.
 *
 * Exported because a derived {@link StudyBlock} is filed by when you should
 * sit down, not by when its exam is: a block for tomorrow belongs under
 * "Tomorrow" even though the midterm it prepares for is three weeks out.
 */
export function groupLabelFor(at: Date, now: Date): PlanGroupLabel {
  // Anything whose moment has passed is overdue — including earlier today.
  if (at.getTime() < now.getTime()) return "Overdue";
  const days = calendarDaysUntil(now, at);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return "This week";
  return "Later";
}

/**
 * Deterministic study suggestions for an exam or quiz: three blocks at
 * due − 7d / − 3d / − 1d, keeping each block's original "n of 3" position
 * even when earlier blocks have already passed and been skipped.
 * Returns undefined when the item isn't an exam/quiz, is already due,
 * is more than 14 days out, or every block is in the past.
 */
function studyBlocksFor(item: PlanItem, now: Date): StudyBlock[] | undefined {
  if (item.kind !== "exam" && item.kind !== "quiz") return undefined;
  const lead = item.dueAt.getTime() - now.getTime();
  if (lead <= 0 || lead > STUDY_WINDOW_DAYS * DAY_MS) return undefined;

  const blocks: StudyBlock[] = [];
  STUDY_OFFSET_DAYS.forEach((days, index) => {
    const at = new Date(item.dueAt.getTime() - days * DAY_MS);
    if (at.getTime() < now.getTime()) return; // that window already closed
    const n = index + 1;
    blocks.push({
      key: `study:${item.id}:${n}`,
      n,
      label: `Study block ${n} of 3 — ${item.courseCode} ${item.title}`,
      at,
    });
  });
  return blocks.length > 0 ? blocks : undefined;
}

/**
 * Build the whole plan in one pass: sort items by due date (ties broken by
 * course code, then title, then id, so the order never jitters), attach the
 * student's done flags and any study blocks, bucket into ordered groups, and
 * derive the headline stats.
 */
export function buildPlan(
  items: PlanItem[],
  checkoffs: Set<string>,
  now: Date
): Plan {
  const entries: PlanEntry[] = [...items]
    .sort(
      (a, b) =>
        a.dueAt.getTime() - b.dueAt.getTime() ||
        a.courseCode.localeCompare(b.courseCode) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id)
    )
    .map((item) => ({
      ...item,
      done: checkoffs.has(item.id),
      studyBlocks: studyBlocksFor(item, now),
    }));

  // Bucket while preserving the sorted order inside each group.
  const buckets = new Map<PlanGroupLabel, PlanEntry[]>();
  for (const entry of entries) {
    const label = groupLabelFor(entry.dueAt, now);
    const bucket = buckets.get(label);
    if (bucket) bucket.push(entry);
    else buckets.set(label, [entry]);
  }
  const groups: PlanGroup[] = PLAN_GROUP_ORDER.flatMap((label) => {
    const bucket = buckets.get(label);
    return bucket ? [{ label, entries: bucket }] : [];
  });

  const handled = entries.reduce((sum, e) => (e.done ? sum + 1 : sum), 0);

  // "This week" is Overdue through This week — the rest of the term is a
  // denominator nobody can move today, and folding it in makes a good week
  // read as 8%.
  let weekTotal = 0;
  let weekHandled = 0;
  for (const [label, bucket] of buckets) {
    if (label === "Later") continue;
    for (const entry of bucket) {
      weekTotal += 1;
      if (entry.done) weekHandled += 1;
    }
  }

  // A lecture is never checked off and a weekly pattern expands into dozens
  // of them, so the plain "earliest unhandled" rule points at a class that
  // already met. Prefer something the student can actually handle; fall back
  // to the plain rule for a plan that is nothing but lectures.
  const nextUp =
    entries.find((e) => !e.done && e.kind !== "lecture") ??
    entries.find((e) => !e.done);

  return {
    groups,
    stats: {
      handled,
      total: entries.length,
      weekHandled,
      weekTotal,
      ...(nextUp ? { nextUp } : {}),
    },
  };
}

/* ------------------------------ streaks ------------------------------ */

/** Local calendar-day key — streaks live in the student's timezone. */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * The streak rule, written once: how many consecutive local calendar days,
 * ending today or yesterday, have at least one of these moments in them.
 *
 * Yesterday still counts as alive, so an unmarked morning doesn't zero out
 * last night's run — a streak is a gift, never a debt. Days are counted in
 * the student's own timezone, so something that happened at 1am belongs to
 * that new day exactly as they experienced it. Anything unparseable (or
 * null, for work that isn't finished) is skipped rather than counted.
 *
 * This is the shared definition: the study plan feeds it check-off times and
 * `@/lib/focus` feeds it session end times, so "3-day streak" means the same
 * thing on both screens. Callers stay quiet below 2 — no guilt UI.
 *
 * Pure: order doesn't matter and `now` is passed in, never read from the
 * clock, so a ticking screen and a unit test get the same answer.
 *
 * @param moments When the thing happened — Dates or ISO strings, mixed is
 *   fine. Nulls and undefineds are ignored.
 * @param now     The current moment.
 */
export function computeDayStreak(
  moments: Iterable<Date | string | null | undefined>,
  now: Date
): number {
  const days = new Set<string>();
  for (const moment of moments) {
    if (moment === null || moment === undefined) continue;
    const at = moment instanceof Date ? moment : new Date(moment);
    if (Number.isNaN(at.getTime())) continue;
    days.add(localDayKey(at));
  }

  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(localDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
