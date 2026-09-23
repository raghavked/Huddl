import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every PostgREST embed of `profiles` in the mobile app names its foreign
 * key: `author:profiles!messages_author_id_fkey(...)`, never
 * `author:profiles(...)`.
 *
 * A bare embed works only while the parent table has exactly one foreign
 * key to profiles. The moment a second one lands (messages grew
 * forwarded_author_id and pinned_by; community_posts grew pinned_by in
 * migration 0071), PostgREST answers HTTP 300 "more than one relationship
 * was found" and every screen reading that table shows its error state.
 * That took down the channel list on the first cable build and the whole
 * feed on the first TestFlight build, both times with no failing test,
 * because the SQL fleets run below PostgREST and the screenshot rig above
 * it. Naming the key costs nothing and makes the next such column a
 * non-event, so the rule is universal rather than per table.
 */

const ROOT = join(process.cwd(), "mobile", "src");
const SKIP = new Set(["node_modules", ".expo", "ios", "android"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("profiles embeds name their foreign key", () => {
  it("finds no bare `alias:profiles(` embed anywhere in mobile/src", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (/[A-Za-z_]+:profiles\(/.test(line)) {
          offenders.push(`${relative(process.cwd(), file)}:${i + 1}`);
        }
      });
    }
    expect(offenders, "bare profiles embeds (add !<constraint>_fkey)").toEqual([]);
  });
});
