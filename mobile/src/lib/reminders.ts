import { supabase } from "@/lib/supabase";

/* Assignment reminders — the data layer.
 *
 * A student taps a deadline, picks how far ahead they want the nudge, and one
 * notification arrives at that moment. That is the whole feature, and almost
 * all of it already lives in the database (migration 0032):
 *
 *   `public.calendar_reminders` is keyed `(user_id, item_id)` — one reminder
 *   per person per deadline, never two. `lead_minutes` is how far ahead, and
 *   the check constraint holds it between 15 minutes and two weeks.
 *   `sent_at` stamps the single nudge so the sweep can never repeat itself.
 *
 *   `public.send_calendar_reminders()` runs on cron at ten past every hour.
 *   It picks up rows where `sent_at is null` and the deadline is still ahead
 *   but within the lead, stamps them, and inserts a row in `notifications`.
 *   The client never sends anything and never writes `sent_at` — this module
 *   only ever asks to be on the list, or asks to come off it.
 *
 * WHAT "HOURLY" MEANS FOR THE COPY YOU WRITE
 * The sweep ticks once an hour, so a nudge lands at the first tick after its
 * moment, not on the minute. Say "about 15 minutes before", never "at 9:44".
 * And a lead longer than the time left is a reminder that will never arrive:
 * the sweep only sends while `due_at` is still in the future, so a one-day
 * lead on something due in an hour is silently dead. {@link reminderFiresAt}
 * exists so the UI can say that out loud instead of pretending.
 *
 * RLS IS THE ENROLMENT CHECK
 * The WITH CHECK on the table requires the caller to be enrolled in the
 * course the item belongs to, so the only way a write is refused is a student
 * reaching for a class they haven't added. That is four taps away from fixed,
 * so {@link ENROLL_FIRST} says so rather than apologising.
 *
 * No React, no theme, no navigation in here — queries, narrowing, and two
 * pure helpers at the bottom that take `now` rather than reading the clock.
 * Every failure arrives as a {@link ReminderError} whose message is warm,
 * specific, and safe to drop straight into an inline error.
 */

/* ══════════════════════════════ shapes ══════════════════════════════ */

/**
 * One offered lead time. The ladder is data, not a switch statement, so a
 * picker can map straight over it and {@link describeLead} can read a stored
 * value back out of the same list.
 */
export type LeadChoice = {
  /** Minutes before the deadline, stored verbatim in `lead_minutes`. */
  minutes: number;
  /** Warm, sentence-case label for the row — e.g. "The night before". */
  label: string;
};

/**
 * The caller's own reminder on one calendar item, flattened. `user_id` is
 * always the signed-in student, so it isn't carried.
 */
export type Reminder = {
  /** `course_calendar_items.id` this reminder is attached to. */
  item_id: string;
  /** How far ahead the nudge goes out, in minutes. 15 to 20160. */
  lead_minutes: number;
  /**
   * ISO timestamp the sweep sent the nudge, or null while it's still pending.
   * A set reminder with a stamp has already done its job — render it as sent
   * rather than as armed, and note that changing the lead re-arms it.
   */
  sent_at: string | null;
};

/** When a reminder will actually reach the student — see {@link reminderFiresAt}. */
export type ReminderTiming = {
  /** The moment the nudge is due: the deadline minus the lead. */
  at: Date;
  /**
   * True when that moment has already gone by, which means this reminder will
   * never arrive — the sweep only sends while the deadline is still ahead.
   * Say so plainly next to the choice; don't leave a dead reminder looking
   * armed.
   */
  past: boolean;
};

/* ══════════════════════════════ the ladder ══════════════════════════ */

/** An hour, in minutes. */
const HOUR = 60;
/** A day, in minutes. */
const DAY = 24 * HOUR;
/** A week, in minutes. */
const WEEK = 7 * DAY;

/** The floor the `lead_minutes` check constraint enforces. */
export const LEAD_MIN_MINUTES = 15;
/** The ceiling the `lead_minutes` check constraint enforces — two weeks. */
export const LEAD_MAX_MINUTES = 2 * WEEK;

/**
 * The lead the column defaults to, and the one a picker should land on when
 * the student hasn't chosen yet. A day out is far enough to do something
 * about it and near enough to still be the same piece of work.
 */
export const DEFAULT_LEAD_MINUTES = DAY;

/**
 * The lead times we offer, nearest first.
 *
 * "The night before" is 15 hours rather than a clock time, because reminders
 * are relative to the deadline and we don't store one. On the 11:59pm due
 * date almost every assignment actually has, 15 hours lands the nudge at
 * about 9am the previous day — coffee, not panic. On a 2pm deadline it slides
 * to the evening before, which is still the last useful moment to start.
 *
 * Everything here sits inside the 15-minute / two-week constraint, so a value
 * taken from this list never needs checking before it's written.
 */
export const LEAD_CHOICES: readonly LeadChoice[] = [
  { minutes: 15, label: "15 minutes before" },
  { minutes: HOUR, label: "An hour before" },
  { minutes: 3 * HOUR, label: "Three hours before" },
  { minutes: 15 * HOUR, label: "The night before" },
  { minutes: DAY, label: "A day before" },
  { minutes: 2 * DAY, label: "Two days before" },
  { minutes: WEEK, label: "A week out" },
];

/** Columns every read and write in this module selects. Keep them consistent. */
const REMINDER_SELECT = "item_id, lead_minutes, sent_at";

/**
 * How many item ids go into one `in(...)` lookup. A quarter of weekly
 * lectures across five classes is hundreds of rows, and hundreds of uuids in
 * a query string is a request that gets rejected on length long before the
 * database sees it. {@link fetchReminders} splits and stitches instead.
 */
const ID_CHUNK = 100;

/* ═════════════════════════════ failures ═════════════════════════════ */

/**
 * A reminder failure with a message written for a person, not a log. Show
 * `err.message` directly in your inline error — it never leaks SQL, ids, or
 * PostgREST codes.
 */
export class ReminderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReminderError";
  }
}

/**
 * What an RLS refusal actually means here. The WITH CHECK requires an
 * enrolment in the item's course, so the only way to be turned down is to be
 * setting a reminder on a class you haven't added yet.
 */
const ENROLL_FIRST =
  "Add this class to your courses first, then you can be reminded about its deadlines.";

/** What a lead outside the stored window says. */
const OUT_OF_RANGE =
  "Pick a reminder between 15 minutes and two weeks before it's due.";

const SET_FAILED = "We couldn't set that reminder just now. Give it another go.";

const CLEAR_FAILED =
  "We couldn't turn that reminder off just now. Give it another tap.";

const LOAD_FAILED =
  "We couldn't load your reminders. Check your connection and give it another go.";

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

/**
 * Turn a write failure into the sentence a student should read: the enrolment
 * nudge, the range nudge, or the generic one the caller passed in.
 */
function writeFailure(raw: unknown, fallback: string): ReminderError {
  if (isEnrollmentRefusal(raw)) return new ReminderError(ENROLL_FIRST);
  if (errorCode(raw) === CHECK_VIOLATION) return new ReminderError(OUT_OF_RANGE);
  return new ReminderError(fallback);
}

/* ═════════════════════════════ narrowing ════════════════════════════ */

/** A trimmed string, or null when it's missing, blank, or the wrong type. */
function optionalText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * An embedded relation comes back as an object OR a one-element array
 * depending on how PostgREST resolves it. Nothing in this module joins today,
 * but `.single()` and `.maybeSingle()` shapes go through the same door — unwrap
 * both to a plain record. Same defence as `@/lib/course-archive`.
 */
function embedded(raw: unknown): Record<string, unknown> | null {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

/**
 * Narrow one row into a {@link Reminder}. Returns null when the row is missing
 * an item id or a usable lead — a reminder we can't describe is worse than one
 * the screen quietly treats as unset, because the student would see a lead
 * they never picked.
 *
 * `lead_minutes` is an `integer`, but PostgREST has handed numerics back as
 * strings before, so a numeric string is accepted and truncated rather than
 * thrown away.
 */
function toReminder(raw: unknown): Reminder | null {
  const record = embedded(raw);
  if (!record) return null;

  const itemId = optionalText(record["item_id"]);
  if (itemId === null) return null;

  const rawLead = record["lead_minutes"];
  const lead = typeof rawLead === "string" ? Number(rawLead) : rawLead;
  if (typeof lead !== "number" || !Number.isFinite(lead)) return null;

  return {
    item_id: itemId,
    lead_minutes: Math.trunc(lead),
    sent_at: optionalText(record["sent_at"]),
  };
}

/* ═══════════════════════════ validation ═════════════════════════════ */

/**
 * Check a lead against the window the column enforces, so a bad value fails on
 * the phone with a sentence instead of as a constraint violation after a round
 * trip. Values from {@link LEAD_CHOICES} always pass.
 *
 * @throws {ReminderError} When the lead isn't a whole number of minutes inside
 *   the 15-minute / two-week window.
 */
function checkLead(minutes: number): number {
  if (!Number.isFinite(minutes)) throw new ReminderError(OUT_OF_RANGE);
  const whole = Math.trunc(minutes);
  if (whole < LEAD_MIN_MINUTES || whole > LEAD_MAX_MINUTES) {
    throw new ReminderError(OUT_OF_RANGE);
  }
  return whole;
}

/* ════════════════════════════════ auth ══════════════════════════════ */

/**
 * The caller's `profiles.id`, read from the stored session (no network hop —
 * supabase-js refreshes the token itself when it's stale).
 *
 * @throws {ReminderError} When nobody's signed in.
 */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (error || typeof id !== "string" || id.length === 0) {
    throw new ReminderError("Sign in again to manage your reminders.");
  }
  return id;
}

/* ═══════════════════════════════ reads ══════════════════════════════ */

/**
 * Every reminder the student has set across a batch of calendar items, keyed
 * by `item_id`.
 *
 * One query for a whole screen: a calendar or plan list hands over the ids it
 * is about to render and gets back a map it can index per row, so a list of
 * fifty deadlines makes one request rather than fifty. An item with no
 * reminder simply isn't in the map — `reminders.get(item.id)` returning
 * undefined IS "no reminder", and the bell renders unset.
 *
 * Ids are deduped and blanks are dropped, and the lookup is split into chunks
 * of {@link ID_CHUNK} so a full quarter of items can't produce a query string
 * long enough to be rejected. An empty list skips the network entirely and
 * returns an empty map.
 *
 * Rows are scoped to `user_id` explicitly as well as by RLS — never rely on a
 * policy alone to scope a "mine" list.
 *
 * @param itemIds `course_calendar_items.id` values the screen is rendering.
 * @returns A map from item id to the student's reminder on it.
 * @throws {ReminderError} With copy that's ready to render.
 */
export async function fetchReminders(
  itemIds: readonly string[]
): Promise<Map<string, Reminder>> {
  const byItem = new Map<string, Reminder>();

  const unique = [...new Set(itemIds.filter((id) => id.length > 0))];
  if (unique.length === 0) return byItem;

  const userId = await requireUserId();

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    chunks.push(unique.slice(i, i + ID_CHUNK));
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from("calendar_reminders")
        .select(REMINDER_SELECT)
        .eq("user_id", userId)
        .in("item_id", chunk)
    )
  );

  for (const { data, error } of results) {
    if (error) throw new ReminderError(LOAD_FAILED);
    if (!Array.isArray(data)) continue;
    for (const row of data) {
      const reminder = toReminder(row);
      if (reminder) byItem.set(reminder.item_id, reminder);
    }
  }

  return byItem;
}

/* ══════════════════════════════ writes ══════════════════════════════ */

/**
 * Ask to be reminded about one deadline, or change the lead on a reminder
 * that's already there.
 *
 * The primary key is `(user_id, item_id)`, so this upserts: tapping a second
 * lead on the same item edits the one row rather than failing. It also clears
 * `sent_at`, which is the point — a student who changes their mind after the
 * nudge went out has re-armed the reminder, and the sweep will send once more
 * at the new moment. Setting the same lead twice is harmless.
 *
 * Nothing here is scheduled on the phone. The row is the whole request; the
 * hourly sweep does the sending, so this keeps working with the app closed and
 * survives a reinstall.
 *
 * Safe to run optimistically: draw the bell as set with the chosen lead, call
 * this, and put it back the way it was if it throws.
 *
 * @param itemId      `course_calendar_items.id` to be reminded about. You must
 *   be enrolled in its course, or you get {@link ENROLL_FIRST} back.
 * @param leadMinutes How far ahead, in minutes — pass a
 *   {@link LEAD_CHOICES} value. Defaults to {@link DEFAULT_LEAD_MINUTES}.
 * @returns The saved reminder, exactly as the database now has it.
 * @throws {ReminderError} With copy that's ready to render.
 */
export async function setReminder(
  itemId: string,
  leadMinutes: number = DEFAULT_LEAD_MINUTES
): Promise<Reminder> {
  // Checked before the session lookup: a bad lead is a bug on the phone, and
  // it shouldn't cost a round trip to say so.
  const lead = checkLead(leadMinutes);
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from("calendar_reminders")
    .upsert(
      {
        user_id: userId,
        item_id: itemId,
        lead_minutes: lead,
        // Changing your mind re-arms it: the sweep skips stamped rows.
        sent_at: null,
      },
      { onConflict: "user_id,item_id" }
    )
    .select(REMINDER_SELECT)
    .single();

  if (error) throw writeFailure(error, SET_FAILED);

  const saved = toReminder(data);
  // No readable row back means the write didn't land the way we'd report it.
  if (!saved) throw new ReminderError(SET_FAILED);
  return saved;
}

/**
 * Take a reminder off one deadline.
 *
 * A delete, not a flag: nothing is left behind saying the student once wanted
 * this, and setting it again later starts from a clean, unsent row.
 *
 * Clearing a reminder that isn't there quietly succeeds — the intent ("don't
 * nudge me about this") already holds, and a second tap on a stale screen
 * shouldn't produce an error.
 *
 * Safe to run optimistically: draw the bell as unset, call this, and put the
 * reminder back if it throws.
 *
 * @param itemId `course_calendar_items.id` to stop being reminded about.
 * @throws {ReminderError} With copy that's ready to render.
 */
export async function clearReminder(itemId: string): Promise<void> {
  const userId = await requireUserId();

  const { error } = await supabase
    .from("calendar_reminders")
    .delete()
    .eq("user_id", userId)
    .eq("item_id", itemId);
  if (error) throw writeFailure(error, CLEAR_FAILED);
}

/* ═══════════════════════════ pure helpers ═══════════════════════════ */

/** "1 hour" / "3 hours", for the phrase a value off the ladder falls back to. */
function countOf(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

/**
 * A stored `lead_minutes` as the label a student reads.
 *
 * Values from {@link LEAD_CHOICES} give back their own warm label — 900 is
 * "The night before", not "15 hours before". Anything else (a row written by
 * an older build, or a lead a future picker offers) is described honestly in
 * the largest unit that divides it evenly, so 4320 reads "3 days before" and
 * 90 reads "90 minutes before" rather than falling back to a shrug.
 *
 * Pure: no I/O, no clock, no theme.
 *
 * @param minutes The stored lead. Nonsense values get a truthful catch-all
 *   rather than an exception — this is called while rendering a row.
 */
export function describeLead(minutes: number): string {
  const known = LEAD_CHOICES.find((choice) => choice.minutes === minutes);
  if (known) return known.label;

  if (!Number.isFinite(minutes)) return "Before it's due";
  const whole = Math.trunc(minutes);
  if (whole < 1) return "When it's due";

  if (whole % WEEK === 0) return `${countOf(whole / WEEK, "week")} before`;
  if (whole % DAY === 0) return `${countOf(whole / DAY, "day")} before`;
  if (whole % HOUR === 0) return `${countOf(whole / HOUR, "hour")} before`;
  return `${countOf(whole, "minute")} before`;
}

/**
 * When a reminder will actually reach the student, and whether that moment has
 * already gone.
 *
 * The sweep sends only while the deadline is still ahead, so a lead longer than
 * the time remaining is a reminder that will never arrive: a one-day lead set
 * on something due in an hour fires at a moment twenty-three hours in the past,
 * and nothing will happen. `past` is how the UI says that out loud — "that's
 * already gone by, so this one won't reach you" next to the choice, instead of
 * a bell that looks armed and isn't.
 *
 * The sweep ticks hourly, so `at` is when the nudge becomes due, not the minute
 * it lands. Phrase it loosely: "around 9am on Thursday", never "at 9:04".
 *
 * Pure: `now` is passed in, never read from the clock, so a ticking screen and
 * a unit test get the same answer.
 *
 * @param dueAt       When the item is due. Turn the row's ISO string into a
 *   Date at the edge; this takes the real moment.
 * @param leadMinutes The lead, in minutes.
 * @param now         The current moment.
 */
export function reminderFiresAt(
  dueAt: Date,
  leadMinutes: number,
  now: Date
): ReminderTiming {
  const at = new Date(dueAt.getTime() - leadMinutes * 60 * 1000);
  return { at, past: at.getTime() <= now.getTime() };
}
