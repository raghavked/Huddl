import { describe, expect, it } from "vitest";
import {
  categoryLabel,
  isReportCategory,
  REPORT_CATEGORIES,
  type ReportCategory,
} from "./moderation";

/**
 * The eight report categories, and the guard that decides whether a string is
 * one of them.
 *
 * This matters more than a list of constants usually would. A server action
 * is an HTTP endpoint: the `ReportCategory` type on
 * `reportMessage(id, category, reason)` is a promise the caller made in
 * TypeScript and nothing a hand-rolled POST has to keep. `isReportCategory`
 * is the only runtime check between that request and the `reports.category`
 * check constraint, and the guard it replaced — a truthiness test on
 * `categoryLabel(category)` — waved through every key on Object.prototype.
 */

/** The eight the database will actually accept (0020's check constraint). */
const CONSTRAINT_VALUES = [
  "harassment",
  "spam",
  "hate",
  "impersonation",
  "sexual_content",
  "self_harm",
  "academic_dishonesty",
  "other",
];

describe("report categories", () => {
  it("offers exactly the eight the check constraint allows", () => {
    expect([...REPORT_CATEGORIES].sort()).toEqual([...CONSTRAINT_VALUES].sort());
  });

  it("puts 'other' last, so the vaguest option isn't the first offered", () => {
    expect(REPORT_CATEGORIES[REPORT_CATEGORIES.length - 1]).toBe("other");
  });

  it("names every one of them", () => {
    for (const category of REPORT_CATEGORIES) {
      const label = categoryLabel(category);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("isReportCategory", () => {
  it("accepts the eight", () => {
    for (const category of REPORT_CATEGORIES) {
      expect(isReportCategory(category)).toBe(true);
    }
  });

  it("rejects anything the constraint would reject", () => {
    for (const value of ["", "HARASSMENT", "harrassment", "abuse", "null"]) {
      expect(isReportCategory(value)).toBe(false);
    }
  });

  it("rejects inherited keys, which is the whole reason it exists", () => {
    // Every one of these reads a truthy value straight off Object.prototype,
    // so `if (!categoryLabel(c))` — the guard this replaced — let them past.
    // The insert then failed on the check constraint and the reporter was
    // told to try again, about the one failure retrying can never fix.
    for (const key of [
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "__proto__",
      "isPrototypeOf",
      "propertyIsEnumerable",
    ]) {
      expect(isReportCategory(key)).toBe(false);
    }
  });

  it("rejects non-strings without throwing", () => {
    for (const value of [null, undefined, 7, {}, [], true]) {
      expect(isReportCategory(value)).toBe(false);
    }
  });
});

describe("categoryLabel", () => {
  it("does not hand back a function for an inherited key", () => {
    // Typed as ReportCategory, so only a bad runtime value gets here — but if
    // one does, a moderator's queue must not render "function toString()".
    const label = categoryLabel("toString" as ReportCategory);
    expect(typeof label).toBe("string");
    expect(label).toBe(categoryLabel("other"));
  });
});
