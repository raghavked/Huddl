import { describe, expect, it } from "vitest";
import type { Friendship } from "./types";
import {
  edgeState,
  presenceLabel,
  splitFriendships,
  type FriendEdgeRow,
  type FriendPerson,
} from "./friends";

/**
 * The pure heart of the friends feature: which side of an edge you're on,
 * how one pile of edges becomes the screen's three sections, and how a
 * timestamp becomes one of the three phrases presence is allowed to say.
 *
 * The presence boundaries matter most. "Active now" versus "Active recently"
 * is the difference between "they're here" and "they were", and the copy
 * contract draws those lines at five minutes, an hour, and local midnight.
 * Every boundary gets a test on both sides so a refactor can't quietly move
 * one.
 */

const ME = "00000000-0000-0000-0000-0000000000me";
const THEM = "00000000-0000-0000-0000-000000000you";

function edge(overrides: Partial<Friendship> = {}): Friendship {
  return {
    requester_id: ME,
    addressee_id: THEM,
    status: "pending",
    created_at: "2026-02-01T12:00:00Z",
    responded_at: null,
    ...overrides,
  };
}

function person(id: string, overrides: Partial<FriendPerson> = {}): FriendPerson {
  return {
    id,
    handle: `handle-${id.slice(-3)}`,
    display_name: `Person ${id.slice(-3)}`,
    avatar_url: null,
    last_seen_at: null,
    share_last_seen: true,
    ...overrides,
  };
}

function row(
  overrides: Partial<FriendEdgeRow> = {}
): FriendEdgeRow {
  const base = edge(overrides);
  return {
    ...base,
    requester: person(base.requester_id),
    addressee: person(base.addressee_id),
    ...overrides,
  };
}

describe("edgeState", () => {
  it("reads no edge as none", () => {
    expect(edgeState(null, ME)).toBe("none");
  });

  it("reads a pending edge I sent as outgoing", () => {
    expect(edgeState(edge(), ME)).toBe("outgoing");
  });

  it("reads the SAME pending edge as incoming from the other side", () => {
    expect(edgeState(edge(), THEM)).toBe("incoming");
  });

  it("reads an accepted edge as friends from either side", () => {
    const accepted = edge({
      status: "accepted",
      responded_at: "2026-02-02T09:00:00Z",
    });
    expect(edgeState(accepted, ME)).toBe("friends");
    expect(edgeState(accepted, THEM)).toBe("friends");
  });

  it("reads an edge I'm not on as none rather than guessing a side", () => {
    // RLS makes this unfetchable, but a pure function shouldn't trust that.
    expect(edgeState(edge(), "somebody-else")).toBe("none");
  });
});

describe("splitFriendships", () => {
  it("routes each edge to its section by status and direction", () => {
    const rows = [
      row(), // pending, I asked: sent
      row({ requester_id: THEM, addressee_id: ME }), // pending, they asked: requests
      row({ status: "accepted", responded_at: "2026-02-03T08:00:00Z" }),
    ];
    const sections = splitFriendships(rows, ME);
    expect(sections.requests).toHaveLength(1);
    expect(sections.sent).toHaveLength(1);
    expect(sections.friends).toHaveLength(1);
    expect(sections.requests[0].person.id).toBe(THEM);
  });

  it("always hands back the OTHER person, whichever end I am", () => {
    const asked = row({ requester_id: THEM, addressee_id: ME });
    const asking = row({ requester_id: ME, addressee_id: THEM });
    expect(splitFriendships([asked], ME).requests[0].person.id).toBe(THEM);
    expect(splitFriendships([asking], ME).sent[0].person.id).toBe(THEM);
  });

  it("sorts pendings newest first by when they were asked", () => {
    const older = row({
      requester_id: "a-older",
      addressee_id: ME,
      created_at: "2026-02-01T10:00:00Z",
    });
    const newer = row({
      requester_id: "b-newer",
      addressee_id: ME,
      created_at: "2026-02-05T10:00:00Z",
    });
    const { requests } = splitFriendships([older, newer], ME);
    expect(requests.map((r) => r.edge.requester_id)).toEqual([
      "b-newer",
      "a-older",
    ]);
  });

  it("sorts friends newest first by when they were answered, not asked", () => {
    // Asked first but answered last: the fresh friendship goes on top.
    const askedFirst = row({
      requester_id: "a-early",
      addressee_id: ME,
      status: "accepted",
      created_at: "2026-01-01T10:00:00Z",
      responded_at: "2026-02-10T10:00:00Z",
    });
    const askedLater = row({
      requester_id: "b-late",
      addressee_id: ME,
      status: "accepted",
      created_at: "2026-02-01T10:00:00Z",
      responded_at: "2026-02-02T10:00:00Z",
    });
    const { friends } = splitFriendships([askedLater, askedFirst], ME);
    expect(friends.map((f) => f.edge.requester_id)).toEqual([
      "a-early",
      "b-late",
    ]);
  });

  it("drops a row whose other person isn't readable", () => {
    const blank = row({ requester_id: THEM, addressee_id: ME, requester: null });
    const sections = splitFriendships([blank], ME);
    expect(sections.requests).toHaveLength(0);
  });

  it("drops an edge that doesn't include me at all", () => {
    const foreign = row({
      requester_id: "someone",
      addressee_id: "someone-else",
    });
    const sections = splitFriendships([foreign], ME);
    expect(sections.requests).toHaveLength(0);
    expect(sections.sent).toHaveLength(0);
    expect(sections.friends).toHaveLength(0);
  });

  it("strips the embeds off the edge it hands back", () => {
    const [item] = splitFriendships([row()], ME).sent;
    expect(item.edge).not.toHaveProperty("requester");
    expect(item.edge).not.toHaveProperty("addressee");
  });
});

describe("presenceLabel", () => {
  // Local-time constructors throughout, because the same-day boundary is a
  // LOCAL midnight and these tests must pass in every timezone.
  const at = (
    h: number,
    m: number,
    s = 0,
    day = 15
  ): Date => new Date(2026, 2, day, h, m, s);

  it("says nothing for null, which is also how sharing-off arrives", () => {
    expect(presenceLabel(null, at(12, 0))).toBeNull();
  });

  it("says nothing for a timestamp that won't parse", () => {
    expect(presenceLabel("not a time", at(12, 0))).toBeNull();
  });

  it("reads 4m59s ago as Active now", () => {
    expect(presenceLabel(at(11, 55, 1).toISOString(), at(12, 0))).toBe(
      "Active now"
    );
  });

  it("reads exactly 5m ago as Active recently", () => {
    expect(presenceLabel(at(11, 55).toISOString(), at(12, 0))).toBe(
      "Active recently"
    );
  });

  it("reads 59m ago as Active recently", () => {
    expect(presenceLabel(at(11, 1).toISOString(), at(12, 0))).toBe(
      "Active recently"
    );
  });

  it("reads 61m ago, same day, as Active today", () => {
    expect(presenceLabel(at(10, 59).toISOString(), at(12, 0))).toBe(
      "Active today"
    );
  });

  it("reads this morning as Active today right up to 11:59pm", () => {
    expect(presenceLabel(at(9, 0).toISOString(), at(23, 59))).toBe(
      "Active today"
    );
  });

  it("says nothing once local midnight has passed", () => {
    // Same gap of hours as a within-day case, but yesterday is yesterday.
    expect(
      presenceLabel(at(22, 0).toISOString(), at(9, 0, 0, 16))
    ).toBeNull();
    // Even just past midnight: 11:30pm seen, 12:31am now is over an hour ago
    // AND a different calendar day.
    expect(
      presenceLabel(at(23, 30).toISOString(), at(0, 31, 0, 16))
    ).toBeNull();
  });

  it("still says Active recently across midnight while under the hour", () => {
    // 11:59pm seen, 12:30am now: a different day, but 31 minutes is
    // recently, and the minute ladders win before the calendar is consulted.
    expect(
      presenceLabel(at(23, 59).toISOString(), at(0, 30, 0, 16))
    ).toBe("Active recently");
  });

  it("reads a future timestamp as Active now, not as nothing", () => {
    // A client clock drifted behind the server: the server just heard from
    // them, which is exactly what the phrase means.
    expect(presenceLabel(at(12, 3).toISOString(), at(12, 0))).toBe(
      "Active now"
    );
  });
});
