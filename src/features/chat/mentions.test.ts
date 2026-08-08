import { describe, expect, it } from "vitest";
import {
  filterMentionCandidates,
  insertMention,
  mentionQuery,
  splitMentions,
  type MentionCandidate,
} from "@/features/chat/mentions";

describe("splitMentions", () => {
  it("passes plain text through as a single non-mention segment", () => {
    expect(splitMentions("hello there")).toEqual([
      { text: "hello there", mention: false },
    ]);
  });

  it("marks @handles and keeps surrounding text intact", () => {
    expect(splitMentions("hey @ada_l, see you at 3")).toEqual([
      { text: "hey ", mention: false },
      { text: "@ada_l", mention: true },
      { text: ", see you at 3", mention: false },
    ]);
  });

  it("handles mentions at the start and end of the message", () => {
    expect(splitMentions("@ada hi @grace")).toEqual([
      { text: "@ada", mention: true },
      { text: " hi ", mention: false },
      { text: "@grace", mention: true },
    ]);
  });

  it("ignores tokens shorter than the 3-char handle minimum", () => {
    expect(splitMentions("email me @ab ok")).toEqual([
      { text: "email me @ab ok", mention: false },
    ]);
  });

  it("caps the highlighted handle at 24 chars, like the notify trigger", () => {
    const long = "a".repeat(30);
    const segments = splitMentions(`@${long}`);
    expect(segments[0]).toEqual({ text: `@${"a".repeat(24)}`, mention: true });
  });

  it("returns one empty segment for empty content", () => {
    expect(splitMentions("")).toEqual([{ text: "", mention: false }]);
  });
});

describe("mentionQuery", () => {
  it("returns the partial handle being typed", () => {
    expect(mentionQuery("hey @jo")).toBe("jo");
  });

  it("returns an empty string right after the @", () => {
    expect(mentionQuery("hey @")).toBe("");
  });

  it("matches an @ at the start of the draft", () => {
    expect(mentionQuery("@gra")).toBe("gra");
  });

  it("lowercases the partial", () => {
    expect(mentionQuery("@GrA")).toBe("gra");
  });

  it("does not fire mid-word (emails stay quiet)", () => {
    expect(mentionQuery("mail me at ada@ucd")).toBeNull();
  });

  it("does not fire once the token is finished with a space", () => {
    expect(mentionQuery("hey @jo ")).toBeNull();
  });

  it("returns null with no @ in sight", () => {
    expect(mentionQuery("plain text")).toBeNull();
  });
});

describe("filterMentionCandidates", () => {
  const members: MentionCandidate[] = [
    { id: "1", handle: "ada_l", display_name: "Ada Lovelace", avatar_url: null },
    { id: "2", handle: "grace", display_name: "Grace Hopper", avatar_url: null },
    { id: "3", handle: "radia", display_name: "Radia Perlman", avatar_url: null },
    { id: "4", handle: "kath", display_name: "Katherine Johnson", avatar_url: null },
  ];

  it("prefix matches on handle or display name rank first", () => {
    const result = filterMentionCandidates(members, "gra");
    expect(result.map((m) => m.handle)).toEqual(["grace"]);
  });

  it("falls back to substring matches after prefix matches", () => {
    const result = filterMentionCandidates(members, "ad");
    expect(result.map((m) => m.handle)).toEqual(["ada_l", "radia"]);
  });

  it("excludes the signed-in user", () => {
    const result = filterMentionCandidates(members, "", "2");
    expect(result.some((m) => m.id === "2")).toBe(false);
  });

  it("caps results at max", () => {
    expect(filterMentionCandidates(members, "", undefined, 2)).toHaveLength(2);
  });

  it("offers everyone (up to max) for the empty query", () => {
    expect(filterMentionCandidates(members, "")).toHaveLength(4);
  });
});

describe("insertMention", () => {
  it("replaces the trailing token with @handle plus a space", () => {
    const result = insertMention("hey @jo", 7, "jordan");
    expect(result.next).toBe("hey @jordan ");
    expect(result.caret).toBe(12);
  });

  it("keeps text after the caret", () => {
    const result = insertMention("hey @jo bye", 7, "jordan");
    expect(result.next).toBe("hey @jordan  bye");
    expect(result.caret).toBe(12);
  });

  it("works right after a bare @", () => {
    const result = insertMention("@", 1, "ada_l");
    expect(result.next).toBe("@ada_l ");
    expect(result.caret).toBe(7);
  });

  it("is a no-op when the caret is not in an @-token", () => {
    expect(insertMention("plain", 5, "ada_l")).toEqual({
      next: "plain",
      caret: 5,
    });
  });
});
