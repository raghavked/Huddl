import {
  CATEGORY_NAME_MAX,
  ENTRY_TITLE_MAX,
  GradesError,
  POINTS_MAX,
  WEIGHT_MAX,
  type GradeCategory,
} from "@/lib/grades";

/* The grade tracker's plumbing: text in, numbers out, and the sentences that
 * come back when a field doesn't hold up.
 *
 * `@/lib/grades` owns the arithmetic and the copy that reports it. This file
 * owns the layer above: parsing what someone typed, checking it against the
 * same limits the database enforces so a typo never becomes a round trip, and
 * formatting numbers the way a person writes them.
 *
 * Everything here is pure (no React, no Supabase), so the section, the
 * category card and the two forms can all share it without importing each
 * other.
 */

/* ------------------------------ formatting ------------------------------ */

/** "86.7", "90", "45": a percentage the way a person writes it. */
export function pctText(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** "18", "17.5": points with no trailing zeros. */
export function pointsText(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** "4 items", "1 item". */
export function itemsText(count: number): string {
  return `${count} item${count === 1 ? "" : "s"}`;
}

/** "Oct 14": quiet, and only carries a year when it isn't this one. */
export function shortDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(
    undefined,
    sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" }
  );
}

/** A `GradesError` already reads like a person wrote it; anything else won't. */
export function messageFor(error: unknown, fallback: string): string {
  return error instanceof GradesError ? error.message : fallback;
}

/* ------------------------------ validation ------------------------------ */

/** The three fields a score is typed into, before they're numbers. */
export type EntryDraft = { title: string; earned: string; possible: string };

/** The two fields a category is typed into, before they're numbers. */
export type CategoryDraft = { name: string; weight: string };

/** A checked draft, or the one sentence explaining what to fix. */
export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

/** A finite number out of a text field, or null for empty/garbled. */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * The same rules `@/lib/grades` enforces, checked in the browser first so a
 * typo never becomes a round trip. Extra credit is deliberately not an
 * error, because 22 out of 20 is a real thing that happens.
 */
export function checkEntry(
  draft: EntryDraft
): Checked<{ title: string; earned: number; possible: number }> {
  const title = draft.title.trim();
  if (title.length === 0) {
    return {
      ok: false,
      message: "Give this score a name so you can find it later.",
    };
  }
  if (title.length > ENTRY_TITLE_MAX) {
    return {
      ok: false,
      message: `Score names cap out at ${ENTRY_TITLE_MAX} characters.`,
    };
  }
  const earned = parseNumber(draft.earned);
  if (earned === null || earned < 0) {
    return {
      ok: false,
      message: "Points earned needs to be a number, zero or more.",
    };
  }
  const possible = parseNumber(draft.possible);
  if (possible === null || possible <= 0) {
    return { ok: false, message: "Points possible has to be more than zero." };
  }
  if (earned > POINTS_MAX || possible > POINTS_MAX) {
    return { ok: false, message: "That's more points than we can keep track of." };
  }
  return { ok: true, value: { title, earned, possible } };
}

/** Category rules, same idea. */
export function checkCategory(
  draft: CategoryDraft
): Checked<{ name: string; weight: number }> {
  const name = draft.name.trim();
  if (name.length === 0) {
    return {
      ok: false,
      message: "Give this category a name: homework, labs, midterm.",
    };
  }
  if (name.length > CATEGORY_NAME_MAX) {
    return {
      ok: false,
      message: `Category names cap out at ${CATEGORY_NAME_MAX} characters.`,
    };
  }
  const weight = parseNumber(draft.weight);
  if (weight === null || weight < 0 || weight > WEIGHT_MAX) {
    return {
      ok: false,
      message: `Weights run from 0 to ${WEIGHT_MAX}. Copy the number off your syllabus.`,
    };
  }
  return { ok: true, value: { name, weight } };
}

/** Every category's weight added up, for the live "weights so far" caption. */
export function sumWeights(categories: readonly GradeCategory[]): number {
  let total = 0;
  for (const category of categories) {
    if (Number.isFinite(category.weight)) total += Math.max(category.weight, 0);
  }
  return Math.round(total * 100) / 100;
}

/* ------------------------------ draft rows ------------------------------ */

/**
 * Ids for optimistic rows that haven't met the server yet. A draft id is
 * never a real primary key, so anything that would send it to Supabase (the
 * edit form, the delete button, the add-a-score row) stays shut until the
 * insert settles and the row swaps for the saved one.
 */
const DRAFT_PREFIX = "huddl-draft:";
let draftSeq = 0;

/** A throwaway id for a row that's still in flight. */
export function draftId(kind: string): string {
  draftSeq += 1;
  return `${DRAFT_PREFIX}${kind}-${draftSeq}`;
}

/** True while a row is still in flight and its id means nothing to Postgres. */
export function isDraft(id: string): boolean {
  return id.startsWith(DRAFT_PREFIX);
}
