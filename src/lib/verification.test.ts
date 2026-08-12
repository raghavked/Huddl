import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeGap,
  summariseGaps,
  verificationGaps,
  type VerificationGap,
} from "./verification";

/**
 * The client's copy of the badge rules, checked against the database's.
 *
 * `profile_is_complete()` in migration 0047 decides who is verified; this
 * module only explains to a student why they are not. If the two drift, the
 * checklist tells someone they are done while the badge stays off — so the
 * last test here reads the migration off disk and asserts the same fields
 * appear in both.
 */

const COMPLETE = {
  display_name: "Ada Lovelace",
  handle: "ada",
  avatar_url: "ada/avatar.jpg",
  major: "Mathematics",
  grad_year: 2028,
};

describe("verificationGaps", () => {
  it("finds nothing missing on a complete, confirmed profile", () => {
    expect(verificationGaps(COMPLETE, true)).toEqual([]);
  });

  it("asks for email confirmation first — it's the half that isn't optional", () => {
    expect(verificationGaps(COMPLETE, false)).toEqual(["email"]);
    expect(verificationGaps({ ...COMPLETE, major: "" }, false)[0]).toBe("email");
  });

  it("treats a display name that is only the handle as untouched", () => {
    // The handle is generated from the email at signup, so this is what a
    // profile nobody has edited looks like.
    expect(verificationGaps({ ...COMPLETE, display_name: "ada" }, true)).toEqual(
      ["display_name"]
    );
    expect(verificationGaps({ ...COMPLETE, display_name: "ADA" }, true)).toEqual(
      ["display_name"]
    );
    expect(
      verificationGaps({ ...COMPLETE, display_name: "  ada  " }, true)
    ).toEqual(["display_name"]);
  });

  it("counts whitespace as blank, the way btrim does in the database", () => {
    for (const field of ["display_name", "avatar_url", "major"] as const) {
      const gaps = verificationGaps({ ...COMPLETE, [field]: "   " }, true);
      expect(gaps.length).toBe(1);
    }
  });

  it("catches a missing graduation year, including year zero", () => {
    expect(verificationGaps({ ...COMPLETE, grad_year: null }, true)).toEqual([
      "grad_year",
    ]);
    // 0 is falsy but is a value the column can hold; it must not read as absent.
    expect(verificationGaps({ ...COMPLETE, grad_year: 0 }, true)).toEqual([]);
  });

  it("reports everything missing at once, in a sensible order", () => {
    const gaps = verificationGaps(
      {
        display_name: "ada",
        handle: "ada",
        avatar_url: null,
        major: null,
        grad_year: null,
      },
      false
    );
    expect(gaps).toEqual([
      "email",
      "display_name",
      "avatar",
      "major",
      "grad_year",
    ]);
  });
});

describe("summariseGaps", () => {
  it("says so when there is nothing left", () => {
    expect(summariseGaps([])).toContain("Verified");
  });

  it("names one thing plainly", () => {
    expect(summariseGaps(["avatar"])).toBe("Add a profile photo to get verified");
  });

  it("names two, and counts the rest rather than listing five", () => {
    expect(summariseGaps(["avatar", "major"])).toBe(
      "Add a profile photo, add your major"
    );
    expect(summariseGaps(["email", "avatar", "major", "grad_year"])).toContain(
      "and 2 more"
    );
  });

  it("has a label for every gap it can produce", () => {
    const all: VerificationGap[] = [
      "email",
      "display_name",
      "avatar",
      "major",
      "grad_year",
    ];
    for (const gap of all) {
      expect(describeGap(gap).length).toBeGreaterThan(0);
    }
  });
});

describe("agreement with the database", () => {
  it("checks the same fields profile_is_complete() does", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase",
        "migrations",
        "0047_verified_badge_by_email_and_profile.sql"
      ),
      "utf8"
    );
    const body = sql.slice(
      sql.indexOf("create or replace function public.profile_is_complete"),
      sql.indexOf("comment on function public.profile_is_complete")
    );
    // Every field this module can report as missing must be tested there.
    for (const column of ["display_name", "handle", "avatar_url", "major", "grad_year"]) {
      expect(body).toContain(column);
    }
    // And the database must not have quietly gained a requirement this module
    // cannot explain. `bio` is the one most likely to be added by mistake.
    for (const excluded of ["bio", "interests", "looking_for"]) {
      expect(body).not.toContain(`p.${excluded}`);
    }
  });
});
