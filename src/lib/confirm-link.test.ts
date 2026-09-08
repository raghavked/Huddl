import { describe, expect, it } from "vitest";
import { describeConfirmLink } from "./confirm-link";

const HASH = "pkce_4f3a1c9e7b2d6a8f0e5c3b1a9d7f5e3c1b9a7d5f3e1c9b7a5d3f1e9c7b5a3d1f";

describe("describeConfirmLink: the shapes Supabase sends", () => {
  it("turns a signup email link into the confirm route with its token", () => {
    const link = describeConfirmLink({ token_hash: HASH, type: "email" });
    expect(link).toEqual({
      kind: "signup",
      href: `/auth/confirm?token_hash=${HASH}&type=email`,
    });
  });

  it("knows a reset link from a signup link", () => {
    expect(describeConfirmLink({ token_hash: HASH, type: "recovery" })?.kind).toBe(
      "recovery"
    );
    expect(
      describeConfirmLink({ token_hash: HASH, type: "email_change" })?.kind
    ).toBe("email_change");
    expect(describeConfirmLink({ token_hash: HASH, type: "magiclink" })?.kind).toBe(
      "magiclink"
    );
  });

  it("still accepts the older signup type value", () => {
    expect(describeConfirmLink({ token_hash: HASH, type: "signup" })?.kind).toBe(
      "signup"
    );
  });

  it("carries a safe next path through and drops an unsafe one", () => {
    expect(
      describeConfirmLink({ token_hash: HASH, type: "recovery", next: "/reset-password" })
        ?.href
    ).toContain("&next=%2Freset-password");
    expect(
      describeConfirmLink({ token_hash: HASH, type: "email", next: "https://evil.com" })
        ?.href
    ).not.toContain("next=");
  });

  it("takes the first value when a key repeats", () => {
    expect(
      describeConfirmLink({ token_hash: [HASH, "second"], type: ["email", "recovery"] })
        ?.kind
    ).toBe("signup");
  });
});

describe("describeConfirmLink: what it refuses", () => {
  it("refuses a link missing either piece", () => {
    expect(describeConfirmLink({})).toBeNull();
    expect(describeConfirmLink({ token_hash: HASH })).toBeNull();
    expect(describeConfirmLink({ type: "email" })).toBeNull();
  });

  it("refuses an unknown type", () => {
    expect(describeConfirmLink({ token_hash: HASH, type: "sms" })).toBeNull();
  });

  it("refuses a token hash that is not a token hash", () => {
    expect(describeConfirmLink({ token_hash: "short", type: "email" })).toBeNull();
    expect(
      describeConfirmLink({ token_hash: "has spaces and <tags>", type: "email" })
    ).toBeNull();
    expect(
      describeConfirmLink({ token_hash: "a".repeat(600), type: "email" })
    ).toBeNull();
  });
});
