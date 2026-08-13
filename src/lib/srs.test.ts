import { describe, expect, it } from "vitest";
import {
  AGAIN_DELAY_MINUTES,
  EASY_INTERVAL_DAYS,
  GOOD_INTERVAL_DAYS,
  buildQueue,
  nextReview,
} from "@/lib/srs";

const NOW = new Date("2026-08-08T12:00:00.000Z");

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function minutesFromNow(dueAt: Date): number {
  return (dueAt.getTime() - NOW.getTime()) / MINUTE_MS;
}

function daysFromNow(dueAt: Date): number {
  return (dueAt.getTime() - NOW.getTime()) / DAY_MS;
}

describe("nextReview: grade transitions", () => {
  it('"again" resets the streak and comes back in 10 minutes', () => {
    const next = nextReview({ streak: 4 }, "again", NOW);
    expect(next.streak).toBe(0);
    expect(minutesFromNow(next.dueAt)).toBe(AGAIN_DELAY_MINUTES);
  });

  it('"again" on a brand-new card also lands at streak 0, 10 minutes out', () => {
    const next = nextReview(null, "again", NOW);
    expect(next.streak).toBe(0);
    expect(minutesFromNow(next.dueAt)).toBe(10);
  });

  it('"good" on first contact starts the streak at 1, due tomorrow', () => {
    const next = nextReview(null, "good", NOW);
    expect(next.streak).toBe(1);
    expect(daysFromNow(next.dueAt)).toBe(1);
  });

  it('"easy" on first contact jumps the streak by 2, due in 3 days', () => {
    const next = nextReview(null, "easy", NOW);
    expect(next.streak).toBe(2);
    expect(daysFromNow(next.dueAt)).toBe(3);
  });

  it('"good" bumps the streak by exactly 1, "easy" by exactly 2', () => {
    expect(nextReview({ streak: 3 }, "good", NOW).streak).toBe(4);
    expect(nextReview({ streak: 3 }, "easy", NOW).streak).toBe(5);
  });

  it("treats a negative stored streak as 0", () => {
    const good = nextReview({ streak: -2 }, "good", NOW);
    expect(good.streak).toBe(1);
    expect(daysFromNow(good.dueAt)).toBe(GOOD_INTERVAL_DAYS[0]);
  });

  it("computes from the passed `now`, not the wall clock", () => {
    const otherNow = new Date("1999-12-31T23:59:00.000Z");
    const next = nextReview(null, "good", otherNow);
    expect(next.dueAt.getTime() - otherNow.getTime()).toBe(DAY_MS);
  });
});

describe("nextReview: ladders index by the PRE-update streak", () => {
  it('walks the "good" ladder 1 / 3 / 7 / 14 / 30 by previous streak', () => {
    for (const [prevStreak, days] of [
      [0, 1],
      [1, 3],
      [2, 7],
      [3, 14],
      [4, 30],
    ] as const) {
      const next = nextReview({ streak: prevStreak }, "good", NOW);
      expect(daysFromNow(next.dueAt)).toBe(days);
    }
  });

  it('walks the "easy" ladder 3 / 7 / 14 / 30 / 60 by previous streak', () => {
    for (const [prevStreak, days] of [
      [0, 3],
      [1, 7],
      [2, 14],
      [3, 30],
      [4, 60],
    ] as const) {
      const next = nextReview({ streak: prevStreak }, "easy", NOW);
      expect(daysFromNow(next.dueAt)).toBe(days);
    }
  });

  it("clamps long streaks to the last rung instead of falling off", () => {
    expect(daysFromNow(nextReview({ streak: 9 }, "good", NOW).dueAt)).toBe(
      GOOD_INTERVAL_DAYS[GOOD_INTERVAL_DAYS.length - 1]
    );
    expect(daysFromNow(nextReview({ streak: 25 }, "easy", NOW).dueAt)).toBe(
      EASY_INTERVAL_DAYS[EASY_INTERVAL_DAYS.length - 1]
    );
  });

  it("uses the streak from BEFORE the update, not the bumped one", () => {
    // Streak 1 graded "good": interval is ladder[1] = 3 days, not
    // ladder[2] = 7. The bump to streak 2 pays off next time.
    const next = nextReview({ streak: 1 }, "good", NOW);
    expect(next.streak).toBe(2);
    expect(daysFromNow(next.dueAt)).toBe(3);
  });
});

describe("buildQueue: ordering and the cap", () => {
  type TestCard = { id: string; position: number };

  const card = (id: string, position: number): TestCard => ({ id, position });

  const review = (offsetMs: number): { dueAt: Date } => ({
    dueAt: new Date(NOW.getTime() + offsetMs),
  });

  it("puts new cards first (by position), then due cards oldest-due first", () => {
    const cards = [
      card("due-recent", 0),
      card("new-b", 3),
      card("due-old", 2),
      card("new-a", 1),
    ];
    const reviews = new Map([
      ["due-recent", review(-1 * MINUTE_MS)],
      ["due-old", review(-3 * DAY_MS)],
    ]);
    const queue = buildQueue(cards, reviews, NOW);
    expect(queue.map((c) => c.id)).toEqual([
      "new-a",
      "new-b",
      "due-old",
      "due-recent",
    ]);
  });

  it("leaves out reviewed cards that aren't due yet", () => {
    const cards = [card("rested", 0), card("new", 1)];
    const reviews = new Map([["rested", review(2 * DAY_MS)]]);
    const queue = buildQueue(cards, reviews, NOW);
    expect(queue.map((c) => c.id)).toEqual(["new"]);
  });

  it("includes a card due exactly now", () => {
    const cards = [card("on-the-dot", 0)];
    const reviews = new Map([["on-the-dot", review(0)]]);
    expect(buildQueue(cards, reviews, NOW)).toHaveLength(1);
  });

  it("caps the session at 30 by default", () => {
    const cards = Array.from({ length: 45 }, (_, i) => card(`c${i}`, i));
    const queue = buildQueue(cards, new Map(), NOW);
    expect(queue).toHaveLength(30);
    // …and the cap keeps the front of the ordering, not a random slice.
    expect(queue[0]?.id).toBe("c0");
    expect(queue[29]?.id).toBe("c29");
  });

  it("honors a custom cap, and cards.length means the full due set", () => {
    const cards = Array.from({ length: 45 }, (_, i) => card(`c${i}`, i));
    expect(buildQueue(cards, new Map(), NOW, 5)).toHaveLength(5);
    expect(buildQueue(cards, new Map(), NOW, cards.length)).toHaveLength(45);
  });

  it("treats a non-positive cap as an empty queue", () => {
    const cards = [card("a", 0), card("b", 1)];
    expect(buildQueue(cards, new Map(), NOW, 0)).toEqual([]);
    expect(buildQueue(cards, new Map(), NOW, -3)).toEqual([]);
  });

  it("returns an empty queue for an empty deck", () => {
    expect(buildQueue([], new Map(), NOW)).toEqual([]);
  });

  it("does not mutate the caller's card array", () => {
    const cards = [card("b", 1), card("a", 0)];
    buildQueue(cards, new Map(), NOW);
    expect(cards.map((c) => c.id)).toEqual(["b", "a"]);
  });
});
