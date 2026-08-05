// Pure helpers for the schedule-image course setup flow. No I/O here — the
// OCR itself runs on-device via tesseract.js in the wizard; these functions
// turn raw recognized text into normalized course codes and match them
// against the university catalog. Kept pure so they are trivially testable.

import type { Course } from "@/lib/types";

/**
 * Course-code shape: 2–5 letters, an optional single space/hyphen/dash, then
 * 2–4 digits with an optional trailing section letter. Matches "CS 101",
 * "MATH-221A", "PSYCH100", "ee 302b", etc. Word boundaries on both sides so
 * we never pull codes out of the middle of longer words.
 */
const COURSE_CODE_RE = /\b([A-Za-z]{2,5})[ \t\-‐-―]?(\d{2,4}[A-Za-z]?)\b/g;

/**
 * Letter groups that show up next to numbers on almost every schedule image
 * but are never department codes: rooms, buildings, meeting-day patterns,
 * month abbreviations ("Aug 25"), "Fall 2026", section markers, and so on.
 */
const NOISE_WORDS = new Set([
  "ROOM",
  "RM",
  "HALL",
  "BLDG",
  "FALL",
  "SEC",
  "WEEK",
  "MWF",
  "MTWRF",
  "MTWTH",
  "TTH",
  "MW",
  "TR",
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "SEPT",
  "OCT",
  "NOV",
  "DEC",
]);

/** "cs-101" / "CS 101" / "CS101" all collapse to the same comparison key. */
export function normalizeCourseCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Pull course-code candidates out of OCR text, normalized to "DEPT NUM"
 * uppercase ("cs101" → "CS 101", "Math-221a" → "MATH 221A"), deduped while
 * preserving first-seen order.
 */
export function extractCourseCodes(text: string): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const match of text.matchAll(COURSE_CODE_RE)) {
    const dept = match[1]!.toUpperCase();
    if (NOISE_WORDS.has(dept)) continue;
    const code = `${dept} ${match[2]!.toUpperCase()}`;
    if (!seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }
  return codes;
}

/**
 * Split extracted codes into courses that exist in the catalog and codes we
 * couldn't find. Comparison is case-, space- and hyphen-insensitive on
 * course.code. Matched courses are deduped by id (first catalog hit wins per
 * code); unmatched codes are deduped by normalized key, original order kept.
 */
export function matchToCourses(
  codes: string[],
  courses: Course[]
): { matched: Course[]; unmatched: string[] } {
  const byKey = new Map<string, Course>();
  for (const course of courses) {
    const key = normalizeCourseCode(course.code);
    if (key && !byKey.has(key)) byKey.set(key, course);
  }

  const matched: Course[] = [];
  const matchedIds = new Set<string>();
  const unmatched: string[] = [];
  const unmatchedKeys = new Set<string>();

  for (const code of codes) {
    const key = normalizeCourseCode(code);
    if (!key) continue;
    const hit = byKey.get(key);
    if (hit) {
      if (!matchedIds.has(hit.id)) {
        matchedIds.add(hit.id);
        matched.push(hit);
      }
    } else if (!unmatchedKeys.has(key)) {
      unmatchedKeys.add(key);
      unmatched.push(code);
    }
  }

  return { matched, unmatched };
}
