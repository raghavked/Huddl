import { supabase } from "@/lib/supabase";

/* Course archiving — the data layer.
 *
 * SHELVING IS NOT DROPPING. Say it out loud, because the whole feature rests
 * on the difference:
 *
 *   Dropping a course DELETEs the enrollment row. The trigger takes the
 *   student out of the course channel, the chat disappears from their list,
 *   and the class is gone from their account.
 *
 *   Shelving a course only stamps `enrollments.archived_at`. The enrollment
 *   row survives. The `channel_members` row survives with it, so last
 *   quarter's chat stays reachable, notes stay readable, and every message
 *   the student ever sent is still theirs. Nothing here touches
 *   `channel_members`, and nothing here deletes anything — if you find
 *   yourself reaching for a delete while working on archiving, you are
 *   writing the drop path instead, and that already lives in the courses
 *   screen.
 *
 * Unshelving is the same stamp cleared back to null. A student can move a
 * class between the two shelves all day and lose nothing either way.
 *
 * Migration 0028 added the column and a partial index on
 * `(user_id) where archived_at is null`, so the active-courses read is the
 * cheap one. {@link fetchMyCourses} still pulls both shelves in a single
 * query and splits them on the phone: a student has a couple of dozen
 * enrollments at the very most, and one round trip means the courses screen
 * can say "4 shelved" without a second request.
 *
 * WHERE THIS GETS READ FROM
 * Every other surface that lists classes — the study plan, the calendar,
 * home, the course picker in focus sessions and grades — should read
 * **active courses only**. That is the entire point of the feature: a
 * finished class stops crowding this quarter. Those screens are not wired up
 * yet; that is the integration round's job, not this module's. This file
 * ships the query and the split, and hands `{ active, archived }` to
 * whoever asks.
 *
 * BACKEND GAP, READ BEFORE WIRING THE BUTTON
 * `public.enrollments` has RLS policies for SELECT, INSERT and DELETE, but
 * **no UPDATE policy** as of migration 0028. With RLS on and no UPDATE
 * policy, Postgres matches zero rows for the update: PostgREST reports no
 * error, it simply changes nothing. Both writes here therefore ask for the
 * changed row back and treat "no row" as a failure ({@link CourseArchiveError})
 * rather than reporting a success that never happened. Closing the gap is one
 * migration, and the tight version is a column grant so the policy cannot be
 * used to rewrite anything but the shelf:
 *
 *   revoke update on public.enrollments from authenticated;
 *   grant update (archived_at) on public.enrollments to authenticated;
 *
 *   create policy "students shelve their own enrollments"
 *     on public.enrollments for update
 *     to authenticated
 *     using (user_id = ( SELECT auth.uid() ))
 *     with check (user_id = ( SELECT auth.uid() ));
 *
 * Until that lands, {@link archiveCourse} and {@link unarchiveCourse} will
 * fail warmly every time, which is the honest behaviour.
 *
 * No React, no theme, no navigation in here — queries, narrowing, and one
 * pure grouping helper. Every failure arrives as a {@link CourseArchiveError}
 * whose message is warm, specific, and safe to drop straight into an inline
 * error.
 */

/* ══════════════════════════════ shapes ══════════════════════════════ */

/**
 * One of the student's enrollments with its course flattened onto it — the
 * exact shape a row on the courses screen renders, on either shelf.
 *
 * Flattened rather than nested because every caller wants all of it at once:
 * the code, the title, and which term it belonged to. Rows whose course can't
 * be read are dropped by the narrowing rather than handed over half-built.
 */
export type MyCourse = {
  /** `enrollments.id` — the id both writes in this module take. */
  enrollment_id: string;
  /** `courses.id`. What every other course surface keys off. */
  course_id: string;
  /** e.g. "ECS 36A". Lists are ordered by this. */
  code: string;
  /** e.g. "Programming & Problem Solving". */
  title: string;
  /** The term's name, e.g. "Fall 2025", or null when the course has no term. */
  term: string | null;
  /**
   * `terms.starts_on` as an ISO date ("2025-09-24"), or null. Carried purely
   * so {@link groupByTerm} can put the newest term first without guessing at
   * the name — see that function for the fallback when it's missing.
   */
  term_starts_on: string | null;
  /**
   * ISO timestamp the student shelved this class, or null while it's active.
   * The one field that decides which shelf the course sits on.
   */
  archived_at: string | null;
};

/**
 * The student's classes, split by shelf. Both lists are ordered by course
 * code; both can be empty.
 */
export type MyCourses = {
  /** This quarter's classes — `archived_at is null`. */
  active: MyCourse[];
  /** Shelved classes, newest term first once run through {@link groupByTerm}. */
  archived: MyCourse[];
};

/** A term's worth of courses, as {@link groupByTerm} hands them back. */
export type TermGroup<T = MyCourse> = {
  /** The term's name, or {@link EARLIER_TERM} for courses without one. */
  term: string;
  /** The courses in that term, in the order they arrived. */
  courses: T[];
};

/** The minimum a course needs to carry to be grouped by term. */
type Termed = Pick<MyCourse, "term" | "term_starts_on">;

/* ══════════════════════════════ limits ══════════════════════════════ */

/**
 * Where courses with no term land. A real bucket with a real name, not a
 * blank header: a class that arrived by schedule photo may never have been
 * matched to a term, and "Earlier" is truthful about it — it's shelved, so it
 * is by definition behind you.
 */
export const EARLIER_TERM = "Earlier";

/** Columns the courses read selects. Keep selects consistent. */
export const MY_COURSES_SELECT =
  "id, archived_at, course:courses(id, code, title, term:terms(name, starts_on))";

/* ═════════════════════════════ failures ═════════════════════════════ */

/**
 * A course-archiving failure with a message written for a person, not a log.
 * Show `err.message` directly in your inline error — it never leaks SQL, ids,
 * or PostgREST codes.
 */
export class CourseArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CourseArchiveError";
  }
}

/** What a shelve that changed nothing says. See the backend note up top. */
const SHELVE_FAILED =
  "We couldn't shelve that class just now. Give it another go.";

/** What an unshelve that changed nothing says. */
const UNSHELVE_FAILED =
  "We couldn't bring that class back just now. Give it another go.";

/* ═════════════════════════════ narrowing ════════════════════════════ */

/**
 * An embedded relation comes back as an object OR a one-element array
 * depending on how PostgREST resolves it, and sometimes as null. Unwrap both
 * shapes to a plain record. Same defence as `@/lib/study-buddy` and
 * `@/lib/focus`.
 */
function embedded(raw: unknown): Record<string, unknown> | null {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

/** A trimmed string, or null when it's missing, blank, or the wrong type. */
function optionalText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Narrow one joined enrollment row into a {@link MyCourse}. Returns null when
 * the row is missing something a course row can't be drawn without — the
 * enrollment id, the course, its id, or its code. A course with no readable
 * title keeps its code and shows an empty title rather than vanishing, since
 * the code is what students actually navigate by.
 */
function toMyCourse(raw: unknown): MyCourse | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const enrollmentId = record["id"];
  if (typeof enrollmentId !== "string" || enrollmentId.length === 0) {
    return null;
  }

  const course = embedded(record["course"]);
  if (!course) return null;
  const courseId = course["id"];
  if (typeof courseId !== "string" || courseId.length === 0) return null;
  const code = optionalText(course["code"]);
  if (code === null) return null;

  const term = embedded(course["term"]);

  return {
    enrollment_id: enrollmentId,
    course_id: courseId,
    code,
    title: optionalText(course["title"]) ?? "",
    term: term ? optionalText(term["name"]) : null,
    term_starts_on: term ? optionalText(term["starts_on"]) : null,
    archived_at: optionalText(record["archived_at"]),
  };
}

/**
 * Course codes sort like a human reads them: "ECS 36A" before "ECS 122A", not
 * after it, so the numeric collation matters. If a runtime ships without full
 * Intl the options are ignored and it degrades to a plain string compare,
 * which is still stable. Ties fall through to the title and then the id so
 * the order never jitters between refreshes.
 */
function byCode(a: MyCourse, b: MyCourse): number {
  return (
    a.code.localeCompare(b.code, undefined, {
      numeric: true,
      sensitivity: "base",
    }) ||
    a.title.localeCompare(b.title) ||
    a.enrollment_id.localeCompare(b.enrollment_id)
  );
}

/* ════════════════════════════════ auth ══════════════════════════════ */

/**
 * The caller's `profiles.id`, read from the stored session (no network hop —
 * supabase-js refreshes the token itself when it's stale).
 *
 * @throws {CourseArchiveError} When nobody's signed in.
 */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (error || typeof id !== "string" || id.length === 0) {
    throw new CourseArchiveError("Sign in again to see your classes.");
  }
  return id;
}

/* ═══════════════════════════════ reads ══════════════════════════════ */

/**
 * Every class the student is in, split into `{ active, archived }` and each
 * side ordered by course code.
 *
 * One query, split on the phone. The SELECT policy on `enrollments` also lets
 * a student see their classmates' rows, so this filters on `user_id`
 * explicitly — never rely on RLS alone to scope a "mine" list.
 *
 * A student with no classes yet gets two empty arrays, not an error: that's an
 * empty state inviting them to add their first course, and the courses screen
 * should render it as one.
 *
 * @returns Both shelves, code-ordered. Pass `archived` to
 *   {@link groupByTerm} for the shelved view.
 * @throws {CourseArchiveError} With copy that's ready to render.
 */
export async function fetchMyCourses(): Promise<MyCourses> {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from("enrollments")
    .select(MY_COURSES_SELECT)
    .eq("user_id", userId);
  if (error) {
    throw new CourseArchiveError(
      "We couldn't load your classes. Check your connection and give it another go."
    );
  }
  if (!Array.isArray(data)) return { active: [], archived: [] };

  const active: MyCourse[] = [];
  const archived: MyCourse[] = [];
  for (const row of data) {
    const course = toMyCourse(row);
    if (!course) continue;
    if (course.archived_at === null) active.push(course);
    else archived.push(course);
  }

  return { active: active.sort(byCode), archived: archived.sort(byCode) };
}

/* ══════════════════════════════ writes ══════════════════════════════ */

/**
 * Stamp or clear `archived_at` on one of the caller's own enrollments.
 *
 * Scoped by `user_id` as well as `id` so a stale id from another account can
 * never be touched, and asks for the changed row back: with no UPDATE policy
 * on `enrollments` a refused write returns zero rows and no error, and a
 * silent no-op that renders as success is the one outcome worse than a
 * failure. No row back means the write didn't happen — say so.
 *
 * @param enrollmentId `enrollments.id` to move.
 * @param value        ISO timestamp to shelve, or null to bring it back.
 * @param failure      The sentence to throw if nothing changed.
 * @returns The stored `archived_at`, exactly as the database now has it.
 * @throws {CourseArchiveError} With copy that's ready to render.
 */
async function setArchivedAt(
  enrollmentId: string,
  value: string | null,
  failure: string
): Promise<string | null> {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from("enrollments")
    .update({ archived_at: value })
    .eq("id", enrollmentId)
    .eq("user_id", userId)
    .select("id, archived_at")
    .maybeSingle();
  if (error) throw new CourseArchiveError(failure);

  // No row came back: RLS refused the update, or the enrollment is gone
  // (dropped on another device). Either way nothing moved.
  if (typeof data !== "object" || data === null) {
    throw new CourseArchiveError(failure);
  }
  return optionalText((data as Record<string, unknown>)["archived_at"]);
}

/**
 * Shelve a finished class.
 *
 * This is shelving, not dropping. The enrollment row stays, the student stays
 * in the course channel, and the chat, the notes and the calendar history all
 * stay reachable — the class simply stops appearing in this quarter's lists.
 * Nothing is deleted, and nothing about it is announced to anyone.
 *
 * Shelving something already shelved quietly re-stamps the timestamp rather
 * than failing, so a second tap on a stale screen is harmless.
 *
 * Safe to run optimistically: move the course to the archived list with
 * `archived_at` set to now, call this, and move it back if it throws.
 *
 * @param enrollmentId `enrollments.id` — {@link MyCourse.enrollment_id}, not
 *   the course id.
 * @returns The stored shelved-at timestamp, for reconciling the optimistic row.
 * @throws {CourseArchiveError} With copy that's ready to render.
 */
export async function archiveCourse(enrollmentId: string): Promise<string> {
  const stamped = await setArchivedAt(
    enrollmentId,
    new Date().toISOString(),
    SHELVE_FAILED
  );
  // The column is set, so a null back means the row didn't take the stamp.
  if (stamped === null) throw new CourseArchiveError(SHELVE_FAILED);
  return stamped;
}

/**
 * Bring a shelved class back to this quarter's lists by clearing
 * `archived_at`.
 *
 * The mirror of {@link archiveCourse}, and just as lossless: nothing was
 * removed on the way in, so nothing has to be rebuilt on the way out. The
 * channel membership was never dropped, so the chat is exactly where it was.
 *
 * Unshelving something already active quietly succeeds — the student's intent
 * ("this class is current") already holds.
 *
 * Safe to run optimistically: move the course to the active list, call this,
 * and put it back on the shelf if it throws.
 *
 * @param enrollmentId `enrollments.id` — {@link MyCourse.enrollment_id}, not
 *   the course id.
 * @throws {CourseArchiveError} With copy that's ready to render.
 */
export async function unarchiveCourse(enrollmentId: string): Promise<void> {
  await setArchivedAt(enrollmentId, null, UNSHELVE_FAILED);
}

/* ═══════════════════════════ pure helpers ═══════════════════════════ */

/** Where each quarter/semester falls in a calendar year, for name parsing. */
const SEASON_MONTH: ReadonlyArray<readonly [RegExp, number]> = [
  [/\bwinter\b/i, 0],
  [/\bspring\b/i, 2],
  [/\bsummer\b/i, 5],
  [/\bfall\b|\bautumn\b/i, 8],
];

/**
 * How recent a term is, as a sortable number. Prefers `terms.starts_on`,
 * which is authoritative; falls back to reading a year (and a season, if it
 * finds one) out of the term's name for rows where the date didn't come
 * through. A term we can place nowhere sorts below every term we can, but
 * still above {@link EARLIER_TERM}.
 */
function termRecency(term: string, startsOn: string | null): number {
  if (startsOn !== null) {
    const parsed = Date.parse(startsOn);
    if (Number.isFinite(parsed)) return parsed;
  }
  const year = /\b(19|20)\d{2}\b/.exec(term);
  if (!year) return Number.NEGATIVE_INFINITY;
  const month = SEASON_MONTH.find(([pattern]) => pattern.test(term))?.[1] ?? 0;
  return Date.UTC(Number(year[0]), month, 1);
}

/** Newest first, with equal keys (including two unplaceable terms) held. */
function byRecency(a: number, b: number): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

/**
 * Group a course list under term names for the shelved view: "Fall 2025",
 * then "Spring 2025", then "Winter 2025", and finally "Earlier" for anything
 * with no term at all.
 *
 * Newest term first, because the class you shelved in June is the one you're
 * most likely to be digging back into. Recency comes from `term_starts_on`
 * where it's there and from the term's name where it isn't; terms we can't
 * place at all keep a stable alphabetical order at the bottom, and
 * {@link EARLIER_TERM} is always last no matter how many courses are in it.
 *
 * Course order inside each group is left exactly as it arrived — hand it the
 * `archived` list from {@link fetchMyCourses} and each term stays sorted by
 * course code. Empty groups are never produced, so `groups.length === 0`
 * means the shelf is empty and the screen should show its empty state.
 *
 * Pure: no I/O, no clock, no theme. Deterministic for any input.
 *
 * @param courses Any courses carrying a term and its start date.
 * @returns One group per term, newest first, "Earlier" last.
 */
export function groupByTerm<T extends Termed>(
  courses: readonly T[]
): TermGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const course of courses) {
    const name = course.term ?? EARLIER_TERM;
    const bucket = buckets.get(name);
    if (bucket) bucket.push(course);
    else buckets.set(name, [course]);
  }

  // Key each group once, so a term is dated rather than re-parsed per compare.
  type Keyed = { group: TermGroup<T>; earlier: boolean; recency: number };
  const keyed: Keyed[] = [];
  for (const [term, grouped] of buckets) {
    // Any course in the term can carry the date — take the first that does,
    // so one row with a missing embed doesn't misdate the whole group.
    const dated = grouped.find((course) => course.term_starts_on !== null);
    keyed.push({
      group: { term, courses: grouped },
      earlier: term === EARLIER_TERM,
      recency: termRecency(term, dated?.term_starts_on ?? null),
    });
  }

  return keyed
    .sort((a, b) => {
      // "Earlier" is a bucket, not a term — it sinks past every real one.
      if (a.earlier !== b.earlier) return a.earlier ? 1 : -1;
      return (
        byRecency(a.recency, b.recency) ||
        a.group.term.localeCompare(b.group.term)
      );
    })
    .map((entry) => entry.group);
}
