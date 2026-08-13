import { describe, expect, it } from "vitest";
import {
  firstNameOf,
  GroupDmError,
  requireGroupTitle,
  threadDisplay,
  threadPreview,
  uniqueIds,
  warmGroupMessage,
  type ThreadPerson,
} from "@/features/dm/group-dm";

const me: ThreadPerson = {
  id: "me",
  display_name: "Ada Lovelace",
  handle: "ada",
  avatar_url: null,
};
const maya: ThreadPerson = {
  id: "maya",
  display_name: "Maya Ortiz",
  handle: "maya",
  avatar_url: null,
};
const theo: ThreadPerson = {
  id: "theo",
  display_name: "Theo Nguyen",
  handle: "theo",
  avatar_url: null,
};

describe("threadDisplay", () => {
  it("names a group after its title and counts everyone in it", () => {
    expect(
      threadDisplay(
        { is_group: true, title: "ECS 36A study crew" },
        [me, maya, theo],
        "me"
      )
    ).toEqual({ title: "ECS 36A study crew", subtitle: "3 people" });
  });

  it("falls back to a warm name when a group somehow has none", () => {
    expect(
      threadDisplay({ is_group: true, title: "   " }, [me, maya], "me").title
    ).toBe("Group chat");
  });

  it("says nothing about headcount before the roster lands", () => {
    expect(
      threadDisplay({ is_group: true, title: "Lab crew" }, [], "me")
    ).toEqual({ title: "Lab crew", subtitle: null });
  });

  it("uses the singular for a group of one", () => {
    expect(
      threadDisplay({ is_group: true, title: "Lab crew" }, [me], "me").subtitle
    ).toBe("1 person");
  });

  it("names a 1:1 after whoever isn't me, with no second line", () => {
    expect(threadDisplay({ is_group: false, title: null }, [me, maya], "me")).toEqual(
      { title: "Maya Ortiz", subtitle: null }
    );
  });

  it("holds a neutral placeholder while a 1:1 is still loading", () => {
    expect(
      threadDisplay({ is_group: false, title: null }, [], "me").title
    ).toBe("Conversation");
  });

  it("says someone left when a 1:1 has only me in it", () => {
    expect(
      threadDisplay({ is_group: false, title: null }, [me], "me").title
    ).toBe("Someone who left");
  });
});

describe("threadPreview", () => {
  const latest = { content: "see you at 6", deleted_at: null };

  it("names the speaker in a group", () => {
    expect(
      threadPreview({
        isGroup: true,
        latest,
        latestIsMine: false,
        latestAuthorName: "Maya",
      })
    ).toBe("Maya: see you at 6");
  });

  it("marks my own last word in either shape", () => {
    expect(
      threadPreview({
        isGroup: true,
        latest,
        latestIsMine: true,
        latestAuthorName: "Ada",
      })
    ).toBe("You: see you at 6");
    expect(
      threadPreview({
        isGroup: false,
        latest,
        latestIsMine: true,
        latestAuthorName: null,
      })
    ).toBe("You: see you at 6");
  });

  it("leaves a 1:1 message unprefixed", () => {
    expect(
      threadPreview({
        isGroup: false,
        latest,
        latestIsMine: false,
        latestAuthorName: null,
      })
    ).toBe("see you at 6");
  });

  it("covers a group author who has since left", () => {
    expect(
      threadPreview({
        isGroup: true,
        latest,
        latestIsMine: false,
        latestAuthorName: null,
      })
    ).toBe("Someone: see you at 6");
  });

  it("collapses whitespace so a pasted message can't stretch the row", () => {
    expect(
      threadPreview({
        isGroup: false,
        latest: { content: " lab   report\n\ndone ", deleted_at: null },
        latestIsMine: false,
        latestAuthorName: null,
      })
    ).toBe("lab report done");
  });

  it("says a deleted message is deleted, whoever wrote it", () => {
    expect(
      threadPreview({
        isGroup: true,
        latest: { content: "oops", deleted_at: "2026-01-01T00:00:00Z" },
        latestIsMine: true,
        latestAuthorName: "Maya",
      })
    ).toBe("Message deleted");
  });

  it("recruits when a thread has no messages yet", () => {
    expect(
      threadPreview({
        isGroup: true,
        latest: null,
        latestIsMine: false,
        latestAuthorName: null,
      })
    ).toBe("No messages yet. Get it started.");
    expect(
      threadPreview({
        isGroup: false,
        latest: null,
        latestIsMine: false,
        latestAuthorName: null,
      })
    ).toBe("No messages yet. Say hi.");
  });
});

describe("firstNameOf", () => {
  it("takes the first word", () => {
    expect(firstNameOf("Maya Ortiz")).toBe("Maya");
    expect(firstNameOf("  Theo  ")).toBe("Theo");
  });

  it("keeps a one-word or blank name intact", () => {
    expect(firstNameOf("Prince")).toBe("Prince");
    expect(firstNameOf("   ")).toBe("   ");
  });
});

describe("requireGroupTitle", () => {
  it("returns the trimmed name", () => {
    expect(requireGroupTitle("  Lab crew  ")).toBe("Lab crew");
  });

  it("refuses names outside the 2-60 window the database enforces", () => {
    expect(() => requireGroupTitle(" a ")).toThrow(GroupDmError);
    expect(() => requireGroupTitle("x".repeat(61))).toThrow(
      "Group names run 2 to 60 characters."
    );
  });
});

describe("uniqueIds", () => {
  it("dedupes and trims, keeping the order they were picked", () => {
    expect(uniqueIds([" maya ", "theo", "maya", "", "   "])).toEqual([
      "maya",
      "theo",
    ]);
  });
});

describe("warmGroupMessage", () => {
  it("swaps a raised database sentence for warm copy", () => {
    expect(
      warmGroupMessage({ message: "this group is full at 16" }, "fallback")
    ).toBe("This group is full at 16.");
    expect(warmGroupMessage("groups hold 3-16 people including you", "x")).toBe(
      "Groups hold 3 to 16 people including you."
    );
  });

  it("falls back when nothing matches, or there's nothing to read", () => {
    expect(warmGroupMessage({ message: "42703" }, "Try again.")).toBe(
      "Try again."
    );
    expect(warmGroupMessage(null, "Try again.")).toBe("Try again.");
  });
});
