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
  /** Items the student has checked off. */
  handled: number;
  /** Every item in the plan window. */
  total: number;
  /**
   * The earliest-due item still unhandled — overdue items included, since
   * catching up on a missed deadline IS the next thing to do. Absent when
   * everything is handled (or the plan is empty).
   */
  nextUp?: PlanEntry;
};

export type Plan = { groups: PlanGroup[]; stats: PlanStats };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Study blocks land at due − 7d, due − 3d, due − 1d, in that order. */
const STUDY_OFFSET_DAYS: readonly number[] = [7, 3, 1];

/** Only exams/quizzes due within this many days earn study blocks. */
const STUDY_WINDOW_DAYS = 14;

/** Groups always render in this order; empty groups are dropped. */
const GROUP_ORDER: readonly PlanGroupLabel[] = [
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

/** Which bucket an item belongs to, relative to `now`. */
function groupLabelFor(dueAt: Date, now: Date): PlanGroupLabel {
  // Anything whose moment has passed is overdue — including earlier today.
  if (dueAt.getTime() < now.getTime()) return "Overdue";
  const days = calendarDaysUntil(now, dueAt);
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
  const groups: PlanGroup[] = GROUP_ORDER.flatMap((label) => {
    const bucket = buckets.get(label);
    return bucket ? [{ label, entries: bucket }] : [];
  });

  const handled = entries.reduce((sum, e) => (e.done ? sum + 1 : sum), 0);
  const nextUp = entries.find((e) => !e.done);

  return {
    groups,
    stats: {
      handled,
      total: entries.length,
      ...(nextUp ? { nextUp } : {}),
    },
  };
}
