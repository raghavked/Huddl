import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatEventTime,
  formatFileSize,
  formatMessageTime,
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

  it("collapses extra whitespace between and around words", () => {
    expect(initials("  Ada   Lovelace  ")).toBe("AL");
    expect(initials("Ada\tLovelace")).toBe("AL");
  });

  it("uppercases lowercase names", () => {
    expect(initials("ada lovelace")).toBe("AL");
  });

  it("keeps accented and non-latin letters", () => {
    expect(initials("Émile Ångström")).toBe("ÉÅ");
    expect(initials("李 华")).toBe("李华");
  });

  it("returns an empty string for empty or all-whitespace names", () => {
    expect(initials("")).toBe("");
    expect(initials("   ")).toBe("");
  });
});

describe("formatFileSize", () => {
  it("scales units", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("stays in bytes up to 1023 and flips to KB at exactly 1024", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1023)).toBe("1023 B");
    expect(formatFileSize(1024)).toBe("1.0 KB");
  });

  it("rounds to one decimal place", () => {
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1024 + 51)).toBe("1.0 KB"); // 1.0498… rounds down
  });

  it("flips to MB at exactly 1024 KB", () => {
    // One byte shy of a megabyte still reads as KB — the one-decimal
    // rounding lands on 1024.0 at the seam.
    expect(formatFileSize(1024 * 1024 - 1)).toBe("1024.0 KB");
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
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

  it("enforces 8–15 digit length after stripping formatting", () => {
    expect(isValidPhone("1234567")).toBe(false); // 7 digits — too short
    expect(isValidPhone("12345678")).toBe(true); // 8 digits — shortest allowed
    expect(isValidPhone("123456789012345")).toBe(true); // 15 — longest allowed
    expect(isValidPhone("1234567890123456")).toBe(false); // 16 — too long
  });

  it("rejects a leading zero, with or without +", () => {
    expect(isValidPhone("0123456789")).toBe(false);
    expect(isValidPhone("+0123456789")).toBe(false);
  });

  it("strips spaces, parens and dashes but not dots", () => {
    expect(isValidPhone("+44 7911 123456")).toBe(true);
    expect(isValidPhone("415-555-1234")).toBe(true);
    expect(isValidPhone("415.555.1234")).toBe(false);
  });

  it("only allows + at the very start", () => {
    expect(isValidPhone("4155+551234")).toBe(false);
  });

  it("normalizes separators out of non-US numbers", () => {
    expect(normalizePhone("+44 7911 123456")).toBe("+447911123456");
    expect(normalizePhone("415-555-1234")).toBe("+14155551234");
  });

  it("leaves an already-normalized number alone", () => {
    expect(normalizePhone("+14155551234")).toBe("+14155551234");
  });
});

describe("formatMessageTime", () => {
  // Fake timers pin "now" so the day-window boundaries are deterministic.
  // Expected strings are built with the same toLocale* options the helper
  // uses, so the assertions verify *which branch fired* and hold in whatever
  // locale/timezone the runner has. Mid-June dodges DST transitions.
  const now = new Date(2026, 5, 17, 12, 0, 0); // Wed Jun 17 2026, noon local
  const DAY = 24 * 60 * 60 * 1000;

  const timeOnly = (d: Date) =>
    d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const weekdayTime = (d: Date) =>
    d.toLocaleDateString([], {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  const monthDay = (d: Date) =>
    d.toLocaleDateString([], { month: "short", day: "numeric" });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats a same-day timestamp as time only", () => {
    const d = new Date(2026, 5, 17, 9, 5);
    const out = formatMessageTime(d.toISOString());
    expect(out).toBe(timeOnly(d));
    expect(out).toContain(":");
  });

  it("still counts today's midnight as today", () => {
    const d = new Date(2026, 5, 17, 0, 0);
    expect(formatMessageTime(d.toISOString())).toBe(timeOnly(d));
  });

  it("switches to weekday + time one minute before midnight yesterday", () => {
    const d = new Date(2026, 5, 16, 23, 59);
    expect(formatMessageTime(d.toISOString())).toBe(weekdayTime(d));
  });

  it("keeps weekday + time just inside the six-day window", () => {
    const d = new Date(now.getTime() - 6 * DAY + 1);
    expect(formatMessageTime(d.toISOString())).toBe(weekdayTime(d));
  });

  it("drops to month + day at exactly six days ago", () => {
    const d = new Date(now.getTime() - 6 * DAY);
    const out = formatMessageTime(d.toISOString());
    expect(out).toBe(monthDay(d));
    expect(out).not.toContain(":");
  });

  it("formats older timestamps as month + day with no time", () => {
    const d = new Date(now.getTime() - 8 * DAY);
    const out = formatMessageTime(d.toISOString());
    expect(out).toBe(monthDay(d));
    expect(out).not.toContain(":");
  });
});

describe("formatEventTime", () => {
  const start = new Date(2026, 8, 4, 19, 0); // Fri Sep 4 2026, 7:00 PM local
  const end = new Date(2026, 8, 4, 21, 30);
  const datePart = start.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = (d: Date) =>
    d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  it("renders date · start time when there's no end", () => {
    const out = formatEventTime(start.toISOString());
    expect(out).toBe(`${datePart} · ${time(start)}`);
    expect(out).not.toContain("–");
  });

  it("treats a null end like a missing one", () => {
    expect(formatEventTime(start.toISOString(), null)).toBe(
      formatEventTime(start.toISOString())
    );
  });

  it("joins start and end times with an en dash", () => {
    expect(formatEventTime(start.toISOString(), end.toISOString())).toBe(
      `${datePart} · ${time(start)}–${time(end)}`
    );
  });
});
