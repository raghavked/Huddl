import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { computeDayStreak } from "@/lib/study-plan";
import { supabase } from "@/lib/supabase";

/* Focus sessions — "studying now" — as a data layer.
 *
 * A focus session is one student sitting down to work: a goal in minutes, an
 * optional course, an optional one-line note about what they're doing. While
 * `ended_at` is null the row is OPEN, and open rows are the campus's
 * "studying now" list — proof that nobody's grinding alone at 11pm. Closed
 * rows are the quiet history behind the streak.
 *
 * Migration 0028 created `focus_sessions` with two policies: campus-scoped
 * SELECT (anyone at your university sees open and closed rows for people at
 * that university) and self-only writes. It's also in the realtime
 * publication, so {@link subscribeStudyingNow} works without any extra setup.
 *
 * Two migrations have narrowed that read since. 0031 made CLOSED sessions
 * private to their owner — a study history is nobody's business — and 0040
 * added `is_private`, which keeps an OPEN one off the campus list too. Both
 * are read-side only: a private session runs, ticks and counts toward the
 * streak exactly like any other, it simply isn't in anyone else's query.
 * Nothing in this file has to filter for either, because the SELECT policy
 * already does — {@link fetchStudyingNow} never sees a row it shouldn't.
 *
 * Everything here is either a query or a pure function — no React, no theme,
 * no navigation. The I/O functions read the clock; the pure ones take `now`
 * as an argument so a ticking screen and a unit test get the same answers.
 * Failures arrive as a {@link FocusError} whose message is warm, specific,
 * and safe to drop straight into an inline error.
 */

/* ------------------------------ shapes ------------------------------ */

/** One `focus_sessions` row, exactly as the table stores it. */
export type FocusSession = {
  /** `focus_sessions.id`. */
  id: string;
  /** Whose session it is (`profiles.id`). */
  user_id: string;
  /** The course they're working on, or null for "just studying". */
  course_id: string | null;
  /** How long they meant to sit for, 5-240 minutes. */
  goal_minutes: number;
  /** Their one-line "what are you on?", up to 80 characters, or null. */
  note: string | null;
  /** ISO timestamp they sat down. */
  started_at: string;
  /** ISO timestamp they stood up, or null while the session is open. */
  ended_at: string | null;
  /**
   * True when this session is being timed off the campus list: nobody else
   * ever sees the row, open or closed. The owner still does, and it still
   * counts toward their streak. Always false on a row that reached you
   * through {@link fetchStudyingNow} — a private session of somebody else's
   * is not readable at all.
   */
  is_private: boolean;
};

/** Just enough of a person to render a row and an avatar. */
export type FocusPerson = {
  /** `profiles.id`. */
  id: string;
  /**
   * What to call them. Their display name — or, for a student whose profile
   * is private, their handle. See {@link toFocusPerson}: a private profile
   * never lends its real name to this list.
   */
  display_name: string;
  /** Their handle, without the leading `@`. */
  handle: string;
  /** Their avatar, or null — fall back to initials via `@/components/avatar`. */
  avatar_url: string | null;
};

/**
 * An open session with the two things a list row needs attached: who it is,
 * and which class (if any) they're in.
 */
export type StudyingNow = FocusSession & {
  /** The student behind the session. Rows without a readable profile are dropped. */
  person: FocusPerson;
  /** e.g. "ECS 36A", or null when the session isn't tied to a course. */
  course_code: string | null;
};

/** What {@link subscribeStudyingNow} hands its listener on every change. */
export type FocusChange = {
  /** `"INSERT"` — someone just sat down. `"UPDATE"` — usually someone standing up. */
  event: "INSERT" | "UPDATE";
  /**
   * The row as the database now has it. Realtime payloads are bare table
   * rows: there's no profile or course code attached, so a list that shows
   * names should refetch via {@link fetchStudyingNow} rather than splice
   * this in.
   */
  session: FocusSession;
};

/* ------------------------------ limits ------------------------------ */

/** Shortest sitting the database accepts, in minutes. */
export const FOCUS_GOAL_MIN = 5;

/** Longest sitting the database accepts, in minutes. */
export const FOCUS_GOAL_MAX = 240;

/** What we start the picker on — one pomodoro, same as the column default. */
export const FOCUS_GOAL_DEFAULT = 25;

/**
 * Suggested goals for a picker, so every surface offers the same rungs. Five
 * steps: a short sit, a pomodoro, then the two class-adjacent blocks a quarter
 * actually runs on (a 45 and an hour), then the long one. The database accepts
 * anything from {@link FOCUS_GOAL_MIN} to {@link FOCUS_GOAL_MAX} and
 * {@link startFocus} clamps, so these are rungs, not rules.
 */
export const FOCUS_GOAL_PRESETS: readonly number[] = [15, 25, 45, 60, 90];

/** Longest note the database accepts — cap your TextInput here. */
export const FOCUS_NOTE_MAX = 80;

/** Most rows {@link fetchStudyingNow} will ever return. */
export const STUDYING_NOW_LIMIT = 50;

/** Columns every focus query selects. Keep selects consistent. */
export const FOCUS_SELECT =
  "id, user_id, course_id, goal_minutes, note, started_at, ended_at, is_private";

/**
 * {@link FOCUS_SELECT} plus the person and the course code, for the list.
 *
 * `is_public` rides along because "studying now" is a campus-wide list and a
 * private profile must not go out on it under its real name — see
 * {@link toFocusPerson}. The profiles SELECT policy is campus-scoped and says
 * nothing about `is_public` (migration 0012 leaves the redaction to the app),
 * so if this column isn't asked for, nothing else stops the name going out.
 */
const STUDYING_NOW_SELECT = `${FOCUS_SELECT}, person:profiles(id, display_name, handle, avatar_url, is_public), course:courses(code)`;

/* ----------------------------- failures ----------------------------- */

/**
 * A focus-session failure with a message written for a person, not a log.
 * Show `err.message` directly in your inline error — it never leaks SQL,
 * ids, or PostgREST codes.
 */
export class FocusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FocusError";
  }
}

/* ---------------------------- narrowing ----------------------------- */

/**
 * The Supabase client here is untyped, so every result comes back as `any`.
 * Narrow one row into a {@link FocusSession}, or null if it's missing the
 * fields we promise callers — better an honest null than a half-row.
 */
function toFocusSession(raw: unknown): FocusSession | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = record["id"];
  const userId = record["user_id"];
  const startedAt = record["started_at"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof userId !== "string" || userId.length === 0) return null;
  if (typeof startedAt !== "string" || startedAt.length === 0) return null;
  const courseId = record["course_id"];
  const goalMinutes = record["goal_minutes"];
  const note = record["note"];
  const endedAt = record["ended_at"];
  return {
    id,
    user_id: userId,
    course_id: typeof courseId === "string" ? courseId : null,
    goal_minutes:
      typeof goalMinutes === "number" && Number.isFinite(goalMinutes)
        ? goalMinutes
        : FOCUS_GOAL_DEFAULT,
    note: typeof note === "string" && note.length > 0 ? note : null,
    started_at: startedAt,
    ended_at: typeof endedAt === "string" && endedAt.length > 0 ? endedAt : null,
    /* Only a literal `true` counts as private, so a select that forgot the
       column reads as visible. That is the safe direction here and the
       opposite of `toFocusPerson` above: this flag decides what the screen
       TELLS a student about who can see them, and the lie that costs
       something is "nobody can see this" over a row the campus can. */
    is_private: record["is_private"] === true,
  };
}

/**
 * An embedded relation comes back as an object OR a one-element array
 * depending on how PostgREST resolves it, and sometimes as null. Unwrap both
 * shapes to a plain record. Same defence as `@/lib/group-dm`.
 */
function embedded(raw: unknown): Record<string, unknown> | null {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

/**
 * Narrow an embedded `profiles` row; null when it's unreadable.
 *
 * A student with Public profile turned off comes back under their handle
 * rather than their name — exactly the redaction the board (`lib/board.ts`),
 * study buddies (`lib/study-buddy.ts`), campus search and the people
 * directory already apply, down to keeping the avatar. They still appear:
 * being heads-down is the one thing a focus session says about you, and the
 * privacy screen says so. Their real name is not part of that.
 *
 * Anything other than a literal `true` counts as private, so a select that
 * forgets the column redacts rather than leaks.
 *
 * There is no "except me" here on purpose: {@link fetchStudyingNow}'s callers
 * all drop their own row (you are the timer at the top of the screen, not an
 * entry in the list) and read their own session through
 * {@link fetchMyOpenSession}, which never goes through this function.
 */
function toFocusPerson(raw: unknown): FocusPerson | null {
  const record = embedded(raw);
  if (!record) return null;
  const id = record["id"];
  const handle = record["handle"];
  const displayName = record["display_name"];
  const avatarUrl = record["avatar_url"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof handle !== "string" || handle.length === 0) return null;
  const isPublic = record["is_public"] === true;
  return {
    id,
    handle,
    display_name:
      isPublic && typeof displayName === "string" && displayName.length > 0
        ? displayName
        : handle,
    avatar_url: typeof avatarUrl === "string" ? avatarUrl : null,
  };
}

/**
 * Narrow a joined "studying now" row. Rows whose session or profile can't be
 * read are dropped rather than rendered as a mystery — a missing course code
 * is fine (the session may not have a course), a missing person is not.
 */
function toStudyingNow(raw: unknown): StudyingNow | null {
  const session = toFocusSession(raw);
  if (!session) return null;
  const record = raw as Record<string, unknown>;
  const person = toFocusPerson(record["person"]);
  if (!person) return null;
  const course = embedded(record["course"]);
  const code = course?.["code"];
  return {
    ...session,
    person,
    course_code: typeof code === "string" && code.length > 0 ? code : null,
  };
}

/* ---------------------------- validation ---------------------------- */

/**
 * Round a requested goal to whole minutes and clamp it into the 5-240 window
 * the database enforces, so a slider that overshoots never costs a round
 * trip. Nonsense (NaN, Infinity) falls back to the 25-minute default.
 */
function cleanGoalMinutes(goalMinutes: number | undefined): number {
  if (goalMinutes === undefined || !Number.isFinite(goalMinutes)) {
    return FOCUS_GOAL_DEFAULT;
  }
  const whole = Math.round(goalMinutes);
  return Math.min(Math.max(whole, FOCUS_GOAL_MIN), FOCUS_GOAL_MAX);
}

/** Trim a note to the 80-character limit; blank becomes null, not "". */
function cleanNote(note: string | undefined | null): string | null {
  const trimmed = (note ?? "").trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, FOCUS_NOTE_MAX);
}

/**
 * The caller's `profiles.id`, read from the stored session (no network hop —
 * supabase-js refreshes the token itself when it's stale).
 *
 * @throws {FocusError} When nobody's signed in.
 */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (error || typeof id !== "string" || id.length === 0) {
    throw new FocusError("Sign in again to start a focus session.");
  }
  return id;
}

/* ------------------------------ writes ------------------------------ */

/**
 * Close every open session belonging to `userId`. Used by
 * {@link startFocus} — a student can only sit down once, so starting a new
 * session tidies up whatever the last one left open (an app that got killed
 * mid-session, a session started on another device).
 *
 * Quiet on failure: the new session matters more than the old one's
 * bookkeeping, and the next start will try again.
 */
async function closeOpenSessions(userId: string, endedAt: string): Promise<void> {
  await supabase
    .from("focus_sessions")
    .update({ ended_at: endedAt })
    .eq("user_id", userId)
    .is("ended_at", null);
}

/**
 * Sit down to study. Closes any session the caller left open, then opens a
 * fresh one — which, unless `isPrivate` is set, is immediately visible to the
 * whole campus in {@link fetchStudyingNow}, so the copy around this button
 * should say so.
 *
 * The goal is rounded and clamped to 5-240 minutes and the note trimmed to
 * 80 characters before the insert, so the database's checks are a backstop
 * rather than an error path students ever see.
 *
 * @param opts.courseId    The course they're working on, or omit for none.
 * @param opts.goalMinutes How long they mean to sit; defaults to 25.
 * @param opts.note        A one-line "what are you on?", up to 80 characters.
 * @param opts.isPrivate   True times the session off the campus list: the
 *   row stays the caller's alone, and their name, class and note never go
 *   out. The timer and the streak are untouched. Defaults to false, which is
 *   the column default and how every session behaved before 0040.
 * @returns The new open session — pass it straight to the timer helpers.
 * @throws {FocusError} With copy that's ready to render.
 */
export async function startFocus({
  courseId,
  goalMinutes,
  note,
  isPrivate,
}: {
  courseId?: string | null;
  goalMinutes?: number;
  note?: string | null;
  isPrivate?: boolean;
} = {}): Promise<FocusSession> {
  const userId = await requireUserId();
  await closeOpenSessions(userId, new Date().toISOString());

  const { data, error } = await supabase
    .from("focus_sessions")
    .insert({
      user_id: userId,
      course_id: courseId ?? null,
      goal_minutes: cleanGoalMinutes(goalMinutes),
      note: cleanNote(note),
      // Sent explicitly rather than left to the column default: a caller
      // that asked for private and got a row without the column back should
      // fail loudly here, not discover it on the campus list.
      is_private: isPrivate === true,
    })
    .select(FOCUS_SELECT)
    .single();

  const session = error ? null : toFocusSession(data);
  if (!session) {
    throw new FocusError("We couldn't start that session. Give it another go.");
  }
  return session;
}

/**
 * Stand up: stamp `ended_at` on an open session so it leaves the "studying
 * now" list and joins the history behind the streak.
 *
 * Only touches rows that are still open, so double-tapping "I'm done" can't
 * move a session's end time. Ending a session that's already closed — or one
 * that isn't yours, which RLS hides — resolves with null rather than
 * throwing: the student's intent ("I'm not studying anymore") already holds.
 *
 * @param sessionId The session's `focus_sessions.id`.
 * @returns The closed row, or null if there was nothing open to close.
 * @throws {FocusError} With copy that's ready to render.
 */
export async function endFocus(sessionId: string): Promise<FocusSession | null> {
  const { data, error } = await supabase
    .from("focus_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", sessionId)
    .is("ended_at", null)
    .select(FOCUS_SELECT)
    .maybeSingle();
  if (error) {
    throw new FocusError("We couldn't close that session. Give it another go.");
  }
  return toFocusSession(data);
}

/* ------------------------------ reads ------------------------------- */

/**
 * The caller's own open session, or null when they're not sitting down.
 * Call it on mount to decide between "start studying" and a live timer.
 *
 * There should only ever be one open row per person ({@link startFocus}
 * enforces that), but the newest wins if an old device left a stray behind.
 *
 * @throws {FocusError} With copy that's ready to render.
 */
export async function fetchMyOpenSession(): Promise<FocusSession | null> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("focus_sessions")
    .select(FOCUS_SELECT)
    .eq("user_id", userId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new FocusError("We couldn't check your focus session just now.");
  }
  return toFocusSession(data);
}

/**
 * Everyone on campus who's studying right now — open sessions only, newest
 * first, capped at 50, each with the student's profile and their course code
 * attached. RLS already limits this to your university, so there's no campus
 * filter to pass.
 *
 * Students with Public profile off come back under their handle rather than
 * their name — see {@link toFocusPerson}. Your own row is in here too;
 * callers drop it.
 *
 * @param courseIds Optionally narrow to these courses (e.g. the student's own
 *   enrolments, for a "your classes" tab). Sessions with no course are
 *   excluded when this is given. Passing an empty array means "no courses"
 *   and returns `[]` without a round trip. Omit it for the whole campus.
 * @throws {FocusError} With copy that's ready to render.
 */
export async function fetchStudyingNow(
  courseIds?: readonly string[]
): Promise<StudyingNow[]> {
  if (courseIds !== undefined && courseIds.length === 0) return [];

  let query = supabase
    .from("focus_sessions")
    .select(STUDYING_NOW_SELECT)
    .is("ended_at", null);
  if (courseIds !== undefined) {
    query = query.in("course_id", [...courseIds]);
  }

  const { data, error } = await query
    .order("started_at", { ascending: false })
    .limit(STUDYING_NOW_LIMIT);
  if (error) {
    throw new FocusError("We couldn't see who's studying right now.");
  }
  if (!Array.isArray(data)) return [];

  const out: StudyingNow[] = [];
  for (const row of data) {
    const session = toStudyingNow(row);
    if (session) out.push(session);
  }
  return out;
}

/* ---------------------------- realtime ------------------------------ */

/** Channel topics must be unique per subscription, so number them. */
let channelSeq = 0;

/**
 * Watch the campus sit down and stand up. Fires `onChange` on every INSERT
 * (someone started) and UPDATE (almost always someone finishing) on
 * `focus_sessions`. The table is in the realtime publication and its SELECT
 * policy is campus-scoped, so the socket only ever delivers rows the caller
 * is already allowed to read — no filter needed here.
 *
 * Payloads are bare table rows with no profile or course attached. The
 * simplest correct listener refetches:
 *
 * ```ts
 * useEffect(() => subscribeStudyingNow(() => void refresh()), [refresh]);
 * ```
 *
 * @param onChange Called with the event and the row as it now stands.
 * @returns An unsubscribe function — return it straight from a `useEffect`.
 */
export function subscribeStudyingNow(
  onChange: (change: FocusChange) => void
): () => void {
  channelSeq += 1;
  const handle = (
    event: "INSERT" | "UPDATE",
    payload: RealtimePostgresChangesPayload<Record<string, unknown>>
  ): void => {
    const session = toFocusSession(payload.new);
    if (session) onChange({ event, session });
  };

  const channel = supabase
    .channel(`focus-sessions:${channelSeq}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "focus_sessions" },
      (payload) => handle("INSERT", payload)
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "focus_sessions" },
      (payload) => handle("UPDATE", payload)
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

/* --------------------------- pure helpers --------------------------- */

const MINUTE_MS = 60 * 1000;

/** When a session's clock stops: its end, or `now` while it's still open. */
function endMoment(
  session: Pick<FocusSession, "ended_at">,
  now: Date
): number {
  if (session.ended_at === null) return now.getTime();
  const ended = new Date(session.ended_at).getTime();
  return Number.isNaN(ended) ? now.getTime() : ended;
}

/**
 * Whole minutes spent so far — measured to `ended_at` on a closed session and
 * to `now` on an open one. Floored (a session 24 minutes 50 seconds in reads
 * "24m", not "25m") and never negative, so a phone clock that's drifted
 * behind the server can't produce a session that started in the future.
 *
 * Pure: pass the moment in, from a state tick or a test.
 */
export function elapsedMinutes(
  session: Pick<FocusSession, "started_at" | "ended_at">,
  now: Date
): number {
  const started = new Date(session.started_at).getTime();
  if (Number.isNaN(started)) return 0;
  const elapsed = endMoment(session, now) - started;
  return Math.max(0, Math.floor(elapsed / MINUTE_MS));
}

/**
 * Whole minutes left against the session's goal, clamped at 0 — a session
 * that's run past its goal reads "0m left", never a negative number.
 *
 * Defined as `goal_minutes − elapsedMinutes`, so elapsed and remaining always
 * add up to the goal until the goal passes.
 *
 * Pure: pass the moment in.
 */
export function remainingMinutes(
  session: Pick<FocusSession, "started_at" | "ended_at" | "goal_minutes">,
  now: Date
): number {
  return Math.max(0, session.goal_minutes - elapsedMinutes(session, now));
}

/**
 * How far through the goal this session is, from 0 to 1 — for a progress ring
 * or bar. Computed from raw milliseconds rather than whole minutes so the
 * ring moves smoothly instead of jumping once a minute, and clamped at both
 * ends. A session with a nonsensical goal (0 or less, which the database
 * won't allow) reads as complete.
 *
 * Pure: pass the moment in.
 */
export function progress(
  session: Pick<FocusSession, "started_at" | "ended_at" | "goal_minutes">,
  now: Date
): number {
  const goalMs = session.goal_minutes * MINUTE_MS;
  if (!(goalMs > 0)) return 1;
  const started = new Date(session.started_at).getTime();
  if (Number.isNaN(started)) return 0;
  const elapsed = endMoment(session, now) - started;
  return Math.min(Math.max(elapsed / goalMs, 0), 1);
}

/**
 * Minutes as a human would say them: `25` → "25m", `60` → "1h",
 * `70` → "1h 10m", `0` → "0m". Rounds to whole minutes and treats anything
 * negative or non-finite as 0, so a formatter never renders "NaNm".
 *
 * Pure.
 */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0m";
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/**
 * The focus streak: consecutive local calendar days, ending today or
 * yesterday, on which the student finished at least one session.
 *
 * Only COMPLETED sessions count, keyed by the day they ended: an open session
 * hasn't been a session yet, and a student mid-sitting shouldn't see the
 * streak flicker. That's all this adds — the day arithmetic itself is
 * {@link computeDayStreak} in `@/lib/study-plan`, which check-offs use too, so
 * the two streaks can never disagree about what a day is or about yesterday
 * still counting as alive.
 *
 * Pure: feed it whatever rows you've loaded (order doesn't matter) plus a
 * `now`, and it hands back a day count. Stay quiet below 2 — no guilt UI.
 *
 * @param sessions Any sessions at all; open ones are ignored.
 * @param now      The current moment — passed in, never read from the clock.
 */
export function computeFocusStreak(
  sessions: Iterable<Pick<FocusSession, "ended_at">>,
  now: Date
): number {
  const endings: (string | null)[] = [];
  for (const session of sessions) endings.push(session.ended_at);
  return computeDayStreak(endings, now);
}
