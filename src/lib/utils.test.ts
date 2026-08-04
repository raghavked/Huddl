import { describe, expect, it } from "vitest";
import {
  formatFileSize,
  initials,
  isValidPhone,
  normalizePhone,
} from "@/lib/utils";

describe("initials", () => {
  it("takes the first letters of the first two words", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("Cher")).toBe("C");
    expect(initials("Jean Luc Picard")).toBe("JL");
  });
});

describe("formatFileSize", () => {
  it("scales units", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("phone helpers", () => {
  it("accepts common US formats", () => {
    expect(isValidPhone("+14155551234")).toBe(true);
    expect(isValidPhone("(415) 555-1234")).toBe(true);
    expect(isValidPhone("415555")).toBe(false);
    expect(isValidPhone("not a phone")).toBe(false);
  });

  it("normalizes to E.164, defaulting to +1", () => {
    expect(normalizePhone("(415) 555-1234")).toBe("+14155551234");
    expect(normalizePhone("+447911123456")).toBe("+447911123456");
  });
});
