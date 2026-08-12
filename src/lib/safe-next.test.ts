import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath — the bypasses that motivated it", () => {
  it("rejects the backslash open redirect", () => {
    // The whole reason this module exists: the old startsWith guard passed
    // this and new URL() resolved it to https://evil.com/.
    expect(safeNextPath("/\\evil.com")).toBeNull();
  });

  it("rejects a protocol-relative url", () => {
    expect(safeNextPath("//evil.com")).toBeNull();
    expect(safeNextPath("//evil.com/path")).toBeNull();
  });

  it("rejects an absolute url to another origin", () => {
    expect(safeNextPath("https://evil.com")).toBeNull();
    expect(safeNextPath("http://evil.com/reset")).toBeNull();
  });

  it("rejects a backslash-prefixed absolute url", () => {
    expect(safeNextPath("\\\\evil.com")).toBeNull();
    expect(safeNextPath("/\\/evil.com")).toBeNull();
  });

  it("rejects a bare word that isn't an absolute path", () => {
    expect(safeNextPath("home")).toBeNull();
    expect(safeNextPath("evil.com")).toBeNull();
  });

  it("rejects a null byte", () => {
    expect(safeNextPath("/reset\0//evil.com")).toBeNull();
  });
});

describe("safeNextPath — the legitimate paths it must keep", () => {
  it("keeps a plain same-origin path", () => {
    expect(safeNextPath("/reset-password")).toBe("/reset-password");
    expect(safeNextPath("/home")).toBe("/home");
  });

  it("keeps a path with a query and a hash", () => {
    expect(safeNextPath("/settings/security#delete-account")).toBe(
      "/settings/security#delete-account"
    );
    expect(safeNextPath("/search?q=ecs36a")).toBe("/search?q=ecs36a");
  });

  it("keeps a deep path", () => {
    expect(safeNextPath("/course/abc/notes")).toBe("/course/abc/notes");
  });
});

describe("safeNextPath — the fallback", () => {
  it("returns null by default when the candidate is missing", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
  });

  it("returns the given fallback when the candidate is unsafe", () => {
    expect(safeNextPath("//evil.com", "/home")).toBe("/home");
    expect(safeNextPath(undefined, "/home")).toBe("/home");
  });

  it("returns the safe path over the fallback when the candidate is good", () => {
    expect(safeNextPath("/reset-password", "/home")).toBe("/reset-password");
  });
});
