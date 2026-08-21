import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isProtectedPath,
  PROTECTED_PREFIXES,
  PUBLIC_PATHS,
} from "./protected-routes";

/**
 * The website is marketing plus the email funnel; the product lives in the
 * app. This is what notices if that stops being true quietly: the moment a
 * signed-in route group reappears under src/app, somebody has to come back
 * here and start declaring private prefixes again, on purpose.
 */

describe("protected routes", () => {
  it("has no signed-in surface to protect", () => {
    expect(PROTECTED_PREFIXES).toEqual([]);
    expect(existsSync(join(process.cwd(), "src", "app", "(app)"))).toBe(false);
  });

  it("never marks a public path as protected", () => {
    const leaked = PUBLIC_PATHS.filter(
      (path) => path !== "/" && isProtectedPath(path)
    );
    expect(leaked).toEqual([]);
  });

  it("keeps the funnel and legal pages public", () => {
    for (const path of ["/", "/signup", "/login", "/legal/privacy"]) {
      expect(isProtectedPath(path)).toBe(false);
    }
  });
});
