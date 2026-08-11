import { colorForCourse, type CourseTint } from "@/lib/course-color";
import {
  courseEstimate,
  letterFor,
  type CategoryWeight,
  type CourseEstimate,
  type EntryScore,
  type Letter,
} from "@/lib/grades";
import { supabase } from "@/lib/supabase";

/* The semester overview — one number across every class, and the read behind it.
 *
 * THIS IS SCRATCH MATH. Read that twice before writing copy against it.
 *
 * Every figure in this module is derived from what the student typed into
 * their own private gradebook: `grade_categories` and `grade_entries`, both
 * RLS self-only, both described in migration 0028 as "math the student owns,
 * not a claim about their record". Nothing here is a transcript, a registrar
 * figure, or a grade of record. It is never shared with a classmate, never
 * written back anywhere, never shown to anyone but the person who typed the
 * numbers in. If a screen ever renders one of these as official — a badge on a
 * profile, a line in a group, a number another student can see — that is a bug
 * in the screen, not a feature of this file.
 *
 * It is also an estimate OF an estimate. Each course number from
 * `courseEstimate` is already a projection from partial grades, rescaled by
 * the weight that's actually been graded. Averaging twelve weeks of guesses
 * does not make them facts. Keep the copy hedged the whole way up.
 *
 * TWO HALVES, AND THEY NEVER MIX
 *
 *   1. THE MATH is pure. No Supabase, no Date.now(), no React, no theme.
 *      Numbers in, numbers and one warm sentence out. Nothing in this module
 *      reads the clock at all, so every function is deterministic and
 *      unit-testable on plain object literals — including on the optimistic
 *      rows a screen is holding mid-edit.
 *
 *   2. THE DATA half is one batched read. Three queries total, no matter how
 *      many classes are enrolled: the active enrollments, then every grade
 *      category across all of them, then every score inside those categories.
 *      Never a gradebook per course in a loop.
 *
 * WHAT THIS REUSES
 * The per-course percentage comes from {@link courseEstimate} in
 * `@/lib/grades` — the same function the single-course grade screen calls, so
 * a course reads identically in both places. The letter comes from
 * `letterFor`, and {@link gradePointFor} is defined on top of that letter
 * rather than on its own cutoffs, so the two can never drift apart.
 */

/* ══════════════════════════════ shapes ══════════════════════════════ */

/**
 * The least {@link semesterEstimate} needs from a class. A full
 * {@link SemesterCourse} fits, so the same array feeds the list and the math.
 */
export type SemesterCourseInput = {
  /** `courses.id`. Carried so a caller can pass its own row shape unchanged. */
  courseId: string;
  /** e.g. "ECS 36A" — the only thing the note ever names a class by. */
  code: string;
  /**
   * `courses.units`, or null when the class hasn't had its units filled in.
   * Null, zero, and anything non-finite all read as "unknown" and tip the
   * whole estimate to an unweighted mean — see {@link semesterEstimate}.
   */
  units: number | null;
  /** The course's own estimate; `pct` null means it isn't graded yet. */
  estimate: Pick<CourseEstimate, "pct">;
};

/** The headline number for a semester. See {@link semesterEstimate}. */
export type SemesterEstimate = {
  /**
   * The estimated grade-point average on a 4.0 scale, rounded to two
   * decimals — or null when no class has a grade yet. Never NaN.
   */
  gpa: number | null;
  /** How many classes had an estimate to contribute. */
  graded: number;
  /** How many active classes there are in total, graded or not. */
  total: number;
  /**
   * True when the average is a plain mean rather than weighted by units,
   * because at least one graded class is missing its units. With a single
   * graded class the two are the same number; the flag is still literal about
   * how it got there, and `note` explains it in words either way.
   */
  unweighted: boolean;
  /** One warm sentence naming what the number does and doesn't cover. */
  note: string;
};

/** One class on the semester screen: the course, its estimate, its tint. */
export type SemesterCourse = {
  /** `enrollments.id` — what the archive and colour writes take. */
  enrollmentId: string;
  /** `courses.id` — what every other course surface keys off. */
  courseId: string;
  /** e.g. "ECS 36A". The list is ordered by this. */
  code: string;
  /** e.g. "Programming & Problem Solving", or "" when it didn't come through. */
  title: string;
  /** `courses.units`, or null when nobody in the class has filled them in. */
  units: number | null;
  /**
   * The tint this class wears for this student, already resolved from
   * `enrollments.color` with the stable code hash as the fallback. Paint it
   * with `courseTintsFor(scheme)[color]`.
   */
  color: CourseTint;
  /** The course's own estimate, straight from {@link courseEstimate}. */
  estimate: CourseEstimate;
  /** The letter beside the percentage, or null when there's nothing to letter. */
  letter: Letter | null;
  /** The 4.0-scale point this class contributes, or null when ungraded. */
  gradePoint: number | null;
  /**
   * How many grade categories the student has set up for this class. Lets a
   * row tell "no gradebook yet" from "gradebook, nothing graded yet" without
   * pattern-matching on `estimate.note`.
   */
  categoryCount: number;
};

/** Everything the semester screen needs, in one shot. See {@link fetchSemester}. */
export type Semester = {
  /** Active classes, ordered by course code. Empty when nothing's enrolled. */
  courses: SemesterCourse[];
  /** The whole-semester number, already computed over `courses`. */
  summary: SemesterEstimate;
};

/* ════════════════════════════ the 4.0 scale ═════════════════════════ */

/**
 * What each letter is worth on a 4.0 scale.
 *
 * **This is one common US scale, not a universal one.** Plenty of schools
 * differ, and they all think theirs is the normal one: some award an A+ worth
 * 4.0 and some 4.3, some ignore plus/minus entirely so every B is 3.0, some
 * put A- at 3.67 rather than 3.7, and some don't use grade points at all.
 * Your registrar's number is the real one. This is the student's own scratch
 * math, and the copy around it should never call it a GPA of record.
 *
 * Keyed by {@link Letter} rather than by percentage on purpose: the cutoffs
 * live in exactly one place (`LETTER_CUTOFFS` in `@/lib/grades`), so a
 * displayed "A-" and a 3.7 can never come from two different opinions about
 * where 90% lands. Add a letter there and this record stops type-checking
 * until it's given a value here.
 */
export const GRADE_POINTS: Record<Letter, number> = {
  A: 4,
  "A-": 3.7,
  "B+": 3.3,
  B: 3,
  "B-": 2.7,
  "C+": 2.3,
  C: 2,
  "C-": 1.7,
  "D+": 1.3,
  D: 1,
  "D-": 0.7,
  F: 0,
};

/** The most any single class can be worth here — there is no A+ on this scale. */
export const GRADE_POINT_MAX = 4;

/* ═══════════════════════ small number helpers ═══════════════════════ */

/** Float slop guard — unit totals never differ by anything this small. */
const EPSILON = 1e-9;

/** Round to two decimals: the precision a GPA is always reported at. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Units we can actually weight by: finite and above zero. Null, zero, a
 * negative, or a NaN from a half-typed edit all mean "unknown", which is a
 * different thing from "worth nothing" and is treated as such everywhere below.
 */
function usableUnits(units: number | null | undefined): number | null {
  if (typeof units !== "number" || !Number.isFinite(units) || units <= 0) {
    return null;
  }
  return units;
}

/** Small counts read better as words in a sentence; big ones as digits. */
const COUNT_WORDS: readonly string[] = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

/** "three" for 3, "14" for 14. Never a bare digit where a word would read. */
function countWord(count: number): string {
  return COUNT_WORDS[count] ?? String(count);
}

/** The same count, capitalised for the start of a sentence. */
function countWordCapitalized(count: number): string {
  const word = countWord(count);
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/* ════════════════════════════ the math ═════════════════════════════
 *
 * Everything below this line is pure: same inputs, same outputs, forever.
 * No clock, no network, no module state.
 */

/**
 * The 4.0-scale grade point a percentage is worth, on the same scale
 * `letterFor` uses.
 *
 * Defined as "the letter, then {@link GRADE_POINTS}" rather than as its own
 * table of cutoffs, which is the whole point: a screen showing 90% → "A-" and
 * this returning 3.7 are two readings of one decision. They cannot disagree,
 * and moving a cutoff in `@/lib/grades` moves both.
 *
 * **An estimate, not a promise.** Instructors curve, drop a low score, and
 * weight differently than the syllabus reads; schools count plus/minus
 * differently or not at all. Extra credit above 100% still lands at 4.0 —
 * there is no A+ on this scale, so the number tops out where an A does.
 *
 * Null in, null out, so it can be handed a {@link CourseEstimate.pct} directly.
 *
 * @param pct A percentage, 0-100 (above 100 with extra credit).
 * @returns The grade point, 0 to {@link GRADE_POINT_MAX}.
 */
export function gradePointFor(pct: number): number;
export function gradePointFor(pct: number | null): number | null;
export function gradePointFor(pct: number | null): number | null {
  const letter = letterFor(pct);
  if (letter === null) return null;
  return GRADE_POINTS[letter];
}

/**
 * The semester's estimated GPA: every class's percentage turned into a grade
 * point, weighted by units, averaged.
 *
 * **Ungraded classes are left out, not counted as zero.** A class the student
 * hasn't logged a single score in has no opinion about their semester, and
 * folding it in as a 0.0 would be a lie that gets worse the earlier in the
 * quarter you look. `graded` and `total` report the gap out loud so a screen
 * can say "3 of 5 classes" beside the number, and `note` says it in a sentence.
 *
 * **Units are all-or-nothing.** If even one graded class is missing its units,
 * the whole average falls back to a plain mean over the graded classes,
 * `unweighted` comes back true, and the note names how many classes are
 * missing them. The alternative — inventing a default of 4 units for the
 * unknown ones — would quietly weight a seminar like a lecture and never tell
 * anyone. Units are classmate-editable (`courses.units`), so the fix is one
 * student typing one number, and the note is what points at it.
 *
 * Deterministic and pure: hand it optimistic rows mid-edit and it behaves
 * exactly as it does on fetched ones.
 *
 * @param courses The student's active classes and their course estimates.
 * @returns The GPA, the coverage, whether it's weighted, and a warm note.
 */
export function semesterEstimate(
  courses: readonly SemesterCourseInput[]
): SemesterEstimate {
  const total = courses.length;

  /* One pass: keep only the classes that actually have a number to give. */
  const graded: { code: string; point: number; units: number | null }[] = [];
  for (const course of courses) {
    const point = gradePointFor(course.estimate.pct);
    if (point === null) continue;
    graded.push({
      code: course.code,
      point,
      units: usableUnits(course.units),
    });
  }

  const gradedCount = graded.length;
  if (gradedCount === 0) {
    return {
      gpa: null,
      graded: 0,
      total,
      unweighted: false,
      note:
        total === 0
          ? "Add your classes to see where the semester stands."
          : "Nothing's graded yet — your first score in any class starts this off.",
    };
  }

  let pointSum = 0;
  let weightedSum = 0;
  let unitSum = 0;
  let missingUnits = 0;
  for (const entry of graded) {
    pointSum += entry.point;
    if (entry.units === null) {
      missingUnits += 1;
      continue;
    }
    weightedSum += entry.point * entry.units;
    unitSum += entry.units;
  }

  const unweighted = missingUnits > 0;
  const plainMean = pointSum / gradedCount;
  // `missingUnits === 0` already guarantees `unitSum > 0`; the second test is
  // belt and braces, because a NaN reaching a screen as someone's GPA is the
  // one failure mode worth two lines of paranoia.
  const gpa =
    unweighted || unitSum <= EPSILON ? plainMean : weightedSum / unitSum;

  return {
    gpa: round2(gpa),
    graded: gradedCount,
    total,
    unweighted,
    note: summaryNote({
      total,
      graded: gradedCount,
      missingUnits,
      onlyCode: gradedCount === 1 ? (graded[0]?.code ?? null) : null,
    }),
  };
}

/**
 * The one sentence under the number. Four things can be true at once — some
 * classes ungraded, some missing units, only one class counting, everything
 * covered — and this picks the one a student most needs to know.
 *
 * Order of honesty: missing units change what the number *is*, so they always
 * get said; partial coverage changes what it *covers*, so it rides along in
 * the same sentence when both apply.
 */
function summaryNote(args: {
  total: number;
  graded: number;
  missingUnits: number;
  onlyCode: string | null;
}): string {
  const { total, graded, missingUnits, onlyCode } = args;

  // A single class carries the whole number, and weighting one thing by its
  // units changes nothing — so name the class instead of explaining the math.
  if (graded === 1) {
    const named =
      onlyCode !== null && onlyCode.length > 0 ? onlyCode : "one class";
    return `Only ${named} has scores so far — this is that class on its own.`;
  }

  const covered = graded >= total;

  if (missingUnits > 0) {
    const subject =
      missingUnits === 1
        ? `${countWordCapitalized(1)} class is missing its units`
        : `${countWordCapitalized(missingUnits)} classes are missing their units`;
    return covered
      ? `${subject}, so this is a plain average.`
      : `${subject}, so this is a plain average of the ${countWord(graded)} classes with grades so far.`;
  }

  return covered
    ? `Weighted by units across all ${countWord(total)} of your classes.`
    : `Weighted by units across the ${countWord(graded)} classes that have grades so far.`;
}

/**
 * A GPA the way a person writes one: two decimals, always — "3.40", not "3.4".
 *
 * Lives here so the headline, the share of it in a summary row, and anything
 * else that prints the number all agree on its shape. Null in, null out, so a
 * screen decides its own placeholder rather than inheriting one from a library.
 *
 * @param gpa A value from {@link SemesterEstimate.gpa}.
 */
export function formatGpa(gpa: number): string;
export function formatGpa(gpa: number | null): string | null;
export function formatGpa(gpa: number | null): string | null {
  if (gpa === null || !Number.isFinite(gpa)) return null;
  return gpa.toFixed(2);
}

/**
 * How many units the semester is worth, counting only classes whose units are
 * known. Returns null when no class has units at all, so a screen can leave
 * the line out entirely instead of printing "0 units".
 *
 * @param courses Any classes carrying units — {@link SemesterCourse} fits.
 */
export function totalUnits(
  courses: readonly Pick<SemesterCourseInput, "units">[]
): number | null {
  let sum = 0;
  let counted = 0;
  for (const course of courses) {
    const units = usableUnits(course.units);
    if (units === null) continue;
    sum += units;
    counted += 1;
  }
  return counted === 0 ? null : round2(sum);
}

/* ═══════════════════════════ the data half ══════════════════════════
 *
 * Below this line: Supabase only. Nothing above imports anything from here.
 */

/**
 * A semester-overview failure with a message written for a person, not a log.
 * Render `err.message` straight into an inline error — it never leaks SQL,
 * ids, or PostgREST codes.
 */
export class SemesterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SemesterError";
  }
}

/** What a failed enrollments read says. */
const LOAD_CLASSES_FAILED =
  "We couldn't load your classes. Check your connection and give it another go.";

/**
 * What a failed gradebook read says. The classes may have loaded fine, but a
 * semester number built on half the scores would be worse than no number, so
 * this throws rather than quietly averaging what came back.
 */
const LOAD_GRADES_FAILED =
  "We couldn't load your grades just now. Give it another go.";

/** Columns the active-enrollments read needs. Keep selects aligned. */
const ENROLLMENT_SELECT = "id, color, course:courses(id, code, title, units)";

/** Columns the batched category read needs — weights only, no names. */
const CATEGORY_SELECT = "id, course_id, weight";

/** Columns the batched score read needs — points only, no titles. */
const ENTRY_SELECT = "category_id, points_earned, points_possible";

/* ═════════════════════════════ narrowing ════════════════════════════ */

/** A plain record, or null when the value isn't an object. */
function record(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/**
 * An embedded relation comes back as an object OR a one-element array
 * depending on how PostgREST resolves it, and sometimes as null. Unwrap both
 * shapes. Same defence as `@/lib/course-archive` and `@/lib/study-buddy`.
 */
function embedded(raw: unknown): Record<string, unknown> | null {
  return record(Array.isArray(raw) ? raw[0] : raw);
}

/** A trimmed non-empty string, else null. */
function text(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * A finite number from a JSON number or a numeric-as-string. PostgREST hands
 * `numeric` columns back either way depending on the driver, and `weight`,
 * `units`, and both points columns are all numeric.
 */
function num(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Rows or nothing — PostgREST returns null data alongside a null error. */
function rows(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

/**
 * Course codes sort like a human reads them: "ECS 36A" before "ECS 122A", so
 * the numeric collation matters. Ties fall through to the title and the id, so
 * the order never jitters between refreshes. A runtime without full Intl
 * ignores the options and degrades to a plain compare, which is still stable.
 */
function byCode(a: SemesterCourse, b: SemesterCourse): number {
  return (
    a.code.localeCompare(b.code, undefined, {
      numeric: true,
      sensitivity: "base",
    }) ||
    a.title.localeCompare(b.title) ||
    a.courseId.localeCompare(b.courseId)
  );
}

/**
 * The caller's `profiles.id`, read from the stored session (no network hop —
 * supabase-js refreshes a stale token itself).
 *
 * @throws {SemesterError} When nobody's signed in.
 */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (error || typeof id !== "string" || id.length === 0) {
    throw new SemesterError("Sign in again to see your semester.");
  }
  return id;
}

/* ═══════════════════════════════ reads ══════════════════════════════ */

/** One active class before its gradebook is folded in. */
type CourseShell = Pick<
  SemesterCourse,
  "enrollmentId" | "courseId" | "code" | "title" | "units" | "color"
>;

/**
 * Narrow one joined enrollment row. Returns null when the row is missing
 * something a course line can't be drawn without: the enrollment id, the
 * course, its id, or its code. A course whose title didn't come through keeps
 * its code and shows an empty title rather than vanishing — the code is what
 * students navigate by.
 */
function toShell(raw: unknown): CourseShell | null {
  const row = record(raw);
  if (!row) return null;

  const enrollmentId = text(row["id"]);
  if (enrollmentId === null) return null;

  const course = embedded(row["course"]);
  if (!course) return null;
  const courseId = text(course["id"]);
  const code = text(course["code"]);
  if (courseId === null || code === null) return null;

  return {
    enrollmentId,
    courseId,
    code,
    title: text(course["title"]) ?? "",
    units: usableUnits(num(course["units"])),
    color: colorForCourse(text(row["color"]), code),
  };
}

/**
 * The whole semester: every active class with its own grade estimate, plus the
 * one number across all of them.
 *
 * **Three queries at most, never one per class.** A gradebook-per-course loop
 * would cost a student with eight classes eight round trips on a screen that
 * shows one number. Instead:
 *
 *   1. Active enrollments (`archived_at is null`) joined to their courses.
 *   2. Every grade category the student owns in those courses, in one `in(…)`.
 *   3. Every score inside those categories, in one `in(…)`.
 *
 * The later queries drop away when there's nothing to ask about: no active
 * classes returns after the first, no categories after the second.
 *
 * Then the grouping and the estimating happen on the phone, through the same
 * {@link courseEstimate} the single-course grade screen uses, so a class reads
 * the same number in both places.
 *
 * **Shelved classes are out.** Last quarter's grades are still there, still
 * private, still reachable from the course itself — but a finished class has
 * no business in this quarter's average, which is the whole point of shelving.
 *
 * Both list queries filter on `user_id` explicitly. The grade tables are
 * RLS self-only so nothing could leak, but `enrollments` lets a student read
 * their classmates' rows too, and a "mine" list should never lean on RLS to
 * stay mine.
 *
 * A student with no classes gets `{ courses: [], summary }` where the summary
 * invites them to add one — an empty state, not an error.
 *
 * @returns Classes ordered by course code, and the semester summary.
 * @throws {SemesterError} With copy that's ready to render.
 */
export async function fetchSemester(): Promise<Semester> {
  const userId = await requireUserId();

  const { data: enrollmentRows, error: enrollmentError } = await supabase
    .from("enrollments")
    .select(ENROLLMENT_SELECT)
    .eq("user_id", userId)
    .is("archived_at", null);
  if (enrollmentError) throw new SemesterError(LOAD_CLASSES_FAILED);

  const shells: CourseShell[] = [];
  for (const row of rows(enrollmentRows)) {
    const shell = toShell(row);
    if (shell) shells.push(shell);
  }
  if (shells.length === 0) {
    return { courses: [], summary: semesterEstimate([]) };
  }

  // Dedupe before the `in(…)`: a course only needs asking about once, however
  // many enrollment rows point at it.
  const courseIds = [...new Set(shells.map((shell) => shell.courseId))];

  const { data: categoryRows, error: categoryError } = await supabase
    .from("grade_categories")
    .select(CATEGORY_SELECT)
    .eq("user_id", userId)
    .in("course_id", courseIds);
  if (categoryError) throw new SemesterError(LOAD_GRADES_FAILED);

  const categoriesByCourse = new Map<string, CategoryWeight[]>();
  const categoryIds: string[] = [];
  for (const row of rows(categoryRows)) {
    const category = record(row);
    if (!category) continue;
    const id = text(category["id"]);
    const courseId = text(category["course_id"]);
    const weight = num(category["weight"]);
    if (id === null || courseId === null || weight === null) continue;
    categoryIds.push(id);
    const bucket = categoriesByCourse.get(courseId);
    if (bucket) bucket.push({ id, weight });
    else categoriesByCourse.set(courseId, [{ id, weight }]);
  }

  // Every category id in one lookup, then handed whole to each course's
  // estimate — `courseEstimate` only ever indexes the ids it was given.
  const entriesByCategory: Record<string, EntryScore[]> = {};
  if (categoryIds.length > 0) {
    const { data: entryRows, error: entryError } = await supabase
      .from("grade_entries")
      .select(ENTRY_SELECT)
      .eq("user_id", userId)
      .in("category_id", categoryIds);
    if (entryError) throw new SemesterError(LOAD_GRADES_FAILED);

    for (const row of rows(entryRows)) {
      const entry = record(row);
      if (!entry) continue;
      const categoryId = text(entry["category_id"]);
      const earned = num(entry["points_earned"]);
      const possible = num(entry["points_possible"]);
      if (categoryId === null || earned === null || possible === null) continue;
      // The database forbids a non-positive `points_possible`; drop it anyway
      // rather than hand `categoryScore` something it has to skip.
      if (possible <= 0) continue;
      const bucket = entriesByCategory[categoryId];
      const score: EntryScore = {
        points_earned: earned,
        points_possible: possible,
      };
      if (bucket) bucket.push(score);
      else entriesByCategory[categoryId] = [score];
    }
  }

  const courses: SemesterCourse[] = shells.map((shell) => {
    const categories = categoriesByCourse.get(shell.courseId) ?? [];
    const estimate = courseEstimate(categories, entriesByCategory);
    return {
      ...shell,
      categoryCount: categories.length,
      estimate,
      letter: letterFor(estimate.pct),
      gradePoint: gradePointFor(estimate.pct),
    };
  });
  courses.sort(byCode);

  return { courses, summary: semesterEstimate(courses) };
}

/* ═════════════════════════════ units ════════════════════════════════ */

/** The floor and ceiling `set_course_units` enforces server-side. */
export const UNITS_MIN = 0.5;
export const UNITS_MAX = 30;

/**
 * Read what a student typed into the units field as a number the RPC will
 * accept — or as null, which is a real value meaning "nobody's filled this
 * in", not a failure.
 *
 * Blank clears. Anything else has to be a number in range, because a units
 * figure the GPA is weighted by is worth refusing rather than guessing at.
 *
 * Pure.
 *
 * @param text Raw field contents.
 * @returns Units, or null to clear.
 * @throws {SemesterError} With copy that's ready to render.
 */
export function unitsFrom(text: string | null | undefined): number | null {
  const trimmed = (text ?? "").trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new SemesterError(
      "Units should be a number — 4, or 1.5. Leave it blank if you're not sure."
    );
  }
  const rounded = Math.round(parsed * 100) / 100;
  if (rounded < UNITS_MIN || rounded > UNITS_MAX) {
    throw new SemesterError(`Units run ${UNITS_MIN} to ${UNITS_MAX}.`);
  }
  return rounded;
}

/**
 * Set or clear a course's units, for anyone enrolled in it.
 *
 * This is a **shared** column — one number per course, not per student — so
 * filling it in fixes the semester GPA for the whole class, and clearing it
 * un-fixes it for the whole class too. That's the same bargain as the
 * instructor and room fields, and the screen says so before it offers the
 * field.
 *
 * Deliberately its own RPC rather than a fifth argument on the course-details
 * save: migration 0036 has the long version, but the short one is that a
 * student correcting a room number must never be able to blank the number the
 * GPA is weighted by.
 *
 * @param courseId The course to update.
 * @param units    Units, or null to clear.
 * @throws {SemesterError} With copy that's ready to render.
 */
export async function setCourseUnits(
  courseId: string,
  units: number | null
): Promise<void> {
  const { error } = await supabase.rpc("set_course_units", {
    p_course_id: courseId,
    p_units: units,
  });
  if (!error) return;
  if (error.message.includes("join the course")) {
    throw new SemesterError(
      "Units are kept by the class — add this course to your classes first."
    );
  }
  if (error.message.includes("units run")) {
    throw new SemesterError(`Units run ${UNITS_MIN} to ${UNITS_MAX}.`);
  }
  throw new SemesterError("We couldn't save those units just now. Try again.");
}
