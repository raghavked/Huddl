import { describe, expect, it } from "vitest";
import {
  COURSE_TINT_CLASSES,
  COURSE_TINT_KEYS,
  COURSE_TINT_LABELS,
  asCourseTint,
  colorForCourse,
  courseTintClasses,
  type CourseTint,
} from "@/lib/course-color";

/* Course tints, exercised on plain strings.
 *
 * The whole point of the hash is that it is boring and forever: ECS 36A is
 * the same colour on a laptop, on a phone, after a reinstall, and, on the web,
 * across a server render and the hydration that follows it. So the
 * assertions below lock in the actual bucket for a handful of real UC Davis
 * codes rather than only asserting "it returns something".
 *
 * If one of those expectations ever fails, that is not a flaky test. It means
 * the hash, the normalizer, or the order of COURSE_TINT_KEYS changed, and
 * every student who never opened the picker just had their whole term
 * re-coloured. Change the expectation only when that is the intended edit.
 */

/* --------------------------- the palette itself --------------------------- */

describe("the palette", () => {
  it("offers six tints in picker order", () => {
    expect(COURSE_TINT_KEYS).toEqual([
      "ember",
      "fern",
      "clay",
      "plum",
      "sky",
      "sand",
    ]);
  });

  it("gives every tint a label and a soft/ink class pair", () => {
    for (const tint of COURSE_TINT_KEYS) {
      expect(COURSE_TINT_LABELS[tint]).toBeTruthy();
      const classes = courseTintClasses(tint);
      expect(classes.soft).toBe(`bg-course-${tint}-soft`);
      expect(classes.ink).toBe(`text-course-${tint}-ink`);
      expect(classes.chip).toBe(`${classes.soft} ${classes.ink}`);
    }
  });

  it("spells its class names out so Tailwind can find them", () => {
    // Composed at runtime they would never be generated; see the note at the
    // top of course-color.ts. A literal check is the cheapest guard we have.
    expect(COURSE_TINT_CLASSES.plum.chip).toBe(
      "bg-course-plum-soft text-course-plum-ink"
    );
  });
});

/* ------------------------------ asCourseTint ------------------------------ */

describe("asCourseTint: reading a stored value back", () => {
  it("accepts every tint we store", () => {
    for (const tint of COURSE_TINT_KEYS) {
      expect(asCourseTint(tint)).toBe(tint);
    }
  });

  it("is generous about case and whitespace", () => {
    expect(asCourseTint(" Ember")).toBe("ember");
    expect(asCourseTint("SKY ")).toBe("sky");
  });

  it("is null for nothing, blank, and anything off the palette", () => {
    expect(asCourseTint(null)).toBeNull();
    expect(asCourseTint(undefined)).toBeNull();
    expect(asCourseTint("")).toBeNull();
    expect(asCourseTint("   ")).toBeNull();
    expect(asCourseTint("teal")).toBeNull();
  });
});

/* ----------------------------- colorForCourse ----------------------------- */

describe("colorForCourse: the student's pick wins", () => {
  it("uses an explicit choice whatever the code hashes to", () => {
    expect(colorForCourse("plum", "ECS 36A")).toBe("plum");
    expect(colorForCourse("plum", "BIS 2A")).toBe("plum");
  });

  it("falls through to the hash for null, blank, and unknown values", () => {
    const hashed = colorForCourse(null, "ECS 36A");
    expect(colorForCourse(undefined, "ECS 36A")).toBe(hashed);
    expect(colorForCourse("", "ECS 36A")).toBe(hashed);
    // A value from a newer client re-hashes rather than going grey.
    expect(colorForCourse("chartreuse", "ECS 36A")).toBe(hashed);
  });
});

describe("colorForCourse: the hash is stable and spelling-blind", () => {
  /* Locked-in buckets. See the note at the top of this file before editing. */
  const KNOWN: readonly [string, CourseTint][] = [
    ["ECS 36A", "ember"],
    ["ECS 122A", "clay"],
    ["MAT 21A", "sand"],
    ["BIS 2A", "ember"],
    ["CHE 2B", "sand"],
    ["STA 13", "fern"],
  ];

  it.each(KNOWN)("puts %s on %s, every time", (code, tint) => {
    expect(colorForCourse(null, code)).toBe(tint);
    // Same call, same answer: no module state, no clock, no counter.
    expect(colorForCourse(null, code)).toBe(tint);
  });

  it("reads one course out of four spellings", () => {
    const spellings = ["ECS 36A", "ecs 36a", "ECS36A", "ECS-36A", " ecs-36A "];
    const tints = spellings.map((code) => colorForCourse(null, code));
    expect(new Set(tints).size).toBe(1);
  });

  it("lands on ember when there is nothing left to hash", () => {
    expect(colorForCourse(null, "")).toBe("ember");
    expect(colorForCourse(null, "///")).toBe("ember");
  });

  it("spreads a real course list over more than one colour", () => {
    // Six buckets collide sometimes, which is the documented cost of a
    // stateless rule, but a whole catalogue landing on one tint would mean the
    // hash had stopped working.
    const catalogue = [
      "ECS 36A",
      "ECS 36B",
      "ECS 50",
      "ECS 60",
      "MAT 21A",
      "MAT 21B",
      "MAT 22A",
      "STA 13",
      "BIS 2A",
      "BIS 2B",
      "CHE 2A",
      "CHE 2B",
      "PHY 9A",
      "PSC 1",
      "ECN 1A",
      "ENL 3",
      "HIS 17A",
      "ANT 2",
    ];
    const used = new Set(catalogue.map((code) => colorForCourse(null, code)));
    expect(used.size).toBeGreaterThanOrEqual(5);
  });
});
