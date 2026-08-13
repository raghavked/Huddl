import { describe, expect, it } from "vitest";
import {
  LETTER_CUTOFFS,
  categoryScore,
  courseEstimate,
  letterFor,
  weightWarning,
  whatIf,
  type CategoryWeight,
  type EntriesLookup,
  type EntryScore,
} from "@/lib/grades";

/* The grade math, exercised on plain object literals.
 *
 * Everything under test is pure (no Supabase, no clock), so each case is
 * just numbers in, numbers and sentences out. The sentences are asserted in
 * full where the wording is the point (the honest edges of `whatIf`, the
 * weight warnings), because that copy is the feature: a student reads the
 * sentence, not the float.
 *
 * Points are chosen to divide exactly (45/50, 72/80, 15/30) wherever a test
 * asserts an exact figure. Binary floating point turns 29/30 into
 * 0.9666…67 and the rescale would carry that noise into the assertion.
 */

/* --------------------------------- fixtures ------------------------------- */

function cat(id: string, weight: number): CategoryWeight {
  return { id, weight };
}

function score(earned: number, possible: number): EntryScore {
  return { points_earned: earned, points_possible: possible };
}

/* ------------------------------ categoryScore ----------------------------- */

describe("categoryScore: one bucket's arithmetic", () => {
  it("is null for a bucket nobody has scored in yet", () => {
    expect(categoryScore(undefined)).toBeNull();
    expect(categoryScore([])).toBeNull();
  });

  it("adds points across entries and reports the percentage", () => {
    expect(categoryScore([score(18, 20), score(9, 10)])).toEqual({
      earned: 27,
      possible: 30,
      pct: 90,
    });
  });

  it("carries extra credit through instead of clamping to 100", () => {
    expect(categoryScore([score(22, 20)])).toEqual({
      earned: 22,
      possible: 20,
      pct: 110,
    });
  });

  it("skips entries worth zero points and keeps the rest", () => {
    expect(categoryScore([score(0, 0), score(18, 20)])).toEqual({
      earned: 18,
      possible: 20,
      pct: 90,
    });
  });

  it("is null when every entry is unscoreable", () => {
    expect(categoryScore([score(5, 0)])).toBeNull();
    expect(categoryScore([score(5, -10)])).toBeNull();
    expect(categoryScore([score(5, Number.NaN)])).toBeNull();
    expect(categoryScore([score(5, Number.POSITIVE_INFINITY)])).toBeNull();
    // A mid-typing row with no earned value drops out entirely. Its
    // `possible` must not count either, or a zero appears from nowhere.
    expect(categoryScore([score(Number.NaN, 20)])).toBeNull();
  });

  it("floors a negative score at zero rather than crediting it", () => {
    expect(categoryScore([score(-5, 20)])).toEqual({
      earned: 0,
      possible: 20,
      pct: 0,
    });
  });

  it("rounds points to two decimals and the percentage to one", () => {
    expect(categoryScore([score(0.1, 1), score(0.2, 1)])).toEqual({
      earned: 0.3,
      possible: 2,
      pct: 15,
    });
    expect(categoryScore([score(1, 3)])?.pct).toBe(33.3);
  });
});

/* ------------------------------ courseEstimate ---------------------------- */

describe("courseEstimate: rescaling by what's actually graded", () => {
  it("averages over the graded weight, not the whole syllabus", () => {
    // Week five: homework and the midterm are back, the final is not. A plain
    // weighted average would read 45%; the honest answer is 90%.
    const categories = [cat("hw", 20), cat("mt", 30), cat("final", 50)];
    const entries: EntriesLookup = {
      hw: [score(18, 20)],
      mt: [score(27, 30)],
    };

    const estimate = courseEstimate(categories, entries);
    expect(estimate.pct).toBe(90);
    expect(estimate.gradedWeight).toBe(50);
    expect(estimate.note).toBe(
      "Based on the 50% of your grade that's been graded so far."
    );
  });

  it("weights the graded categories against each other", () => {
    // 20% at 90 and 30% at 80 rescale to (18 + 24) / 50.
    const categories = [cat("hw", 20), cat("mt", 30)];
    const entries: EntriesLookup = {
      hw: [score(18, 20)],
      mt: [score(24, 30)],
    };
    expect(courseEstimate(categories, entries).pct).toBe(84);
  });

  it("says so plainly when there are no weights to work from", () => {
    expect(courseEstimate([], {})).toEqual({
      pct: null,
      gradedWeight: 0,
      note: "Add your categories and their weights to see an estimate.",
    });
    expect(courseEstimate([cat("hw", 0)], { hw: [score(10, 10)] })).toEqual({
      pct: null,
      gradedWeight: 0,
      note: "Add your categories and their weights to see an estimate.",
    });
  });

  it("waits for the first score before estimating anything", () => {
    const estimate = courseEstimate([cat("hw", 40), cat("final", 60)], {});
    expect(estimate.pct).toBeNull();
    expect(estimate.gradedWeight).toBe(0);
    expect(estimate.note).toBe(
      "Nothing's graded yet. Your first score starts the estimate."
    );
  });

  it("ignores a zero-weight bucket even when it has scores in it", () => {
    const estimate = courseEstimate([cat("extra", 0), cat("final", 100)], {
      extra: [score(10, 10)],
    });
    expect(estimate.pct).toBeNull();
    expect(estimate.note).toBe(
      "Nothing's graded yet. Your first score starts the estimate."
    );
  });

  it("calls a fully graded course the whole grade", () => {
    const estimate = courseEstimate([cat("hw", 40), cat("final", 60)], {
      hw: [score(36, 40)],
      final: [score(54, 60)],
    });
    expect(estimate.pct).toBe(90);
    expect(estimate.gradedWeight).toBe(100);
    expect(estimate.note).toBe(
      "Everything that counts has a score, so this is your whole grade."
    );
  });

  it("treats whatever the weights sum to as the whole grade", () => {
    // A syllabus half entered: 50 points of weight, all of it graded.
    const estimate = courseEstimate([cat("hw", 20), cat("mt", 30)], {
      hw: [score(18, 20)],
      mt: [score(24, 30)],
    });
    expect(estimate.gradedWeight).toBe(100);
    expect(estimate.note).toBe(
      "Everything that counts has a score, so this is your whole grade."
    );
  });

  it("never rounds a partly graded course up to a whole grade", () => {
    const estimate = courseEstimate([cat("hw", 99.99), cat("tail", 0.01)], {
      hw: [score(9, 10)],
    });
    expect(estimate.gradedWeight).toBe(99.9);
    expect(estimate.note).toBe(
      "Based on the 99.9% of your grade that's been graded so far."
    );
  });

  it("never rounds a barely graded course down to nothing", () => {
    const estimate = courseEstimate([cat("quiz", 0.01), cat("rest", 99.99)], {
      quiz: [score(9, 10)],
    });
    expect(estimate.gradedWeight).toBe(0.1);
    expect(estimate.note).toBe(
      "Based on the 0.1% of your grade that's been graded so far."
    );
  });

  it("lets extra credit push the estimate past 100", () => {
    const estimate = courseEstimate([cat("hw", 100)], {
      hw: [score(22, 20)],
    });
    expect(estimate.pct).toBe(110);
    expect(estimate.gradedWeight).toBe(100);
  });

  it("counts a non-finite weight as no weight at all", () => {
    const estimate = courseEstimate(
      [cat("hw", Number.NaN), cat("final", 100)],
      { hw: [score(10, 10)], final: [score(80, 100)] }
    );
    expect(estimate.pct).toBe(80);
    expect(estimate.gradedWeight).toBe(100);
  });
});

/* ---------------------------------- whatIf -------------------------------- */

describe("whatIf: what's left has to average", () => {
  it("solves for the average the ungraded weight needs", () => {
    const categories = [cat("hw", 50), cat("final", 50)];
    const entries: EntriesLookup = { hw: [score(45, 50)] };

    const result = whatIf(categories, entries, 90);
    expect(result.neededPct).toBe(90);
    expect(result.reachable).toBe(true);
    expect(result.message).toBe(
      "What's left needs to average about 90% to land at 90%."
    );
  });

  it("rounds the needed average UP so hitting it always clears the target", () => {
    // Exactly 78.571…%: rounding down to 78.5 would land a hair short.
    const result = whatIf([cat("hw", 30), cat("final", 70)], {
      hw: [score(15, 30)],
    }, 70);
    expect(result.neededPct).toBe(78.6);
    expect(result.neededPct as number).toBeGreaterThan((55 / 70) * 100);
    expect(result.reachable).toBe(true);
    expect(result.message).toBe(
      "What's left needs to average about 78.6% to land at 70%."
    );
  });

  it("says you're already there when even zeros would clear it", () => {
    const result = whatIf([cat("hw", 80), cat("final", 20)], {
      hw: [score(72, 80)],
    }, 60);
    expect(result.neededPct).toBe(0);
    expect(result.reachable).toBe(true);
    expect(result.message).toBe("You're there even if the rest goes badly.");
  });

  it("names where a perfect finish actually lands when the target is gone", () => {
    const result = whatIf([cat("hw", 30), cat("final", 70)], {
      hw: [score(15, 30)],
    }, 90);
    expect(result.reachable).toBe(false);
    // The real, impossible figure, not a comforting 100.
    expect(result.neededPct).toBe(107.2);
    expect(result.message).toBe(
      "Even a perfect finish lands around 85%. Worth a talk with your instructor."
    );
  });

  it("counts a target that needs a perfect finish as still reachable", () => {
    const result = whatIf([cat("hw", 40), cat("final", 60)], {
      hw: [score(30, 40)],
    }, 90);
    expect(result.neededPct).toBe(100);
    expect(result.reachable).toBe(true);
  });

  it("has a different sentence before anything is graded", () => {
    const result = whatIf([cat("hw", 50), cat("final", 50)], {}, 85);
    expect(result.neededPct).toBe(85);
    expect(result.reachable).toBe(true);
    expect(result.message).toBe(
      "Nothing's graded yet. Averaging about 85% from here lands you at 85%."
    );
  });

  it("congratulates a finished course that made the target", () => {
    const result = whatIf([cat("all", 100)], { all: [score(95, 100)] }, 90);
    expect(result.neededPct).toBeNull();
    expect(result.reachable).toBe(true);
    expect(result.message).toBe(
      "Everything's graded and it landed at 95%. You made your 90%."
    );
  });

  it("is straight with a finished course that missed it", () => {
    const result = whatIf([cat("all", 100)], { all: [score(85, 100)] }, 90);
    expect(result.neededPct).toBeNull();
    expect(result.reachable).toBe(false);
    expect(result.message).toBe(
      "Everything's graded, so this one lands at 85%. Nothing left to move it."
    );
  });

  it("asks for weights before it will work anything out", () => {
    const expected = {
      neededPct: null,
      reachable: false,
      message:
        "Add your categories and weights first, then we can work out what's left.",
    };
    expect(whatIf([], {}, 90)).toEqual(expected);
    expect(whatIf([cat("hw", 0)], { hw: [score(9, 10)] }, 90)).toEqual(expected);
  });

  it("clamps a target above 100 back to 100", () => {
    const result = whatIf([cat("hw", 50), cat("final", 50)], {
      hw: [score(45, 50)],
    }, 150);
    expect(result.reachable).toBe(false);
    expect(result.message).toBe(
      "Even a perfect finish lands around 95%. Worth a talk with your instructor."
    );
  });

  it("treats a negative or garbled target as zero", () => {
    const categories = [cat("hw", 50), cat("final", 50)];
    const entries: EntriesLookup = { hw: [score(45, 50)] };
    for (const target of [-10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = whatIf(categories, entries, target);
      expect(result.neededPct).toBe(0);
      expect(result.reachable).toBe(true);
      expect(result.message).toBe("You're there even if the rest goes badly.");
    }
  });
});

/* -------------------------------- letterFor ------------------------------- */

describe("letterFor: the hint beside the number", () => {
  it("hands back the letter at every cutoff on the scale", () => {
    for (const { letter, min } of LETTER_CUTOFFS) {
      expect(letterFor(min)).toBe(letter);
    }
  });

  it("drops to the next letter down a tenth below each cutoff", () => {
    LETTER_CUTOFFS.forEach((cutoff, index) => {
      const next = LETTER_CUTOFFS[index + 1];
      if (!next) return;
      expect(letterFor(cutoff.min - 0.1)).toBe(next.letter);
    });
  });

  it("agrees with the percentage on screen, which is rounded to a tenth", () => {
    // 89.95 displays as 90%, so it must not read B+.
    expect(letterFor(89.95)).toBe("A-");
    expect(letterFor(92.95)).toBe("A");
    expect(letterFor(89.94)).toBe("B+");
  });

  it("gives an A for extra credit and an F for the floor", () => {
    expect(letterFor(105)).toBe("A");
    expect(letterFor(0)).toBe("F");
    expect(letterFor(-5)).toBe("F");
  });

  it("passes null and unusable numbers straight through", () => {
    expect(letterFor(null)).toBeNull();
    expect(letterFor(Number.NaN)).toBeNull();
    expect(letterFor(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

/* ------------------------------ weightWarning ----------------------------- */

describe("weightWarning: when the syllabus doesn't add up", () => {
  it("stays quiet on an empty course and on a course that adds to 100", () => {
    expect(weightWarning([])).toBeNull();
    expect(weightWarning([cat("hw", 20), cat("mt", 30), cat("final", 50)])).toBeNull();
  });

  it("stays quiet within a rounding hair of 100", () => {
    expect(weightWarning([cat("hw", 33.33), cat("mt", 33.33), cat("f", 33.34)])).toBeNull();
    expect(weightWarning([cat("hw", 99.999)])).toBeNull();
  });

  it("asks for the percentages when nothing carries any weight", () => {
    expect(weightWarning([cat("hw", 0), cat("mt", 0)])).toBe(
      "Your categories don't carry any weight yet. Add the percentages from your syllabus."
    );
  });

  it("explains that a short syllabus is treated as the whole grade", () => {
    expect(weightWarning([cat("hw", 20), cat("mt", 30)])).toBe(
      "Your weights add to 50%, so the estimate assumes that's the whole grade."
    );
  });

  it("explains that an over-100 syllabus gets scaled back", () => {
    expect(weightWarning([cat("hw", 60), cat("mt", 50)])).toBe(
      "Your weights add to 110%, so the estimate scales them back to fit."
    );
  });

  it("drops the trailing zero from a whole-number total", () => {
    expect(weightWarning([cat("hw", 45.5), cat("mt", 44.5)])).toBe(
      "Your weights add to 90%, so the estimate assumes that's the whole grade."
    );
  });

  it("counts a negative or non-finite weight as zero", () => {
    expect(weightWarning([cat("hw", -50), cat("final", 100)])).toBeNull();
    expect(weightWarning([cat("hw", Number.NaN), cat("final", 100)])).toBeNull();
  });
});
