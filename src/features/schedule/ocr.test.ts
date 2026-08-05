import { describe, expect, it } from "vitest";
import {
  extractCourseCodes,
  matchToCourses,
  normalizeCourseCode,
} from "@/features/schedule/ocr";
import type { Course } from "@/lib/types";

function course(overrides: Partial<Course> & { id: string; code: string }): Course {
  return {
    university_id: "uni-1",
    term_id: "term-1",
    title: overrides.code,
    canvas_course_id: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("extractCourseCodes", () => {
  it("finds spaced, hyphenated and glued codes", () => {
    const text = "CS 101 Intro to CS\nMATH-221A Linear Algebra\nPSYCH100 Lecture";
    expect(extractCourseCodes(text)).toEqual(["CS 101", "MATH 221A", "PSYCH 100"]);
  });

  it("normalizes to uppercase DEPT NUM", () => {
    expect(extractCourseCodes("cs101 and math-221a")).toEqual([
      "CS 101",
      "MATH 221A",
    ]);
  });

  it("keeps an optional trailing section letter and 4-digit numbers", () => {
    expect(extractCourseCodes("ENGR 2210B and HIST 30")).toEqual([
      "ENGR 2210B",
      "HIST 30",
    ]);
  });

  it("dedupes different spellings of the same code, keeping first-seen order", () => {
    const text = "BIO 200, bio-200, BIO200, then CHEM 111";
    expect(extractCourseCodes(text)).toEqual(["BIO 200", "CHEM 111"]);
  });

  it("ignores schedule noise like rooms, days, months and terms", () => {
    const text =
      "Fall 2026 · MWF 10:00 Room 204 Hall 3 · TTh 12:30 · starts Aug 25 Sec 002";
    expect(extractCourseCodes(text)).toEqual([]);
  });

  it("respects word boundaries and digit limits", () => {
    // Letters buried in longer words, 1-digit and 5-digit numbers don't count.
    const text = "Professor101 says CS 1 is easy but CS 12345 is not real";
    expect(extractCourseCodes(text)).toEqual([]);
  });

  it("requires 2-5 letters for the department", () => {
    expect(extractCourseCodes("A 101 BIOLOGY 101")).toEqual([]);
  });

  it("returns an empty list for empty text", () => {
    expect(extractCourseCodes("")).toEqual([]);
  });
});

describe("normalizeCourseCode", () => {
  it("collapses case, spaces and separators", () => {
    expect(normalizeCourseCode("cs 101")).toBe("CS101");
    expect(normalizeCourseCode("CS-101")).toBe("CS101");
    expect(normalizeCourseCode("Math  221a")).toBe("MATH221A");
  });
});

describe("matchToCourses", () => {
  const catalog = [
    course({ id: "c1", code: "CS 101", title: "Intro to Computer Science" }),
    course({ id: "c2", code: "MATH-221A", title: "Linear Algebra" }),
    course({ id: "c3", code: "psych100", title: "Intro Psychology" }),
  ];

  it("matches case-, space- and hyphen-insensitively", () => {
    const { matched, unmatched } = matchToCourses(
      ["CS 101", "MATH 221A", "PSYCH 100"],
      catalog
    );
    expect(matched.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(unmatched).toEqual([]);
  });

  it("reports codes with no catalog hit as unmatched", () => {
    const { matched, unmatched } = matchToCourses(
      ["CS 101", "ART 310"],
      catalog
    );
    expect(matched.map((c) => c.id)).toEqual(["c1"]);
    expect(unmatched).toEqual(["ART 310"]);
  });

  it("dedupes matched courses when several codes hit the same course", () => {
    const { matched } = matchToCourses(["CS 101", "cs-101"], catalog);
    expect(matched.map((c) => c.id)).toEqual(["c1"]);
  });

  it("dedupes unmatched codes by normalized key", () => {
    const { unmatched } = matchToCourses(["ART 310", "art-310"], catalog);
    expect(unmatched).toEqual(["ART 310"]);
  });

  it("handles empty inputs", () => {
    expect(matchToCourses([], catalog)).toEqual({ matched: [], unmatched: [] });
    expect(matchToCourses(["CS 101"], [])).toEqual({
      matched: [],
      unmatched: ["CS 101"],
    });
  });
});
