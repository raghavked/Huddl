/**
 * The signed-in surface, as one list.
 *
 * Three separate places need to agree on which routes are private, and until
 * now each kept its own copy: the middleware (which redirects to login and
 * carries `?next=` so the student lands where they were going), the robots
 * file (which keeps crawlers off the app), and `app/(app)/layout.tsx` (which
 * redirects too, but bare). They drifted, in the way three hand-maintained
 * copies of one list always do — eight routes added since launch were in the
 * app and in none of the copies, so a link to a board post survived login by
 * dumping the student on /home, and the same eight paths were left crawlable.
 *
 * A route is private if it lives under `app/(app)`. Adding a new one means
 * adding one line here and nowhere else.
 */
export const PROTECTED_PREFIXES = [
  "/home",
  "/channels",
  "/messages",
  "/events",
  "/people",
  "/clubs",
  "/courses",
  "/board",
  "/saved",
  "/focus",
  "/plan",
  "/semester",
  "/calendar",
  "/decks",
  "/moderation",
  "/setup",
  "/notifications",
  "/settings",
  "/onboarding",
  "/u",
] as const;

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
