/* Where a redirect is allowed to land, decided in exactly one place.
 *
 * Three auth routes take a `?next=` off the URL and, on a successful sign-in,
 * redirect the freshly-authenticated student there: the login page, the OAuth
 * callback, and the email-confirm route. That parameter is attacker-controlled
 * (it rides in on a link), so the one rule is that it may only ever be a path
 * on our own origin. A `next` that can point off-site is an open redirect, and
 * on an auth route an open redirect is how a phished student ends up typing a
 * new password into someone else's page wearing our URL.
 *
 * All three used to check it inline, the same way: `startsWith("/") &&
 * !startsWith("//")`. That looks airtight and is not. A backslash walks
 * straight through it. `"/\\evil.com"` starts with "/", does not start with
 * "//", and passes, and then `new URL("/\\evil.com", origin)` resolves to
 * `https://evil.com/`, because the WHATWG URL parser (Node and every browser)
 * folds backslashes to forward slashes for http(s). The string looked like a
 * path and became an origin.
 *
 * So the check here does not trust the shape of the string at all. It resolves
 * the candidate against a throwaway origin and then asks the parser where it
 * actually landed: if resolving it changed the origin, it was never a path,
 * whatever it looked like. Only a value that resolves back to the same origin
 * is returned, and only as its path: query and hash kept, origin discarded.
 *
 * Pure: no React, no Next, no request. Tested in safe-next.test.ts against the
 * exact bypasses that motivated it.
 */

/* A fixed, unroutable origin to resolve against. Its only job is to be a
   stable yardstick. If a candidate resolves somewhere other than here, it
   escaped, and where it escaped to does not matter. */
const SENTINEL_ORIGIN = "https://hearth.invalid";

/**
 * The safe same-origin path from an untrusted `?next=`, or `fallback` when the
 * candidate is missing, malformed, or points anywhere but our own origin.
 *
 * ```ts
 * const next = safeNextPath(params.next, "/home");   // callback: a default
 * const next = safeNextPath(params.next);            // login: null when unsafe
 * ```
 */
export function safeNextPath<F extends string | null = null>(
  candidate: string | null | undefined,
  fallback: F = null as F
): string | F {
  if (!candidate) return fallback;

  // A real path is absolute and single-slashed. Everything else (a
  // protocol-relative "//host", an absolute "https://host", a backslash trick,
  // a bare "home") is rejected before we even resolve it.
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    candidate.includes("\0")
  ) {
    return fallback;
  }

  try {
    const resolved = new URL(candidate, SENTINEL_ORIGIN);
    // The load-bearing line: if resolving moved the origin, it was never ours.
    if (resolved.origin !== SENTINEL_ORIGIN) return fallback;
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    // An unparseable candidate is not a path we are going to send anyone to.
    return fallback;
  }
}
