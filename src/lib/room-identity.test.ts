import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAMPUS_ROOM_GLYPHS,
  roomGlyph,
  roomKindLabel,
  roomMonogram,
  roomTitle,
  roomTone,
  type RoomKind,
} from "./room-identity";

/**
 * The room identity exists twice (native is the source of truth, this is the
 * verbatim copy) and the web tile translates its Feather glyph names to
 * lucide. Both seams are exactly where drift would sneak in, so both are
 * pinned here.
 */

const REPO = process.cwd();
const SHARED_FROM = 'export type RoomKind = "campus"';

function sharedPart(source: string): string {
  const at = source.indexOf(SHARED_FROM);
  if (at === -1) throw new Error("shared marker missing; update SHARED_FROM");
  return source.slice(at);
}

describe("room identity", () => {
  it("is identical on native and web", () => {
    const native = readFileSync(
      join(REPO, "mobile", "src", "lib", "room-identity.ts"),
      "utf8"
    );
    const web = readFileSync(join(REPO, "src", "lib", "room-identity.ts"), "utf8");
    expect(sharedPart(web)).toBe(sharedPart(native));
  });

  it("gives the web tile a lucide translation for every glyph it can emit", () => {
    const tile = readFileSync(
      join(REPO, "src", "components", "room-tile.tsx"),
      "utf8"
    );
    const map = tile.slice(
      tile.indexOf("const GLYPHS"),
      tile.indexOf("};", tile.indexOf("const GLYPHS"))
    );
    const emittable = new Set([
      ...Object.values(CAMPUS_ROOM_GLYPHS),
      "map-pin",
      "book-open",
      "award",
    ]);
    for (const glyph of emittable) {
      expect(map, glyph).toContain(glyph);
    }
  });

  it("turns slugs back into words and never shows a hash", () => {
    expect(roomTitle("general", "general")).toBe("General");
    expect(roomTitle("asks-and-offers", "asks-and-offers")).toBe(
      "Asks and offers"
    );
    expect(roomTitle(null, "study-buddies")).toBe("Study buddies");
    // A founder-typed name wins exactly as typed.
    expect(roomTitle("Pickup Soccer!!", "pickup-soccer")).toBe("Pickup Soccer!!");
    expect(roomTitle("  ", "")).toBe("Room");
  });

  it("differentiates all four kinds", () => {
    expect(roomGlyph("campus", "general")).toBe("coffee");
    expect(roomGlyph("campus", "some-future-room")).toBe("map-pin");
    expect(roomGlyph("course", "phys-9b")).toBe("book-open");
    expect(roomGlyph("club", "chess")).toBe("award");
    // Topic rooms wear a monogram instead of a glyph.
    expect(roomGlyph("topic", "pickup-soccer")).toBeNull();
    const kinds: RoomKind[] = ["campus", "course", "topic", "club"];
    expect(new Set(kinds.map(roomKindLabel)).size).toBe(4);
  });

  it("gives a topic room a stable face", () => {
    expect(roomMonogram("Pickup Soccer!!")).toBe("P");
    expect(roomMonogram("  ")).toBe("R");
    // Same title, same tone, every render.
    expect(roomTone("Pickup Soccer!!")).toBe(roomTone("Pickup Soccer!!"));
    expect(["ember", "sage"]).toContain(roomTone("anything"));
  });
});
