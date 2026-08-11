import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEAD_MINUTES,
  LEAD_CHOICES,
  LEAD_MAX_MINUTES,
  LEAD_MIN_MINUTES,
  describeLead,
  reminderFiresAt,
} from "@/lib/reminders";

/* The two pure halves of reminders: reading a stored lead back as words, and
 * working out whether a nudge can still reach anybody.
 *
 * Neither reads the clock — `reminderFiresAt` takes `now` — so every case is
 * fixed moments in, a boolean and a Date out.
 */

const MINUTE = 60 * 1000;

/** A fixed moment to hang the timing cases off. */
const NOW = new Date(2026, 0, 12, 9, 0);

/** `minutes` after {@link NOW}. */
function fromNow(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * MINUTE);
}

/* -------------------------------- the ladder ------------------------------ */

describe("the lead ladder", () => {
  it("runs nearest first", () => {
    const minutes = LEAD_CHOICES.map((choice) => choice.minutes);
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
  });

  it("never offers a lead the column would reject", () => {
    for (const choice of LEAD_CHOICES) {
      expect(choice.minutes).toBeGreaterThanOrEqual(LEAD_MIN_MINUTES);
      expect(choice.minutes).toBeLessThanOrEqual(LEAD_MAX_MINUTES);
    }
    expect(DEFAULT_LEAD_MINUTES).toBeGreaterThanOrEqual(LEAD_MIN_MINUTES);
    expect(DEFAULT_LEAD_MINUTES).toBeLessThanOrEqual(LEAD_MAX_MINUTES);
  });

  it("matches the constraint the database actually enforces", () => {
    expect(LEAD_MIN_MINUTES).toBe(15);
    expect(LEAD_MAX_MINUTES).toBe(20160);
  });
});

/* ------------------------------- describeLead ----------------------------- */

describe("describeLead — a stored lead as words", () => {
  it("gives a ladder value its own warm label", () => {
    expect(describeLead(900)).toBe("The night before");
    expect(describeLead(1440)).toBe("A day before");
    expect(describeLead(10080)).toBe("A week out");
  });

  it("describes an off-ladder lead in the largest unit that divides it", () => {
    expect(describeLead(4320)).toBe("3 days before");
    expect(describeLead(20160)).toBe("2 weeks before");
    expect(describeLead(120)).toBe("2 hours before");
    expect(describeLead(90)).toBe("90 minutes before");
  });

  it("gets the singular right", () => {
    // 60 and 1440 are on the ladder; 30240 (three weeks) is not.
    expect(describeLead(30240)).toBe("3 weeks before");
    expect(describeLead(2880)).toBe("Two days before");
  });

  it("never throws mid-render on a nonsense value", () => {
    expect(describeLead(Number.NaN)).toBe("Before it's due");
    expect(describeLead(0)).toBe("When it's due");
    expect(describeLead(-5)).toBe("When it's due");
  });
});

/* ----------------------------- reminderFiresAt ---------------------------- */

describe("reminderFiresAt — when the nudge is actually due", () => {
  it("is the deadline minus the lead", () => {
    const timing = reminderFiresAt(fromNow(180), 60, NOW);
    expect(timing.at.getTime()).toBe(fromNow(120).getTime());
    expect(timing.past).toBe(false);
  });

  it("is past when the lead is longer than the time left", () => {
    // A day's lead on something due in an hour: the sweep would never send.
    const timing = reminderFiresAt(fromNow(60), 1440, NOW);
    expect(timing.past).toBe(true);
    expect(timing.at.getTime()).toBeLessThan(NOW.getTime());
  });

  it("counts the exact moment as gone — the sweep ticks after it, not on it", () => {
    expect(reminderFiresAt(fromNow(15), 15, NOW).past).toBe(true);
    expect(reminderFiresAt(fromNow(16), 15, NOW).past).toBe(false);
  });

  it("is past for a deadline that has already been and gone", () => {
    expect(reminderFiresAt(fromNow(-60), LEAD_MIN_MINUTES, NOW).past).toBe(true);
  });

  it("agrees with itself: the closest rung is the last one to go past", () => {
    // Once 15 minutes is unreachable, nothing further out can reach either.
    const due = fromNow(10);
    expect(reminderFiresAt(due, LEAD_MIN_MINUTES, NOW).past).toBe(true);
    for (const choice of LEAD_CHOICES) {
      expect(reminderFiresAt(due, choice.minutes, NOW).past).toBe(true);
    }
  });
});
