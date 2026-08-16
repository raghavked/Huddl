import { describe, expect, it } from "vitest";
import {
  categoryLabel,
  isReportCategory,
  REPORT_CATEGORIES,
  reporterLine,
  reportSubject,
  subjectHref,
  summarize,
  type ModerationReport,
  type ReportCategory,
  type ReportPerson,
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
 * check constraint, and the guard it replaced (a truthiness test on
 * `categoryLabel(category)`) waved through every key on Object.prototype.
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
    // so `if (!categoryLabel(c))`, the guard this replaced, let them past.
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

describe("reporterLine", () => {
  const maya: ReportPerson = {
    id: "person-1",
    handle: "maya",
    display_name: "Maya Chen",
    avatar_url: null,
  };

  it("names the reporter when there is one", () => {
    expect(reporterLine({ reporter: maya })).toBe("Reported by Maya Chen");
  });

  it("credits Hearth when nobody filed it", () => {
    // The slur auto-flag (0051) inserts with `reporter_id null`, and that's
    // the only way a report arrives with no reporter: a deleted reporter's
    // rows leave with them (`on delete cascade`), so this null is never a
    // person we lost track of.
    expect(reporterLine({ reporter: null })).toBe(
      "Hearth flagged this automatically"
    );
    expect(reporterLine({ reporter: null, reporter_id: null })).toBe(
      "Hearth flagged this automatically"
    );
  });

  it("never mistakes an unnamed person for Hearth", () => {
    // A caller holding a raw row can have a `reporter_id` with no person
    // beside it. Someone filed that one; we just can't name them.
    expect(reporterLine({ reporter: null, reporter_id: "person-2" })).toBe(
      "Reported by Someone on campus"
    );
  });

  it("prefers the person over the raw id when both are present", () => {
    expect(reporterLine({ reporter: maya, reporter_id: maya.id })).toBe(
      "Reported by Maya Chen"
    );
  });
});

describe("a flagged club announcement", () => {
  /* The slur auto-flag on club announcements (0060) files rows like this
     one: `club_announcement_id` and `reported_user_id` set, no reporter,
     and nothing embedded, because the announcement's words aren't readable
     through RLS from the queue. They come from `fetchReportedContent`,
     one report at a time. */
  const report: ModerationReport = {
    id: "report-1",
    status: "open",
    category: "hate",
    reason: "This announcement matched the slur list.",
    created_at: "2026-08-01T12:00:00.000Z",
    reporter: null,
    reported: null,
    message: null,
    post: null,
    message_id: null,
    board_post_id: null,
    dm_message_id: null,
    club_announcement_id: "announcement-1",
    reported_user_id: "person-1",
  };

  it("resolves to gone, with the words behind a deliberate ask", () => {
    expect(reportSubject(report)).toEqual({
      kind: "gone",
      was: "announcement",
      note: "A club announcement, so the words aren't loaded with the queue.",
    });
  });

  it("titles the row after the thing, never the accusation", () => {
    expect(summarize(report)).toBe("A club announcement");
  });

  it("stays behind a DM in precedence", () => {
    // A row carrying both columns is about the more private thing first.
    const both: ModerationReport = { ...report, dm_message_id: "dm-1" };
    expect(reportSubject(both)).toMatchObject({
      kind: "gone",
      was: "message",
    });
  });

  it("still leads somewhere when the reported student is readable", () => {
    const withPerson: ModerationReport = {
      ...report,
      reported: {
        id: "person-1",
        handle: "maya",
        display_name: "Maya Chen",
        avatar_url: null,
        bio: null,
      },
    };
    expect(subjectHref(withPerson)).toBe("/u/maya");
    // With nothing readable at all, the row is honestly inert.
    expect(subjectHref(report)).toBeNull();
  });
});

describe("categoryLabel", () => {
  it("does not hand back a function for an inherited key", () => {
    // Typed as ReportCategory, so only a bad runtime value gets here. But if
    // one does, a moderator's queue must not render "function toString()".
    const label = categoryLabel("toString" as ReportCategory);
    expect(typeof label).toBe("string");
    expect(label).toBe(categoryLabel("other"));
  });
});
