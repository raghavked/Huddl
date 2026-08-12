import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isProtectedPath,
  PROTECTED_PREFIXES,
  PUBLIC_PATHS,
} from "./protected-routes";

/**
 * The three copies of "which routes are private" are now one list, but a list
 * still has to be kept up to date by hand. This is what notices when it
 * isn't: it reads the actual route folders off disk and asserts every one of
 * them is accounted for.
 *
 * The drift it exists to catch already happened once. Eight routes shipped
 * after launch — /board, /saved, /focus, /plan, /semester, /calendar, /decks
 * and /moderation — were private in the app and missing from both the
 * middleware and robots.txt, so following a link to a board post survived
 * login by dumping the student on /home, and crawlers were free to walk the
 * signed-in surface. Nobody noticed because nothing failed; it just quietly
 * did the wrong thing.
 */

const APP_GROUP = join(process.cwd(), "src", "app", "(app)");

/** Every top-level route segment under app/(app), as a leading-slash path. */
function routeSegments(): string[] {
  return readdirSync(APP_GROUP)
    .filter((entry) => statSync(join(APP_GROUP, entry)).isDirectory())
    // Route groups "(x)" and private folders "_x" aren't URL segments.
    .filter((entry) => !entry.startsWith("(") && !entry.startsWith("_"))
    // "[courseId]" style dynamic roots would need their own handling; there
    // are none directly under (app) today, and one appearing is worth a
    // failure here rather than a silent gap.
    .map((entry) => `/${entry}`);
}

describe("protected routes", () => {
  it("covers every route folder under app/(app)", () => {
    const missing = routeSegments().filter(
      (segment) => !isProtectedPath(segment)
    );
    expect(missing).toEqual([]);
  });

  it("names no prefix that isn't a real route", () => {
    const real = new Set(routeSegments());
    const phantom = PROTECTED_PREFIXES.filter((prefix) => !real.has(prefix));
    expect(phantom).toEqual([]);
  });

  it("never marks a public path as protected", () => {
    // "/" starts every string, so it is checked as an exact match instead.
    const leaked = PUBLIC_PATHS.filter(
      (path) => path !== "/" && isProtectedPath(path)
    );
    expect(leaked).toEqual([]);
    expect(PROTECTED_PREFIXES).not.toContain("/");
  });

  it("matches a nested path, not just the segment root", () => {
    expect(isProtectedPath("/courses/abc/calendar")).toBe(true);
    expect(isProtectedPath("/u/maya")).toBe(true);
    expect(isProtectedPath("/u")).toBe(true);
    expect(isProtectedPath("/legal/terms")).toBe(false);
  });

  it("matches whole segments, so a longer name isn't swept up", () => {
    // The failure a plain startsWith would have: a future public route whose
    // name merely begins with a private one.
    expect(isProtectedPath("/people-directory")).toBe(false);
    expect(isProtectedPath("/homepage")).toBe(false);
    expect(isProtectedPath("/settings-guide")).toBe(false);
  });
});
