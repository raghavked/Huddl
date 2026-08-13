import { describe, expect, it } from "vitest";
import {
  GRADE_POINTS,
  formatGpa,
  gradePointFor,
  SemesterError,
  semesterEstimate,
  totalUnits,
  unitsFrom,
  type SemesterCourseInput,
} from "@/lib/semester";

/* The semester math, exercised on plain object literals.
 *
 * Everything under test is pure (no Supabase, no clock), so each case is
 * numbers in, a number and one sentence out. The sentences are asserted in
 * full, because that copy IS the feature: a student reads "Two classes are
 * missing their units, so this is a plain average" and knows exactly what the
 * figure above it means. A GPA with no honest note attached is a number
 * pretending to be a fact.
 *
 * Percentages are chosen to sit comfortably inside a letter band (95 is an A,
 * 85 a B, 75 a C) so no assertion here is one rounding hair away from
 * flipping to a neighbouring grade point.
 */

/* --------------------------------- fixtures ------------------------------- */

function course(
  code: string,
  units: number | null,
  pct: number | null
): SemesterCourseInput {
  return { courseId: `id-${code}`, code, units, estimate: { pct } };
}

/* ------------------------------ gradePointFor ----------------------------- */

describe("gradePointFor: one percentage on the 4.0 scale", () => {
  it("reads the same cutoffs the letter does", () => {
    expect(gradePointFor(95)).toBe(GRADE_POINTS.A);
    expect(gradePointFor(90)).toBe(GRADE_POINTS["A-"]);
    expect(gradePointFor(89.9)).toBe(GRADE_POINTS["B+"]);
    expect(gradePointFor(59)).toBe(GRADE_POINTS.F);
  });

  it("tops out at an A, because there is no A+ on this scale", () => {
    expect(gradePointFor(100)).toBe(4);
    expect(gradePointFor(112)).toBe(4);
  });

  it("is null for a class with nothing to letter", () => {
    expect(gradePointFor(null)).toBeNull();
  });
});

/* ------------------------------- formatGpa -------------------------------- */

describe("formatGpa: the way a person writes one", () => {
  it("always shows two decimals", () => {
    expect(formatGpa(3.4)).toBe("3.40");
    expect(formatGpa(4)).toBe("4.00");
    expect(formatGpa(0)).toBe("0.00");
  });

  it("is null in, null out, so a page picks its own placeholder", () => {
    expect(formatGpa(null)).toBeNull();
    expect(formatGpa(Number.NaN)).toBeNull();
  });
});

/* ------------------------------- totalUnits ------------------------------- */

describe("totalUnits: only what we actually know", () => {
  it("adds the classes whose units are filled in", () => {
    expect(totalUnits([course("A", 4, 90), course("B", 3, null)])).toBe(7);
  });

  it("skips the unknowns rather than counting them as zero", () => {
    expect(totalUnits([course("A", 4, 90), course("B", null, 90)])).toBe(4);
    expect(totalUnits([course("A", 0, 90), course("B", -2, 90)])).toBeNull();
  });

  it("is null when nobody has filled any in, so the line can be left out", () => {
    expect(totalUnits([])).toBeNull();
    expect(totalUnits([course("A", null, 90)])).toBeNull();
  });

  it("rounds a fractional total to two decimals", () => {
    expect(totalUnits([course("A", 1.5, 90), course("B", 2.5, 90)])).toBe(4);
  });
});

/* ---------------------------- semesterEstimate ---------------------------- */

describe("semesterEstimate: nothing to average yet", () => {
  it("invites a student with no classes to add some", () => {
    expect(semesterEstimate([])).toEqual({
      gpa: null,
      graded: 0,
      total: 0,
      unweighted: false,
      note: "Add your classes to see where the semester stands.",
    });
  });

  it("says why the number is missing when the classes are there", () => {
    const summary = semesterEstimate([
      course("ECS 36A", 4, null),
      course("MAT 21A", 4, null),
    ]);
    expect(summary.gpa).toBeNull();
    expect(summary.graded).toBe(0);
    expect(summary.total).toBe(2);
    expect(summary.note).toBe(
      "Nothing's graded yet. Your first score in any class starts this off."
    );
  });
});

describe("semesterEstimate: weighted by units", () => {
  it("weights each class by what it's worth", () => {
    // A (4.0) over five units and a C (2.0) over one: 22 / 6.
    const summary = semesterEstimate([
      course("ECS 36A", 5, 95),
      course("PHE 1", 1, 75),
    ]);
    expect(summary.gpa).toBe(3.67);
    expect(summary.unweighted).toBe(false);
    expect(summary.note).toBe("Weighted by units across all two of your classes.");
  });

  it("counts only the graded classes, and says how many that was", () => {
    const summary = semesterEstimate([
      course("ECS 36A", 4, 95),
      course("MAT 21A", 4, 85),
      course("BIS 2A", 4, null),
    ]);
    // (4.0 + 3.0) / 2; the ungraded class is left out, not folded in as a 0.
    expect(summary.gpa).toBe(3.5);
    expect(summary.graded).toBe(2);
    expect(summary.total).toBe(3);
    expect(summary.note).toBe(
      "Weighted by units across the two classes that have grades so far."
    );
  });

  it("never counts an ungraded class as a zero", () => {
    const alone = semesterEstimate([course("ECS 36A", 4, 95)]);
    const withGhost = semesterEstimate([
      course("ECS 36A", 4, 95),
      course("MAT 21A", 4, null),
    ]);
    expect(withGhost.gpa).toBe(alone.gpa);
  });
});

describe("semesterEstimate: units missing, so the whole thing rescales", () => {
  it("falls back to a plain mean and names how many classes are short", () => {
    // Weighted this would be 4.6/1.2 ≈ 3.83; unweighted it is (4 + 2) / 2.
    const summary = semesterEstimate([
      course("ECS 36A", 5, 95),
      course("PHE 1", null, 75),
    ]);
    expect(summary.gpa).toBe(3);
    expect(summary.unweighted).toBe(true);
    expect(summary.note).toBe(
      "One class is missing its units, so this is a plain average."
    );
  });

  it("says both things at once when coverage is partial too", () => {
    const summary = semesterEstimate([
      course("ECS 36A", null, 95),
      course("MAT 21A", null, 85),
      course("BIS 2A", 4, 75),
      course("CHE 2A", 4, null),
    ]);
    expect(summary.gpa).toBe(3);
    expect(summary.unweighted).toBe(true);
    expect(summary.note).toBe(
      "Two classes are missing their units, so this is a plain average of the three classes with grades so far."
    );
  });

  it("only cares about units on classes that are actually graded", () => {
    // The unit-less class has no scores, so it can't tip the average.
    const summary = semesterEstimate([
      course("ECS 36A", 5, 95),
      course("MAT 21A", 3, 85),
      course("SEM 1", null, null),
    ]);
    expect(summary.unweighted).toBe(false);
    expect(summary.gpa).toBe(3.63); // (4·5 + 3·3) / 8
  });

  it("treats zero and a negative as unknown, not as worth nothing", () => {
    const summary = semesterEstimate([
      course("ECS 36A", 0, 95),
      course("MAT 21A", 4, 85),
    ]);
    expect(summary.unweighted).toBe(true);
    expect(summary.gpa).toBe(3.5);
  });
});

describe("semesterEstimate: a single class carries the whole number", () => {
  it("names the class instead of explaining the weighting", () => {
    const summary = semesterEstimate([
      course("ECS 36A", 4, 95),
      course("MAT 21A", 4, null),
    ]);
    expect(summary.gpa).toBe(4);
    expect(summary.note).toBe(
      "Only ECS 36A has scores so far, so this is that class on its own."
    );
  });

  it("says so even when that one class has no units", () => {
    const summary = semesterEstimate([course("ECS 36A", null, 85)]);
    expect(summary.gpa).toBe(3);
    // One class weighted by its own units is the same number either way, so
    // the missing-units sentence would be noise here.
    expect(summary.unweighted).toBe(true);
    expect(summary.note).toBe(
      "Only ECS 36A has scores so far, so this is that class on its own."
    );
  });

  it("falls back to 'one class' when the code didn't come through", () => {
    expect(semesterEstimate([course("", 4, 95)]).note).toBe(
      "Only one class has scores so far, so this is that class on its own."
    );
  });
});

describe("semesterEstimate: the number itself", () => {
  it("rounds to the two decimals a GPA is reported at", () => {
    // (4·3 + 3·4) / 7 = 3.4285…
    expect(
      semesterEstimate([course("A", 3, 95), course("B", 4, 85)]).gpa
    ).toBe(3.43);
  });

  it("is never NaN, whatever the units look like", () => {
    for (const units of [null, 0, -4, Number.NaN, Number.POSITIVE_INFINITY]) {
      const summary = semesterEstimate([
        course("A", units, 95),
        course("B", units, 85),
      ]);
      expect(Number.isFinite(summary.gpa)).toBe(true);
    }
  });

  it("counts past ten in digits rather than inventing more words", () => {
    const many = Array.from({ length: 12 }, (_, i) => course(`C${i}`, 4, 95));
    expect(semesterEstimate(many).note).toBe(
      "Weighted by units across all 12 of your classes."
    );
  });
});

/* ---------------------------------- units --------------------------------- */

describe("unitsFrom", () => {
  it("reads a whole or fractional unit count", () => {
    expect(unitsFrom("4")).toBe(4);
    expect(unitsFrom("1.5")).toBe(1.5);
    expect(unitsFrom(" 3 ")).toBe(3);
  });

  it("treats a blank field as clearing, not as an error", () => {
    // Null is a real value here: the overview reports "missing its units"
    // honestly rather than papering over it with a default, so a student has
    // to be able to take a wrong number back out.
    expect(unitsFrom("")).toBeNull();
    expect(unitsFrom("   ")).toBeNull();
    expect(unitsFrom(null)).toBeNull();
    expect(unitsFrom(undefined)).toBeNull();
  });

  it("refuses a number the GPA would be wrong to trust", () => {
    expect(() => unitsFrom("four")).toThrow(SemesterError);
    expect(() => unitsFrom("four")).toThrow(
      "Units should be a number, like 4 or 1.5. Leave it blank if you're not sure."
    );
  });

  it("holds the same 0.5 to 30 range the RPC enforces", () => {
    expect(unitsFrom("0.5")).toBe(0.5);
    expect(unitsFrom("30")).toBe(30);
    expect(() => unitsFrom("0.4")).toThrow("Units run 0.5 to 30.");
    expect(() => unitsFrom("31")).toThrow("Units run 0.5 to 30.");
    expect(() => unitsFrom("0")).toThrow("Units run 0.5 to 30.");
    expect(() => unitsFrom("-4")).toThrow("Units run 0.5 to 30.");
  });

  it("trims excess precision rather than storing a long decimal", () => {
    // Units are a coarse quantity (1, 1.5, 3, 4), so two places is all the
    // precision the column ever needs, and a pasted 3.333333 should not be
    // what a whole class's GPA is weighted by.
    expect(unitsFrom("3.333333")).toBe(3.33);
    expect(unitsFrom("4.567")).toBe(4.57);
  });
});
