/**
 * The signed-in surface, as one list. Since the website slimmed down to
 * marketing plus the email funnel, the product lives entirely in the app
 * and this list is empty. It stays as the single place a private route
 * would be declared if the website ever grows one again: middleware,
 * robots, and the sitemap all read from here, so a future addition is one
 * line in one file rather than three copies drifting apart.
 */
export const PROTECTED_PREFIXES = [] as const;

/**
 * True when this path sits behind the sign-in wall.
 *
 * Matched on whole segments rather than raw string prefixes. A plain
 * `startsWith` is both too loose and too tight: it would catch a future
 * `/people-directory` on the strength of `/people`, and it missed `/u`
 * exactly, which is why that entry used to be written `/u/` with a trailing
 * slash. Comparing segments needs no such special case.
 */
export function isProtectedPath(path: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

/**
 * The public surface, named rather than inferred: crawlers get an explicit
 * allow list, and the sitemap is built from the same names, so a page can't
 * be advertised in one and forbidden in the other.
 */
export const PUBLIC_PATHS = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/legal/terms",
  "/legal/privacy",
  "/legal/guidelines",
] as const;
