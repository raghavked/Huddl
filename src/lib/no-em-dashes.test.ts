import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No em dashes anywhere in the app.
 *
 * They were swept out of the whole codebase once. Without a guard they come
 * straight back, one autocompleted sentence at a time, because an em dash is
 * what a machine reaches for when it is unsure whether a thought is one
 * sentence or two. Deciding that question is the point.
 *
 * The rule is punctuation, not vocabulary: use a full stop, a comma, a colon,
 * or brackets. A hyphen is not a substitute and neither is " - ".
 *
 * Applied migrations are exempt. supabase/migrations holds a record of what
 * was actually run against the database, and editing that history to tidy up
 * its comments would trade a real property (the file matches the migration)
 * for a cosmetic one.
 */

const REPO = process.cwd();

/** Where the rule applies. */
const ROOTS = ["src", "mobile/src", "docs"];

/** Never walk into these, at any depth. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".expo",
  "dist",
  "build",
  "ios",
  "android",
  ".git",
]);

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".md", ".json", ".sql"];

const EM_DASH = "—";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

describe("no em dashes", () => {
  it("in any source, doc or copy file", () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of walk(join(REPO, root))) {
        // This test necessarily contains the character it is looking for.
        if (file.endsWith("no-em-dashes.test.ts")) continue;

        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, index) => {
          if (line.includes(EM_DASH)) {
            offenders.push(
              `${relative(REPO, file)}:${index + 1}: ${line.trim().slice(0, 100)}`
            );
          }
        });
      }
    }

    expect(
      offenders,
      `Found ${offenders.length} em dash(es). Use a full stop, comma, colon ` +
        "or brackets instead, whichever the sentence actually wants:\n" +
        offenders.slice(0, 40).join("\n")
    ).toEqual([]);
  });
});
