import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { CALENDAR_KINDS, type CalendarKind } from "@/lib/syllabus";

/* Recurring calendar items: the generator and the series rules.
 *
 * A weekly lecture is not one clever row that knows how to repeat itself. It
 * is twenty ordinary rows on the class calendar that happen to have been
 * created together, and migration 0032 gives them the one thing they need to
 * stay together afterwards:
 *
 *   `course_calendar_items.series_id`, a uuid the CLIENT generates and stamps
 *   on every row of one weekly pattern. Null for a one-off. Nothing in the
 *   database expands anything, schedules anything, or knows what "weekly"
 *   means; each row stays an ordinary calendar item that a student can open,
 *   set a reminder on, or delete by itself. The series id only exists so
 *   "change the whole series" and "clear the rest of these" can find the rest
 *   of the family.
 *
 * That is the entire design, and it is deliberate. No recurrence engine, no
 * RRULE, no expansion job: the dates you can see are the dates that exist, so
 * the calendar never disagrees with itself and a row is never a ghost of a
 * rule stored somewhere else.
 *
 * PAST ROWS ARE HISTORY
 * {@link updateSeries} and {@link deleteSeries} only ever touch rows still in
 * the future. A lecture that already happened is a thing that happened.
 * Renaming it retroactively or sweeping it away would rewrite the term. Which
 * rows count as "the future" is decided by the CALLER, who passes the boundary
 * in, so a page ticking every minute and a unit test frozen at a fixed moment
 * get the same answer, and neither this module nor its tests ever read the
 * clock.
 *
 * ONLY THE AUTHOR EDITS
 * The UPDATE and DELETE policies on `course_calendar_items` are
 * `created_by = auth.uid()`, so a classmate cannot edit or remove someone
 * else's dates. Every write here filters on `created_by` explicitly as well.
 * Never lean on a policy alone to scope a "mine" write, and a filter that
 * matches the policy turns a silent no-op into an honest empty result.
 *
 * WHAT A SERIES INSERT DOES TO EVERYONE ELSE'S INBOX: READ BEFORE WIRING UI
 * `course_calendar_item_notify` (migration 0018) is an AFTER INSERT FOR EACH
 * ROW trigger: every manual calendar row notifies every other student in the
 * course. A twenty-week lecture series is therefore twenty inbox rows per
 * classmate. Their phone only buzzes once (the push trigger coalesces to one
 * per two minutes, migration 0035), but the notification list still fills up.
 * {@link SERIES_MAX_ROWS} bounds the damage; it does not fix it. The fix is one
 * migration, announcing only the first row of a series:
 *
 *   -- inside notify_course_calendar_item(), before the insert
 *   if new.series_id is not null and exists (
 *     select 1 from public.course_calendar_items i
 *     where i.series_id = new.series_id
 *       and (i.due_at, i.id) < (new.due_at, new.id)
 *   ) then
 *     return new;
 *   end if;
 *
 * Until that lands, keep series short and say plainly in the confirm step that
 * the whole class will see these dates.
 *
 * No React, no theme, no routing in here: one pure generator, four queries,
 * and small pure helpers. Every failure arrives as a {@link SeriesError} whose
 * message is warm, specific, and safe to drop straight into an inline error.
 *
 * The one web-only adjustment: every I/O function takes an optional trailing
 * {@link SeriesCtx}. Browser callers omit it and get the shared browser
 * client; a server component passes its request-scoped client (and the user
 * id it already resolved) so nothing reads the session cookie twice.
 */

/* ══════════════════════════════ shapes ══════════════════════════════ */

/** The Supabase client these queries run against: server or browser. */
type Db = SupabaseClient;

/**
 * How a caller tells this module which Supabase client to use.
 *
 * @property client Request-scoped server client. Omit in the browser.
 * @property userId The caller's `profiles.id` when it's already known.
 *   Server components have it from `getCurrentUser()`, and passing it keeps
 *   this module off `auth.getSession()` on the server.
 */
export type SeriesCtx = {
  client?: Db;
  userId?: string | null;
};

/**
 * A day of the week, ISO-numbered: Monday is 1 and Sunday is 7. Callers should
 * never build these by hand. Map over {@link WEEKDAYS} and take `index`, so
 * the numbering can only ever be right.
 */
export type WeekdayIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** One day of the week, as a row of weekday chips renders it. */
export type Weekday = {
  /** ISO index: Monday 1 … Sunday 7. What {@link generateSeries} takes. */
  index: WeekdayIndex;
  /** Chip label: "Mon". Sentence case, because everything is. */
  short: string;
  /** The full name: "Monday". For prose and accessibility labels. */
  label: string;
};

/** A local wall-clock time of day. Both fields are whole numbers. */
export type TimeOfDay = {
  /** 0–23, local time. */
  hour: number;
  /** 0–59, local time. */
  minute: number;
};

/** Everything {@link generateSeries} needs to lay out a weekly pattern. */
export type SeriesSpec = {
  /**
   * What every row is called: "Lecture", "Discussion section", "Problem set".
   * Shared verbatim by all of them; the date is what tells them apart. Trimmed
   * here, and it has to survive as 1–200 characters (the column's own check).
   */
  title: string;
  /** The kind every row carries. A weekly class meeting is `"lecture"`. */
  kind: CalendarKind;
  /**
   * Which days it meets, as {@link WeekdayIndex} values. Order doesn't matter
   * and duplicates are ignored; at least one is required.
   */
  weekdays: readonly WeekdayIndex[];
  /**
   * The first day the pattern can land on, inclusive. Only the calendar day is
   * read. Whatever time this Date carries is discarded in favour of
   * `timeOfDay`.
   *
   * This module never reads the clock, so it cannot know that today's meeting
   * has already been and gone. If you want to skip it, hand in tomorrow.
   */
  startDate: Date;
  /** The last day the pattern can land on, inclusive. Same day-only reading. */
  endDate: Date;
  /**
   * When it meets, in the student's own local time. Rows are built one
   * calendar day at a time, so every one keeps this wall-clock time across a
   * daylight-saving change instead of drifting by an hour.
   */
  timeOfDay: TimeOfDay;
  /** Optional note carried by every row. Trimmed; blank becomes null. */
  details?: string | null;
};

/**
 * One row a series is about to become, before it has touched the database.
 *
 * Snake_case on purpose: this is the content half of an insert, and
 * {@link saveSeries} completes it with the course, the author, the series id
 * and the source. It carries no id, so a draft can be regenerated on every
 * keystroke of a preview without anything being created or orphaned.
 */
export type CalendarRowDraft = {
  kind: CalendarKind;
  title: string;
  details: string | null;
  /**
   * The moment it happens, as an ISO timestamp. The column is called `due_at`
   * for the whole calendar, so a lecture's "due" time is really when class
   * starts. The calendar page just prints the time when it isn't 11:59pm.
   */
  due_at: string;
};

/** A calendar row as it came back from the database, series and all. */
export type SeriesRow = {
  /** `course_calendar_items.id`. */
  id: string;
  course_id: string;
  /** The author: always the signed-in student for rows this module writes. */
  created_by: string | null;
  /** The shared id every row of this pattern carries. */
  series_id: string;
  kind: CalendarKind;
  title: string;
  details: string | null;
  /** ISO timestamp. */
  due_at: string;
  /** Always `"manual"` here: a series is hand-made, not parsed from a PDF. */
  source: "manual" | "syllabus";
};

/**
 * The fields an edit can change across a whole series: the ones that are the
 * same on every row.
 *
 * Times and weekdays are deliberately absent. Moving a lecture from 10am to
 * 11am changes every row to a DIFFERENT value, which no single update can
 * express, and adding a Friday isn't an edit at all; it's more rows. Both are
 * the same recipe: {@link deleteSeries} the upcoming rows, then
 * {@link generateSeries} and {@link saveSeries} the new pattern. Say that out
 * loud in the UI ("this replaces the rest of the quarter") rather than hiding
 * a delete inside a save.
 */
export type SeriesPatch = {
  /** New shared title, 1–200 characters after trimming. */
  title?: string;
  /** New kind for every upcoming row. */
  kind?: CalendarKind;
  /** New shared note. Pass `null` or `""` to clear it. */
  details?: string | null;
};

/* ══════════════════════════════ the days ════════════════════════════ */

/**
 * The week, as data. A picker maps straight over this: no switch statement,
 * no array of magic numbers, and one place to change if a school ever wants
 * the week to start on Sunday.
 *
 * Monday first, because a class schedule is a school week.
 */
export const WEEKDAYS: readonly Weekday[] = [
  { index: 1, short: "Mon", label: "Monday" },
  { index: 2, short: "Tue", label: "Tuesday" },
  { index: 3, short: "Wed", label: "Wednesday" },
  { index: 4, short: "Thu", label: "Thursday" },
  { index: 5, short: "Fri", label: "Friday" },
  { index: 6, short: "Sat", label: "Saturday" },
  { index: 7, short: "Sun", label: "Sunday" },
];

/**
 * 11:59pm, the time the rest of the app treats as "no particular time".
 * The syllabus importer writes it, and the calendar page prints no time at
 * all when it sees it, so a weekly problem set due Friday night looks like a
 * due date rather than an appointment. Use it for assignment-shaped series;
 * pass a real time for anything that meets.
 */
export const END_OF_DAY: TimeOfDay = { hour: 23, minute: 59 };

/* ══════════════════════════════ limits ══════════════════════════════ */

/**
 * The most rows one series may generate.
 *
 * A quarter of twice-weekly lectures is about twenty rows; a semester of
 * three-times-weekly is about forty-five. Sixty is generous for both and still
 * small enough that the class calendar stays readable and one insert stays one
 * ordinary request. What it really buys is the typo: an end date of 2027
 * instead of 2026 is a thousand rows on everyone's calendar and a thousand
 * notifications, and it is much easier to fix a date field than to unpick that.
 *
 * Going over is refused, never quietly trimmed. Sixty rows ending on a date
 * the student never picked would be a worse lie than the error.
 */
export const SERIES_MAX_ROWS = 60;

/** The column's own limit on `title` (`char_length(title) between 1 and 200`). */
const TITLE_MAX = 200;

/** Columns every read and write in this module selects. Keep them consistent. */
const SERIES_SELECT =
  "id, course_id, created_by, series_id, kind, title, details, due_at, source";

/* ═════════════════════════════ failures ═════════════════════════════ */

/**
 * A series failure with a message written for a person, not a log. Show
 * `err.message` directly in your inline error. It never leaks SQL, ids, or
 * PostgREST codes.
 */
export class SeriesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeriesError";
  }
}

/** What an RLS refusal on the insert actually means: you're not in the class. */
const ENROLL_FIRST =
  "Add this class to your courses first, then you can put its schedule on the calendar.";

const NO_TITLE = "Give these dates a name: Lecture, Lab, whatever it is.";

const TITLE_TOO_LONG = "That name is a bit long. Keep it under 200 characters.";

const NO_DAYS = "Pick at least one day of the week.";

const BAD_TIME = "Pick a time of day for these.";

const BAD_RANGE = "Set the last date on or after the first one.";

const TOO_MANY = `That's more than ${SERIES_MAX_ROWS} dates. Bring the last date closer in. A quarter of twice-weekly meetings is about twenty.`;

const NOTHING_TO_SAVE =
  "No dates fall in that range. Check the days of the week and try again.";

const SAVE_FAILED = "We couldn't add those dates just now. Give it another go.";

const UPDATE_FAILED =
  "We couldn't change those dates just now. Give it another go.";

const DELETE_FAILED =
  "We couldn't clear those dates just now. Give it another go.";

const COUNT_FAILED =
  "We couldn't check how many dates are left in this series. Give it another go.";

const NOTHING_TO_CHANGE =
  "Change something first: the name, the kind, or the note.";

/** PostgREST's code for "row-level security policy said no". */
const RLS_DENIED = "42501";

/** PostgREST's code for a check-constraint violation. */
const CHECK_VIOLATION = "23514";

/** Read a PostgREST error's `code` without trusting the client's typing. */
function errorCode(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) return "";
  const code = (raw as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

/**
 * True when a failure is the enrolment guard rather than a real fault. Also
 * matches on the message, because a refusal that surfaces through a trigger
 * doesn't always carry the code.
 */
function isEnrollmentRefusal(raw: unknown): boolean {
  if (errorCode(raw) === RLS_DENIED) return true;
  const message =
    typeof raw === "object" && raw !== null
      ? String((raw as { message?: unknown }).message ?? "")
      : "";
  return message.toLowerCase().includes("row-level security");
}

/**
 * Turn a write failure into the sentence a student should read: the enrolment
 * nudge, the title nudge, or the generic one the caller passed in.
 */
function writeFailure(raw: unknown, fallback: string): SeriesError {
  if (isEnrollmentRefusal(raw)) return new SeriesError(ENROLL_FIRST);
  if (errorCode(raw) === CHECK_VIOLATION) return new SeriesError(TITLE_TOO_LONG);
  return new SeriesError(fallback);
}

/* ══════════════════════════════ client ══════════════════════════════ */

/** One browser client for the whole tab, made on first use. */
let browserDb: Db | null = null;

/** The client to run against: the caller's, or the shared browser one. */
function db(ctx?: SeriesCtx): Db {
  if (ctx?.client) return ctx.client;
  browserDb ??= createClient();
  return browserDb;
}

/* ═════════════════════════════ narrowing ════════════════════════════ */

/**
 * An embedded relation (or a `.single()` result) comes back as an object OR
 * a one-element array depending on how PostgREST resolves it. Unwrap both
 * shapes to a plain record. Same defence as `@/lib/reminders` and
 * `@/lib/course-archive`.
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

/** A stored kind, or `"other"` when it's unreadable: same rule as the plan. */
function toKind(raw: unknown): CalendarKind {
  return typeof raw === "string" &&
    (CALENDAR_KINDS as readonly string[]).includes(raw)
    ? (raw as CalendarKind)
    : "other";
}

/**
 * Narrow one row into a {@link SeriesRow}. Returns null when it's missing an
 * id, a course, a series id or a due date. A row we can't place on a calendar
 * is better dropped than handed over half-built. A row with no readable title
 * keeps its place with an empty one; the date is what the student is looking
 * at.
 */
function toSeriesRow(raw: unknown): SeriesRow | null {
  const record = embedded(raw);
  if (!record) return null;

  const id = optionalText(record["id"]);
  const courseId = optionalText(record["course_id"]);
  const seriesId = optionalText(record["series_id"]);
  const dueAt = optionalText(record["due_at"]);
  if (id === null || courseId === null || seriesId === null || dueAt === null) {
    return null;
  }

  return {
    id,
    course_id: courseId,
    created_by: optionalText(record["created_by"]),
    series_id: seriesId,
    kind: toKind(record["kind"]),
    title: optionalText(record["title"]) ?? "",
    details: optionalText(record["details"]),
    due_at: dueAt,
    source: record["source"] === "syllabus" ? "syllabus" : "manual",
  };
}

/** Rows in the order a calendar reads them: earliest first, id breaking ties. */
function byDueAt(a: SeriesRow, b: SeriesRow): number {
  return a.due_at.localeCompare(b.due_at) || a.id.localeCompare(b.id);
}

/* ════════════════════════════════ ids ═══════════════════════════════ */

/**
 * Sixteen random bytes, from the platform's CSPRNG when it has one and from
 * `Math.random` when it doesn't.
 *
 * The `Math.random` arm is not cryptographic and doesn't need to be: a series
 * id is a grouping key, not a secret or a capability. Nobody can reach a row
 * by guessing one (RLS scopes every read to the student's own enrolments and
 * every write to the author), so the only cost of a collision would be two
 * series merging into one, and 122 random bits makes that impossible in
 * practice even from a weak source.
 */
function randomBytes16(): Uint8Array {
  const bytes = new Uint8Array(16);
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
    return bytes;
  }
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/**
 * A fresh RFC 4122 version-4 uuid for one series.
 *
 * `crypto.randomUUID()` is there in every browser this app supports and in
 * Node, and it is used when it is. It is NOT there on an insecure origin:
 * `crypto.randomUUID` is a secure-context API, so a `http://` preview build
 * loses it. The column is also a real `uuid`, so a "close enough" random
 * string would be rejected outright. Hence the hand-built fallback, which sets
 * the version and variant bits properly so what we send is a genuine v4.
 */
function newSeriesId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }

  const bytes = randomBytes16();
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10xx

  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/* ════════════════════════════════ auth ══════════════════════════════ */

/**
 * The caller's `profiles.id`: theirs if they handed one over, otherwise read
 * from the stored session (no network hop; supabase-js refreshes the token
 * itself when it's stale).
 *
 * @throws {SeriesError} When nobody's signed in.
 */
async function requireUserId(ctx?: SeriesCtx): Promise<string> {
  const given = ctx?.userId;
  if (typeof given === "string" && given.length > 0) return given;
  const { data, error } = await db(ctx).auth.getSession();
  const id = data.session?.user.id;
  if (error || typeof id !== "string" || id.length === 0) {
    throw new SeriesError("Sign in again to edit the class calendar.");
  }
  return id;
}

/* ═══════════════════════════ the generator ══════════════════════════ */

/** Local midnight on the given date: the day, with the time discarded. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** A whole number in `[min, max]`, or null when it's neither. */
function wholeInRange(value: number, min: number, max: number): number | null {
  if (!Number.isFinite(value)) return null;
  const whole = Math.trunc(value);
  return whole >= min && whole <= max ? whole : null;
}

/**
 * Every date a weekly pattern lands on, as drafts ready to be saved.
 *
 * Pure, and the heart of the feature: no ids, no network, no clock. Same spec
 * in, same drafts out, every time, which is exactly what a live preview
 * needs, since it can regenerate on each keystroke and throw the result away
 * without having created anything.
 *
 * The pattern is walked one calendar day at a time from `startDate` to
 * `endDate` inclusive, and each match becomes a row at `timeOfDay` in local
 * time. Building each row from its own calendar day (rather than adding seven
 * days of milliseconds to the last one) is what keeps a 10am lecture at 10am
 * on the far side of a daylight-saving change. The one oddity worth knowing:
 * on a spring-forward morning a time that doesn't exist locally, like 2:30am,
 * slides forward to 3:30am, because that is the moment the clock actually had.
 *
 * Drafts come back in chronological order, all carrying the same title. The
 * date is what tells one Tuesday's lecture from the next.
 *
 * @param spec The pattern. See {@link SeriesSpec}.
 * @returns The drafts, earliest first. **Empty** when the range is valid but
 *   no chosen weekday falls inside it (a Friday pattern in a Monday-to-Tuesday
 *   window). That's a preview saying "no dates yet", not a failure.
 *   {@link saveSeries} is the one that refuses an empty list.
 * @throws {SeriesError} When the pattern can't be built at all: no name, a name
 *   over 200 characters, no weekdays, a nonsense time, a last date before the
 *   first, or more than {@link SERIES_MAX_ROWS} dates. Every message is ready
 *   to render inline under the form.
 */
export function generateSeries(spec: SeriesSpec): CalendarRowDraft[] {
  const title = spec.title.trim();
  if (title.length === 0) throw new SeriesError(NO_TITLE);
  if (title.length > TITLE_MAX) throw new SeriesError(TITLE_TOO_LONG);

  // Dedupe and sanity-check the days: [3, 1, 1] is the same Monday-and-
  // Wednesday pattern as [1, 3], and an index from outside the week is a bug
  // in the client rather than something to write to the calendar.
  const days = new Set<number>();
  for (const weekday of spec.weekdays) {
    const iso = wholeInRange(weekday, 1, 7);
    // Stored the way Date.getDay() reports it, so the walk below is one lookup:
    // ISO Monday 1 stays 1, ISO Sunday 7 wraps to 0.
    if (iso !== null) days.add(iso % 7);
  }
  if (days.size === 0) throw new SeriesError(NO_DAYS);

  const hour = wholeInRange(spec.timeOfDay.hour, 0, 23);
  const minute = wholeInRange(spec.timeOfDay.minute, 0, 59);
  if (hour === null || minute === null) throw new SeriesError(BAD_TIME);

  const startMs = spec.startDate.getTime();
  const endMs = spec.endDate.getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new SeriesError(BAD_RANGE);
  }
  const cursor = startOfDay(spec.startDate);
  const last = startOfDay(spec.endDate);
  if (cursor.getTime() > last.getTime()) throw new SeriesError(BAD_RANGE);

  const details = optionalText(spec.details);

  const drafts: CalendarRowDraft[] = [];
  while (cursor.getTime() <= last.getTime()) {
    if (days.has(cursor.getDay())) {
      // Refuse the moment we go over rather than after counting to a thousand:
      // the loop can only run a few weeks past the cap before it throws, so a
      // typo'd end date decades out costs nothing.
      if (drafts.length >= SERIES_MAX_ROWS) throw new SeriesError(TOO_MANY);
      drafts.push({
        kind: spec.kind,
        title,
        details,
        due_at: new Date(
          cursor.getFullYear(),
          cursor.getMonth(),
          cursor.getDate(),
          hour,
          minute,
          0,
          0
        ).toISOString(),
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return drafts;
}

/* ══════════════════════════════ writes ══════════════════════════════ */

/**
 * Write a generated pattern to the class calendar as one series.
 *
 * One insert, one round trip, one freshly generated `series_id` stamped on
 * every row, so the whole pattern lands together or not at all, and the rows
 * can find each other again later. `created_by` is stamped with the caller's
 * own id because the INSERT policy requires it, and `source` is `"manual"`
 * because a student typed this; the syllabus importer owns the other value.
 *
 * These dates are shared. Everyone in the course sees them on the class
 * calendar and gets them in their notifications (see the note at the top of
 * this file), so a confirm step should name the count and say who it reaches
 * before this is called: "20 dates, visible to everyone in ECS 36A".
 *
 * Not safe to run optimistically: the ids come back from here, so wait for the
 * rows before drawing them.
 *
 * @param courseId The course these belong to. You must be enrolled, or you get
 *   {@link ENROLL_FIRST} back.
 * @param drafts   Straight from {@link generateSeries}.
 * @returns The inserted rows, earliest first, ready to splice into a calendar
 *   list without a refetch. They all share `series_id`.
 * @throws {SeriesError} With copy that's ready to render.
 */
export async function saveSeries(
  courseId: string,
  drafts: readonly CalendarRowDraft[],
  ctx?: SeriesCtx
): Promise<SeriesRow[]> {
  if (courseId.length === 0) throw new SeriesError(SAVE_FAILED);
  // Checked before the session lookup: neither is worth a round trip to say.
  if (drafts.length === 0) throw new SeriesError(NOTHING_TO_SAVE);
  if (drafts.length > SERIES_MAX_ROWS) throw new SeriesError(TOO_MANY);

  const userId = await requireUserId(ctx);
  const seriesId = newSeriesId();

  const { data, error } = await db(ctx)
    .from("course_calendar_items")
    .insert(
      drafts.map((draft) => ({
        ...draft,
        course_id: courseId,
        created_by: userId,
        series_id: seriesId,
        source: "manual" as const,
      }))
    )
    .select(SERIES_SELECT);

  if (error) throw writeFailure(error, SAVE_FAILED);

  const rows: SeriesRow[] = [];
  if (Array.isArray(data)) {
    for (const row of data) {
      const parsed = toSeriesRow(row);
      if (parsed) rows.push(parsed);
    }
  }
  // Nothing readable back means we can't honestly report what landed.
  if (rows.length === 0) throw new SeriesError(SAVE_FAILED);

  return rows.sort(byDueAt);
}

/**
 * Change the shared facts on every upcoming row of a series at once.
 *
 * Only rows due strictly after `after` are touched. A lecture that already
 * happened keeps the name it happened under. `after` is passed in rather than
 * read from the clock so the boundary is the caller's decision and this stays
 * testable: a page hands over `new Date()` at the moment the student confirms,
 * a test hands over a fixed moment, and both get the same rule.
 *
 * The write is also scoped to `created_by = me`, matching the UPDATE policy.
 * Only whoever created the series can rename it; for anyone else this changes
 * nothing and returns an empty array rather than pretending.
 *
 * Times and weekdays can't be changed here. See {@link SeriesPatch} for why,
 * and for the delete-and-regenerate recipe that does it honestly.
 *
 * Safe to run optimistically: redraw the upcoming rows with the new title, call
 * this, and put the old one back if it throws.
 *
 * @param seriesId The shared id from {@link SeriesRow.series_id}.
 * @param patch    The fields to change. At least one is required.
 * @param after    Rows due after this moment are the future; everything at or
 *   before it is history and is left alone.
 * @returns The rows that actually changed, earliest first. **Empty** means
 *   there was nothing upcoming left to change (or the caller isn't the author).
 *   Call {@link fetchSeriesCount} first so the confirm step can say so
 *   instead of finding out afterwards.
 * @throws {SeriesError} With copy that's ready to render.
 */
export async function updateSeries(
  seriesId: string,
  patch: SeriesPatch,
  after: Date,
  ctx?: SeriesCtx
): Promise<SeriesRow[]> {
  if (seriesId.length === 0) throw new SeriesError(UPDATE_FAILED);

  const fields: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title.length === 0) throw new SeriesError(NO_TITLE);
    if (title.length > TITLE_MAX) throw new SeriesError(TITLE_TOO_LONG);
    fields["title"] = title;
  }
  if (patch.kind !== undefined) fields["kind"] = patch.kind;
  // `details: null` is a real instruction ("clear the note"), so presence is
  // what counts here, not truthiness.
  if (patch.details !== undefined) {
    fields["details"] = optionalText(patch.details);
  }

  if (Object.keys(fields).length === 0) {
    throw new SeriesError(NOTHING_TO_CHANGE);
  }

  const userId = await requireUserId(ctx);

  const { data, error } = await db(ctx)
    .from("course_calendar_items")
    .update(fields)
    .eq("series_id", seriesId)
    .eq("created_by", userId)
    .gt("due_at", after.toISOString())
    .select(SERIES_SELECT);

  if (error) throw writeFailure(error, UPDATE_FAILED);

  const rows: SeriesRow[] = [];
  if (Array.isArray(data)) {
    for (const row of data) {
      const parsed = toSeriesRow(row);
      if (parsed) rows.push(parsed);
    }
  }
  return rows.sort(byDueAt);
}

/**
 * Clear the rest of a series off the class calendar.
 *
 * Upcoming rows only, on the same rule and for the same reason as
 * {@link updateSeries}: the meetings that already happened stay, so the term
 * still reads back the way it was lived. Scoped to `created_by = me` to match
 * the DELETE policy.
 *
 * This removes shared rows from everyone's calendar, and the reminders anyone
 * set on them go with the rows (`calendar_reminders` cascades on delete). Name
 * that in the confirm ("removes the next 12 lectures for the whole class"),
 * with the destructive button saying the verb and the cancel saying the
 * outcome ("Keep them").
 *
 * Deleting a series with nothing upcoming left quietly succeeds with 0. The
 * intent already holds, and a second click on a stale page shouldn't be an
 * error.
 *
 * @param seriesId The shared id from {@link SeriesRow.series_id}.
 * @param after    Rows due after this moment go; everything at or before it
 *   stays. Caller-passed for the same testability reason as
 *   {@link updateSeries}.
 * @returns How many rows were removed: the number a confirmation should name.
 * @throws {SeriesError} With copy that's ready to render.
 */
export async function deleteSeries(
  seriesId: string,
  after: Date,
  ctx?: SeriesCtx
): Promise<number> {
  if (seriesId.length === 0) throw new SeriesError(DELETE_FAILED);

  const userId = await requireUserId(ctx);

  const { data, error } = await db(ctx)
    .from("course_calendar_items")
    .delete()
    .eq("series_id", seriesId)
    .eq("created_by", userId)
    .gt("due_at", after.toISOString())
    .select("id");

  if (error) throw writeFailure(error, DELETE_FAILED);
  return Array.isArray(data) ? data.length : 0;
}

/* ═══════════════════════════════ reads ══════════════════════════════ */

/**
 * How many rows of a series are still ahead: the number a confirm dialog
 * should name.
 *
 * Counted with exactly the filters {@link updateSeries} and
 * {@link deleteSeries} use, including `created_by = me`, so "this changes 12
 * dates" is a promise the write can keep rather than a guess that includes
 * rows the policy will refuse. A student who isn't the author gets 0, which is
 * the truth about what they can change.
 *
 * `head: true` means no rows come back, just the count. Cheap enough to call
 * every time a panel opens.
 *
 * @param seriesId The shared id from {@link SeriesRow.series_id}.
 * @param after    The same boundary you'll pass to the write that follows.
 * @returns The number of upcoming rows, possibly 0.
 * @throws {SeriesError} With copy that's ready to render.
 */
export async function fetchSeriesCount(
  seriesId: string,
  after: Date,
  ctx?: SeriesCtx
): Promise<number> {
  if (seriesId.length === 0) return 0;

  const userId = await requireUserId(ctx);

  const { count, error } = await db(ctx)
    .from("course_calendar_items")
    .select("id", { count: "exact", head: true })
    .eq("series_id", seriesId)
    .eq("created_by", userId)
    .gt("due_at", after.toISOString());

  if (error) throw new SeriesError(COUNT_FAILED);
  return count ?? 0;
}

/* ═══════════════════════════ pure helpers ═══════════════════════════ */

/**
 * Which day of the week a date falls on, as a {@link WeekdayIndex}.
 *
 * Use it to pre-select the weekday chip for the day the student started from,
 * so adding "every Tuesday" from Tuesday's calendar is one click shorter.
 * Pure: it reads the date it's given, never the clock.
 */
export function weekdayOf(date: Date): WeekdayIndex {
  // JS numbers Sunday 0 … Saturday 6; ISO numbers Monday 1 … Sunday 7.
  return (((date.getDay() + 6) % 7) + 1) as WeekdayIndex;
}

/**
 * The chosen days as a phrase: "Mon, Wed & Fri", "Tue & Thu", "Mon".
 *
 * For the confirm step and the row subtitle, so the sentence is written once
 * instead of hand-rolled on every page that shows a series. Days come out in
 * week order however they went in, duplicates dropped. An empty selection
 * gives an empty string. A form in that state should be prompting for a day
 * rather than describing one.
 *
 * Pure: no clock, no locale lookup. The short labels come straight from
 * {@link WEEKDAYS}.
 */
export function describeWeekdays(weekdays: readonly WeekdayIndex[]): string {
  const chosen = new Set<number>(weekdays);
  const labels = WEEKDAYS.filter((day) => chosen.has(day.index)).map(
    (day) => day.short
  );
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} & ${labels[labels.length - 1] ?? ""}`;
}
