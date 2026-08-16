import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HELP_INTRO, HELP_SECTIONS } from "./help-content";

/**
 * "How Hearth works" exists twice, for the same reason the legal copy does:
 * mobile/src/lib/help-content.ts is the source of truth, and this directory's
 * copy is a verbatim duplicate because the web tsconfig cannot reach into
 * mobile/.
 *
 * The legal parity test had to parse string literals out of the native file,
 * because the two modules were written independently and only later brought
 * into line. This pair was built as a copy from the start, so the two files
 * are byte-identical from the first type declaration onward and the check can
 * be an exact string comparison. That is a stronger guarantee: it catches a
 * reordered section or a dropped item, not just a reworded sentence.
 */

const NATIVE_PATH = join(
  process.cwd(),
  "mobile",
  "src",
  "lib",
  "help-content.ts"
);

/** Everything after each file's own header comment: the part that must match. */
const SHARED_FROM = "/** One thing a student can do";

function sharedPart(source: string): string {
  const at = source.indexOf(SHARED_FROM);
  if (at === -1) {
    throw new Error(
      `Could not find the shared marker ${JSON.stringify(SHARED_FROM)}. ` +
        "If the header changed, update SHARED_FROM in this test."
    );
  }
  return source.slice(at);
}

describe("help content", () => {
  it("is identical on native and web", () => {
    const native = readFileSync(NATIVE_PATH, "utf8");
    const web = readFileSync(join(process.cwd(), "src", "lib", "help-content.ts"), "utf8");
    expect(sharedPart(web)).toBe(sharedPart(native));
  });

  it("covers the five tabs by name", () => {
    const tabs = HELP_SECTIONS.find((s) => s.key === "tabs");
    expect(tabs).toBeDefined();
    expect(tabs?.items.map((i) => i.term)).toEqual([
      "Home",
      "Rooms",
      "Messages",
      "Clubs",
      "Events",
    ]);
  });

  it("says who can see what", () => {
    // The privacy section is the one a student is most likely to arrive for,
    // and the one where a missing line does real harm.
    const privacy = HELP_SECTIONS.find((s) => s.key === "privacy");
    expect(privacy?.items.length).toBeGreaterThanOrEqual(4);
  });

  it("reads as sentences, not fragments", () => {
    const details = HELP_SECTIONS.flatMap((s) => s.items.map((i) => i.detail));
    expect(details.length).toBeGreaterThan(0);
    for (const detail of [...details, HELP_INTRO]) {
      expect(detail.trim()).toMatch(/[.!?]$/);
      expect(detail.trim()[0]).toBe(detail.trim()[0]?.toUpperCase());
    }
  });

  it("names no term twice", () => {
    const terms = HELP_SECTIONS.flatMap((s) => s.items.map((i) => i.term));
    expect(new Set(terms).size).toBe(terms.length);
  });
});
