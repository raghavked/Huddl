/* What makes a password acceptable, decided in exactly one place.
 *
 * Until now the only rule in the product was `password.length >= 8`, typed
 * inline in two signup forms that could not see each other. That was fine
 * while signup was the only place a password was ever set. It stops being
 * fine the moment a student can also *reset* one from an emailed link and
 * *change* one from settings, because then four screens are each making up
 * their own mind about the same question, and the answer a student gets
 * depends on which door they came through.
 *
 * So: one module, four callers, one answer.
 *
 * WHAT THIS IS NOT. It is not a strength meter pretending to be security.
 * Entropy estimates on a 12-character string are mostly theatre, and a bar
 * that turns green teaches a student that "Password1!" is safe. What a
 * student actually needs from us is the short list of ways a password fails
 * in practice (too short to bother attacking, a word that is on every
 * cracking list, or their own email address with a digit stuck on the end)
 * and a sentence saying which one happened. The `strength` read exists to
 * label the field, not to gate it: only {@link PasswordCheck.ok} decides
 * whether a form may submit, and it ignores strength entirely.
 *
 * WHY THE EMAIL CHECK. Hearth accounts are university email addresses, which
 * means the local part is usually the student's name or their campus ID:
 * public, guessable, and the first thing anyone tries. A password that
 * contains it is the one bad password we can actually detect for certain.
 *
 * The common-password list is deliberately short. A real one is tens of
 * thousands of entries and belongs behind an API; a hundred entries shipped
 * in the bundle catches the passwords students actually type when they are
 * in a hurry, costs nothing, and never has to be online. It is a floor, not
 * a filter, and the copy never implies otherwise.
 *
 * Pure: no React, no Supabase, no clock, no network. Both apps carry a copy
 * (this one and `src/lib/password.ts` in the web app); they must agree, or a
 * password accepted on a laptop is refused on the phone that set it. The web
 * copy is the one with the tests, so change that one first, then port here.
 */

/**
 * The shortest password we accept. Eight is what signup already enforced, so
 * raising it here would lock out students whose existing password is exactly
 * that long the next time they tried to confirm it.
 */
export const PASSWORD_MIN_LENGTH = 8;

/** The longest we accept. Supabase's own limit is 72 bytes (bcrypt). */
export const PASSWORD_MAX_LENGTH = 72;

/**
 * How a password can fail. Each maps to one sentence in
 * {@link describeProblem}. A student sees the sentence, never the tag.
 */
export type PasswordProblem =
  | "too-short"
  | "too-long"
  | "too-common"
  | "looks-like-email";

/**
 * A label for the field, not a gate. `ok` is what decides whether a form may
 * submit; this only decides what word sits under the input.
 */
export type PasswordStrength = "weak" | "ok" | "strong";

export type PasswordCheck = {
  /** True when the password may be used. Reads `problems`, never `strength`. */
  ok: boolean;
  /** Every reason it was refused, in the order worth saying them. */
  problems: PasswordProblem[];
  strength: PasswordStrength;
};

/*
 * The hundred or so passwords that turn up first in every leaked-credential
 * dump, plus the handful this product invites specifically. A campus app
 * gets "hearth", "password", and the school's own name more than its share.
 * Compared lowercased, so casing variants collapse onto one entry.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  "password", "password1", "password123", "passw0rd", "p@ssword", "p@ssw0rd",
  "12345678", "123456789", "1234567890", "123123123", "111111111", "000000000",
  "qwertyui", "qwerty123", "qwertyuiop", "asdfghjkl", "zxcvbnm1", "1qaz2wsx",
  "iloveyou", "sunshine", "princess", "football", "baseball", "basketball",
  "superman", "batman123", "pokemon1", "starwars", "computer", "internet",
  "welcome1", "welcome123", "letmein1", "letmein123", "trustno1", "monkey12",
  "dragon123", "shadow123", "master123", "michael1", "jennifer", "jordan23",
  "harley123", "ranger123", "hunter123", "buster123", "soccer12", "hockey12",
  "killer123", "george123", "andrew123", "charlie1", "thomas123", "robert123",
  "daniel123", "matthew1", "joshua123", "anthony1", "william1", "abc12345",
  "abcd1234", "a1b2c3d4", "qazwsxedc", "zaq12wsx", "adminadmin", "administrator",
  "changeme", "changeme1", "secret123", "freedom1", "whatever", "nothing1",
  "sunshine1", "chocolate", "butterfly", "cheese123", "flower123", "purple12",
  "orange123", "banana123", "summer123", "winter123", "spring123", "autumn123",
  "student1", "student123", "college1", "college123", "university", "campus123",
  "hearth123", "hearthhearth", "gohearth1", "aggies123", "ucdavis1", "ucdavis123",
  "davis123", "california", "sacramento", "graduate1", "freshman1", "senior123",
]);

/** Anything a person would read as one word: letters, digits, or both. */
function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The local part of an email, reduced to the name inside it, so that
 * `ada.lovelace+cs@ucdavis.edu` and `adalovelace@ucdavis.edu` come out as the
 * same stem and a password built from either is caught.
 *
 * The `+tag` goes first and whole: it is a routing label the student added,
 * not part of who they are, and folding its letters into the stem would make
 * the stem longer than the name and stop it matching.
 */
function emailStem(email: string): string {
  const local = normalize(email).split("@")[0] ?? "";
  return local
    .replace(/\+.*$/, "")
    .replace(/[._-]/g, "")
    .replace(/\d+$/, "");
}

/**
 * Does this password read as the student's own email address? True when the
 * password contains the stem, or the stem contains the password. A stem of
 * four characters or fewer is ignored, since short initials collide with
 * ordinary words and we would be refusing good passwords to catch nothing.
 */
function looksLikeEmail(password: string, email: string | undefined): boolean {
  if (!email) return false;
  const stem = emailStem(email);
  if (stem.length < 5) return false;
  const value = normalize(password).replace(/[.+_-]/g, "");
  return value.includes(stem) || stem.includes(value);
}

/**
 * Whether a password may be used, why not if not, and a word for the field.
 *
 * Pass the student's email when you have it: on signup, on the settings
 * change form, anywhere the address is already on screen. The reset-from-link
 * flow does not always know it, and omitting it skips that one check rather
 * than failing closed.
 *
 * ```ts
 * const check = checkPassword(value, { email });
 * if (!check.ok) setError(describeProblem(check.problems[0]));
 * ```
 */
export function checkPassword(
  password: string,
  options?: { email?: string }
): PasswordCheck {
  const problems: PasswordProblem[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) problems.push("too-short");
  if (password.length > PASSWORD_MAX_LENGTH) problems.push("too-long");
  if (COMMON_PASSWORDS.has(normalize(password))) problems.push("too-common");
  if (looksLikeEmail(password, options?.email)) problems.push("looks-like-email");

  return {
    ok: problems.length === 0,
    problems,
    strength: rate(password, problems),
  };
}

/*
 * Length carries most of the signal, so it carries most of the weight here.
 * A refused password is always "weak" regardless of how long it is, because
 * telling a student their rejected password is "strong" is a contradiction
 * they should never have to read.
 */
function rate(password: string, problems: PasswordProblem[]): PasswordStrength {
  if (problems.length > 0) return "weak";
  const variety =
    (/[a-z]/.test(password) ? 1 : 0) +
    (/[A-Z]/.test(password) ? 1 : 0) +
    (/\d/.test(password) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(password) ? 1 : 0);
  if (password.length >= 16 || (password.length >= 12 && variety >= 3)) {
    return "strong";
  }
  if (password.length >= 12 || variety >= 3) return "ok";
  return "weak";
}

/** Do the password and its confirmation match? Exact, including whitespace. */
export function passwordsMatch(password: string, confirmation: string): boolean {
  return password.length > 0 && password === confirmation;
}

/**
 * The sentence a student reads. Plain, specific, and never scolding: a bad
 * password is a thing that happened, not a character flaw.
 */
export function describeProblem(problem: PasswordProblem): string {
  switch (problem) {
    case "too-short":
      return `Passwords need at least ${PASSWORD_MIN_LENGTH} characters.`;
    case "too-long":
      return `That's longer than ${PASSWORD_MAX_LENGTH} characters. Trim it a little.`;
    case "too-common":
      return "That one turns up in every leaked-password list. Pick something else.";
    case "looks-like-email":
      return "That's close to your email address, which is the first thing anyone would try.";
  }
}

/** The word under the field. Sentence case, like everything else. */
export function describeStrength(strength: PasswordStrength): string {
  switch (strength) {
    case "weak":
      return "Weak";
    case "ok":
      return "Good";
    case "strong":
      return "Strong";
  }
}
