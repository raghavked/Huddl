import { describe, expect, it } from "vitest";
import {
  BOARD_STALE_DAYS,
  BoardError,
  asBoardCategory,
  categoryInfo,
  isMine,
  isStale,
  parseBoardDay,
  priceCentsFrom,
  priceLabel,
  rideLabel,
  toBoardDay,
} from "@/lib/board";

/* The board's pure helpers, exercised on plain values.
 *
 * Nothing here touches Supabase and nothing reads the clock — every function
 * under test takes its moment as an argument, which is the whole reason these
 * cases can assert an exact sentence instead of a shape.
 *
 * Two things get more attention than their line count suggests. Money, because
 * `45.50 * 100` is 4550.000000000001 in JavaScript and the column has a check
 * constraint: a rounding hair here is a failed insert in front of a student.
 * And the date-only `happens_on` column, because `new Date("2026-08-14")`
 * parses as UTC midnight — the 13th at 5pm in California — so every ride would
 * read as leaving a day early if anything ever parsed it the obvious way.
 */

/* --------------------------------- fixtures ------------------------------- */

/** A Thursday, mid-afternoon local time. Every "now" in this file. */
const NOW = new Date(2026, 7, 13, 15, 30);

/** The shape isStale() actually reads — a category, a day, a created time. */
function post(
  fields: Partial<{
    category: Parameters<typeof isStale>[0]["category"];
    happens_on: string | null;
    created_at: string;
  }> = {}
) {
  return {
    category: "sale" as const,
    happens_on: null,
    created_at: NOW.toISOString(),
    ...fields,
  };
}

/** `days` before or after NOW, as the stored `YYYY-MM-DD` shape. */
function dayFromNow(days: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  return toBoardDay(d);
}

/* -------------------------------- categories ------------------------------ */

describe("asBoardCategory", () => {
  it("passes the seven real boards through", () => {
    for (const value of [
      "ride",
      "lost",
      "found",
      "free",
      "sale",
      "ask",
      "offer",
    ]) {
      expect(asBoardCategory(value)).toBe(value);
    }
  });

  it("forgives the casing and spacing a hand-typed URL arrives with", () => {
    // ?category=Ride comes off a shared link, not off our own chip rail.
    expect(asBoardCategory("Ride")).toBe("ride");
    expect(asBoardCategory("  SALE ")).toBe("sale");
  });

  it("rejects anything else, including near misses and non-strings", () => {
    expect(asBoardCategory("rides")).toBeNull();
    expect(asBoardCategory("")).toBeNull();
    expect(asBoardCategory(null)).toBeNull();
    expect(asBoardCategory(undefined)).toBeNull();
    expect(asBoardCategory(7)).toBeNull();
  });
});

describe("categoryInfo", () => {
  it("only rides carry a date, and only the money boards carry a price", () => {
    expect(categoryInfo("ride").wantsDate).toBe(true);
    expect(categoryInfo("sale").wantsDate).toBe(false);

    expect(categoryInfo("sale").wantsPrice).toBe(true);
    expect(categoryInfo("lost").wantsPrice).toBe(false);
  });
});

/* ---------------------------------- money --------------------------------- */

describe("priceCentsFrom", () => {
  it("reads whole cents without float drift", () => {
    // The case the helper exists for: 45.50 * 100 is not 4550 in JavaScript.
    expect(priceCentsFrom("45.50")).toBe(4550);
    expect(priceCentsFrom("0.07")).toBe(7);
    expect(priceCentsFrom("19.99")).toBe(1999);
  });

  it("forgives the ways a person actually types a price", () => {
    expect(priceCentsFrom("45")).toBe(4500);
    expect(priceCentsFrom("$45")).toBe(4500);
    expect(priceCentsFrom("1,200")).toBe(120000);
    expect(priceCentsFrom(" $1,200.50 ")).toBe(120050);
  });

  it("treats a blank field as no price rather than as free", () => {
    expect(priceCentsFrom("")).toBeNull();
    expect(priceCentsFrom("   ")).toBeNull();
    expect(priceCentsFrom(null)).toBeNull();
    expect(priceCentsFrom(undefined)).toBeNull();
  });

  it("keeps an explicit zero, which means free", () => {
    expect(priceCentsFrom("0")).toBe(0);
  });

  it("names what to do instead of failing silently", () => {
    expect(() => priceCentsFrom("free")).toThrow(BoardError);
    expect(() => priceCentsFrom("free")).toThrow(
      "Write the price as a number — 45, or 45.50. Leave it blank if it's free."
    );
    expect(() => priceCentsFrom(".")).toThrow(BoardError);
    expect(() => priceCentsFrom("45.505")).toThrow(BoardError);
  });

  it("refuses a price past the column's ceiling", () => {
    expect(priceCentsFrom("5000")).toBe(500000);
    expect(() => priceCentsFrom("5001")).toThrow(BoardError);
  });
});

describe("priceLabel", () => {
  it("says Free rather than $0", () => {
    expect(priceLabel(0)).toBe("Free");
  });

  it("drops the cents when there are none", () => {
    expect(priceLabel(4500)).toBe("$45");
    expect(priceLabel(120000)).toBe("$1,200");
  });

  it("keeps two digits when there are cents", () => {
    expect(priceLabel(4550)).toBe("$45.50");
    expect(priceLabel(7)).toBe("$0.07");
  });

  it("renders nothing for a post with no price", () => {
    expect(priceLabel(null)).toBeNull();
    expect(priceLabel(undefined)).toBeNull();
    expect(priceLabel(Number.NaN)).toBeNull();
  });
});

/* ----------------------------------- days --------------------------------- */

describe("toBoardDay / parseBoardDay", () => {
  it("round-trips a local day without sliding across UTC midnight", () => {
    // 11pm local on the 14th is already the 15th in UTC. The stored day must
    // still be the 14th, or a ride reads as leaving a day early.
    const lateEvening = new Date(2026, 7, 14, 23, 30);
    expect(toBoardDay(lateEvening)).toBe("2026-08-14");

    const back = parseBoardDay("2026-08-14");
    expect(back?.getFullYear()).toBe(2026);
    expect(back?.getMonth()).toBe(7);
    expect(back?.getDate()).toBe(14);
    expect(back?.getHours()).toBe(0);
  });

  it("rejects a day that isn't on the calendar", () => {
    // JavaScript rolls Feb 31 forward to Mar 3 rather than failing, so the
    // helper has to catch the rollover itself.
    expect(parseBoardDay("2026-02-31")).toBeNull();
    expect(parseBoardDay("2026-13-01")).toBeNull();
    expect(parseBoardDay("2026-00-10")).toBeNull();
  });

  it("accepts the leap day in a leap year and refuses it otherwise", () => {
    expect(parseBoardDay("2028-02-29")).not.toBeNull();
    expect(parseBoardDay("2026-02-29")).toBeNull();
  });

  it("reads null for anything that isn't a stored day", () => {
    expect(parseBoardDay(null)).toBeNull();
    expect(parseBoardDay(undefined)).toBeNull();
    expect(parseBoardDay("")).toBeNull();
    expect(parseBoardDay("next friday")).toBeNull();
  });

  it("tolerates a full timestamp by reading its date half", () => {
    const parsed = parseBoardDay("2026-08-14T18:00:00Z");
    expect(parsed?.getDate()).toBe(14);
  });
});

describe("rideLabel", () => {
  it("speaks in days for the ones that are nearly here", () => {
    expect(rideLabel(dayFromNow(0), NOW)).toBe("Leaving today");
    expect(rideLabel(dayFromNow(1), NOW)).toBe("Leaving tomorrow");
  });

  it("names the weekday inside the coming week", () => {
    // NOW is a Thursday, so two days on is Saturday.
    expect(rideLabel(dayFromNow(2), NOW)).toBe("Leaving Saturday");
  });

  it("falls back to a short date past a week out", () => {
    expect(rideLabel(dayFromNow(9), NOW)).toBe("Leaving Aug 22");
  });

  it("switches to past tense once the day has gone", () => {
    // The point of the whole helper: a ride nobody closed still has to read
    // as over, because nobody comes back to tidy a drive they already took.
    expect(rideLabel(dayFromNow(-1), NOW)).toBe("Left yesterday");
    expect(rideLabel(dayFromNow(-2), NOW)).toBe("Left Tuesday");
    expect(rideLabel(dayFromNow(-9), NOW)).toBe("Left last week");
    expect(rideLabel(dayFromNow(-30), NOW)).toBe("Left Jul 14");
  });

  it("renders nothing for a post with no day", () => {
    expect(rideLabel(null, NOW)).toBeNull();
    expect(rideLabel("2026-02-31", NOW)).toBeNull();
  });
});

/* ---------------------------------- sorting ------------------------------- */

describe("isStale", () => {
  it("leaves a fresh post alone", () => {
    expect(isStale(post(), NOW)).toBe(false);
  });

  it("sinks a ride whose day has been and gone", () => {
    expect(isStale(post({ category: "ride", happens_on: dayFromNow(-1) }), NOW)).toBe(
      true
    );
  });

  it("keeps a ride leaving today up top all day", () => {
    // The student posting at 8am and the one reading at 3pm see the same ride.
    expect(isStale(post({ category: "ride", happens_on: dayFromNow(0) }), NOW)).toBe(
      false
    );
  });

  it("draws the age line at BOARD_STALE_DAYS, not before it", () => {
    const justInside = new Date(NOW.getTime() - (BOARD_STALE_DAYS * 86400000 - 60000));
    const justPast = new Date(NOW.getTime() - (BOARD_STALE_DAYS * 86400000 + 60000));

    expect(isStale(post({ created_at: justInside.toISOString() }), NOW)).toBe(false);
    expect(isStale(post({ created_at: justPast.toISOString() }), NOW)).toBe(true);
  });

  it("treats an unreadable created time as fresh rather than hiding the post", () => {
    expect(isStale(post({ created_at: "not a time" }), NOW)).toBe(false);
  });
});

describe("isMine", () => {
  it("matches the author_id = auth.uid() the policies enforce", () => {
    expect(isMine({ author_id: "abc" }, "abc")).toBe(true);
    expect(isMine({ author_id: "abc" }, "xyz")).toBe(false);
  });

  it("claims nothing while the session is still resolving", () => {
    // Guessing "mine" here would offer edit and delete to a stranger for a
    // frame, and RLS would refuse the write after they tapped it.
    expect(isMine({ author_id: "abc" }, null)).toBe(false);
    expect(isMine({ author_id: "abc" }, "")).toBe(false);
  });
});
