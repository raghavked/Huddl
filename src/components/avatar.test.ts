import { describe, expect, it } from "vitest";
import { TONES, toneFor } from "@/components/avatar-tone";

describe("toneFor", () => {
  it("always returns a tone from the token palette", () => {
    const names = [
      "Ada Lovelace",
      "Jean Luc Picard",
      "Émile Ångström",
      "李华",
      "x",
      "a-very-long-handle-that-overflows-the-32-bit-hash-accumulator",
      "",
    ];
    for (const name of names) {
      expect(TONES).toContain(toneFor(name));
    }
  });

  it("is deterministic: the same name always lands on the same tone", () => {
    for (const name of ["Ada Lovelace", "Grace Hopper", "李华", ""]) {
      expect(toneFor(name)).toBe(toneFor(name));
    }
  });

  it("spreads a roster across more than one tone", () => {
    const roster = ["Ada", "Bea", "Cal", "Dev", "Elle", "Femi", "Gus", "Hana"];
    const tones = new Set(roster.map(toneFor));
    expect(tones.size).toBeGreaterThanOrEqual(2);
  });

  it("handles an empty name without throwing", () => {
    expect(() => toneFor("")).not.toThrow();
    expect(TONES).toContain(toneFor(""));
  });
});
