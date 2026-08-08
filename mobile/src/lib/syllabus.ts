/* Syllabus parsing — pure, dependency-free, and entirely on-device.
   A pasted syllabus never leaves the phone: we scan it line by line with
   deterministic heuristics, and only the dates the student confirms are
   written to the shared class calendar. No network, no React, no AI. */

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
    also stamp `created_by` with their own auth uid — spread it in at insert
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

/** Find the first date on a line — numeric or month-name, whichever comes
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
    .replace(/\(\s*\)|\[\s*\]/g, " ") // "(10/14)" leaves "( )" — drop the shell
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—:;,.|>*•·\])]+/, "") // leading bullets/separators
    .replace(/[\s\-–—:;,|(\[]+$/, "") // trailing separators the date left
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
    - Due times default to 11:59 PM local — syllabi rarely carry times, and
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
    'syllabus'). Callers add `created_by` — see CalendarInsertRow. */
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
