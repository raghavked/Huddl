/**
 * The verified badge, from the client's side.
 *
 * `profiles.verified_at` is decided by the database — the
 * `sync_profile_verified` trigger in migration 0047 recomputes it from
 * `profile_is_complete()` and the account's `email_confirmed_at`, and the
 * column is outside the authenticated UPDATE grant, so nothing here can award
 * it. This module does the other half: telling a student who hasn't earned it
 * what is missing, rather than leaving them to guess what "verified" wants.
 *
 * The field list MIRRORS `profile_is_complete()` and is not the authority for
 * it. Same file exists on the web (`src/lib/verification.ts`) with the same
 * rules — the web tsconfig can't reach into mobile/, so the two are
 * duplicated the way the legal copy is. Change one, change the other.
 */

/** One thing standing between a student and the badge. */
export type VerificationGap =
  | "email"
  | "display_name"
  | "avatar"
  | "major"
  | "grad_year";

/** What to tell them to do about it. */
const GAP_LABELS: Record<VerificationGap, string> = {
  email: "Confirm your university email",
  display_name: "Add your full name",
  avatar: "Add a profile photo",
  major: "Add your major",
  grad_year: "Add your graduation year",
};

/** The order worth doing them in — the one that isn't optional comes first. */
const GAP_ORDER: readonly VerificationGap[] = [
  "email",
  "display_name",
  "avatar",
  "major",
  "grad_year",
];

function blank(value: string | null | undefined): boolean {
  return typeof value !== "string" || value.trim() === "";
}

/** The shape this needs, which is whatever the account screen holds. */
export type VerificationInput = {
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  major: string;
  /** As typed — the account screen keeps the year as text. */
  gradYear: string;
  emailConfirmed: boolean;
};

/** Everything still missing, in the order the student should tackle it. */
export function verificationGaps(input: VerificationInput): VerificationGap[] {
  const found = new Set<VerificationGap>();
  if (!input.emailConfirmed) found.add("email");
  // A display name that is only the handle is an untouched profile: the
  // handle is generated from the email's local part at signup, so accepting
  // it would let a blank page pass for a filled-in one.
  if (
    blank(input.displayName) ||
    input.displayName.trim().toLowerCase() === input.handle.trim().toLowerCase()
  ) {
    found.add("display_name");
  }
  if (blank(input.avatarUrl)) found.add("avatar");
  if (blank(input.major)) found.add("major");
  if (blank(input.gradYear)) found.add("grad_year");
  return GAP_ORDER.filter((gap) => found.has(gap));
}

/** The label for one gap, for a checklist. */
export function describeGap(gap: VerificationGap): string {
  return GAP_LABELS[gap];
}
