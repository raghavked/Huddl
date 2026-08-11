/* Which colour a course wears, decided in exactly one place.
 *
 * A course colour is **personal**. It lives on `enrollments.color` — the
 * student's own row for that course — so the tint you gave BIS 2A is yours,
 * your lab partner can pick a different one, and neither of you ever sees the
 * other's choice. Nothing about a course colour is shared, published, or
 * synced to the class. Never write it to `courses`, and never show one
 * student's tint on another student's screen.
 *
 * `enrollments.color` is nullable, and null is the normal state: most students
 * will never open the picker. Null does not mean "no colour" — it means "let
 * the app choose". So we choose, by hashing the course code onto the same six
 * tints. That gives us two things worth more than a random pick:
 *
 *   - ECS 36A is the same tint every time, on every device, forever. It never
 *     shuffles between page loads, and it doesn't depend on how many courses
 *     are enrolled or what order they loaded in.
 *   - A term of untouched courses still looks deliberate, because six roughly
 *     even buckets means four courses usually land on four colours.
 *
 * Usually. Six buckets means two of a student's courses collide about one time
 * in six, and that is the honest cost of a stateless rule — the fix is the
 * picker, which is why the picker exists.
 *
 * Pure: no React, no Supabase, no clock. Pages pass what they already have.
 *
 * WHERE THE PAINT LIVES. The colours themselves are CSS custom properties in
 * `src/app/globals.css`, both themes, alongside the rest of the hearth tokens.
 * This file carries the Tailwind class names for them because they cannot be
 * composed at runtime: `bg-course-${tint}-soft` is a string Tailwind's scanner
 * never sees, and the utility would simply not be generated. So the twelve
 * class names are spelled out once, here, in {@link COURSE_TINT_CLASSES}.
 */

/**
 * The six colours a student can hang on a course, matching the values
 * `enrollments.color` accepts (migration 0032's check constraint).
 */
export type CourseTint = "ember" | "fern" | "clay" | "plum" | "sky" | "sand";

/**
 * One tint, as a page uses it: the wash a course sits on, and the ink that
 * reads on that wash.
 *
 * `soft` is a fill — a chip, a course card's icon tile, a swatch in the
 * picker. `ink` is the text and the icons *on* that fill. `chip` is the pair
 * together, which is what almost every caller actually wants.
 */
export type CourseTintClasses = {
  /** Background utility for the wash, e.g. `bg-course-plum-soft`. */
  soft: string;
  /** Text utility for the ink, e.g. `text-course-plum-ink`. */
  ink: string;
  /** `soft` and `ink` together — the one-line answer for a chip or a tile. */
  chip: string;
};

/**
 * The table everything else here is derived from: picker order, the label a
 * student reads, and the two utilities that paint it.
 *
 * Order matters twice over — it is the order of swatches in the colour picker
 * AND the order of the buckets the hash lands in, so re-ordering these keys
 * re-tints every course whose owner never picked one. Don't reorder casually.
 *
 * Typed `Record<CourseTint, …>`, which is the exhaustiveness guard: add a
 * seventh tint to the union and this object stops type-checking until it is
 * given a row, so the picker, the labels and the hash buckets can never drift
 * out of step with the palette.
 */
const TINTS = {
  /* The brand pair, verbatim: brand-soft / brand-ink. */
  ember: {
    label: "Ember",
    soft: "bg-course-ember-soft",
    ink: "text-course-ember-ink",
    chip: "bg-course-ember-soft text-course-ember-ink",
  },
  /* The accent pair, verbatim: accent-soft / accent. */
  fern: {
    label: "Fern",
    soft: "bg-course-fern-soft",
    ink: "text-course-fern-ink",
    chip: "bg-course-fern-soft text-course-fern-ink",
  },
  clay: {
    label: "Clay",
    soft: "bg-course-clay-soft",
    ink: "text-course-clay-ink",
    chip: "bg-course-clay-soft text-course-clay-ink",
  },
  plum: {
    label: "Plum",
    soft: "bg-course-plum-soft",
    ink: "text-course-plum-ink",
    chip: "bg-course-plum-soft text-course-plum-ink",
  },
  sky: {
    label: "Sky",
    soft: "bg-course-sky-soft",
    ink: "text-course-sky-ink",
    chip: "bg-course-sky-soft text-course-sky-ink",
  },
  sand: {
    label: "Sand",
    soft: "bg-course-sand-soft",
    ink: "text-course-sand-ink",
    chip: "bg-course-sand-soft text-course-sand-ink",
  },
} as const satisfies Record<CourseTint, CourseTintClasses & { label: string }>;

/**
 * The six tints in picker order: the two hearth colours the app already wears,
 * then the four that were added for courses, warm side first.
 *
 * Derived from {@link TINTS} rather than written out a second time, so the
 * list cannot go stale. Object key order is insertion order for string keys,
 * which is exactly the order above.
 */
export const COURSE_TINT_KEYS = Object.keys(TINTS) as readonly CourseTint[];

/** What each tint is called when a student is looking at it. */
export const COURSE_TINT_LABELS: Record<CourseTint, string> = {
  ember: TINTS.ember.label,
  fern: TINTS.fern.label,
  clay: TINTS.clay.label,
  plum: TINTS.plum.label,
  sky: TINTS.sky.label,
  sand: TINTS.sand.label,
};

/**
 * The Tailwind utilities that paint each tint.
 *
 * `courseTintClasses(colorForCourse(enrollment.color, course.code)).chip` is
 * the whole idiom — a soft fill and the ink that reads on it, in both themes,
 * with no branching on the theme in a component.
 */
export const COURSE_TINT_CLASSES: Record<CourseTint, CourseTintClasses> = TINTS;

/** The tint every fallback path lands on when there is nothing to hash. */
const DEFAULT_TINT: CourseTint = "ember";

/**
 * The colour this course wears for this student.
 *
 * @param explicit The student's own pick — `enrollments.color`. Null,
 *                 undefined, or anything the palette doesn't recognise (a
 *                 value from a newer client, a hand-edited row) falls through
 *                 to the hash rather than throwing or going grey.
 * @param courseCode The course code, e.g. `"ECS 36A"`. Matched loosely:
 *                 case and punctuation are ignored, so "ECS 36A", "ecs36a",
 *                 and "ECS-36A" are one course and get one tint.
 *
 * @returns One of the six tint names. Paint it with
 *          {@link courseTintClasses}.
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
export function asCourseTint(
  value: string | null | undefined
): CourseTint | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return COURSE_TINT_KEYS.find((key) => key === normalized) ?? null;
}

/** The utilities for one tint. See {@link COURSE_TINT_CLASSES}. */
export function courseTintClasses(tint: CourseTint): CourseTintClasses {
  return COURSE_TINT_CLASSES[tint];
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
 * Course codes arrive spelled a dozen ways — "ECS 36A", "ecs 36a", "ECS36A",
 * "ECS-36A". Strip everything that isn't a letter or a digit and upper-case
 * the rest, so all of those hash to one tint instead of four.
 */
function normalizeCode(courseCode: string): string {
  return courseCode.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

/**
 * FNV-1a, 32-bit. Chosen over the multiply-by-31 hash `Avatar` uses because
 * this one has to spread over six buckets instead of two, and 31 clusters
 * badly on short strings that share a prefix — which is every course list.
 * Across a hundred real UC Davis codes this lands within half a point of a
 * perfectly even split.
 *
 * `Math.imul` keeps the multiply in 32-bit territory, so every engine agrees
 * on the answer — and, more to the point here, so the server render and the
 * browser hydration agree. That agreement is the whole reason this is a hash
 * and not a counter: the same course must be the same colour on the phone,
 * the laptop, and after a sign-out.
 */
function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
