import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/* The private grade tracker: the math, then the data layer.
 *
 * Migration 0028 gave every student two tables of their own:
 *
 *   grade_categories: the buckets off a syllabus (Homework 20%, Midterm 30%)
 *   grade_entries:    the scores inside a bucket (18/20 on Problem Set 3)
 *
 * Both are RLS self-only: nobody else on campus can read a single row, and
 * the write policies require `user_id = auth.uid()`, so every insert here
 * stamps the caller's own id.
 *
 * The file has two halves and they never mix:
 *
 *   1. THE MATH is pure. No Supabase, no Date.now(), no React, no theme.
 *      Numbers in, numbers and sentences out. Every function is
 *      deterministic and unit-testable on plain object literals (see
 *      `grades.test.ts`), and takes whatever shape the screen already has in
 *      state, so optimistic local rows work exactly like fetched ones.
 *
 *   2. THE DATA half is thin: fetch a course's whole gradebook in two
 *      queries, then create / update / delete a category or an entry.
 *      Failures arrive as a {@link GradesError} whose message is warm,
 *      specific and safe to render straight into an inline error.
 *
 * One honesty rule runs through all of it: an estimate is an estimate. We
 * rescale by the weight that's actually been graded so an early-quarter
 * student isn't dragged to zero by empty buckets, we say out loud how much
 * of the grade the number rests on, and we never round a "needed" score down
 * into a promise we can't keep.
 *
 * The one web-only adjustment: there is no module-level Supabase singleton
 * here the way there is in the native app. Every I/O function takes an
 * optional trailing {@link GradesCtx}. Browser callers omit it and get the
 * shared browser client; a server component passes its request-scoped client
 * (and the user id it already resolved) so nothing reads the session cookie
 * twice.
 */

/* ══════════════════════════════ shapes ══════════════════════════════ */

/** The Supabase client these queries run against, server or browser. */
type Db = SupabaseClient;

/**
 * How a caller tells this module which Supabase client to use.
 *
 * @property client Request-scoped server client. Omit in the browser.
 * @property userId The caller's `profiles.id` when it's already known.
 *   Server components have it from `getCurrentUser()`, and passing it keeps
 *   this module off `auth.getSession()` on the server.
 */
export type GradesCtx = {
  client?: Db;
  userId?: string | null;
};

/** A `grade_categories` row: one weighted bucket off a syllabus. */
export type GradeCategory = {
  /** `grade_categories.id`. */
  id: string;
  /** Always the signed-in student. These rows are never shared. */
  user_id: string;
  /** `courses.id` this bucket belongs to. */
  course_id: string;
  /** What the syllabus calls it, 1-60 characters. */
  name: string;
  /** Share of the final grade, 0-100. Weights need not sum to 100. */
  weight: number;
  /** Sort order within the course, ascending; ties fall back to created_at. */
  position: number;
  /** ISO timestamp the bucket was added. */
  created_at: string;
};

/** A `grade_entries` row: one score inside a bucket. */
export type GradeEntry = {
  /** `grade_entries.id`. */
  id: string;
  /** Always the signed-in student. */
  user_id: string;
  /** `grade_categories.id` this score sits in. */
  category_id: string;
  /** What the assignment was called, 1-120 characters. */
  title: string;
  /** Points scored. Zero is fine; extra credit above `points_possible` is too. */
  points_earned: number;
  /** Points the assignment was out of. Always greater than zero. */
  points_possible: number;
  /** ISO timestamp the score was logged (not when it was assigned). */
  recorded_at: string;
};

/** The least the math needs from a score. A full {@link GradeEntry} fits. */
export type EntryScore = Pick<GradeEntry, "points_earned" | "points_possible">;

/** The least the math needs from a bucket. A full {@link GradeCategory} fits. */
export type CategoryWeight = Pick<GradeCategory, "id" | "weight">;

/**
 * Scores grouped by `grade_categories.id`. The pure functions take this
 * looser lookup so a screen can pass optimistic rows, a partial map, or the
 * real thing from {@link fetchGradeBook}.
 */
export type EntriesLookup = Readonly<
  Record<string, readonly EntryScore[] | undefined>
>;

/** Everything a course's grade screen needs, in one shot. */
export type GradeBook = {
  /** The course's buckets, in `position` then `created_at` order. */
  categories: GradeCategory[];
  /**
   * Scores keyed by category id. Every category in `categories` has a key
   * (an empty array when nothing's been logged there yet), so a screen can
   * index it without a fallback.
   */
  entriesByCategory: Record<string, GradeEntry[]>;
};

/** What one bucket adds up to. See {@link categoryScore}. */
export type CategoryScore = {
  /** Points scored across the bucket's entries. */
  earned: number;
  /** Points those entries were out of. Always greater than zero. */
  possible: number;
  /** `earned / possible` as a percentage, rounded to one decimal. */
  pct: number;
};

/** The headline number for a course. See {@link courseEstimate}. */
export type CourseEstimate = {
  /**
   * The weighted estimate, 0-100 (higher with extra credit), rounded to one
   * decimal, or null when there's nothing to estimate from yet.
   */
  pct: number | null;
  /**
   * How much of the grade this rests on: the share of total weight that's
   * actually been graded, 0-100. Exactly 100 only when every weighted
   * category has at least one score.
   */
  gradedWeight: number;
  /** One warm sentence naming what the number does and doesn't cover. */
  note: string;
};

/** The answer to "what do I need from here?". See {@link whatIf}. */
export type WhatIf = {
  /**
   * What the ungraded weight has to average, as a percentage, rounded UP to
   * the next tenth so hitting the number always clears the target. Null when
   * there's nothing left to average: no weights at all, or everything's
   * already graded. Above 100 when the target is out of reach.
   */
  neededPct: number | null;
  /** True when the target is still mathematically possible. */
  reachable: boolean;
  /** One warm, honest sentence, including when the honest answer is no. */
  message: string;
};

/** The letters {@link letterFor} hands back. */
export type Letter =
  | "A"
  | "A-"
  | "B+"
  | "B"
  | "B-"
  | "C+"
  | "C"
  | "C-"
  | "D+"
  | "D"
  | "D-"
  | "F";

/* ══════════════════════════════ limits ══════════════════════════════ */

/** Longest a category name may be, after trimming. Cap your input here. */
export const CATEGORY_NAME_MAX = 60;

/** Longest a score's title may be, after trimming. */
export const ENTRY_TITLE_MAX = 120;

/** Largest weight a single category may carry, matching the check constraint. */
export const WEIGHT_MAX = 100;

/** Ceiling on any points value: `numeric(8,2)` runs out here. */
export const POINTS_MAX = 999_999.99;

/**
 * The letter scale, highest cutoff first: a percentage earns the first letter
 * whose `min` it reaches. This is the common US 12-step scale; plenty of
 * syllabi differ (some award an A+ at 97, some curve, some drop a low score),
 * which is exactly why {@link letterFor} is documented as an estimate.
 */
export const LETTER_CUTOFFS: readonly { letter: Letter; min: number }[] = [
  { letter: "A", min: 93 },
  { letter: "A-", min: 90 },
  { letter: "B+", min: 87 },
  { letter: "B", min: 83 },
  { letter: "B-", min: 80 },
  { letter: "C+", min: 77 },
  { letter: "C", min: 73 },
  { letter: "C-", min: 70 },
  { letter: "D+", min: 67 },
  { letter: "D", min: 63 },
  { letter: "D-", min: 60 },
  { letter: "F", min: 0 },
];

/* ═══════════════════════ small number helpers ═══════════════════════ */

/** Float slop guard: weights and points never differ by anything this small. */
const EPSILON = 1e-9;

/** Round to one decimal: the precision every percentage is reported at. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Round to two decimals, matching the `numeric(_,2)` columns. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Round UP to one decimal, used for "you need" numbers, never down. */
function ceil1(value: number): number {
  return Math.ceil(value * 10) / 10;
}

/**
 * A percentage as a person would write it: "45", "82.4", "90". Feed it a
 * value that's already been rounded; the trailing ".0" is dropped so copy
 * reads "45%" and not "45.0%".
 */
function formatPct(value: number): string {
  const rounded = round1(value);
  return String(rounded === 0 ? 0 : rounded);
}

/** Keep a value inside `[low, high]`. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/* ════════════════════════════ the math ═════════════════════════════
 *
 * Everything below this line is pure: same inputs, same outputs, forever.
 * No clock, no network, no module state.
 */

/**
 * Add up one bucket: total points scored, total points available, and the
 * percentage between them.
 *
 * Returns **null** when the bucket has nothing to score yet: no entries at
 * all, or only malformed ones. Null is the signal a screen should render as
 * "nothing here yet" rather than as 0%, and it's what keeps an ungraded
 * bucket out of {@link courseEstimate}'s average entirely.
 *
 * Entries with a non-positive or non-finite `points_possible` are skipped
 * (the database forbids them, but optimistic local rows can be mid-typing).
 * `earned` may exceed `possible`. That's extra credit, and clamping it
 * would quietly lie about the score.
 *
 * @param entries The bucket's scores, in any order.
 * @returns Points earned, points possible, and the percentage, or null.
 */
export function categoryScore(
  entries: readonly EntryScore[] | undefined
): CategoryScore | null {
  if (!entries || entries.length === 0) return null;

  let earned = 0;
  let possible = 0;
  for (const entry of entries) {
    const out = entry.points_possible;
    const got = entry.points_earned;
    if (!Number.isFinite(out) || out <= 0) continue;
    if (!Number.isFinite(got)) continue;
    possible += out;
    earned += Math.max(got, 0);
  }
  if (possible <= 0) return null;

  return {
    earned: round2(earned),
    possible: round2(possible),
    pct: round1((earned / possible) * 100),
  };
}

/** Weight totals for a course, in "weight points" on whatever scale the
 * syllabus declared. Every course-level number is derived from these three. */
type Tally = {
  /** Every category's weight summed: the scale treated as the whole grade. */
  totalWeight: number;
  /** Weight belonging to categories that have at least one score. */
  gradedWeight: number;
  /** Weight actually earned: Σ weight × (earned ÷ possible), graded only. */
  earnedWeight: number;
};

/**
 * The one pass both course-level functions share. Categories with no weight
 * or no entries contribute nothing to `gradedWeight`/`earnedWeight`, which is
 * precisely what makes the estimate a rescale rather than an average over
 * zeros.
 */
function tally(
  categories: readonly CategoryWeight[],
  entriesByCategory: EntriesLookup
): Tally {
  let totalWeight = 0;
  let gradedWeight = 0;
  let earnedWeight = 0;

  for (const category of categories) {
    const weight = Number.isFinite(category.weight)
      ? Math.max(category.weight, 0)
      : 0;
    totalWeight += weight;
    if (weight <= 0) continue;

    const score = categoryScore(entriesByCategory[category.id]);
    if (score === null) continue;

    gradedWeight += weight;
    earnedWeight += weight * (score.earned / score.possible);
  }

  return { totalWeight, gradedWeight, earnedWeight };
}

/**
 * The course estimate, rescaled by what's actually been graded.
 *
 * A weighted average over ALL categories would read 12% in week three, when
 * the only thing back is one quiz. The missing 88% of the grade isn't a
 * zero, it just hasn't happened. So this averages over **only the categories
 * that have entries** and divides by their combined weight. Two homework
 * scores and a midterm produce the grade you'd have if the rest of the
 * quarter went the same way.
 *
 * `gradedWeight` is the share of the syllabus's total weight that estimate
 * rests on, and `note` says so in a sentence. When the weights don't sum to
 * 100 the total they DO sum to is treated as the whole grade. See
 * {@link weightWarning}, which is what tells the student that's happening.
 *
 * @param categories       The course's buckets and their weights.
 * @param entriesByCategory Scores keyed by category id, from {@link fetchGradeBook}.
 * @returns The estimate, how much of the grade it covers, and a warm note.
 */
export function courseEstimate(
  categories: readonly CategoryWeight[],
  entriesByCategory: EntriesLookup
): CourseEstimate {
  const { totalWeight, gradedWeight, earnedWeight } = tally(
    categories,
    entriesByCategory
  );

  if (totalWeight <= EPSILON) {
    return {
      pct: null,
      gradedWeight: 0,
      note: "Add your categories and their weights to see an estimate.",
    };
  }
  if (gradedWeight <= EPSILON) {
    return {
      pct: null,
      gradedWeight: 0,
      note: "Nothing's graded yet. Your first score starts the estimate.",
    };
  }

  const pct = round1((earnedWeight / gradedWeight) * 100);
  const allGraded = gradedWeight >= totalWeight - EPSILON;

  // Never let rounding claim a whole grade it doesn't have: a partially
  // graded course reports at most 99.9%, and at least 0.1%.
  const share = allGraded
    ? 100
    : clamp(round1((gradedWeight / totalWeight) * 100), 0.1, 99.9);

  return {
    pct,
    gradedWeight: share,
    note: allGraded
      ? "Everything that counts has a score, so this is your whole grade."
      : `Based on the ${formatPct(share)}% of your grade that's been graded so far.`,
  };
}

/**
 * "What do I need on the rest?" The average the ungraded weight has to hit
 * for the final grade to land on `targetPct`.
 *
 * The two edges are answered honestly rather than with a number:
 *
 *   - **Already there.** If even zeros on everything left clear the target,
 *     `neededPct` is 0 and the message says so plainly.
 *   - **Out of reach.** If a perfect finish still falls short, `reachable` is
 *     false, `neededPct` comes back above 100 (the real, impossible figure),
 *     and the message names where a perfect finish actually lands and
 *     suggests talking to the instructor. No false hope.
 *
 * `neededPct` is rounded UP to the next tenth, so a student who hits the
 * number always clears the target rather than landing a hair under it.
 *
 * @param categories        The course's buckets and their weights.
 * @param entriesByCategory Scores keyed by category id.
 * @param targetPct         The grade they're aiming for, clamped to 0-100.
 * @returns The needed average, whether it's possible, and a warm sentence.
 */
export function whatIf(
  categories: readonly CategoryWeight[],
  entriesByCategory: EntriesLookup,
  targetPct: number
): WhatIf {
  const target = Number.isFinite(targetPct) ? clamp(targetPct, 0, 100) : 0;
  const { totalWeight, gradedWeight, earnedWeight } = tally(
    categories,
    entriesByCategory
  );

  if (totalWeight <= EPSILON) {
    return {
      neededPct: null,
      reachable: false,
      message:
        "Add your categories and weights first, then we can work out what's left.",
    };
  }

  const remaining = totalWeight - gradedWeight;

  // Nothing left to move the needle: the grade is whatever it is.
  if (remaining <= EPSILON) {
    const landed = round1((earnedWeight / totalWeight) * 100);
    const reachable = landed >= target - EPSILON;
    return {
      neededPct: null,
      reachable,
      message: reachable
        ? `Everything's graded and it landed at ${formatPct(landed)}%. You made your ${formatPct(target)}%.`
        : `Everything's graded, so this one lands at ${formatPct(landed)}%. Nothing left to move it.`,
    };
  }

  // Solve (earned + remaining × x) ÷ total = target for x, as a percentage.
  const needed = (((target / 100) * totalWeight - earnedWeight) / remaining) * 100;

  if (needed <= EPSILON) {
    return {
      neededPct: 0,
      reachable: true,
      message: "You're there even if the rest goes badly.",
    };
  }

  if (needed > 100 + EPSILON) {
    const best = round1(((earnedWeight + remaining) / totalWeight) * 100);
    return {
      neededPct: ceil1(needed),
      reachable: false,
      message: `Even a perfect finish lands around ${formatPct(best)}%. Worth a talk with your instructor.`,
    };
  }

  const needs = ceil1(needed);
  return {
    neededPct: needs,
    reachable: true,
    message:
      gradedWeight <= EPSILON
        ? `Nothing's graded yet. Averaging about ${formatPct(needs)}% from here lands you at ${formatPct(target)}%.`
        : `What's left needs to average about ${formatPct(needs)}% to land at ${formatPct(target)}%.`,
  };
}

/**
 * The letter a percentage lands on, on the common US 12-step scale
 * (A 93, A- 90, B+ 87, … D- 60, F below).
 *
 * **This is an estimate, not a promise.** Instructors curve, drop a low
 * score, weight differently than the syllabus reads, and some award an A+
 * this scale doesn't have. Show the letter as a hint beside the percentage,
 * never as a grade of record.
 *
 * The percentage is rounded to one decimal before comparing, so the letter
 * always agrees with the number on screen: a displayed 90% never reads B+.
 * Null in, null out, so it can be handed {@link CourseEstimate.pct} directly.
 *
 * @param pct A percentage, 0-100 (above 100 with extra credit).
 */
export function letterFor(pct: number): Letter;
export function letterFor(pct: number | null): Letter | null;
export function letterFor(pct: number | null): Letter | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  const rounded = round1(pct);
  for (const cutoff of LETTER_CUTOFFS) {
    if (rounded >= cutoff.min) return cutoff.letter;
  }
  return "F";
}

/**
 * A warm heads-up when the weights don't add to 100. Usually that's a bucket
 * that hasn't been entered yet, sometimes a syllabus that really is 110%
 * with extra credit built in.
 *
 * Either way the estimate treats whatever the weights DO add to as the whole
 * grade, and this sentence is where the student finds that out. Returns null
 * when the weights sum to 100 (within a rounding hair) or when there are no
 * categories yet: an empty course needs an empty state, not a warning.
 *
 * @param categories The course's buckets and their weights.
 */
export function weightWarning(
  categories: readonly CategoryWeight[]
): string | null {
  if (categories.length === 0) return null;

  let total = 0;
  for (const category of categories) {
    if (Number.isFinite(category.weight)) total += Math.max(category.weight, 0);
  }
  const rounded = round2(total);

  if (rounded <= 0) {
    return "Your categories don't carry any weight yet. Add the percentages from your syllabus.";
  }
  if (Math.abs(rounded - 100) < 0.005) return null;
  if (rounded < 100) {
    return `Your weights add to ${formatPct(rounded)}%, so the estimate assumes that's the whole grade.`;
  }
  return `Your weights add to ${formatPct(rounded)}%, so the estimate scales them back to fit.`;
}

/* ═══════════════════════════ the data half ══════════════════════════
 *
 * Below this line: Supabase only. Nothing here is imported by the math.
 */

/**
 * A grade-tracker failure with a message written for a person, not a log.
 * Render `err.message` straight into an inline error. It never leaks SQL,
 * ids, or PostgREST codes.
 */
export class GradesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GradesError";
  }
}

/** Columns every screen needs off `grade_categories`. Keep selects aligned. */
const CATEGORY_SELECT =
  "id, user_id, course_id, name, weight, position, created_at";

/** Columns every screen needs off `grade_entries`. */
const ENTRY_SELECT =
  "id, user_id, category_id, title, points_earned, points_possible, recorded_at";

/* ------------------------------ client ----------------------------- */

/** One browser client for the whole tab, made on first use. */
let browserDb: Db | null = null;

/** The client to run against: the caller's, or the shared browser one. */
function db(ctx?: GradesCtx): Db {
  if (ctx?.client) return ctx.client;
  browserDb ??= createClient();
  return browserDb;
}

/* ------------------------- row normalizing ------------------------- */

/** A finite number from a JSON number or a numeric-as-string, else null. */
function num(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** A non-empty string, else null. */
function str(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * The Supabase client here is untyped, and PostgREST can hand `numeric` back
 * as a string depending on the driver, so rows are narrowed rather than
 * cast. A row missing anything the math depends on is dropped instead of
 * poisoning the estimate with NaN.
 */
function normalizeCategory(raw: unknown): GradeCategory | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const id = str(row["id"]);
  const userId = str(row["user_id"]);
  const courseId = str(row["course_id"]);
  const name = typeof row["name"] === "string" ? row["name"] : null;
  const weight = num(row["weight"]);
  if (!id || !userId || !courseId || name === null || weight === null) {
    return null;
  }
  return {
    id,
    user_id: userId,
    course_id: courseId,
    name,
    weight,
    position: num(row["position"]) ?? 0,
    created_at: str(row["created_at"]) ?? "",
  };
}

/** Same defence as {@link normalizeCategory}, for a score row. */
function normalizeEntry(raw: unknown): GradeEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const id = str(row["id"]);
  const userId = str(row["user_id"]);
  const categoryId = str(row["category_id"]);
  const title = typeof row["title"] === "string" ? row["title"] : null;
  const earned = num(row["points_earned"]);
  const possible = num(row["points_possible"]);
  if (!id || !userId || !categoryId || title === null) return null;
  if (earned === null || possible === null || possible <= 0) return null;
  return {
    id,
    user_id: userId,
    category_id: categoryId,
    title,
    points_earned: earned,
    points_possible: possible,
    recorded_at: str(row["recorded_at"]) ?? "",
  };
}

/** Narrow a list of rows, quietly dropping any that don't hold up. */
function normalizeAll<T>(
  rows: unknown,
  normalize: (raw: unknown) => T | null
): T[] {
  if (!Array.isArray(rows)) return [];
  const out: T[] = [];
  for (const row of rows) {
    const value = normalize(row);
    if (value !== null) out.push(value);
  }
  return out;
}

/* --------------------------- validation ---------------------------- */

/** Mirror the `char_length(name) between 1 and 60` check, warmly. */
function requireCategoryName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new GradesError("Give this category a name.");
  if (trimmed.length > CATEGORY_NAME_MAX) {
    throw new GradesError(
      `Category names cap out at ${CATEGORY_NAME_MAX} characters.`
    );
  }
  return trimmed;
}

/** Mirror the `weight >= 0 and weight <= 100` check, warmly. */
function requireWeight(weight: number): number {
  if (!Number.isFinite(weight) || weight < 0 || weight > WEIGHT_MAX) {
    throw new GradesError("Weights run from 0 to 100.");
  }
  return round2(weight);
}

/** Mirror the `char_length(title) between 1 and 120` check, warmly. */
function requireEntryTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) throw new GradesError("Give this score a name.");
  if (trimmed.length > ENTRY_TITLE_MAX) {
    throw new GradesError(
      `Score names cap out at ${ENTRY_TITLE_MAX} characters.`
    );
  }
  return trimmed;
}

/** Mirror `points_earned >= 0`, warmly. Extra credit above possible is fine. */
function requireEarned(points: number): number {
  if (!Number.isFinite(points) || points < 0) {
    throw new GradesError("Points earned can't be negative.");
  }
  if (points > POINTS_MAX) {
    throw new GradesError("That's more points than we can keep track of.");
  }
  return round2(points);
}

/** Mirror `points_possible > 0`, warmly, including after 2-decimal rounding. */
function requirePossible(points: number): number {
  if (!Number.isFinite(points) || points > POINTS_MAX) {
    throw new GradesError("Points possible has to be a number above zero.");
  }
  const rounded = round2(points);
  if (rounded <= 0) {
    throw new GradesError("Points possible has to be more than zero.");
  }
  return rounded;
}

/**
 * The caller's own id: theirs if they handed one over, otherwise read from
 * the stored session (no network round trip). Every insert stamps it, because
 * the RLS write policies check `user_id = auth.uid()` and a mismatched id
 * fails the policy, not a constraint, which would surface as a confusing
 * permissions error.
 */
async function requireUserId(ctx?: GradesCtx): Promise<string> {
  const given = ctx?.userId;
  if (typeof given === "string" && given.length > 0) return given;
  const { data, error } = await db(ctx).auth.getSession();
  const id = data.session?.user.id;
  if (error || !id) {
    throw new GradesError("Sign in again to pick this back up.");
  }
  return id;
}

/* ------------------------------ reads ------------------------------ */

/**
 * A course's whole gradebook: its categories in syllabus order, plus every
 * score grouped under the category it belongs to.
 *
 * Two queries, never N+1: the categories come back first, then their
 * entries in one `in(...)` lookup. RLS scopes both to the signed-in student,
 * so there's no user filter to forget. A course with no categories yet
 * returns empty and skips the second query entirely.
 *
 * Every category id appears as a key in `entriesByCategory` (empty array when
 * nothing's logged), so screens can index it without a fallback and pass the
 * result straight into {@link courseEstimate} and {@link whatIf}.
 *
 * @param courseId `courses.id` to load.
 * @throws {GradesError} With copy that's ready to render.
 */
export async function fetchGradeBook(
  courseId: string,
  ctx?: GradesCtx
): Promise<GradeBook> {
  const { data: categoryRows, error: categoryError } = await db(ctx)
    .from("grade_categories")
    .select(CATEGORY_SELECT)
    .eq("course_id", courseId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (categoryError) {
    throw new GradesError("We couldn't load your grades for this class.");
  }

  const categories = normalizeAll(categoryRows, normalizeCategory);
  const entriesByCategory: Record<string, GradeEntry[]> = {};
  for (const category of categories) entriesByCategory[category.id] = [];
  if (categories.length === 0) return { categories, entriesByCategory };

  const { data: entryRows, error: entryError } = await db(ctx)
    .from("grade_entries")
    .select(ENTRY_SELECT)
    .in(
      "category_id",
      categories.map((category) => category.id)
    )
    .order("recorded_at", { ascending: true });
  if (entryError) {
    throw new GradesError("We couldn't load your scores for this class.");
  }

  for (const entry of normalizeAll(entryRows, normalizeEntry)) {
    const bucket = entriesByCategory[entry.category_id];
    if (bucket) bucket.push(entry);
  }

  return { categories, entriesByCategory };
}

/* ------------------------- category writes ------------------------- */

/**
 * Add a bucket to a course: "Homework, 20%".
 *
 * `position` sorts the list; pass `categories.length` to append. Weights are
 * checked against the same 0-100 window the database enforces, so a typo
 * fails in the browser rather than as a constraint violation.
 *
 * @returns The saved row, ready to append to state.
 * @throws {GradesError} With copy that's ready to render.
 */
export async function createCategory(
  input: {
    /** `courses.id` the bucket belongs to. */
    courseId: string;
    /** What the syllabus calls it; trimmed, 1-60 characters. */
    name: string;
    /** Share of the final grade, 0-100. */
    weight: number;
    /** Sort order; defaults to 0. Pass `categories.length` to append. */
    position?: number;
  },
  ctx?: GradesCtx
): Promise<GradeCategory> {
  const name = requireCategoryName(input.name);
  const weight = requireWeight(input.weight);
  const userId = await requireUserId(ctx);

  const { data, error } = await db(ctx)
    .from("grade_categories")
    .insert({
      user_id: userId,
      course_id: input.courseId,
      name,
      weight,
      position: Math.max(Math.round(input.position ?? 0), 0),
    })
    .select(CATEGORY_SELECT)
    .single();

  const category = normalizeCategory(data);
  if (error || !category) {
    throw new GradesError("We couldn't save that category. Give it another go.");
  }
  return category;
}

/**
 * Rename a bucket, change its weight, or move it in the list. Only the fields
 * you pass are touched; passing none is a no-op that still returns the row.
 *
 * Safe to run optimistically: patch state, call this, roll back on a throw.
 *
 * @param id    `grade_categories.id`.
 * @param patch The fields to change.
 * @returns The saved row, so state can settle on what the server has.
 * @throws {GradesError} With copy that's ready to render.
 */
export async function updateCategory(
  id: string,
  patch: { name?: string; weight?: number; position?: number },
  ctx?: GradesCtx
): Promise<GradeCategory> {
  const update: Record<string, string | number> = {};
  if (patch.name !== undefined) update["name"] = requireCategoryName(patch.name);
  if (patch.weight !== undefined) update["weight"] = requireWeight(patch.weight);
  if (patch.position !== undefined) {
    update["position"] = Math.max(Math.round(patch.position), 0);
  }

  const { data, error } = await db(ctx)
    .from("grade_categories")
    .update(update)
    .eq("id", id)
    .select(CATEGORY_SELECT)
    .maybeSingle();
  if (error) {
    throw new GradesError("We couldn't save that change. Give it another go.");
  }

  const category = normalizeCategory(data);
  // Zero rows updated isn't an error to PostgREST. The row is gone.
  if (!category) throw new GradesError("That category isn't there anymore.");
  return category;
}

/**
 * Delete a bucket. **Its scores go with it**: `grade_entries.category_id`
 * cascades, so confirm before calling, and mention what's being lost.
 *
 * @param id `grade_categories.id`.
 * @throws {GradesError} With copy that's ready to render.
 */
export async function deleteCategory(
  id: string,
  ctx?: GradesCtx
): Promise<void> {
  const { error } = await db(ctx)
    .from("grade_categories")
    .delete()
    .eq("id", id);
  if (error) {
    throw new GradesError("We couldn't delete that category. Try again.");
  }
}

/* --------------------------- entry writes -------------------------- */

/**
 * Log a score inside a bucket: "Problem Set 3, 18 out of 20".
 *
 * `pointsEarned` may exceed `pointsPossible`; that's extra credit, and the
 * math carries it through rather than clamping. `recorded_at` defaults to now
 * in the database, so nothing here reads the clock.
 *
 * @returns The saved row, ready to append to state.
 * @throws {GradesError} With copy that's ready to render.
 */
export async function createEntry(
  input: {
    /** `grade_categories.id` the score sits in. */
    categoryId: string;
    /** What the assignment was called; trimmed, 1-120 characters. */
    title: string;
    /** Points scored; zero or more. */
    pointsEarned: number;
    /** Points it was out of; above zero. */
    pointsPossible: number;
  },
  ctx?: GradesCtx
): Promise<GradeEntry> {
  const title = requireEntryTitle(input.title);
  const earned = requireEarned(input.pointsEarned);
  const possible = requirePossible(input.pointsPossible);
  const userId = await requireUserId(ctx);

  const { data, error } = await db(ctx)
    .from("grade_entries")
    .insert({
      user_id: userId,
      category_id: input.categoryId,
      title,
      points_earned: earned,
      points_possible: possible,
    })
    .select(ENTRY_SELECT)
    .single();

  const entry = normalizeEntry(data);
  if (error || !entry) {
    throw new GradesError("We couldn't save that score. Give it another go.");
  }
  return entry;
}

/**
 * Fix a score: rename it, or correct either points value. Only the fields you
 * pass are touched. Safe to run optimistically.
 *
 * @param id    `grade_entries.id`.
 * @param patch The fields to change.
 * @returns The saved row, so state can settle on what the server has.
 * @throws {GradesError} With copy that's ready to render.
 */
export async function updateEntry(
  id: string,
  patch: { title?: string; pointsEarned?: number; pointsPossible?: number },
  ctx?: GradesCtx
): Promise<GradeEntry> {
  const update: Record<string, string | number> = {};
  if (patch.title !== undefined) update["title"] = requireEntryTitle(patch.title);
  if (patch.pointsEarned !== undefined) {
    update["points_earned"] = requireEarned(patch.pointsEarned);
  }
  if (patch.pointsPossible !== undefined) {
    update["points_possible"] = requirePossible(patch.pointsPossible);
  }

  const { data, error } = await db(ctx)
    .from("grade_entries")
    .update(update)
    .eq("id", id)
    .select(ENTRY_SELECT)
    .maybeSingle();
  if (error) {
    throw new GradesError("We couldn't save that change. Give it another go.");
  }

  const entry = normalizeEntry(data);
  if (!entry) throw new GradesError("That score isn't there anymore.");
  return entry;
}

/**
 * Remove a score. The bucket stays; if it was the last score in it, the
 * bucket drops back out of the estimate and {@link categoryScore} returns
 * null for it again.
 *
 * @param id `grade_entries.id`.
 * @throws {GradesError} With copy that's ready to render.
 */
export async function deleteEntry(id: string, ctx?: GradesCtx): Promise<void> {
  const { error } = await db(ctx).from("grade_entries").delete().eq("id", id);
  if (error) {
    throw new GradesError("We couldn't delete that score. Try again.");
  }
}
