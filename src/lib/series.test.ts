import { describe, expect, it } from "vitest";
import {
  END_OF_DAY,
  SERIES_MAX_ROWS,
  SeriesError,
  WEEKDAYS,
  describeWeekdays,
  generateSeries,
  weekdayOf,
  type CalendarRowDraft,
  type SeriesSpec,
  type WeekdayIndex,
} from "@/lib/series";

/* The weekly-pattern generator, exercised on plain dates.
 *
 * `generateSeries` is the whole feature: the array it returns is both the
 * preview a student reads and the rows the save writes, so anything wrong in
 * here is wrong on twenty classmates' calendars. It is pure: no ids, no
 * network, no clock, which means every case below is dates in, dates out.
 *
 * Everything is asserted in LOCAL calendar terms (getFullYear / getMonth /
 * getDate / getHours) rather than against ISO strings. The module builds each
 * row from its own local calendar day on purpose, and a test that compared
 * ISO text would pass in UTC and fail for every student west of Greenwich.
 */

/* --------------------------------- helpers -------------------------------- */

/** A local calendar day, time discarded: the same thing the spec reads. */
function day(year: number, month: number, date: number): Date {
  return new Date(year, month - 1, date);
}

/** The local calendar parts of a draft, which is what a student sees. */
function parts(draft: CalendarRowDraft) {
  const d = new Date(draft.due_at);
  return {
    y: d.getFullYear(),
    m: d.getMonth() + 1,
    d: d.getDate(),
    h: d.getHours(),
    min: d.getMinutes(),
  };
}

/** "2026-01-06" for each draft, in local terms. */
function dates(drafts: readonly CalendarRowDraft[]): string[] {
  return drafts.map((draft) => {
    const p = parts(draft);
    return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  });
}

/** A Monday-and-Wednesday 10am lecture across one January week, by default. */
function spec(overrides: Partial<SeriesSpec> = {}): SeriesSpec {
  return {
    title: "MAT 21A lecture",
    kind: "lecture",
    weekdays: [1, 3],
    startDate: day(2026, 1, 5), // a Monday
    endDate: day(2026, 1, 11), // the Sunday after
    timeOfDay: { hour: 10, minute: 0 },
    ...overrides,
  };
}

/* ------------------------------- the weekdays ----------------------------- */

describe("WEEKDAYS and weekdayOf: one numbering, ISO", () => {
  it("runs Monday 1 through Sunday 7, school-week first", () => {
    expect(WEEKDAYS.map((d) => d.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(WEEKDAYS[0]?.label).toBe("Monday");
    expect(WEEKDAYS[6]?.label).toBe("Sunday");
  });

  it("reads a date's weekday on that same numbering", () => {
    // 2026-01-05 is a Monday; 2026-01-11 is the Sunday after it.
    expect(weekdayOf(day(2026, 1, 5))).toBe(1);
    expect(weekdayOf(day(2026, 1, 10))).toBe(6);
    expect(weekdayOf(day(2026, 1, 11))).toBe(7);
  });
});

describe("describeWeekdays: the days as a subtitle", () => {
  it("joins with commas and an ampersand", () => {
    expect(describeWeekdays([1, 3, 5])).toBe("Mon, Wed & Fri");
    expect(describeWeekdays([2, 4])).toBe("Tue & Thu");
    expect(describeWeekdays([1])).toBe("Mon");
  });

  it("puts them in week order however they arrived, duplicates dropped", () => {
    expect(describeWeekdays([5, 1, 3, 1])).toBe("Mon, Wed & Fri");
  });

  it("is empty for an empty selection, so a form can prompt instead", () => {
    expect(describeWeekdays([])).toBe("");
  });
});

/* ------------------------------ generateSeries ---------------------------- */

describe("generateSeries: laying out the pattern", () => {
  it("lands one row on each chosen day inside the range, inclusive", () => {
    expect(dates(generateSeries(spec()))).toEqual([
      "2026-01-05",
      "2026-01-07",
    ]);
  });

  it("includes both ends of the range", () => {
    const drafts = generateSeries(
      spec({ weekdays: [1, 7], startDate: day(2026, 1, 5), endDate: day(2026, 1, 11) })
    );
    expect(dates(drafts)).toEqual(["2026-01-05", "2026-01-11"]);
  });

  it("keeps the wall-clock time on every row", () => {
    const drafts = generateSeries(
      spec({ endDate: day(2026, 1, 25), timeOfDay: { hour: 14, minute: 30 } })
    );
    expect(drafts.length).toBeGreaterThan(4);
    for (const draft of drafts) {
      expect(parts(draft).h).toBe(14);
      expect(parts(draft).min).toBe(30);
    }
  });

  it("holds 10am across the spring-forward change instead of drifting", () => {
    // US DST begins 2026-03-08. A pattern spanning it must still read 10:00
    // on both sides. This is why rows are built per calendar day rather than
    // by adding seven days of milliseconds to the last one.
    const drafts = generateSeries(
      spec({
        weekdays: [1],
        startDate: day(2026, 3, 2),
        endDate: day(2026, 3, 16),
      })
    );
    expect(dates(drafts)).toEqual(["2026-03-02", "2026-03-09", "2026-03-16"]);
    for (const draft of drafts) expect(parts(draft).h).toBe(10);
  });

  it("comes back in chronological order whatever order the days came in", () => {
    const drafts = generateSeries(
      spec({ weekdays: [5, 1, 3], endDate: day(2026, 1, 9) })
    );
    expect(dates(drafts)).toEqual([
      "2026-01-05",
      "2026-01-07",
      "2026-01-09",
    ]);
  });

  it("treats duplicate weekdays as one", () => {
    const once = generateSeries(spec({ weekdays: [1, 3] }));
    const twice = generateSeries(spec({ weekdays: [3, 1, 1, 3] }));
    expect(dates(twice)).toEqual(dates(once));
  });

  it("gives every row the same trimmed title, kind and note", () => {
    const drafts = generateSeries(
      spec({ title: "  MAT 21A lecture  ", details: "  Olson 106  " })
    );
    for (const draft of drafts) {
      expect(draft.title).toBe("MAT 21A lecture");
      expect(draft.details).toBe("Olson 106");
      expect(draft.kind).toBe("lecture");
    }
  });

  it("clears a blank note to null rather than storing whitespace", () => {
    expect(generateSeries(spec({ details: "   " }))[0]?.details).toBeNull();
    expect(generateSeries(spec({ details: undefined }))[0]?.details).toBeNull();
  });

  it("writes 11:59pm for a pattern with no set time", () => {
    const draft = generateSeries(
      spec({ kind: "assignment", timeOfDay: END_OF_DAY })
    )[0];
    expect(parts(draft!).h).toBe(23);
    expect(parts(draft!).min).toBe(59);
  });

  it("is empty, not an error, when no chosen day falls in the range", () => {
    // A Friday pattern inside a Monday-to-Tuesday window. The preview says
    // "no dates yet"; saveSeries is the one that refuses.
    expect(
      generateSeries(
        spec({ weekdays: [5], startDate: day(2026, 1, 5), endDate: day(2026, 1, 6) })
      )
    ).toEqual([]);
  });

  it("reads only the calendar day, discarding the time on the bounds", () => {
    const late = new Date(2026, 0, 5, 23, 45);
    const early = new Date(2026, 0, 7, 0, 15);
    expect(dates(generateSeries(spec({ startDate: late, endDate: early })))).toEqual(
      ["2026-01-05", "2026-01-07"]
    );
  });

  it("handles a single-day range", () => {
    expect(
      dates(
        generateSeries(
          spec({ weekdays: [1], startDate: day(2026, 1, 5), endDate: day(2026, 1, 5) })
        )
      )
    ).toEqual(["2026-01-05"]);
  });
});

describe("generateSeries: what it refuses, and what it says", () => {
  it("wants a name", () => {
    expect(() => generateSeries(spec({ title: "   " }))).toThrow(SeriesError);
    // Substring, not the whole sentence: the punctuation after "name" belongs
    // to src/lib/series.ts and this test is about the refusal, not the comma.
    expect(() => generateSeries(spec({ title: "" }))).toThrow(
      "Give these dates a name"
    );
  });

  it("caps the name at the column's 200 characters", () => {
    expect(() => generateSeries(spec({ title: "x".repeat(201) }))).toThrow(
      /That name is a bit long.*under 200 characters/
    );
    expect(generateSeries(spec({ title: "x".repeat(200) }))).toHaveLength(2);
  });

  it("wants at least one real day of the week", () => {
    expect(() => generateSeries(spec({ weekdays: [] }))).toThrow(
      "Pick at least one day of the week."
    );
    // An index from outside the week is dropped, and dropping them all is
    // the same as never picking one.
    expect(() =>
      generateSeries(spec({ weekdays: [0 as WeekdayIndex, 9 as WeekdayIndex] }))
    ).toThrow("Pick at least one day of the week.");
  });

  it("wants a real time of day", () => {
    expect(() =>
      generateSeries(spec({ timeOfDay: { hour: 24, minute: 0 } }))
    ).toThrow("Pick a time of day for these.");
    expect(() =>
      generateSeries(spec({ timeOfDay: { hour: 10, minute: 60 } }))
    ).toThrow("Pick a time of day for these.");
    expect(() =>
      generateSeries(spec({ timeOfDay: { hour: Number.NaN, minute: 0 } }))
    ).toThrow("Pick a time of day for these.");
  });

  it("wants the last date on or after the first", () => {
    expect(() =>
      generateSeries(spec({ startDate: day(2026, 1, 9), endDate: day(2026, 1, 5) }))
    ).toThrow("Set the last date on or after the first one.");
  });

  it("refuses an unreadable date rather than looping forever", () => {
    expect(() =>
      generateSeries(spec({ endDate: new Date("not a date") }))
    ).toThrow("Set the last date on or after the first one.");
  });

  it("refuses more than the cap instead of quietly trimming to it", () => {
    // A typo'd year: three days a week for a whole extra year.
    expect(() =>
      generateSeries(
        spec({
          weekdays: [1, 3, 5],
          startDate: day(2026, 1, 5),
          endDate: day(2027, 3, 13),
        })
      )
    ).toThrow(/more than 60 dates/);
  });

  it("allows exactly the cap", () => {
    // Sixty Mondays, ending on the sixtieth.
    const start = day(2026, 1, 5);
    const end = new Date(2026, 0, 5 + 59 * 7);
    const drafts = generateSeries(
      spec({ weekdays: [1], startDate: start, endDate: end })
    );
    expect(drafts).toHaveLength(SERIES_MAX_ROWS);
  });
});
