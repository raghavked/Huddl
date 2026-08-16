/* How a room introduces itself, without borrowing Discord's costume.
 *
 * NOTE ON DUPLICATION: mobile/src/lib/room-identity.ts is the source of truth
 * and this is a verbatim copy from the first type declaration onward, because
 * the web tsconfig cannot reach into mobile/. A test keeps them identical.
 * Glyphs are named in Feather's vocabulary; the web RoomTile maps them to
 * lucide equivalents.
 */

export type RoomKind = "campus" | "course" | "topic" | "club";

/** The tones a monogram tile can take, shared with the avatar recipe. */
export type RoomTone = "ember" | "sage";

/**
 * What the four seeded campus rooms are for, as glyphs. Slug-keyed because
 * the seeds guarantee these slugs on every campus. An unseeded campus slug
 * falls back to "map-pin": a campus room is a place on campus even when we
 * do not know which.
 */
export const CAMPUS_ROOM_GLYPHS: Readonly<Record<string, string>> = {
  general: "coffee",
  "study-buddies": "users",
  "campus-events": "calendar",
  "asks-and-offers": "tag",
};

const CAMPUS_FALLBACK_GLYPH = "map-pin";

/**
 * The glyph a room's tile shows, or null for topic rooms, which show their
 * monogram instead. Feather names; the web maps to lucide.
 */
export function roomGlyph(kind: RoomKind, slug: string): string | null {
  switch (kind) {
    case "campus":
      return CAMPUS_ROOM_GLYPHS[slug] ?? CAMPUS_FALLBACK_GLYPH;
    case "course":
      return "book-open";
    case "club":
      return "award";
    case "topic":
      return null;
  }
}

/**
 * The room's display name, never prefixed and never slug-cased.
 *
 * A founder-typed name wins as typed. When the name is just the slug (the
 * seeds, and any room named in lowercase-with-dashes), the slug turns back
 * into words with one capital: "asks-and-offers" becomes "Asks and offers".
 */
export function roomTitle(name: string | null, slug: string): string {
  const typed = (name ?? "").trim();
  if (typed.length > 0 && typed !== slug) return typed;
  const words = slug.replace(/-+/g, " ").trim();
  if (words.length === 0) return "Room";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * One or two words saying what kind of place this is, for lists that mix
 * kinds (search, browse, forwarding) where the tile alone is not enough.
 */
export function roomKindLabel(kind: RoomKind): string {
  switch (kind) {
    case "campus":
      return "Campus room";
    case "course":
      return "Class chat";
    case "topic":
      return "Topic room";
    case "club":
      return "Club room";
  }
}

/** The single letter a topic room's tile wears. */
export function roomMonogram(title: string): string {
  const first = title.trim().charAt(0);
  return first ? first.toUpperCase() : "R";
}

/**
 * Ember or sage for a topic room's tile, from the same 31-hash the avatar
 * fallback uses, so a room keeps its color everywhere it appears.
 */
export function roomTone(title: string): RoomTone {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  }
  return hash % 2 === 0 ? "ember" : "sage";
}
