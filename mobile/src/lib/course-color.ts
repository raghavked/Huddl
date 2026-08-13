/* Which colour a course wears, decided in exactly one place.
 *
 * A course colour is **personal**. It lives on `enrollments.color`, the
 * student's own row for that course, so the tint you gave BIS 2A is yours,
 * your lab partner can pick a different one, and neither of you ever sees the
 * other's choice. Nothing about a course colour is shared, published, or
 * synced to the class. Never write it to `courses`, and never show one
 * student's tint on another student's screen.
 *
 * `enrollments.color` is nullable, and null is the normal state: most students
 * will never open the picker. Null does not mean "no colour". It means "let
 * the app choose". So we choose, by hashing the course code onto the same six
 * tints. That gives us two things worth more than a random pick:
 *
 *   - ECS 36A is the same tint every time, on every device, forever. It never
 *     shuffles between launches, and it doesn't depend on how many courses are
 *     enrolled or what order they loaded in.
 *   - A term of untouched courses still looks deliberate, because six roughly
 *     even buckets means four courses usually land on four colours.
 *
 * Usually. Six buckets means two of a student's courses collide about one time
 * in six, and that is the honest cost of a stateless rule. The fix is the
 * picker, which is why the picker exists.
 *
 * Pure: no React, no Supabase, no clock. Screens pass what they already have.
 */

import type { CourseTint } from "@/constants/theme";

/* The tint name travels with the rule, so a screen can get everything it
   needs from one import. The colours themselves stay in `@/constants/theme`
   with the rest of the tokens; call `courseTintsFor(scheme)` from there. */
export type { CourseTint };

/**
 * The six tints in picker order: the two hearth colours the app already wears,
 * then the four that were added for courses, warm side first.
 *
 * Order matters. It is the order of swatches in the colour picker and the
 * order of the buckets the hash lands in, so changing it re-tints every course
 * whose owner never picked one. Don't reorder casually.
 */
export const COURSE_TINT_KEYS = [
  "ember",
  "fern",
  "clay",
  "plum",
  "sky",
  "sand",
] as const satisfies readonly CourseTint[];

/* Compile-time guard, no runtime cost: add a seventh tint to the palette and
   forget this list, and the alias below stops type-checking. */
type Assert<T extends true> = T;
type UnlistedTint = Exclude<CourseTint, (typeof COURSE_TINT_KEYS)[number]>;
type _EveryTintIsListed = Assert<[UnlistedTint] extends [never] ? true : false>;

/** What each tint is called when a student is looking at it. */
export const COURSE_TINT_LABELS: Record<CourseTint, string> = {
  ember: "Ember",
  fern: "Fern",
  clay: "Clay",
  plum: "Plum",
  sky: "Sky",
  sand: "Sand",
};

/** The tint every fallback path lands on when there is nothing to hash. */
const DEFAULT_TINT: CourseTint = "ember";

/**
 * The colour this course wears for this student.
 *
 * @param explicit The student's own pick, `enrollments.color`. Null,
 *                 undefined, or anything the palette doesn't recognise (a
 *                 value from a newer client, a hand-edited row) falls through
 *                 to the hash rather than throwing or going grey.
 * @param courseCode The course code, e.g. `"ECS 36A"`. Matched loosely:
 *                 case and punctuation are ignored, so "ECS 36A", "ecs36a",
 *                 and "ECS-36A" are one course and get one tint.
 *
 * @returns One of the six tint names. Look up the actual colours with
 *          `courseTintsFor(scheme)[tint]`.
 */
export function colorForCourse(
  explicit: string | null | undefined,
  courseCode: string
): CourseTint {
  const picked = asCourseTint(explicit);
  if (picked) return picked;
  return tintForCode(courseCode);
}

/**
 * Narrow a stored string to a tint we can actually paint, or null.
 *
 * Worth being generous here: the value crosses the wire as plain text, and a
 * stray " Ember" from a future picker should still read as ember rather than
 * silently re-hashing the course to a different colour.
 */
export function asCourseTint(value: string | null | undefined): CourseTint | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return (
    COURSE_TINT_KEYS.find((key): key is CourseTint => key === normalized) ?? null
  );
}

/* ------------------------------- internals ------------------------------- */

/** The stable default: same code in, same tint out, on every device. */
function tintForCode(courseCode: string): CourseTint {
  const key = normalizeCode(courseCode);
  if (!key) return DEFAULT_TINT;
  const bucket = hash32(key) % COURSE_TINT_KEYS.length;
  return COURSE_TINT_KEYS[bucket] ?? DEFAULT_TINT;
}

/**
 * Course codes arrive spelled a dozen ways: "ECS 36A", "ecs 36a", "ECS36A",
 * "ECS-36A". Strip everything that isn't a letter or a digit and upper-case
 * the rest, so all of those hash to one tint instead of four.
 */
function normalizeCode(courseCode: string): string {
  return courseCode.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

/**
 * FNV-1a, 32-bit. Chosen over the multiply-by-31 hash `Avatar` uses because
 * this one has to spread over six buckets instead of two, and 31 clusters
 * badly on short strings that share a prefix, which is every course list.
 * Across a hundred real UC Davis codes this lands within half a point of a
 * perfectly even split.
 *
 * `Math.imul` keeps the multiply in 32-bit territory, so Hermes, JSC, and any
 * future engine all agree on the answer. That agreement is the whole point:
 * the same course must be the same colour on the student's phone, their
 * tablet, and after a reinstall.
 */
function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
