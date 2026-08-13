import type { Profile } from "@/lib/types";

/**
 * The verified badge, from the client's side.
 *
 * `profiles.verified_at` is decided by the database. The
 * `sync_profile_verified` trigger in migration 0047 recomputes it from
 * `profile_is_complete()` and the account's `email_confirmed_at`, and the
 * column is outside the authenticated UPDATE grant so nothing here can award
 * it. This module exists for the other half of the job: telling a student who
 * has not earned it what is missing, without making them guess.
 *
 * The field list below therefore MIRRORS `profile_is_complete()` and is not
 * the authority for it. If that function changes, change this to match. The
 * two are kept honest by a test that asserts the same shape. Being out of
 * step here is not a security problem (the database still decides) but it is a
 * usability one: a checklist that says you are done while the badge stays off
 * is worse than no checklist.
 */

/** One thing standing between a student and the badge. */
export type VerificationGap =
  | "email"
  | "display_name"
  | "avatar"
  | "major"
  | "grad_year";

/** What to tell them to do about it, in the order worth doing them. */
const GAP_LABELS: Record<VerificationGap, string> = {
  email: "Confirm your university email",
  display_name: "Add your full name",
  avatar: "Add a profile photo",
  major: "Add your major",
  grad_year: "Add your graduation year",
};

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

/**
 * Everything still missing, in the order the student should tackle it.
 *
 * @param profile        Their own profile row.
 * @param emailConfirmed Whether the account has confirmed its email. This
 *   lives on the auth user, not the profile, so the caller supplies it.
 *   Supabase puts `email_confirmed_at` on the session's user object.
 */
export function verificationGaps(
  profile: Pick<
    Profile,
    "display_name" | "handle" | "avatar_url" | "major" | "grad_year"
  >,
  emailConfirmed: boolean
): VerificationGap[] {
  const gaps: VerificationGap[] = [];
  if (!emailConfirmed) gaps.push("email");
  // A display name that is merely the handle is an untouched profile: the
  // handle is generated from the email's local part at signup, so accepting
  // it would let a blank page pass for a filled-in one. Same rule as the
  // database's.
  if (
    blank(profile.display_name) ||
    profile.display_name.trim().toLowerCase() ===
      profile.handle.trim().toLowerCase()
  ) {
    gaps.push("display_name");
  }
  if (blank(profile.avatar_url)) gaps.push("avatar");
  if (blank(profile.major)) gaps.push("major");
  if (profile.grad_year === null || profile.grad_year === undefined) {
    gaps.push("grad_year");
  }
  return GAP_ORDER.filter((gap) => gaps.includes(gap));
}

/** The label for one gap, for a checklist. */
export function describeGap(gap: VerificationGap): string {
  return GAP_LABELS[gap];
}

/**
 * One line for a settings row: "Add a profile photo and your major to get
 * verified". Names at most two things, because a list of five reads as a chore and
 * the full checklist is one tap away on the account screen.
 */
export function summariseGaps(gaps: readonly VerificationGap[]): string {
  if (gaps.length === 0) return "Verified. Your profile is complete";
  const first = describeGap(gaps[0]).toLowerCase();
  if (gaps.length === 1) return `${capitalise(first)} to get verified`;
  const second = describeGap(gaps[1]).toLowerCase();
  const rest = gaps.length > 2 ? ` and ${gaps.length - 2} more` : "";
  return `${capitalise(first)}, ${second}${rest}`;
}

function capitalise(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}
