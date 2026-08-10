import { supabase } from "@/lib/supabase";

/* Study buddies — the data layer.
 *
 * One row in `study_buddy_optins` means "I'm in ECS 36A and I'd study with
 * someone." That's the whole feature: a per-course opt-in with an optional
 * 140-character note about how you like to work. Opting out is a DELETE, not
 * a flag — once a student takes their name down there is nothing left behind
 * that says they were ever looking.
 *
 * Migration 0028 created the table with two policies:
 *
 *   SELECT — `is_enrolled(course_id)`. Only classmates in that course can see
 *            who's looking. Nobody browses the list from outside the class.
 *   ALL    — `user_id = auth.uid()` with an added `is_enrolled(course_id)` on
 *            the WITH CHECK, so you can only put your own name up, and only
 *            in a class you're actually in.
 *
 * That second half is the one failure students will actually hit: tapping
 * "find a study partner" on a course they haven't added yet comes back as a
 * bare RLS refusal (PostgREST `42501`), which we translate into a sentence
 * that names the fix. See {@link ENROLL_FIRST}.
 *
 * No React, no theme, no navigation in here — queries, narrowing, and one
 * length check. Every failure arrives as a {@link StudyBuddyError} whose
 * message is warm, specific, and safe to drop straight into an inline error.
 */

/* ------------------------------ shapes ------------------------------ */

/**
 * One `study_buddy_optins` row with the classmate's profile attached — the
 * exact shape a "who's looking" list row renders.
 *
 * The profile is flattened rather than nested because every caller wants all
 * of it: the avatar, the name, and the "Computer science · '27" line under
 * it. Rows whose profile can't be read are dropped by the narrowing rather
 * than handed over half-built.
 */
export type StudyBuddy = {
  /** The classmate's `profiles.id`. Also the row's identity — one per person. */
  user_id: string;
  /** `courses.id` they opted in for. */
  course_id: string;
  /** Their note on how they like to study, up to 140 characters, or null. */
  note: string | null;
  /** ISO timestamp they put their name up. Newest first in the list. */
  created_at: string;
  /** Their handle, without the leading `@`. */
  handle: string;
  /** Their display name, falling back to their handle if it's somehow blank. */
  display_name: string;
  /** Their avatar, or null — fall back to initials via `@/components/avatar`. */
  avatar_url: string | null;
  /** Their major, e.g. "Computer science", or null if they haven't said. */
  major: string | null;
  /** Their graduating year, e.g. 2027, or null if they haven't said. */
  grad_year: number | null;
  /** True on the caller's own row — {@link fetchBuddies} sorts it to the top. */
  is_me: boolean;
};

/**
 * The caller's own opt-in for a course: just the note and when they put it
 * up. Null from {@link fetchMyOptIn} means they aren't looking in that class.
 */
export type MyOptIn = {
  /** `courses.id`. */
  course_id: string;
  /** Their note, up to 140 characters, or null if they didn't write one. */
  note: string | null;
  /** ISO timestamp they put their name up. */
  created_at: string;
};

/* ------------------------------ limits ------------------------------ */

/**
 * Longest note the database accepts (`char_length(note) <= 140`). Cap your
 * TextInput here so the counter and the check constraint agree.
 */
export const BUDDY_NOTE_MAX = 140;

/** Most rows {@link fetchBuddies} will ever return. A class is finite. */
export const BUDDY_LIMIT = 100;

/** Columns every opt-in query selects. Keep selects consistent. */
export const BUDDY_SELECT = "user_id, course_id, note, created_at";

/** {@link BUDDY_SELECT} plus the classmate, for the list. */
const BUDDY_LIST_SELECT = `${BUDDY_SELECT}, profile:profiles(id, handle, display_name, avatar_url, major, grad_year)`;

/* ----------------------------- failures ----------------------------- */

/**
 * A study-buddy failure with a message written for a person, not a log. Show
 * `err.message` directly in your inline error — it never leaks SQL, ids, or
 * PostgREST codes.
 */
export class StudyBuddyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyBuddyError";
  }
}

/**
 * What an RLS refusal on insert actually means. The WITH CHECK requires
 * `is_enrolled(course_id)`, so the only way to be refused is to not have the
 * class — which is something the student can fix in about four taps, so we
 * say so instead of apologising.
 */
const ENROLL_FIRST =
  "Add this class to your courses first, then you can find a study partner.";

/** PostgREST's code for "row-level security policy said no". */
const RLS_DENIED = "42501";

/** Read a PostgREST error's `code` without trusting the client's typing. */
function errorCode(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) return "";
  const code = (raw as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

/**
 * True when a failure is the enrolment guard rather than a real fault. Also
 * matches on the message, because a refusal that surfaces through a trigger
 * or a definer function doesn't always carry the code.
 */
function isEnrollmentRefusal(raw: unknown): boolean {
  if (errorCode(raw) === RLS_DENIED) return true;
  const message =
    typeof raw === "object" && raw !== null
      ? String((raw as { message?: unknown }).message ?? "")
      : "";
  return message.toLowerCase().includes("row-level security");
}

/* ---------------------------- narrowing ----------------------------- */

/**
 * An embedded relation comes back as an object OR a one-element array
 * depending on how PostgREST resolves it, and sometimes as null. Unwrap both
 * shapes to a plain record. Same defence as `@/lib/focus` and
 * `@/lib/group-dm`.
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
 * A graduation year as a whole number, or null. Postgres hands `int` back as
 * a number, but a numeric string wouldn't be a reason to lose the year, and
 * a non-finite value is never worth rendering.
 */
function optionalYear(raw: unknown): number | null {
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

/**
 * Narrow one joined opt-in row into a {@link StudyBuddy}. Returns null when
 * the row is missing something a list row can't be drawn without — an id, a
 * handle, or a timestamp. Better an honest drop than a nameless avatar.
 *
 * @param raw   The row as PostgREST returned it.
 * @param myId  The caller's `profiles.id`, or null when the session hasn't
 *   resolved — nothing is marked `is_me` in that case.
 */
function toStudyBuddy(raw: unknown, myId: string | null): StudyBuddy | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const userId = record["user_id"];
  const courseId = record["course_id"];
  const createdAt = record["created_at"];
  if (typeof userId !== "string" || userId.length === 0) return null;
  if (typeof courseId !== "string" || courseId.length === 0) return null;
  if (typeof createdAt !== "string" || createdAt.length === 0) return null;

  const profile = embedded(record["profile"]);
  if (!profile) return null;
  const handle = optionalText(profile["handle"]);
  if (handle === null) return null;

  return {
    user_id: userId,
    course_id: courseId,
    note: optionalText(record["note"]),
    created_at: createdAt,
    handle,
    display_name: optionalText(profile["display_name"]) ?? handle,
    avatar_url: optionalText(profile["avatar_url"]),
    major: optionalText(profile["major"]),
    grad_year: optionalYear(profile["grad_year"]),
    is_me: myId !== null && userId === myId,
  };
}

/** Narrow the caller's own opt-in row; null when there isn't one. */
function toMyOptIn(raw: unknown): MyOptIn | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const courseId = record["course_id"];
  const createdAt = record["created_at"];
  if (typeof courseId !== "string" || courseId.length === 0) return null;
  return {
    course_id: courseId,
    note: optionalText(record["note"]),
    created_at:
      typeof createdAt === "string" && createdAt.length > 0
        ? createdAt
        : new Date().toISOString(),
  };
}

/* ---------------------------- validation ---------------------------- */

/**
 * Trim a note and check it against the 140-character limit the database
 * enforces, so an over-long note fails on the phone with a sentence rather
 * than as a check-constraint violation after a round trip.
 *
 * Blank becomes null — an empty string in the column would be a note that
 * renders as a gap under someone's name.
 *
 * @throws {StudyBuddyError} When the trimmed note runs past 140 characters.
 */
function cleanNote(note: string | undefined | null): string | null {
  const trimmed = (note ?? "").trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > BUDDY_NOTE_MAX) {
    throw new StudyBuddyError(
      `Keep your note to ${BUDDY_NOTE_MAX} characters — say when you study and where.`
    );
  }
  return trimmed;
}

/**
 * The caller's `profiles.id`, read from the stored session (no network hop —
 * supabase-js refreshes the token itself when it's stale).
 *
 * @throws {StudyBuddyError} When nobody's signed in.
 */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (error || typeof id !== "string" || id.length === 0) {
    throw new StudyBuddyError("Sign in again to find a study partner.");
  }
  return id;
}

/** The caller's `profiles.id`, or null — for reads, which work either way. */
async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/* ------------------------------ reads ------------------------------- */

/**
 * Everyone in a course who's open to studying together, newest first, with
 * the caller's own row lifted to the top when they're on the list.
 *
 * That sort is the whole ergonomics of the screen: a student who has opted in
 * sees their own card first — their note, ready to edit or take down — and a
 * student who hasn't sees only classmates, with the invitation to join them.
 * Everyone else stays in newest-first order, so the person who signed up this
 * morning is the one you're most likely to catch.
 *
 * RLS already limits this to people enrolled in the course, so a student who
 * hasn't added the class gets an empty array rather than a refusal — pair
 * this with a course-level "add this class" affordance rather than treating
 * empty as an error.
 *
 * @param courseId `courses.id` to look inside.
 * @returns Up to 100 classmates. Empty when nobody's looking yet.
 * @throws {StudyBuddyError} With copy that's ready to render.
 */
export async function fetchBuddies(courseId: string): Promise<StudyBuddy[]> {
  const myId = await currentUserId();

  const { data, error } = await supabase
    .from("study_buddy_optins")
    .select(BUDDY_LIST_SELECT)
    .eq("course_id", courseId)
    .order("created_at", { ascending: false })
    .limit(BUDDY_LIMIT);
  if (error) {
    throw new StudyBuddyError(
      "We couldn't load who's looking for a study partner. Give it another go."
    );
  }
  if (!Array.isArray(data)) return [];

  const buddies: StudyBuddy[] = [];
  for (const row of data) {
    const buddy = toStudyBuddy(row, myId);
    if (buddy) buddies.push(buddy);
  }

  // Stable: only the caller moves, and only ever to the front.
  return buddies.sort((a, b) => Number(b.is_me) - Number(a.is_me));
}

/**
 * How many classmates are looking, without shipping a single row — a
 * head-only `count: "exact"`, so a course home can say "4 looking" on a badge
 * for the price of one cheap query.
 *
 * Counts the caller too, if they've opted in, because the badge is answering
 * "how many people are on this list", not "how many strangers".
 *
 * Never throws: a badge is not worth an error state, and a course screen that
 * fails to draw because a tally didn't load is a worse screen. A failure —
 * including the caller not being enrolled, which RLS renders as zero rows —
 * reads as 0, and the badge should simply not render at 0.
 *
 * @param courseId `courses.id` to count inside.
 * @returns The number of opt-ins, or 0 if the count couldn't be read.
 */
export async function countBuddies(courseId: string): Promise<number> {
  const { count, error } = await supabase
    .from("study_buddy_optins")
    .select("user_id", { count: "exact", head: true })
    .eq("course_id", courseId);
  if (error || typeof count !== "number" || !Number.isFinite(count)) return 0;
  return Math.max(0, count);
}

/**
 * The caller's own opt-in for a course, or null when they aren't looking.
 *
 * Call it on mount to decide between "I'm looking too" and the editable card
 * showing their note with a way to take it down.
 *
 * @param courseId `courses.id` to check.
 * @throws {StudyBuddyError} With copy that's ready to render.
 */
export async function fetchMyOptIn(courseId: string): Promise<MyOptIn | null> {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from("study_buddy_optins")
    .select(BUDDY_SELECT)
    .eq("course_id", courseId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new StudyBuddyError(
      "We couldn't check whether you're on that list. Give it another go."
    );
  }
  return toMyOptIn(data);
}

/* ------------------------------ writes ------------------------------ */

/**
 * Put your name up in a course, or update the note that's already there.
 *
 * The table's primary key is `(user_id, course_id)`, so this upserts: opting
 * in twice edits the note rather than failing, which is exactly what an
 * "edit your note" form wants to call. The note is trimmed and length-checked
 * on the phone first, so the 140-character constraint is a backstop rather
 * than an error path anyone sees.
 *
 * Safe to run optimistically: add your own row to the list, call this, and
 * pull it back out if it throws.
 *
 * @param courseId `courses.id` — you must be enrolled, or the database
 *   refuses and you get {@link ENROLL_FIRST} back as the message.
 * @param note     How you like to study, up to 140 characters. Optional;
 *   blank saves as no note at all.
 * @returns The saved opt-in, including the trimmed note as stored.
 * @throws {StudyBuddyError} With copy that's ready to render.
 */
export async function optIn(
  courseId: string,
  note?: string | null
): Promise<MyOptIn> {
  const userId = await requireUserId();
  const cleanedNote = cleanNote(note);

  const { data, error } = await supabase
    .from("study_buddy_optins")
    .upsert(
      { user_id: userId, course_id: courseId, note: cleanedNote },
      { onConflict: "user_id,course_id" }
    )
    .select(BUDDY_SELECT)
    .single();

  if (error) {
    throw new StudyBuddyError(
      isEnrollmentRefusal(error)
        ? ENROLL_FIRST
        : "We couldn't add you to that list just now. Give it another go."
    );
  }

  const saved = toMyOptIn(data);
  if (!saved) {
    throw new StudyBuddyError(
      "We couldn't add you to that list just now. Give it another go."
    );
  }
  return saved;
}

/**
 * Take your name back down. This is a delete — no lingering flag, no "opted
 * out" row, nothing left that says you were ever looking. Your note goes with
 * it, so opting back in starts from a blank note.
 *
 * Opting out when you weren't on the list quietly succeeds: the student's
 * intent ("I'm not looking") already holds, and a second tap on a stale
 * screen shouldn't produce an error.
 *
 * Safe to run optimistically: drop your row from the list, call this, and put
 * it back if it throws.
 *
 * @param courseId `courses.id` to leave.
 * @throws {StudyBuddyError} With copy that's ready to render.
 */
export async function optOut(courseId: string): Promise<void> {
  const userId = await requireUserId();

  const { error } = await supabase
    .from("study_buddy_optins")
    .delete()
    .eq("course_id", courseId)
    .eq("user_id", userId);
  if (error) {
    throw new StudyBuddyError(
      "We couldn't take your name down just now. Give it another go."
    );
  }
}

/* --------------------------- pure helpers --------------------------- */

/**
 * The one-line "Computer science · '27" under a classmate's name, or null
 * when they've filled in neither — in which case render nothing rather than
 * a placeholder, and let the note carry the row.
 *
 * Pure: no I/O, no clock, no theme.
 *
 * @param buddy Anything carrying a major and a grad year.
 */
export function buddyDetail(
  buddy: Pick<StudyBuddy, "major" | "grad_year">
): string | null {
  const parts: string[] = [];
  if (buddy.major !== null) parts.push(buddy.major);
  if (buddy.grad_year !== null) {
    parts.push(`'${String(buddy.grad_year % 100).padStart(2, "0")}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The badge sentence for a course home: `4` → "4 looking", `1` → "1 looking",
 * `0` → null so the badge doesn't render at all. Deliberately not "4 students
 * looking for study partners" — this sits inside a `Chip`.
 *
 * Pure.
 *
 * @param count From {@link countBuddies}.
 */
export function buddyCountLabel(count: number): string | null {
  if (!Number.isFinite(count) || count < 1) return null;
  return `${Math.trunc(count)} looking`;
}
