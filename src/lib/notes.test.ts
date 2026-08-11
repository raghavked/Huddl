import { describe, expect, it } from "vitest";
import {
  MAX_NOTE_TAGS,
  MAX_NOTE_TAG_LENGTH,
  MIN_NOTE_TAG_LENGTH,
  hasTag,
  tagKey,
  tallyTags,
  toTagList,
} from "@/lib/notes";

/* The pure half of note tags: counting them for the filter bar, and comparing
 * a word a student just typed against words the database already normalized.
 *
 * Nothing here trims or lowercases on the way to storage — 0032's trigger owns
 * that, and re-implementing it would be two opinions about one rule. What
 * these functions do is read what came back and tell a composer whether a chip
 * is already on.
 */

describe("the caps a composer has to respect", () => {
  it("matches the trigger in migration 0032", () => {
    expect(MAX_NOTE_TAGS).toBe(5);
    expect(MIN_NOTE_TAG_LENGTH).toBe(2);
    expect(MAX_NOTE_TAG_LENGTH).toBe(24);
  });
});

/* -------------------------------- toTagList ------------------------------- */

describe("toTagList — a text[] off the wire", () => {
  it("keeps the strings", () => {
    expect(toTagList(["lecture", "week 5"])).toEqual(["lecture", "week 5"]);
  });

  it("drops nulls, blanks and non-strings instead of losing the note", () => {
    expect(toTagList(["lecture", null, 7, "", "lab"])).toEqual([
      "lecture",
      "lab",
    ]);
  });

  it("is an empty array for anything that isn't one", () => {
    expect(toTagList(null)).toEqual([]);
    expect(toTagList(undefined)).toEqual([]);
    expect(toTagList("lecture")).toEqual([]);
  });
});

/* ------------------------------ tagKey/hasTag ----------------------------- */

describe("tagKey and hasTag — before anything has been near the database", () => {
  it("reads a typed tag the way the trigger will", () => {
    expect(tagKey("  Midterm 2 ")).toBe("midterm 2");
  });

  it("spots a tag that's already on, however it was typed", () => {
    expect(hasTag(["midterm 2"], "  Midterm 2 ")).toBe(true);
    expect(hasTag(["midterm 2"], "midterm 3")).toBe(false);
    expect(hasTag([], "lecture")).toBe(false);
  });
});

/* -------------------------------- tallyTags ------------------------------- */

describe("tallyTags — the filter bar's ordering", () => {
  it("counts notes, busiest first", () => {
    expect(
      tallyTags([
        ["lecture", "week 1"],
        ["lecture"],
        ["lecture", "midterm"],
        ["midterm"],
      ])
    ).toEqual([
      { tag: "lecture", count: 3 },
      { tag: "midterm", count: 2 },
      { tag: "week 1", count: 1 },
    ]);
  });

  it("breaks a tie alphabetically, so the long tail never shuffles", () => {
    const tally = tallyTags([["lab"], ["cheatsheet"], ["reading"]]);
    expect(tally.map((entry) => entry.tag)).toEqual([
      "cheatsheet",
      "lab",
      "reading",
    ]);
  });

  it("counts a note once per tag, never once per mention", () => {
    expect(tallyTags([["lecture", "lecture"], ["lecture"]])).toEqual([
      { tag: "lecture", count: 2 },
    ]);
  });

  it("is empty when nothing is tagged, so the bar isn't drawn at all", () => {
    expect(tallyTags([])).toEqual([]);
    expect(tallyTags([[], []])).toEqual([]);
  });

  it("gives the same answer whatever order the notes arrived in", () => {
    const forwards = tallyTags([["a1"], ["b2", "a1"], ["c3"]]);
    const backwards = tallyTags([["c3"], ["b2", "a1"], ["a1"]]);
    expect(backwards).toEqual(forwards);
  });
});
