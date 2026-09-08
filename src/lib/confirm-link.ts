import { safeNextPath } from "@/lib/safe-next";

/* The visible confirmation page and what it may hand to the confirm route.
 *
 * Auth emails used to link straight at `/auth/confirm`, a route that spends
 * the one-time token the instant it is fetched. Two things fetch links that
 * are not the student: corporate mail scanners that open every URL in an
 * inbox for safety, and link previews. Either one burned the token before
 * the student ever tapped, and what they saw was "expired or already used"
 * on a link they had not touched. So the emails now link to `/confirm`, a
 * page that shows what is about to happen and waits for a real press;
 * only the button carries the token to the route that spends it.
 *
 * This module is the page's whole understanding of its query string, kept
 * pure so it can be tested against the shapes Supabase actually sends and
 * the ones an attacker might.
 */

/** What the email was for, which decides the words on the page. */
export type ConfirmKind = "signup" | "magiclink" | "recovery" | "email_change";

/**
 * Supabase's `type` values, as its templates and `verifyOtp` know them.
 * `email` is what the signup and magic-link templates send (both are email
 * OTPs); `signup` is accepted for older links that still carry it.
 */
const KIND_BY_TYPE: Record<string, ConfirmKind> = {
  email: "signup",
  signup: "signup",
  magiclink: "magiclink",
  recovery: "recovery",
  email_change: "email_change",
};

/**
 * A token hash is a hex or base64url string Supabase minted. Anything with
 * other characters, or absurdly long, never reaches the route.
 */
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{10,512}$/;

export type ConfirmLink = {
  kind: ConfirmKind;
  /** The same-origin path the confirm button follows. */
  href: string;
};

/**
 * Reads the page's query string. Returns the link the button should carry,
 * or null when the URL is not a confirmation link at all (missing or
 * malformed pieces), in which case the page explains and offers a fresh
 * start instead of a button that would only bounce.
 */
export function describeConfirmLink(params: {
  token_hash?: string | string[];
  type?: string | string[];
  next?: string | string[];
}): ConfirmLink | null {
  const tokenHash = first(params.token_hash);
  const type = first(params.type);
  if (!tokenHash || !type) return null;
  if (!TOKEN_HASH_PATTERN.test(tokenHash)) return null;
  const kind = KIND_BY_TYPE[type];
  if (!kind) return null;

  const search = new URLSearchParams({ token_hash: tokenHash, type });
  const next = safeNextPath(first(params.next));
  if (next) search.set("next", next);
  return { kind, href: `/auth/confirm?${search.toString()}` };
}

/** A repeated query key arrives as an array; the first value is the one. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
