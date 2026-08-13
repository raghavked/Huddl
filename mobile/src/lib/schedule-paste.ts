/* Schedule paste parsing: pure, dependency-free, and entirely on-device.
   Adding six courses one at a time is ninety dull seconds, so a student can
   paste whatever their registrar handed them instead: a copied table row, a
   bulleted list, or three codes separated by commas. We scan it line by line
   with deterministic heuristics (no network, no React, no clock, no AI)
   and hand back a preview the student still edits before anything is saved.

   Sibling of ./syllabus.ts and written to the same shape: exported types
   first, private regexes and helpers in the middle, one documented entry
   point at the bottom. */

/** One course pulled out of the pasted text. */
export type PastedCourse = {
  /** Normalized "SUBJ NUM": always uppercase, one space, no leading zeros
      on the number ("MAT 021A", "MAT021A", and "mat 21a" all land here as
      "MAT 21A", the shape the catalog prints). */
  code: string;
  /** The course name when one plausibly survived the line, else null. */
  title: string | null;
  /** "low" means only a bare code came through. Flag it for a second look. */
  confidence: "high" | "low";
};

export type ParsedSchedule = {
  courses: PastedCourse[];
  /** Non-empty lines we couldn't read a course code out of: table headers,
      "Total units: 16", the stray blank-ish row. Codes dropped as duplicates
      are *not* counted (a repeat isn't a loss), and neither are codes past
      the cap; a caller detects that with `courses.length === MAX_PASTED_COURSES`. */
  skipped: number;
};

/** A term is a dozen classes at the outside; anything past this is a paste
    that went sideways, and twelve editable rows is already a long sheet. */
export const MAX_PASTED_COURSES = 12;

/* ------------------------------ the code shape ---------------------------- */

/* A course code is 2-4 letters, an optional space, 1-3 digits, and an
   optional trailing letter: the shape `catalog_courses` prints
   (subject_code || ' ' || course_number). Notes on the pieces:

   - `(^|[^A-Za-z0-9])` is a hand-rolled left boundary instead of a lookbehind,
     which Hermes cannot be relied on to support. It keeps us from matching
     inside a longer word ("OLSON 106" must not yield "SON 106"), at the cost
     of one extra capture group.
   - `0*` swallows the registrar's zero padding so "MAT 021A" normalizes to
     the catalog's "MAT 21A".
   - the trailing `(?![A-Za-z0-9])` keeps four-digit years ("Fall 2026") and
     longer alphanumeric junk out. */
const CODE_SCAN =
  /(^|[^A-Za-z0-9])([A-Za-z]{2,4})[ \t]{0,4}0*(\d{1,3})([A-Za-z])?(?![A-Za-z0-9])/g;

/** The same shape, anchored, for validating one code rather than scanning
    prose. Deliberately has no keyword deny-list: an existing course really
    could be called "WEEK 1", and this is the function callers use to compare
    a pasted code against courses they're already in. */
const CODE_EXACT = /^\s*([A-Za-z]{2,4})[ \t]{0,4}0*(\d{1,3})([A-Za-z])?\s*$/;

/* Words that fit the code shape but never name a course. Kept deliberately
   short and boring: every entry here is a token that would otherwise turn a
   perfectly ordinary schedule line into a phantom class. Real subject codes
   (ART, MUS, STA, DES, SAS…) must never appear in this list. */
const NOT_A_SUBJECT = new Set([
  // Days and months. "Mon 10", "Oct 14" are dates, not classes.
  "MON", "TUE", "TUES", "WED", "THU", "THUR", "THURS", "FRI", "SAT", "SUN",
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUNE", "JUL", "JULY", "AUG",
  "SEP", "SEPT", "OCT", "NOV", "DEC",
  // Registrar table furniture.
  "CRN", "SEC", "SECT", "LEC", "LECT", "DIS", "DISC", "LAB", "SEM", "TBA",
  "TBD", "RM", "ROOM", "BLDG", "HALL", "UNIT", "UNITS", "CR", "NBR", "TYPE",
  "TIME", "DATE", "OPEN", "FULL", "WAIT", "STAFF", "MAX",
  // Ordinary list scaffolding.
  "WEEK", "DAY", "DAYS", "TERM", "YEAR", "FALL", "WNTR", "SPR", "SUM",
  "PAGE", "ITEM", "STEP", "PART", "NOTE", "TOTAL", "THE", "AND", "FOR",
  "ALL", "NEW", "ADD", "HRS", "HR", "MIN", "AM", "PM",
]);

/* What follows a candidate when the candidate is really a clock time:
   "MWF 10:00", "TR 2-3PM", "F 9 AM". Matched against the text immediately
   after the candidate, which is why the colon form insists on two digits:
   "ECS 36A: Programming" must survive. */
const TIME_TAIL =
  /^[ \t]*(?::\d{2}|[ap]\.?m\.?\b|[-\u2013\u2014][ \t]*\d{1,2}(?::\d{2}|[ \t]*[ap]\.?m\.?))/i;

/* Characters that mark a list rather than a sentence. See findCodes: the
   first code on a line is taken on faith, later ones need one of these in
   the gap, which is what separates "BIS 2A, CHE 2B" (two classes) from
   "MAT 021A 001 CALCULUS 4.0 MWF 10:00" (one class and its columns). */
const LIST_SEPARATORS = /[,;|/&•·]/;

/* Clock times, with the meeting-day token that usually precedes them and the
   range tail that usually follows: "MWF 10:00-10:50AM", "TuTh 2:10 pm".
   The meridiem is spelled out both cases rather than flagged /i, because an
   /i on the day class would let it eat an ordinary lowercase word sitting
   next to a time. */
const CLOCK_TIME =
  /(?:\b[MTWRFSUhu]{1,6}\b[ \t]*)?\b\d{1,2}:\d{2}[ \t]*(?:[aApP]\.?[mM]\.?)?(?:[ \t]*[-\u2013\u2014][ \t]*\d{1,2}(?::\d{2})?[ \t]*(?:[aApP]\.?[mM]\.?)?)?/g;

/* The same, for schedules that write whole hours: "MWF 10-11AM", "F 9 am". */
const HOUR_TIME =
  /(?:\b[MTWRFSUhu]{1,6}\b[ \t]*)?\b\d{1,2}[ \t]*[aApP]\.?[mM]\.?(?:[ \t]*[-\u2013\u2014][ \t]*\d{1,2}[ \t]*(?:[aApP]\.?[mM]\.?)?)?/g;

/* A section number sitting where a title should start: "001", "A01", "12345".
   Two digits minimum so a title that opens with a number ("3D Modeling")
   keeps it. */
const LEADING_SECTION =
  /^(?:sec(?:tion)?|lec(?:ture)?|dis(?:cussion)?|lab|crn)?\.?[ \t]*[A-Za-z]?\d{2,5}[A-Za-z]?\b[ \t]*/i;

/* A building and room at the end of a table row: "OLSON 106", "HARING 2205",
   "OLSON HALL 106". The room number wants two digits or more, which is what
   keeps a title that ends in a numeral ("CALCULUS 2") off this hook. */
const TRAILING_ROOM =
  /[\s,|·]*\b[A-Za-z]{2,}\.?(?:[ \t]+(?:HALL|BLDG|BUILDING|CTR|CENTER))?[ \t]*\d{2,4}[A-Za-z]?\s*$/i;

/** Meeting-day tokens decompose into these, longest first. Deliberately no
    bare "S" or "U": including them would eat "US" out of a title, and
    weekend sections are vanishingly rare. */
const DAY_UNITS = ["Th", "Tu", "Sa", "Su", "M", "T", "W", "R", "F"];

/** Words a Title Case pass leaves lowercase (never in first position). */
const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into",
  "of", "on", "or", "the", "to", "via", "with",
]);

/* -------------------------------- helpers --------------------------------- */

/** True when a token is a meeting pattern like "MWF", "TR", or "TTh", i.e.
    it decomposes cleanly into day units. Tried case-sensitively first (so
    "TTh" works), then uppercase (so "TTH" works); a lowercase word is never
    treated as a meeting pattern, which is what keeps "mus" and "us" safe. */
function isMeetingPattern(token: string): boolean {
  const word = token.replace(/[^A-Za-z]/g, "");
  if (word.length < 2 || word.length > 6) return false;
  const decomposes = (units: readonly string[]): boolean => {
    let i = 0;
    outer: while (i < word.length) {
      for (const unit of units) {
        if (word.startsWith(unit, i)) {
          i += unit.length;
          continue outer;
        }
      }
      return false;
    }
    return true;
  };
  if (decomposes(DAY_UNITS)) return true;
  if (word !== word.toUpperCase()) return false;
  return decomposes(DAY_UNITS.map((unit) => unit.toUpperCase()));
}

/** "MAT", "021", "a" -> "MAT 21A". */
function normalize(letters: string, digits: string, trailing: string): string {
  const number = digits.replace(/^0+(?=\d)/, "");
  return `${letters.toUpperCase()} ${number}${trailing.toUpperCase()}`;
}

/**
 * Validate and normalize a single course code.
 *
 * Returns the canonical "SUBJ NUM" form, or null when the string isn't a
 * course code at all. Callers use it to line a pasted code up against the
 * courses a student is already in, where the two sides were typed by
 * different people on different days ("mat 21a" vs "MAT 21A").
 */
export function normalizeCourseCode(raw: string): string | null {
  const match = CODE_EXACT.exec(raw);
  if (!match) return null;
  return normalize(match[1] ?? "", match[2] ?? "", match[3] ?? "");
}

/** A line carries times, so it's almost certainly a registrar table row,
    which licenses the more aggressive title cleanup (rooms, section labels). */
function looksTabular(line: string): boolean {
  return /\d{1,2}:\d{2}/.test(line) || /\b\d{1,2}[ \t]*[ap]\.?m\.?\b/i.test(line);
}

type CodeHit = { code: string; start: number; end: number };

/**
 * Every course code on one line, in order.
 *
 * Two rules do the real work:
 * 1. A candidate followed by clock punctuation is a time, not a course, so
 *    "MWF 10:00-10:50AM" never becomes "MWF 10".
 * 2. The **first** surviving candidate on a line is always a course. A later
 *    one only counts if a list separator sits between it and the last code we
 *    kept. That single rule is what lets "BIS 2A, CHE 2B, STA 13" be three
 *    classes while "MAT 021A 001 CALCULUS 4.0 …" stays one class and its
 *    columns. Everything after the code on a table row is title material.
 */
function findCodes(line: string): CodeHit[] {
  const hits: CodeHit[] = [];
  CODE_SCAN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CODE_SCAN.exec(line)) !== null) {
    const lead = (match[1] ?? "").length;
    const letters = match[2] ?? "";
    const start = match.index + lead;
    const end = match.index + match[0].length;
    if (NOT_A_SUBJECT.has(letters.toUpperCase())) continue;
    if (TIME_TAIL.test(line.slice(end))) continue;
    const previous = hits[hits.length - 1];
    if (previous && !LIST_SEPARATORS.test(line.slice(previous.end, start))) {
      continue; // whitespace only, so this is part of the previous row's tail
    }
    hits.push({
      code: normalize(letters, match[3] ?? "", match[4] ?? ""),
      start,
      end,
    });
  }
  return hits;
}

/** "PROGRAMMING & PROBLEM SOLVING" -> "Programming & Problem Solving".
    Registrar tables shout; the rest of the app doesn't. Roman numerals and
    anything with a digit in it are left exactly as they came. */
function titleCase(text: string): string {
  let first = true;
  return text
    .split(/(\s+|-)/)
    .map((chunk) => {
      if (/^\s+$/.test(chunk) || chunk === "-") return chunk;
      const word = chunk.toLowerCase();
      const wasFirst = first;
      first = false;
      if (/\d/.test(chunk)) return chunk;
      if (/^[IVX]{1,4}$/.test(chunk)) return chunk; // II, IV, XI
      if (!wasFirst && SMALL_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join("");
}

/**
 * Turn the leftovers of a line into a course title, or null when nothing
 * title-shaped survives.
 *
 * How the registrar's columns get dropped, in order: the leading section
 * number ("001", "A01"), unit counts ("4.0", "(4)", "3 units"), clock times
 * along with the meeting-day token in front of them ("MWF 10:00-10:50AM"),
 * any meeting pattern left standing on its own ("TR"), table words in a row
 * that clearly is a table ("LEC", "CRN", "TBA"), and finally a trailing
 * building-and-room pair ("OLSON 106"). That last one only lands on rows that
 * carried a time, since a row without one is a list line, not a table.
 *
 * What's left is swept of dangling separators and empty brackets, and a
 * result with fewer than three letters is treated as no title at all.
 */
function cleanTitle(raw: string, tabular: boolean): string | null {
  let text = raw.replace(/^[\s\-\u2013\u2014:;,.|>*•·)\]]+/, "");
  text = text.replace(LEADING_SECTION, "");
  text = text.replace(/\b\d{1,2}\.\d\b/g, " ");
  text = text.replace(/\(\s*\d{1,2}(?:\.\d)?\s*\)/g, " ");
  text = text.replace(/\b\d{1,2}(?:\.\d)?[ \t]*(?:units?|credits?|cr)\b/gi, " ");
  text = text.replace(CLOCK_TIME, " ");
  text = text.replace(HOUR_TIME, " ");
  text = text
    .split(/(\s+)/)
    .filter((chunk) => !isMeetingPattern(chunk))
    .join("");
  text = text.replace(/\b(?:TBA|TBD)\b/g, " ");
  if (tabular) {
    text = text.replace(/\b(?:CRN|SEC|SECT|LEC|LECT|DIS|DISC|LAB|SEM|RM|ROOM|UNITS?)\b/g, " ");
    text = text.replace(TRAILING_ROOM, " ");
  }

  const cleaned = text
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-\u2013\u2014:;,.|>*•·)\]]+/, "")
    .replace(/[\s\-\u2013\u2014:;,|(\[]+$/, "")
    .trim()
    .slice(0, 120)
    .trim();

  if ((cleaned.match(/[A-Za-z]/g) ?? []).length < 3) return null;
  return cleaned === cleaned.toUpperCase() ? titleCase(cleaned) : cleaned;
}

/* --------------------------------- parse ---------------------------------- */

/**
 * Read a pasted schedule and pull the classes out of it. Deterministic: the
 * same text in gives the same courses out, every time.
 *
 * Survives the three shapes students actually paste:
 * - a registrar table row: `MAT 021A  001  CALCULUS  4.0  MWF 10:00-10:50AM  OLSON 106`
 * - a copied list line: `ECS 36A - Programming & Problem Solving`
 * - bare codes on one line: `BIS 2A, CHE 2B, STA 13`
 *
 * Rules of the road:
 * - Codes normalize to the catalog's shape, so "MAT021A", "MAT 021A", and
 *   "mat 21a" are one course, not three.
 * - The title is whatever plausibly survives the rest of the line once the
 *   section number, units, times, days, and room are gone. When a line puts
 *   the name *before* the code ("Calculus - MAT 21A") we fall back to the
 *   text in front of it.
 * - A repeated code keeps its first appearance, upgraded if a later line
 *   finally supplies a title.
 * - Confidence is "high" when a title came through and "low" for a bare code;
 *   a caller can still fill a low row in from the catalog.
 * - At most {@link MAX_PASTED_COURSES} courses come back.
 */
export function parseSchedule(text: string): ParsedSchedule {
  const courses: PastedCourse[] = [];
  const indexByCode = new Map<string, number>();
  let skipped = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;

    const hits = findCodes(line);
    if (hits.length === 0) {
      skipped += 1;
      continue;
    }

    const tabular = looksTabular(line);
    for (let i = 0; i < hits.length; i += 1) {
      const hit = hits[i];
      if (!hit) continue;
      const next = hits[i + 1];
      let title = cleanTitle(line.slice(hit.end, next ? next.start : line.length), tabular);
      if (title === null && i === 0 && hit.start > 0) {
        // "Calculus - MAT 21A": the name led, the code followed.
        title = cleanTitle(line.slice(0, hit.start), tabular);
      }

      const seen = indexByCode.get(hit.code);
      if (seen !== undefined) {
        const existing = courses[seen];
        if (existing && existing.title === null && title !== null) {
          existing.title = title;
          existing.confidence = "high";
        }
        continue;
      }
      if (courses.length >= MAX_PASTED_COURSES) continue;
      indexByCode.set(hit.code, courses.length);
      courses.push({
        code: hit.code,
        title,
        confidence: title === null ? "low" : "high",
      });
    }
  }

  return { courses, skipped };
}
