import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMUNITY_GUIDELINES,
  PRIVACY_POLICY,
  TERMS_OF_SERVICE,
  type LegalDoc,
} from "./content";

/**
 * The legal copy exists twice. mobile/src/lib/legal-content.ts is the source
 * of truth, and this directory's content.ts is a verbatim duplicate, because
 * the web tsconfig can't reach into mobile/. docs/LEGAL.md says the two must
 * stay identical, and until now nothing enforced that.
 *
 * They had already come apart. The native copy had been revised to disclose
 * three things the web copy still denied or omitted: that a forwarded message
 * outlives the account it came from, that avatars are served from a public
 * link, and that a block is one-way. The web privacy policy was still
 * telling students that someone they blocked "can't message you or see your
 * posts", the second half of which was never true. A privacy policy that is
 * accurate on a phone and wrong in a browser is worse than one that is merely
 * out of date, because the wrong half is the half a court would read.
 *
 * So: a test, not a note. It reads the native file off disk as text rather
 * than importing it (the import is exactly what the tsconfig forbids) and
 * pulls out the same `heading:` / `body:` string literals the web module
 * declares. Any wording change on one side and not the other fails here.
 */

const NATIVE_PATH = join(
  process.cwd(),
  "mobile",
  "src",
  "lib",
  "legal-content.ts"
);

/**
 * Every `heading: "…"` and `body: "…"` literal in a legal-content module, in
 * source order, still source-escaped. Escaped rather than unescaped on
 * purpose: comparing the raw literals means a stray `\n` or a smart quote
 * typed on one side and not the other is a difference, which is what we want
 * from copy that has to match word for word.
 */
function literalsOf(source: string): string[] {
  const pattern = /\b(?:heading|body):\s*"((?:[^"\\]|\\.)*)"/g;
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

/** The same list, built from the objects this module actually exports. */
function literalsOfDocs(docs: LegalDoc[]): string[] {
  const out: string[] = [];
  for (const doc of docs) {
    for (const section of doc.sections) {
      out.push(escapeLikeSource(section.heading));
      out.push(escapeLikeSource(section.body));
    }
  }
  return out;
}

/** Put back the two escapes a TypeScript double-quoted literal must carry. */
function escapeLikeSource(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const WEB_DOCS = [TERMS_OF_SERVICE, PRIVACY_POLICY, COMMUNITY_GUIDELINES];

describe("legal copy", () => {
  const nativeSource = readFileSync(NATIVE_PATH, "utf8");
  const nativeLiterals = literalsOf(nativeSource);
  const webLiterals = literalsOfDocs(WEB_DOCS);

  it("finds the native source of truth where docs/LEGAL.md says it is", () => {
    expect(nativeLiterals.length).toBeGreaterThan(0);
  });

  it("says exactly the same thing on the web as on a phone", () => {
    // Order-insensitive so that reordering sections is not a failure, but
    // every sentence must appear on both sides.
    const nativeSet = new Set(nativeLiterals);
    const webSet = new Set(webLiterals);
    const onlyWeb = webLiterals.filter((line) => !nativeSet.has(line));
    const onlyNative = nativeLiterals.filter((line) => !webSet.has(line));
    expect({ onlyWeb, onlyNative }).toEqual({ onlyWeb: [], onlyNative: [] });
  });

  it("covers the same number of sections on both sides", () => {
    expect(webLiterals.length).toBe(nativeLiterals.length);
  });

  it("carries the same revision date on every document", () => {
    for (const doc of WEB_DOCS) {
      expect(nativeSource).toContain(`updated: "${doc.updated}"`);
    }
  });

  it("keeps the three promises that are checkable from here", () => {
    const privacy = PRIVACY_POLICY.sections.map((s) => s.body).join(" ");
    // Each of these was wrong on the web before this test existed. They are
    // asserted individually so a regression names itself.
    expect(privacy).toContain("profile photo");
    expect(privacy).toMatch(/public link|served from a public/);
    expect(privacy).toContain("They're never told");
  });
});
