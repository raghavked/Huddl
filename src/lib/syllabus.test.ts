import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CALENDAR_KINDS,
  kindLabel,
  parseSyllabus,
  toCalendarRows,
} from "@/lib/syllabus";

// resolveYear's fall→spring rollover reads the real clock, so pin it.
// Mid-October: currentMonth > 8, which exercises the rollover branch.
const NOW = new Date(2026, 9, 5, 12, 0, 0); // Mon Oct 5 2026, noon local

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const YEAR = { defaultYear: 2026 };

describe("parseSyllabus: finding dates", () => {
  it("parses numeric dates and defaults the time to 11:59 PM", () => {
    const [item] = parseSyllabus("HW 3 due 10/16", YEAR);
    expect(item).toBeDefined();
    expect(item!.dueAt).toEqual(new Date(2026, 9, 16, 23, 59, 0, 0));
  });

  it("parses month-name dates, ordinals included", () => {
    const items = parseSyllabus(
      "Oct 24  Midterm exam\nOctober 31st  Quiz 4",
      YEAR
    );
    expect(items.map((i) => i.dueAt.getDate())).toEqual([24, 31]);
    expect(items.map((i) => i.dueAt.getMonth())).toEqual([9, 9]);
  });

  it("skips lines without a recognizable date", () => {
    expect(parseSyllabus("Week 3\nOffice hours by appointment", YEAR)).toEqual(
      []
    );
  });

  it("takes the start of a range and strips the whole fragment", () => {
    const [item] = parseSyllabus("Project demos 11/12-11/14", YEAR);
    expect(item!.dueAt.getDate()).toBe(12);
    expect(item!.title).toBe("Project demos");
  });

  it("consumes a weekday prefix so it never pollutes the title", () => {
    const [item] = parseSyllabus("Mon 10/14  Lecture: limits", YEAR);
    expect(item!.title).toBe("Lecture: limits");
    expect(item!.dueAt.getDate()).toBe(14);
  });

  it("rejects impossible dates (Feb 30, month 13)", () => {
    expect(parseSyllabus("Quiz 2/30\nExam 13/2", YEAR)).toEqual([]);
  });

  it("dedupes identical title+date pairs", () => {
    const items = parseSyllabus("HW 1 due 10/16\nHW 1 due 10/16", YEAR);
    expect(items).toHaveLength(1);
  });
});

describe("parseSyllabus: years", () => {
  it("reads explicit 2-digit years as 20xx and keeps 4-digit years", () => {
    const items = parseSyllabus("Final 12/10/26\nQuiz 12/3/2027", YEAR);
    expect(items.map((i) => i.dueAt.getFullYear())).toEqual([2026, 2027]);
  });

  it("rolls a yearless spring date forward when pasted in the fall", () => {
    // It's October (see NOW), so a January date belongs to next year's term.
    const [item] = parseSyllabus("Final exam Jan 15", YEAR);
    expect(item!.dueAt.getFullYear()).toBe(2027);
  });

  it("keeps a yearless fall date in the default year", () => {
    const [item] = parseSyllabus("Midterm Oct 24", YEAR);
    expect(item!.dueAt.getFullYear()).toBe(2026);
  });
});

describe("parseSyllabus: kinds", () => {
  it("detects each kind from keywords", () => {
    const kindOf = (line: string) => parseSyllabus(line, YEAR)[0]!.kind;
    expect(kindOf("Midterm exam 10/24")).toBe("exam");
    expect(kindOf("Quiz 3 on 10/20")).toBe("quiz");
    expect(kindOf("HW 4 due 10/22")).toBe("assignment");
    expect(kindOf("Project proposal 10/30")).toBe("project");
    expect(kindOf("Reading: Ch. 5 by 10/19")).toBe("reading");
    expect(kindOf("Lecture 10/14")).toBe("lecture");
    expect(kindOf("Holiday 11/26")).toBe("other");
  });

  it("gives exam > quiz > assignment priority on mixed lines", () => {
    expect(parseSyllabus("Reading quiz 10/20", YEAR)[0]!.kind).toBe("quiz");
    expect(parseSyllabus("Midterm review quiz 10/21", YEAR)[0]!.kind).toBe(
      "exam"
    );
  });
});

describe("parseSyllabus: titles and confidence", () => {
  it("cleans dangling separators and empty parens after date removal", () => {
    const [item] = parseSyllabus("Essay draft (10/28)", YEAR);
    expect(item!.title).toBe("Essay draft");
  });

  it("falls back to a title when the line was nothing but a date", () => {
    const items = parseSyllabus("Mon 10/14\n11/26", YEAR);
    expect(items.map((i) => i.title)).toEqual(["Class date", "Class date"]);
    expect(items.map((i) => i.kind)).toEqual(["other", "other"]);
  });

  it("is high confidence only with a kind keyword AND a surviving title", () => {
    const items = parseSyllabus(
      "HW 3 due 10/16\nHoliday 11/26\nMon 10/14",
      YEAR
    );
    expect(items.map((i) => i.confidence)).toEqual(["high", "low", "low"]);
  });
});

describe("toCalendarRows", () => {
  it("maps confirmed items to insert rows tagged source syllabus", () => {
    const items = parseSyllabus("HW 3 due 10/16", YEAR);
    const rows = toCalendarRows(items, "course-1");
    expect(rows).toEqual([
      {
        course_id: "course-1",
        kind: "assignment",
        title: "HW 3 due",
        due_at: new Date(2026, 9, 16, 23, 59, 0, 0).toISOString(),
        source: "syllabus",
      },
    ]);
  });
});

describe("kindLabel", () => {
  it('reads "other" as "date" and leaves the rest alone', () => {
    expect(kindLabel("other")).toBe("date");
    expect(kindLabel("exam")).toBe("exam");
    expect(CALENDAR_KINDS).toContain("other");
  });
});
