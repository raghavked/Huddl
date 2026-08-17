/* Syllabus parsing and consensus.

   PARSING is pure, dependency-free, and entirely on-device. A pasted
   syllabus never leaves the phone: we scan it line by line with
   deterministic heuristics, and only the dates the student confirms are
   written to the shared class calendar. No network, no React, no AI in
   any of the parse helpers.

   CONSENSUS is the one part of this module that talks to Supabase, and it
   lives in the clearly-marked I/O section at the bottom of the file: which
   syllabus versions a course has, who confirms which one, and the winning
   import the calendar's own read policy already honours. */

import { supabase } from "@/lib/supabase";

export type CalendarKind =
  | "assignment"
  | "exam"
  | "quiz"
  | "lecture"
  | "reading"
  | "project"
  | "other";

export type ParsedItem = {
  kind: CalendarKind;
  title: string;
  dueAt: Date;
  /** "low" means the student should double-check the row before importing. */
  confidence: "high" | "low";
};

/** Insert shape for public.course_calendar_items. RLS requires the caller to
    also stamp `created_by` with their own auth uid, so spread it in at insert
    time (`{ ...row, created_by: userId }`). */
export type CalendarInsertRow = {
  course_id: string;
  kind: CalendarKind;
  title: string;
  due_at: string; // ISO timestamp
  source: "syllabus";
};

/** Every kind, in the order pickers cycle through them. */
export const CALENDAR_KINDS: readonly CalendarKind[] = [
  "assignment",
  "exam",
  "quiz",
  "lecture",
  "reading",
  "project",
  "other",
];

/** Display label for a kind ("other" reads as "date" in the UI). */
export function kindLabel(kind: CalendarKind): string {
  return kind === "other" ? "date" : kind;
}

/* ------------------------------ date regexes ------------------------------ */

/* Weekday prefixes ("Mon 10/14", "Friday, Oct 3") are consumed as part of the
   date fragment so they don't end up polluting the title. */
const WEEKDAY_SRC =
  "(?:mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)(?:day)?\\.?";

/* Full and abbreviated month names, optionally followed by a period. */
const MONTH_SRC =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|" +
  "aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

/* Range separators: "10/14-10/16", "Oct 14 – 16". Ranges take the start date;
   the whole fragment is still removed from the title. */
const DASH_SRC = "\\s*[-\\u2013\\u2014]\\s*";

/* "10/14", "10/14/26", "10/14/2026", optionally "Mon " in front and a range
   tail ("-10/16" or "-16") behind. (?!\d) keeps day/year from matching inside
   longer digit runs. */
const NUMERIC_DATE = new RegExp(
  "(?:\\b" +
    WEEKDAY_SRC +
    ",?\\s+)?" +
    "\\b(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?(?!\\d)" +
    "(?:" +
    DASH_SRC +
    "(?:(?:" +
    WEEKDAY_SRC +
    ",?\\s+)?\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?|\\d{1,2})(?!\\d))?",
  "i"
);

/* "Oct 14", "October 14th", "Oct. 14, 2026", optional weekday prefix and
   range tail ("-16" or "- Oct 16"). */
const NAMED_DATE = new RegExp(
  "(?:\\b" +
    WEEKDAY_SRC +
    ",?\\s+)?" +
    "\\b(" +
    MONTH_SRC +
    ")\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)" +
    "(?:,?\\s*(\\d{4}))?" +
    "(?:" +
    DASH_SRC +
    "(?:(?:" +
    MONTH_SRC +
    ")\\.?\\s+)?\\d{1,2}(?:st|nd|rd|th)?(?!\\d))?",
  "i"
);

/* First three letters of a month name -> month number (1-12). */
const MONTH_BY_PREFIX: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

type DateHit = {
  month: number;
  day: number;
  /** Explicit year from the text, if any (2- or 4-digit). */
  year: number | undefined;
  /** Where the whole date fragment starts/how long it runs, for title cleanup. */
  index: number;
  length: number;
};

/** Find the first date on a line, numeric or month-name, whichever comes
    first. Returns null when the line carries no recognizable date. */
function findDate(line: string): DateHit | null {
  const numeric = NUMERIC_DATE.exec(line);
  const named = NAMED_DATE.exec(line);

  let match: RegExpExecArray | null = null;
  let isNamed = false;
  if (numeric && named) {
    // Both matched: earliest wins, so the title loses the right fragment.
    if (named.index < numeric.index) {
      match = named;
      isNamed = true;
    } else {
      match = numeric;
    }
  } else if (named) {
    match = named;
    isNamed = true;
  } else if (numeric) {
    match = numeric;
  }
  if (!match) return null;

  const first = match[1] ?? "";
  const second = match[2] ?? "";
  const yearRaw = match[3];

  const month = isNamed
    ? MONTH_BY_PREFIX[first.slice(0, 3).toLowerCase()] ?? 0
    : Number(first);
  const day = Number(second);
  const year = yearRaw === undefined ? undefined : Number(yearRaw);

  return { month, day, year, index: match.index, length: match[0].length };
}

/* ------------------------------ year + validity --------------------------- */

/** Days in a month, leap years included. */
function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

/** Resolve the year for a date that may not carry one.
    - Explicit 2-digit years are read as 20xx.
    - Otherwise use opts.defaultYear, with one rollover rule: a spring-term
      date (Jan-May) pasted in the fall (Sep-Dec) almost certainly belongs to
      next year's term, so it rolls forward one year. */
function resolveYear(
  explicit: number | undefined,
  month: number,
  defaultYear: number
): number {
  if (explicit !== undefined) {
    return explicit < 100 ? 2000 + explicit : explicit;
  }
  const currentMonth = new Date().getMonth() + 1; // 1-12
  if (month < 6 && currentMonth > 8) return defaultYear + 1;
  return defaultYear;
}

/* --------------------------------- kind ----------------------------------- */

/** Kind from keywords, checked in a fixed priority order so a line like
    "Reading quiz" lands deterministically (exam > quiz > assignment >
    project > reading > lecture). */
function detectKind(line: string): CalendarKind {
  const l = line.toLowerCase();
  if (/\b(?:finals?|midterms?|exams?)\b/.test(l)) return "exam";
  if (/\bquiz(?:zes)?\b/.test(l)) return "quiz";
  if (/\b(?:hw|homeworks?|assignments?|problem\s+sets?|psets?)\b/.test(l)) {
    return "assignment";
  }
  if (/\bprojects?\b/.test(l)) return "project";
  if (/\breadings?\b|\bchapters?\b|\bch\.\s*\d/.test(l)) return "reading";
  if (/\blectures?\b/.test(l)) return "lecture";
  return "other";
}

/* --------------------------------- title ---------------------------------- */

/** The title is the line minus its date fragment, with the separators the
    removal leaves behind (dangling dashes, colons, empty parens, bullet
    markers) swept up, capped at 120 characters. */
function cleanTitle(line: string, dateStart: number, dateLength: number): string {
  const without =
    line.slice(0, dateStart) + " " + line.slice(dateStart + dateLength);
  return without
    .replace(/\(\s*\)|\[\s*\]/g, " ") // "(10/14)" leaves "( )", so drop the shell
    .replace(/\s+/g, " ")
    .replace(/^[\s\-\u2013\u2014:;,.|>*•·\])]+/, "") // leading bullets/separators
    .replace(/[\s\-\u2013\u2014:;,|(\[]+$/, "") // trailing separators the date left
    .trim()
    .slice(0, 120)
    .trim();
}

/** Fallback when the whole line was just a date: name the row by its kind. */
function fallbackTitle(kind: CalendarKind): string {
  if (kind === "other") return "Class date";
  const label = kindLabel(kind);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/* --------------------------------- parse ---------------------------------- */

/** Scan pasted syllabus text for dated lines and turn each into a calendar
    item. Deterministic: same text in, same items out.
    - Lines without a recognizable date are skipped.
    - Date ranges take their start date.
    - Due times default to 11:59 PM local. Syllabi rarely carry times, and
      end-of-day is the honest default for due dates.
    - Confidence is "high" only when a kind keyword matched AND a real title
      survived the date removal; everything else is flagged for review.
    - Identical title+date pairs are deduped (schedule tables repeat rows). */
export function parseSyllabus(
  text: string,
  opts: { defaultYear: number }
): ParsedItem[] {
  const items: ParsedItem[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const hit = findDate(line);
    if (!hit) continue; // no date, no calendar item

    const year = resolveYear(hit.year, hit.month, opts.defaultYear);
    if (hit.month < 1 || hit.month > 12) continue;
    if (hit.day < 1 || hit.day > daysInMonth(hit.month, year)) continue;

    const dueAt = new Date(year, hit.month - 1, hit.day, 23, 59, 0, 0);
    const kind = detectKind(line);
    const cleaned = cleanTitle(line, hit.index, hit.length);
    const title = cleaned === "" ? fallbackTitle(kind) : cleaned;
    const confidence: ParsedItem["confidence"] =
      kind !== "other" && cleaned.length >= 3 ? "high" : "low";

    const key = `${title.toLowerCase()}|${dueAt.getTime()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({ kind, title, dueAt, confidence });
  }

  return items;
}

/** Map confirmed items to course_calendar_items insert rows (source
    'syllabus'). Callers add `created_by` and, since migration 0061, the
    `import_id` of the syllabus_imports row the paste belongs to. See
    CalendarInsertRow. */
export function toCalendarRows(
  items: ParsedItem[],
  courseId: string
): CalendarInsertRow[] {
  return items.map((item) => ({
    course_id: courseId,
    kind: item.kind,
    title: item.title,
    due_at: item.dueAt.toISOString(),
    source: "syllabus" as const,
  }));
}

/* ═══════════════════════════════════════════════════════════════════════
   CONSENSUS: THE I/O SECTION. Everything above this line is pure parsing
   and never touches the network. Everything below talks to Supabase, in
   the same shape as `@/lib/reminders`: queries, narrowing, and failures
   that arrive as a {@link SyllabusError} whose message is warm, specific,
   and safe to drop straight into an inline error.

   The database (migration 0061) carries the whole mechanism:

   · `course_calendar_items.import_id` remembers which import a date came
     from; hand-added dates carry null and always show.
   · THE CALENDAR'S OWN READ POLICY already filters imported items to the
     winning import: most endorsements, earliest import as the tiebreak.
     Clients never pick the winner themselves; every existing calendar,
     plan, and home query is already correct. {@link winningImportId} only
     exists so a screen can point its endorse control at the version the
     class is currently seeing.
   · `syllabus_endorsements` is keyed `(import_id, user_id)`: one voice per
     classmate per version. Importing endorses your own version via a
     trigger, so a fresh paste starts with its author's confirmation.
   · An importer can DELETE their own `syllabus_imports` row, and the
     cascade takes its items with it, along with anything classmates
     checked off or set reminders on. That is what "withdraw" means, and
     why {@link withdrawImport}'s confirm copy says so out loud.
   ═══════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════ consensus shapes ════════════════════════ */

/** The importer behind one version, just enough to say whose paste it is. */
export type SyllabusImporter = {
  /** Their handle, without the leading `@`. */
  handle: string;
  /** Their display name, falling back to their handle if it's blank. */
  display_name: string;
};

/** One syllabus version a course has, with the class's read on it. */
export type SyllabusImport = {
  /** `syllabus_imports.id`. What endorse and withdraw take. */
  id: string;
  /** The course this version belongs to. */
  course_id: string;
  /** `profiles.id` of the importer. Compare against your own uid to know
      whether "Withdraw my import" is yours to offer. */
  user_id: string;
  /** How many dates the paste produced. */
  item_count: number;
  /** ISO timestamp of the paste. Earliest wins ties. */
  created_at: string;
  /** How many classmates say this matches their syllabus, importer included. */
  endorsement_count: number;
  /** Whether the signed-in student is one of them. */
  endorsed_by_me: boolean;
  /** Who pasted it, or null when their profile isn't readable. */
  importer: SyllabusImporter | null;
};

/* ══════════════════════════ consensus failures ══════════════════════ */

/**
 * A consensus failure with a message written for a person, not a log. Show
 * `err.message` directly in your inline error. It never leaks SQL, ids, or
 * PostgREST codes.
 */
export class SyllabusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyllabusError";
  }
}

/** What an RLS refusal actually means here: not enrolled in the course. */
const ENROLL_FIRST =
  "Add this class to your courses first, then you can weigh in on its syllabus.";

const LOAD_FAILED =
  "We couldn't check the syllabus versions. Give it another go.";

const ENDORSE_FAILED = "That didn't save. Give it another tap.";

const UNENDORSE_FAILED =
  "We couldn't take that back just now. Give it another tap.";

const WITHDRAW_FAILED =
  "We couldn't withdraw that import. Give it another try.";

/** PostgREST's code for "row-level security policy said no". */
const RLS_DENIED = "42501";

/** PostgREST's code for a unique-key collision. */
const DUPLICATE_KEY = "23505";

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

/* ══════════════════════════ consensus narrowing ═════════════════════ */

/** A trimmed string, or null when it's missing, blank, or the wrong type. */
function optionalText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * An embedded relation comes back as an object OR a one-element array
 * depending on how PostgREST resolves it, so unwrap both to a plain record.
 * Same defence as `@/lib/reminders` and `@/lib/friends`.
 */
function embedded(raw: unknown): Record<string, unknown> | null {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

/** Columns every imports read selects, embeds included. Keep it consistent. */
const IMPORT_SELECT =
  "id, course_id, user_id, item_count, created_at, " +
  "importer:profiles!syllabus_imports_user_id_fkey(handle, display_name), " +
  "endorsements:syllabus_endorsements(user_id)";

/**
 * Narrow one `syllabus_imports` row (with its embeds) into a
 * {@link SyllabusImport}. Returns null when the row is missing an id, its
 * course, its importer's uid, or a timestamp: a version we can't describe is
 * worse than one the screen quietly skips.
 */
function toSyllabusImport(raw: unknown, myUserId: string): SyllabusImport | null {
  const record = embedded(raw);
  if (!record) return null;

  const id = optionalText(record["id"]);
  const courseId = optionalText(record["course_id"]);
  const userId = optionalText(record["user_id"]);
  const createdAt = optionalText(record["created_at"]);
  if (id === null || courseId === null || userId === null || createdAt === null) {
    return null;
  }

  // `item_count` is an integer, but PostgREST has handed numerics back as
  // strings before, so a numeric string is accepted rather than thrown away.
  const rawCount = record["item_count"];
  const count = typeof rawCount === "string" ? Number(rawCount) : rawCount;

  const importerRecord = embedded(record["importer"]);
  const handle = importerRecord ? optionalText(importerRecord["handle"]) : null;
  const displayName = importerRecord
    ? optionalText(importerRecord["display_name"])
    : null;

  const rawEndorsements = record["endorsements"];
  const endorsements = Array.isArray(rawEndorsements) ? rawEndorsements : [];
  let endorsementCount = 0;
  let endorsedByMe = false;
  for (const row of endorsements) {
    const endorser = embedded(row);
    const endorserId = endorser ? optionalText(endorser["user_id"]) : null;
    if (endorserId === null) continue;
    endorsementCount += 1;
    if (endorserId === myUserId) endorsedByMe = true;
  }

  return {
    id,
    course_id: courseId,
    user_id: userId,
    item_count:
      typeof count === "number" && Number.isFinite(count) ? Math.trunc(count) : 0,
    created_at: createdAt,
    endorsement_count: endorsementCount,
    endorsed_by_me: endorsedByMe,
    importer:
      handle === null ? null : { handle, display_name: displayName ?? handle },
  };
}

/* ══════════════════════════════ auth ════════════════════════════════ */

/**
 * The caller's `profiles.id`, read from the stored session (no network hop,
 * since supabase-js refreshes the token itself when it's stale).
 *
 * @throws {SyllabusError} When nobody's signed in.
 */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (error || typeof id !== "string" || id.length === 0) {
    throw new SyllabusError("Sign in again to weigh in on the syllabus.");
  }
  return id;
}

/* ══════════════════════════════ reads ═══════════════════════════════ */

/**
 * Every syllabus version a course has, oldest paste first, each carrying its
 * endorsement count, whether the signed-in student endorsed it, and who
 * imported it.
 *
 * One query for a whole screen: the imports, their endorsements, and the
 * importer profiles all arrive in a single select. An empty array means the
 * course has no imports at all, which is also the answer a brand-new course
 * gives, so callers can key "does this class already have a syllabus
 * calendar?" off `length > 0`.
 *
 * The ORDER here is import order, NOT the class's preference. Which version
 * the calendar shows is the read policy's call; ask {@link winningImportId}
 * when you need to point at it.
 *
 * @param courseId `courses.id` to list versions for.
 * @throws {SyllabusError} With copy that's ready to render.
 */
export async function listSyllabusImports(
  courseId: string
): Promise<SyllabusImport[]> {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from("syllabus_imports")
    .select(IMPORT_SELECT)
    .eq("course_id", courseId)
    .order("created_at", { ascending: true });
  if (error) throw new SyllabusError(LOAD_FAILED);

  const imports: SyllabusImport[] = [];
  for (const row of Array.isArray(data) ? data : []) {
    const version = toSyllabusImport(row, userId);
    if (version) imports.push(version);
  }
  return imports;
}

/**
 * The import the class calendar is currently showing, via the
 * `winning_syllabus_import` RPC: most endorsements, earliest paste as the
 * tiebreak. Null when the course has no imports.
 *
 * This is the same function the read policy calls, so the answer can never
 * disagree with the items on screen.
 *
 * @param courseId `courses.id` to ask about.
 * @throws {SyllabusError} With copy that's ready to render.
 */
export async function winningImportId(courseId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("winning_syllabus_import", {
    p_course_id: courseId,
  });
  if (error) throw new SyllabusError(LOAD_FAILED);
  return typeof data === "string" && data.length > 0 ? data : null;
}

/* ══════════════════════════════ writes ══════════════════════════════ */

/**
 * Say one version matches your copy of the syllabus.
 *
 * The primary key is `(import_id, user_id)`, so saying it twice is harmless:
 * a duplicate lands as a quiet success, because the intent ("this one's
 * right") already holds. Endorsements move the winner, so refetch the
 * calendar after this lands: the class's version may just have flipped.
 *
 * @param importId `syllabus_imports.id` to confirm. You must be enrolled in
 *   its course, or you get the enrolment nudge back.
 * @throws {SyllabusError} With copy that's ready to render.
 */
export async function endorseImport(importId: string): Promise<void> {
  const userId = await requireUserId();

  const { error } = await supabase
    .from("syllabus_endorsements")
    .insert({ import_id: importId, user_id: userId });
  if (error) {
    if (errorCode(error) === DUPLICATE_KEY) return; // already said so
    if (isEnrollmentRefusal(error)) throw new SyllabusError(ENROLL_FIRST);
    throw new SyllabusError(ENDORSE_FAILED);
  }
}

/**
 * Take your endorsement back off one version.
 *
 * Taking back an endorsement that isn't there quietly succeeds: the intent
 * already holds, and a second tap on a stale screen shouldn't produce an
 * error. Scoped to `user_id` explicitly as well as by RLS; never rely on a
 * policy alone to scope a "mine" write.
 *
 * @param importId `syllabus_imports.id` to stop confirming.
 * @throws {SyllabusError} With copy that's ready to render.
 */
export async function unendorseImport(importId: string): Promise<void> {
  const userId = await requireUserId();

  const { error } = await supabase
    .from("syllabus_endorsements")
    .delete()
    .eq("import_id", importId)
    .eq("user_id", userId);
  if (error) throw new SyllabusError(UNENDORSE_FAILED);
}

/**
 * Withdraw your own import. The cascade takes its calendar items with it,
 * along with anything classmates checked off or set reminders on, so the
 * screen offering this MUST confirm first with exactly that warning.
 *
 * Only the importer can do this (the delete policy is
 * `user_id = auth.uid()`), and the write filters on `user_id` explicitly as
 * well, so a stale id can only ever remove your own row.
 *
 * @param importId Your own `syllabus_imports.id`.
 * @throws {SyllabusError} With copy that's ready to render.
 */
export async function withdrawImport(importId: string): Promise<void> {
  const userId = await requireUserId();

  const { error } = await supabase
    .from("syllabus_imports")
    .delete()
    .eq("id", importId)
    .eq("user_id", userId);
  if (error) throw new SyllabusError(WITHDRAW_FAILED);
}
