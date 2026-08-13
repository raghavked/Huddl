import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  checkPassword,
  describeProblem,
  describeStrength,
  passwordsMatch,
} from "./password";

describe("checkPassword: length", () => {
  it("refuses anything under the minimum", () => {
    const check = checkPassword("short1");
    expect(check.ok).toBe(false);
    expect(check.problems).toContain("too-short");
  });

  it("accepts exactly the minimum, since signup already did", () => {
    const check = checkPassword("a".repeat(PASSWORD_MIN_LENGTH) + "");
    expect(check.problems).not.toContain("too-short");
  });

  it("refuses past bcrypt's 72-byte ceiling", () => {
    const check = checkPassword("x".repeat(PASSWORD_MAX_LENGTH + 1));
    expect(check.ok).toBe(false);
    expect(check.problems).toContain("too-long");
  });
});

describe("checkPassword: common passwords", () => {
  it("refuses the ones in every leaked dump", () => {
    for (const bad of ["password123", "12345678", "qwertyui", "letmein1"]) {
      expect(checkPassword(bad).problems).toContain("too-common");
    }
  });

  it("refuses them whatever the casing", () => {
    expect(checkPassword("PassWord123").problems).toContain("too-common");
  });

  it("refuses the campus-flavoured ones a student here would reach for", () => {
    for (const bad of ["ucdavis123", "hearth123", "college123"]) {
      expect(checkPassword(bad).problems).toContain("too-common");
    }
  });

  it("leaves an ordinary passphrase alone", () => {
    expect(checkPassword("wandering kettle dusk").ok).toBe(true);
  });
});

describe("checkPassword: the student's own email", () => {
  it("refuses a password built from the local part", () => {
    const check = checkPassword("adalovelace1", { email: "adalovelace@ucdavis.edu" });
    expect(check.ok).toBe(false);
    expect(check.problems).toContain("looks-like-email");
  });

  it("sees through the dots and plus-tags a campus address collects", () => {
    const check = checkPassword("adalovelace99", {
      email: "ada.lovelace+cs@ucdavis.edu",
    });
    expect(check.problems).toContain("looks-like-email");
  });

  it("ignores a stem too short to mean anything", () => {
    // "abc" would otherwise refuse every password containing those letters.
    const check = checkPassword("abcdefghijk", { email: "abc@ucdavis.edu" });
    expect(check.problems).not.toContain("looks-like-email");
  });

  it("skips the check entirely when no email is known", () => {
    // The reset-from-link flow does not always have the address; that must
    // not fail closed.
    expect(checkPassword("adalovelace1").problems).not.toContain(
      "looks-like-email"
    );
  });

  it("does not refuse an unrelated password", () => {
    const check = checkPassword("wandering kettle dusk", {
      email: "adalovelace@ucdavis.edu",
    });
    expect(check.ok).toBe(true);
  });
});

describe("checkPassword: strength is a label, not a gate", () => {
  it("never calls a refused password anything but weak", () => {
    expect(checkPassword("password123").strength).toBe("weak");
    expect(checkPassword("shrt").strength).toBe("weak");
  });

  it("rates a long passphrase strong", () => {
    expect(checkPassword("wandering kettle dusk").strength).toBe("strong");
  });

  it("rates a short-but-varied password ok rather than strong", () => {
    expect(checkPassword("Kx7!qzab").strength).toBe("ok");
  });

  it("never blocks submission on strength alone", () => {
    const check = checkPassword("kettledusk");
    expect(check.strength).toBe("weak");
    expect(check.ok).toBe(true);
  });
});

describe("passwordsMatch", () => {
  it("matches identical strings", () => {
    expect(passwordsMatch("kettle dusk", "kettle dusk")).toBe(true);
  });

  it("refuses a mismatch", () => {
    expect(passwordsMatch("kettle dusk", "kettle dawn")).toBe(false);
  });

  it("counts trailing whitespace as a difference, because it is one", () => {
    expect(passwordsMatch("kettle", "kettle ")).toBe(false);
  });

  it("refuses two empty strings rather than calling them a match", () => {
    expect(passwordsMatch("", "")).toBe(false);
  });
});

describe("the copy a student reads", () => {
  it("has a sentence for every problem", () => {
    for (const problem of [
      "too-short",
      "too-long",
      "too-common",
      "looks-like-email",
    ] as const) {
      const sentence = describeProblem(problem);
      expect(sentence.length).toBeGreaterThan(0);
      expect(sentence).not.toMatch(/!$/);
    }
  });

  it("names the real minimum rather than a hard-coded number", () => {
    expect(describeProblem("too-short")).toContain(String(PASSWORD_MIN_LENGTH));
  });

  it("has a word for every strength", () => {
    expect(describeStrength("weak")).toBe("Weak");
    expect(describeStrength("ok")).toBe("Good");
    expect(describeStrength("strong")).toBe("Strong");
  });
});
