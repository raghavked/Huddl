import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The two clients must not say almost the same thing.
 *
 * Hearth ships the same product twice, once in Expo and once in Next, and the
 * copy is duplicated because neither tsconfig can reach the other. Identical
 * duplication is fine and there is a lot of it. What goes wrong is the near
 * miss: someone improves a sentence on one side, the other side keeps the old
 * one, and a student who uses both is quietly told two different things.
 *
 * That had already happened. Mobile promised the moderation queue would show
 * "who decided it" when the reports table records no such thing; the web
 * privacy page left "and notify" out of the typing-indicator explanation,
 * which is the exact reassurance someone toggling it is looking for. Neither
 * was a typo. Both were one side being edited and the other not.
 *
 * So: strings that are very nearly identical across the two clients fail
 * here, and the fix is to make them actually identical. Genuinely different
 * sentences are far apart and never trip it, and the handful of pairs that
 * SHOULD differ are listed in ALLOWED below with a reason each.
 */

const REPO = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".next", ".expo", "dist", "build"]);

/**
 * How alike two sentences must be before this is a drift rather than two
 * different sentences. 0.95 is deliberately high: at 0.90 the check starts
 * pairing "This club doesn't exist" with "This channel doesn't exist", which
 * are different sentences about different things and always will be.
 */
const THRESHOLD = 0.95;

/**
 * Pairs that are near-identical on purpose. A phone is tapped and a browser
 * is clicked, and pretending otherwise to satisfy a test would make the copy
 * worse. Keyed on the native string.
 */
const ALLOWED = new Map<string, string>([
  [
    "We couldn't turn that reminder off just now. Give it another tap.",
    "tap/go: platform idiom",
  ],
  [
    "That didn't save. Give it another tap in a moment.",
    "tap/go: platform idiom",
  ],
  ["That didn't save just now. Give it another tap.", "tap/go: platform idiom"],
  [
    "That grade didn't save. Give the button another tap.",
    "tap/click: platform idiom",
  ],
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Every double-quoted single-line literal that reads like a sentence a
 * student would see: long enough to be prose, ends in terminal punctuation,
 * and not sitting on a comment line.
 */
function sentences(root: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of walk(join(REPO, root))) {
    // This test quotes both halves of every allowed pair.
    if (file.endsWith("copy-parity.test.ts")) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const trimmed = line.trim();
        if (/^(\*|\/\/|\/\*)/.test(trimmed)) return;
        for (const m of line.matchAll(/"([^"\\\n]{25,240})"/g)) {
          const value = m[1];
          if (!/[a-z] [a-z]/.test(value)) continue;
          if (!/[.!?]$/.test(value)) continue;
          if (!found.has(value)) {
            found.set(value, `${relative(REPO, file)}:${i + 1}`);
          }
        }
      });
  }
  return found;
}

/** Dice coefficient over character bigrams. Cheap, and good enough here. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const bigrams = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  let shared = 0;
  for (const [g, n] of A) shared += Math.min(n, B.get(g) ?? 0);
  const total = a.length - 1 + (b.length - 1);
  return total <= 0 ? 0 : (2 * shared) / total;
}

describe("copy parity between the two clients", () => {
  it("has no sentence that is almost, but not quite, the same on both", () => {
    const native = sentences("mobile/src");
    const web = sentences("src");

    const nativeOnly = [...native.keys()].filter((s) => !web.has(s));
    const webOnly = [...web.keys()].filter((s) => !native.has(s));

    const drift: string[] = [];
    for (const a of nativeOnly) {
      if (ALLOWED.has(a)) continue;
      let best = "";
      let score = 0;
      for (const b of webOnly) {
        const s = similarity(a, b);
        if (s > score) {
          score = s;
          best = b;
        }
      }
      if (score >= THRESHOLD) {
        drift.push(
          `${score.toFixed(2)}\n    native (${native.get(a)}): ${a}\n    web    (${web.get(best)}): ${best}`
        );
      }
    }

    expect(
      drift,
      "These sentences differ between the native and web clients by a word or " +
        "two, which is drift rather than intent. Make them identical, or add " +
        "the native string to ALLOWED with a reason:\n\n" +
        drift.join("\n\n")
    ).toEqual([]);
  });

  it("keeps enough copy genuinely shared to be worth checking", () => {
    // A guard on the guard: if the extractor silently stops matching, the
    // test above passes vacuously and the drift it exists to catch walks
    // straight back in.
    const native = sentences("mobile/src");
    const web = sentences("src");
    const shared = [...native.keys()].filter((s) => web.has(s));
    expect(shared.length).toBeGreaterThan(150);
  });
});
