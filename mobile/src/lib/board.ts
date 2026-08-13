import type { Feather } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";

/* The campus board: the data layer.
 *
 * One table, `board_posts`, for the things students actually need from each
 * other: a ride home for break, a lost water bottle, a couch that needs a new
 * apartment, an hour of tutoring. Seven categories, campus-scoped, author-
 * owned, and CLOSABLE RATHER THAN DELETABLE. That last one is the design
 * decision the whole module is shaped around.
 *
 * A post that got what it wanted stays readable. The ride that filled still
 * says who was driving and when, so the person who missed it knows to ask
 * earlier next time; the bottle that came home is proof the board works.
 * {@link closePost} stamps `closed_at`, {@link fetchBoard} sinks those rows to
 * the bottom, and {@link deletePost} exists for the narrow case of a post that
 * should never have been written at all.
 *
 * Migration 0034 created the table with four policies and no RPCs, so every
 * rule here is enforced by RLS on a plain query:
 *
 *   select  university_id = current_university_id()  (your campus, all of it)
 *   insert  author_id = auth.uid() AND university_id = current_university_id()
 *   update  author_id = auth.uid()   (your post, your edits, your close)
 *   delete  author_id = auth.uid()
 *
 * The insert policy is why {@link createPost} resolves `university_id` from
 * the caller's own profile instead of taking it as an argument: there is
 * exactly one value the database will accept, so a screen should never be in
 * a position to pass the wrong one.
 *
 * Every write filters on `author_id` explicitly as well as leaning on the
 * policy. A filter that matches the policy turns a silent no-op into an honest
 * empty result, which is what lets {@link closePost} and {@link reopenPost}
 * tell "already done" apart from "not yours".
 *
 * No React, no theme, no navigation in here: queries, narrowing, validation,
 * and pure helpers that take `now` as an argument so a ticking screen and a
 * unit test get the same answers. Every failure arrives as a
 * {@link BoardError} whose message is warm, specific, and safe to drop
 * straight into an inline error.
 */

/* ═══════════════════════════ the vocabulary ══════════════════════════ */

/** A Feather glyph name, the only icon set the app draws. */
type FeatherName = keyof typeof Feather.glyphMap;

/**
 * The seven kinds of post the board accepts, exactly as
 * `board_posts.category` stores them. Never build a filter or a chip from a
 * bare string. Read {@link CATEGORIES}, or narrow with
 * {@link asBoardCategory} when the value came from a route param.
 */
export type BoardCategory =
  | "ride"
  | "lost"
  | "found"
  | "free"
  | "sale"
  | "ask"
  | "offer";

/**
 * Everything a screen needs to draw one category: what to call it, what to
 * draw beside it, what to prompt the composer with, and which two optional
 * fields the composer should bother offering.
 */
export type BoardCategoryInfo = {
  /** The stored value: what goes in the column and in a filter. */
  key: BoardCategory;
  /** What a person calls it. Sentence case, short enough for a `Chip`. */
  label: string;
  /** The Feather glyph that rides with it, everywhere it appears. */
  icon: FeatherName;
  /**
   * The composer's body placeholder: a question, not a label, because the
   * hardest part of posting is knowing what detail the reader needs.
   */
  placeholder: string;
  /** Whether the composer should offer a price field for this kind of post. */
  wantsPrice: boolean;
  /**
   * Whether the composer should offer a date. Only a ride has one. The
   * column `happens_on` is null for everything else, and
   * {@link createPost} enforces that no matter what a screen sends.
   */
  wantsDate: boolean;
};

/**
 * The board's whole vocabulary, in the order chips and pickers render it:
 * the two travel-and-loss pairs first because they are the urgent ones, then
 * the two that move objects, then the two that trade time.
 *
 * This is the single source of truth. A screen that hardcodes "Rides" or
 * picks its own icon for `sale` is a screen that will drift.
 */
export const CATEGORIES = [
  {
    key: "ride",
    label: "Ride",
    icon: "navigation",
    placeholder: "Where are you driving, and when?",
    wantsPrice: true,
    wantsDate: true,
  },
  {
    key: "lost",
    label: "Lost",
    icon: "search",
    placeholder: "Where did you last have it?",
    wantsPrice: false,
    wantsDate: false,
  },
  {
    key: "found",
    label: "Found",
    icon: "eye",
    placeholder: "Where did you find it, and where is it now?",
    wantsPrice: false,
    wantsDate: false,
  },
  {
    key: "free",
    label: "Free",
    icon: "gift",
    placeholder: "What is it, and where can someone pick it up?",
    wantsPrice: false,
    wantsDate: false,
  },
  {
    key: "sale",
    label: "For sale",
    icon: "tag",
    placeholder: "What are you selling, and what shape is it in?",
    wantsPrice: true,
    wantsDate: false,
  },
  {
    key: "ask",
    label: "Ask",
    icon: "help-circle",
    placeholder: "What do you need a hand with?",
    wantsPrice: false,
    wantsDate: false,
  },
  {
    key: "offer",
    label: "Offer",
    icon: "life-buoy",
    placeholder: "What can you help with, and when are you free?",
    wantsPrice: true,
    wantsDate: false,
  },
] as const satisfies readonly BoardCategoryInfo[];

/* Compile-time guard, no runtime cost: add an eighth category to the union
   and forget to describe it above, and this alias stops type-checking. Same
   trick as `@/lib/course-color`. */
type Assert<T extends true> = T;
type UnlistedCategory = Exclude<
  BoardCategory,
  (typeof CATEGORIES)[number]["key"]
>;
type _EveryCategoryIsDescribed = Assert<
  [UnlistedCategory] extends [never] ? true : false
>;

const CATEGORY_BY_KEY: ReadonlyMap<BoardCategory, BoardCategoryInfo> = new Map(
  CATEGORIES.map((entry): [BoardCategory, BoardCategoryInfo] => [
    entry.key,
    entry,
  ])
);

/**
 * The description of one category. Total by construction: the guard above
 * proves every category in the union is listed, so this never falls back.
 *
 * Pure.
 *
 * @param category A category from a row or a filter.
 */
export function categoryInfo(category: BoardCategory): BoardCategoryInfo {
  return CATEGORY_BY_KEY.get(category) ?? CATEGORIES[0];
}

/**
 * Narrow an untrusted string (a route param, a stored filter, a column from
 * a client that's newer than this one) to a category we can actually draw.
 * Anything unrecognised reads as null, which every caller should treat as
 * "the whole board" rather than as an error.
 *
 * Pure.
 */
export function asBoardCategory(value: unknown): BoardCategory | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  for (const entry of CATEGORIES) {
    if (entry.key === normalized) return entry.key;
  }
  return null;
}

/* ══════════════════════════════ shapes ═══════════════════════════════ */

/**
 * The student behind a post, as a card byline renders them.
 *
 * A classmate who keeps their profile private is stripped to their handle
 * before anything renders; see {@link toAuthor}. Posting to a campus-wide
 * board is a "here is a thing I need" signal, not consent to publish the
 * profile they deliberately closed.
 */
export type BoardAuthor = {
  /** Their `profiles.id`. Push `/u/<id>` with it if the byline is tappable. */
  id: string;
  /** Their handle, without the leading `@`. */
  handle: string;
  /**
   * Their display name, or their handle when they're private or nameless.
   * Never blank.
   */
  display_name: string;
  /** Their avatar, or null. Fall back to initials via `@/components/avatar`. */
  avatar_url: string | null;
  /**
   * True when this person keeps their profile private, so the byline has
   * already been stripped to their handle. Draw the lock off this rather than
   * inferring it from a name that happens to match a handle. Always false on
   * the caller's own posts: you always see yourself in full.
   */
  locked: boolean;
};

/** One `board_posts` row with its author attached: a board card, entire. */
export type BoardPost = {
  /** `board_posts.id`: your list key, and what every write takes. */
  id: string;
  /** The campus it belongs to. Always the caller's own; RLS sees to that. */
  university_id: string;
  /** Who posted it (`profiles.id`). Never null; the column cascades. */
  author_id: string;
  /** Which of the seven boards it's on. */
  category: BoardCategory;
  /** The headline, 3-120 characters. Never blank. */
  title: string;
  /** The details, up to 1500 characters, or null when the title says it all. */
  body: string | null;
  /**
   * The asking price in **cents**, or null when there isn't one. Zero is a
   * real value and means free. Render it with {@link priceLabel}, never with
   * your own division.
   */
  price_cents: number | null;
  /**
   * For a ride, the day it leaves, as `"YYYY-MM-DD"`. Null for every other
   * category. Read it with {@link parseBoardDay}: a bare `new Date()` on a
   * date-only string lands on UTC midnight and reads as the day before in
   * every North American timezone.
   */
  happens_on: string | null;
  /**
   * ISO timestamp the author marked it handled: the ride filled, the bottle
   * came home, the couch went. Null while the post is open. Closed posts stay
   * readable and sink to the bottom of {@link fetchBoard}.
   */
  closed_at: string | null;
  /** ISO timestamp it went up. Newest first is the only order we use. */
  created_at: string;
  /**
   * The author's profile, or null when it isn't readable. Show a quiet
   * "Someone at Davis" byline rather than hiding the post. A ride home still
   * matters when the profile behind it didn't load.
   */
  author: BoardAuthor | null;
};

/**
 * Everything a student can set on a post. {@link createPost} and
 * {@link updatePost} take the same shape on purpose: an edit is a save of the
 * whole composer, not a patch, so the two paths validate identically and an
 * editor can't leave a stale price behind on a post that stopped being for
 * sale.
 */
export type BoardPostInput = {
  /** Which board it goes on. */
  category: BoardCategory;
  /** The headline, trimmed to 3-120 characters. */
  title: string;
  /** The details, trimmed to 1500 characters. Blank saves as no body at all. */
  body?: string | null;
  /**
   * The asking price in **cents**, 0 to 500000 (five thousand dollars). Omit
   * or pass null for no price. Build it from what the student typed with
   * {@link priceCentsFrom} rather than multiplying a float yourself.
   */
  priceCents?: number | null;
  /**
   * For a ride, the day it leaves. The local calendar day of this `Date` is
   * what gets stored. Ignored (and stored as null) for every other category,
   * because `happens_on` only means anything on a ride.
   */
  happensOn?: Date | null;
};

/** What {@link fetchBoard} narrows by. Hold one of these in screen state. */
export type BoardFilter = {
  /** One board, or omit/null for all seven. */
  category?: BoardCategory | null;
  /**
   * Whether to include posts the author already closed. Default false. The
   * live board is the point. Turn it on for an "everything" toggle or for a
   * student's own history.
   */
  includeClosed?: boolean;
  /**
   * Fewest rows that will do, for a caller that only needs a preview. The
   * Home card shows three and has no use for the other ninety-seven, each of
   * which carries a joined author. Clamped to {@link BOARD_LIMIT}; omit it on
   * the board itself, which wants everything.
   *
   * Note this caps the rows the *database* returns, so it is applied before
   * the open-above-closed partition below. Ask for three with
   * `includeClosed` on and you may get three closed posts.
   */
  limit?: number;
};

/* ══════════════════════════════ limits ═══════════════════════════════ */

/** Shortest title the database accepts, after trimming. */
export const BOARD_TITLE_MIN = 3;

/** Longest title the database accepts. Cap your title TextInput here. */
export const BOARD_TITLE_MAX = 120;

/** Longest body the database accepts. Cap your body TextInput here. */
export const BOARD_BODY_MAX = 1500;

/** The most anyone can ask, in whole dollars. Five thousand buys a car. */
export const BOARD_PRICE_MAX_DOLLARS = 5000;

/** {@link BOARD_PRICE_MAX_DOLLARS} in cents: the column's own ceiling. */
export const BOARD_PRICE_MAX_CENTS = BOARD_PRICE_MAX_DOLLARS * 100;

/** Most posts one {@link fetchBoard} call will ever return. */
export const BOARD_LIMIT = 100;

/** How old a post gets before {@link isStale} says so. */
export const BOARD_STALE_DAYS = 30;

/** Columns every board query selects. Keep selects consistent. */
export const BOARD_SELECT =
  "id, university_id, author_id, category, title, body, price_cents, happens_on, closed_at, created_at";

/**
 * {@link BOARD_SELECT} plus the author, for the list. `is_public` rides along
 * because the board has to strip private profiles itself; see
 * {@link toAuthor}.
 */
const BOARD_LIST_SELECT = `${BOARD_SELECT}, author:profiles(id, handle, display_name, avatar_url, is_public)`;

/* ═════════════════════════════ failures ══════════════════════════════ */

/**
 * A board failure with a message written for a person, not a log. Show
 * `err.message` directly in your inline error. It never leaks SQL, ids, or
 * PostgREST codes.
 */
export class BoardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardError";
  }
}

/** What we say when a write didn't land and we don't know anything sharper. */
const WRITE_FAILED = "That didn't post just now. Give it another go.";

/** What we say when the post is gone, closed, or was never theirs. */
const GONE = "We couldn't find that post. It may already have come down.";

/** PostgREST hands RLS refusals back as 42501, check violations as 23514. */
function errorCode(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) return "";
  const code = (raw as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

/* ════════════════════════════ narrowing ══════════════════════════════ */

/**
 * An embedded relation comes back as an object OR a one-element array
 * depending on how PostgREST resolves it, and sometimes as null. Unwrap every
 * shape to a plain record. Same defence as
 * `@/features/mentions/use-mention-suggestions`, `@/lib/focus`, and
 * `@/lib/study-buddy`.
 */
function embedded(raw: unknown): Record<string, unknown> | null {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

/** A trimmed string, or null when it's missing, blank, or the wrong type. */
function optionalText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Whole cents off the wire, or null. Postgres hands `integer` back as a
 * number, but a numeric string is no reason to lose a price, and a negative
 * or non-finite value is never worth rendering.
 */
function optionalCents(raw: unknown): number | null {
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const whole = Math.trunc(value);
  return whole >= 0 ? whole : null;
}

/**
 * Narrow an embedded `profiles` row into a {@link BoardAuthor}; null when
 * there's no readable handle to stand behind the post.
 *
 * A classmate who set their profile private is stripped here, before anything
 * renders: their handle stands in for their name and nothing else of theirs
 * travels with the post. This is the same rule the directory, the new-message
 * picker, and `@/lib/study-buddy` follow, and it fails closed: anything other
 * than an explicit `is_public: true` counts as private, so a select that
 * forgets the column strips rather than leaks.
 *
 * Your own posts are never stripped: you always see yourself in full.
 *
 * @param raw    The embed as PostgREST returned it.
 * @param myId   The caller's `profiles.id`, or null while the session is
 *   still resolving, in which case nothing counts as the caller's own.
 */
function toAuthor(raw: unknown, myId: string | null): BoardAuthor | null {
  const record = embedded(raw);
  if (!record) return null;
  const id = optionalText(record["id"]);
  const handle = optionalText(record["handle"]);
  if (id === null || handle === null) return null;

  const isMe = myId !== null && id === myId;
  const locked = !isMe && record["is_public"] !== true;

  return {
    id,
    handle,
    display_name: locked
      ? handle
      : (optionalText(record["display_name"]) ?? handle),
    avatar_url: optionalText(record["avatar_url"]),
    locked,
  };
}

/**
 * Narrow one joined row into a {@link BoardPost}, or null when it's missing
 * something a card can't be drawn without: an id, a campus, an author, a
 * recognised category, a title, or a timestamp. Better an honest drop than a
 * card with no words on it. A missing author profile is fine and stays null.
 */
function toBoardPost(raw: unknown, myId: string | null): BoardPost | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const id = optionalText(record["id"]);
  const universityId = optionalText(record["university_id"]);
  const authorId = optionalText(record["author_id"]);
  const title = optionalText(record["title"]);
  const createdAt = optionalText(record["created_at"]);
  const category = asBoardCategory(record["category"]);
  if (id === null || universityId === null || authorId === null) return null;
  if (title === null || createdAt === null || category === null) return null;

  return {
    id,
    university_id: universityId,
    author_id: authorId,
    category,
    title,
    body: optionalText(record["body"]),
    price_cents: optionalCents(record["price_cents"]),
    happens_on: category === "ride" ? optionalText(record["happens_on"]) : null,
    closed_at: optionalText(record["closed_at"]),
    created_at: createdAt,
    author: toAuthor(record["author"], myId),
  };
}

/* ════════════════════════════ validation ═════════════════════════════ */

/**
 * Trim a proposed title and check it against the same 3-120 window the
 * database enforces, so a one-word title fails on the phone with a sentence
 * rather than as a check-constraint violation after a round trip.
 *
 * @throws {BoardError} With copy that's ready to render.
 */
function requireTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < BOARD_TITLE_MIN) {
    throw new BoardError(
      "Give your post a title. A few words is plenty, and it's what people scan."
    );
  }
  if (trimmed.length > BOARD_TITLE_MAX) {
    throw new BoardError(
      `Titles stop at ${BOARD_TITLE_MAX} characters. Put the rest in the details underneath.`
    );
  }
  return trimmed;
}

/**
 * Trim a proposed body against the 1500-character limit. Blank becomes null,
 * since an empty string in the column would render as a gap under the title.
 *
 * @throws {BoardError} With copy that's ready to render.
 */
function cleanBody(body: string | undefined | null): string | null {
  const trimmed = (body ?? "").trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > BOARD_BODY_MAX) {
    throw new BoardError(
      `Posts stop at ${BOARD_BODY_MAX} characters. Trim it, and swap details in a message.`
    );
  }
  return trimmed;
}

/**
 * Check a price in cents against the 0-500000 window the column enforces.
 * Null and undefined both mean "no price", which is the normal state for five
 * of the seven categories.
 *
 * @throws {BoardError} With copy that's ready to render.
 */
function cleanPriceCents(cents: number | undefined | null): number | null {
  if (cents === undefined || cents === null) return null;
  if (!Number.isFinite(cents)) {
    throw new BoardError("That price didn't read as a number. Try again?");
  }
  const whole = Math.round(cents);
  if (whole < 0) {
    throw new BoardError(
      "A price can't be less than nothing. Leave it blank if it's free."
    );
  }
  if (whole > BOARD_PRICE_MAX_CENTS) {
    throw new BoardError(
      `The board tops out at $${BOARD_PRICE_MAX_DOLLARS.toLocaleString()}. Anything bigger belongs somewhere else.`
    );
  }
  return whole;
}

/**
 * Turn what a student typed into whole cents, so a composer never does float
 * arithmetic of its own: `45.50 * 100` is `4550.000000000001` in JavaScript,
 * and a price that lands a hundredth of a cent off is a check-constraint
 * violation waiting to happen.
 *
 * Accepts "45", "$45", "45.50", "1,200", and blank. Blank means no price.
 * The result is already range-checked, so it can go straight into
 * {@link BoardPostInput}.
 *
 * @param text Raw TextInput contents.
 * @returns Whole cents, or null when the field is empty.
 * @throws {BoardError} When it isn't a number, or is outside 0-5000 dollars.
 */
export function priceCentsFrom(text: string | null | undefined): number | null {
  const trimmed = (text ?? "").trim().replace(/[$,\s]/g, "");
  if (trimmed.length === 0) return null;
  if (!/^\d*(\.\d{0,2})?$/.test(trimmed) || trimmed === ".") {
    throw new BoardError(
      "Write the price as a number: 45, or 45.50. Leave it blank if it's free."
    );
  }
  return cleanPriceCents(Math.round(Number(trimmed) * 100));
}

/**
 * The stored form of a calendar day: `"YYYY-MM-DD"` read off the LOCAL year,
 * month, and date, so a ride the student picked for Friday is stored as
 * Friday no matter which side of UTC midnight they were on when they tapped.
 *
 * Pure. Paired with {@link parseBoardDay}; use them together or not at all.
 */
export function toBoardDay(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Read a stored `happens_on` back as a `Date` at LOCAL midnight.
 *
 * `new Date("2026-08-14")` parses as UTC midnight, which is the 13th at 5pm in
 * California, so every ride would read as leaving a day early. We split the
 * string ourselves. A value that isn't a real calendar day (`"2026-02-31"`,
 * a blank, a timestamp from a future column) reads as null.
 *
 * Pure. Use it to seed a date picker in an edit screen, and to feed
 * {@link rideLabel} anything you'd rather not re-derive.
 */
export function parseBoardDay(day: string | null | undefined): Date | null {
  if (typeof day !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim().slice(0, 10));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const parsed = new Date(year, month - 1, date);
  // Reject a rolled-over date: JS turns Feb 31 into Mar 3 rather than failing.
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== date
  ) {
    return null;
  }
  return parsed;
}

/**
 * Validate a whole composer's worth of input and hand back the exact column
 * values to write. Shared by {@link createPost} and {@link updatePost} so the
 * two can never disagree about what a valid post is.
 *
 * The two conditional columns are decided here rather than trusted from the
 * caller: `happens_on` is nulled for anything that isn't a ride, because the
 * column means nothing on the other six boards, and a price is kept for every
 * category (the database allows it) even though only three composers offer
 * the field; see {@link BoardCategoryInfo.wantsPrice}.
 *
 * @throws {BoardError} With copy that's ready to render.
 */
function cleanInput(input: BoardPostInput): {
  category: BoardCategory;
  title: string;
  body: string | null;
  price_cents: number | null;
  happens_on: string | null;
} {
  const category = asBoardCategory(input.category);
  if (category === null) {
    throw new BoardError("Pick what kind of post this is first.");
  }
  return {
    category,
    title: requireTitle(input.title),
    body: cleanBody(input.body),
    price_cents: cleanPriceCents(input.priceCents),
    happens_on:
      category === "ride" && input.happensOn instanceof Date
        ? toBoardDay(input.happensOn)
        : null,
  };
}

/* ═════════════════════════════ identity ══════════════════════════════ */

/**
 * The caller's `profiles.id`, read from the stored session (no network hop;
 * supabase-js refreshes the token itself when it's stale).
 *
 * @throws {BoardError} When nobody's signed in.
 */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (error || typeof id !== "string" || id.length === 0) {
    throw new BoardError("Sign in again to post to the board.");
  }
  return id;
}

/** The caller's `profiles.id`, or null. For reads, which work either way. */
async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Who the caller is and which campus they're on. The insert policy pins
 * `university_id` to `current_university_id()`, so there is exactly one value
 * the database will accept, which is precisely why no screen should be
 * passing one. Read it from the profile and be done.
 *
 * @throws {BoardError} With copy that's ready to render.
 */
async function requireCampus(): Promise<{
  userId: string;
  universityId: string;
}> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("profiles")
    .select("university_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    throw new BoardError(
      "We couldn't reach your campus board just now. Check your connection and give it another go."
    );
  }
  const universityId =
    typeof data === "object" && data !== null
      ? optionalText((data as Record<string, unknown>)["university_id"])
      : null;
  if (universityId === null) {
    throw new BoardError(
      "Finish setting up your profile and your campus board opens up."
    );
  }
  return { userId, universityId };
}

/* ══════════════════════════════ reads ════════════════════════════════ */

/**
 * The campus board: open posts newest first, then (when you ask for them)
 * the closed ones, also newest first, sunk to the bottom where they read as
 * history rather than as offers.
 *
 * RLS scopes this to the caller's own university, so there is no campus
 * argument and no way to read another school's board. A signed-out caller
 * gets an empty array rather than a refusal.
 *
 * The 100-row cap is applied by the database to the NEWEST posts, before the
 * open/closed partition happens here. With `includeClosed` on, closed posts
 * therefore eat into the same hundred, which is the honest behaviour for
 * "the last hundred things that happened", and the reason the default leaves
 * them out entirely.
 *
 * Nothing is hidden by age: a ride whose day has passed and a post from last
 * quarter both still come back. Sinking those is the list's call, and
 * {@link isStale} is how it makes it.
 *
 * @param filter.category      One board, or omit for all seven.
 * @param filter.includeClosed Include posts the author already closed.
 *   Default false.
 * @returns Up to `limit` posts, or 100. Empty when the board is quiet.
 * @throws {BoardError} With copy that's ready to render.
 */
export async function fetchBoard({
  category,
  includeClosed = false,
  limit,
}: BoardFilter = {}): Promise<BoardPost[]> {
  const myId = await currentUserId();

  let query = supabase.from("board_posts").select(BOARD_LIST_SELECT);
  const wanted = asBoardCategory(category);
  if (wanted !== null) query = query.eq("category", wanted);
  if (!includeClosed) query = query.is("closed_at", null);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(
      typeof limit === "number" && limit > 0
        ? Math.min(Math.floor(limit), BOARD_LIMIT)
        : BOARD_LIMIT
    );
  if (error) {
    throw new BoardError(
      "We couldn't load the board. Check your connection and give it another go."
    );
  }
  if (!Array.isArray(data)) return [];

  const posts: BoardPost[] = [];
  for (const row of data) {
    const post = toBoardPost(row, myId);
    if (post) posts.push(post);
  }

  /* A stable partition, not a re-sort: everything is already newest-first, and
     `sort` is stable, so this only lifts the open posts above the closed ones
     and leaves both runs in the order the database gave us. */
  return posts.sort(
    (a, b) => Number(a.closed_at !== null) - Number(b.closed_at !== null)
  );
}

/**
 * One post by id, with its author attached, or null when it isn't there:
 * already deleted, or on another campus, which RLS renders as the same thing.
 *
 * For a detail screen opened from a notification or a report, where the list
 * that would have carried the row was never loaded.
 *
 * @param id The post's `board_posts.id`.
 * @throws {BoardError} With copy that's ready to render.
 */
export async function fetchPost(id: string): Promise<BoardPost | null> {
  const myId = await currentUserId();
  const { data, error } = await supabase
    .from("board_posts")
    .select(BOARD_LIST_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new BoardError(
      "We couldn't open that post. Check your connection and give it another go."
    );
  }
  return toBoardPost(data, myId);
}

/* ══════════════════════════════ writes ═══════════════════════════════ */

/**
 * Put something on the board.
 *
 * `university_id` is resolved from the caller's own profile (see
 * {@link requireCampus}), so a screen passes what the student typed and
 * nothing else. Title, body, price and date are all trimmed and checked here
 * first, so the column constraints stay a backstop rather than an error path
 * anybody sees.
 *
 * Not optimistic-friendly: wait for the row before adding it to the list, so
 * the board never shows a post the database refused.
 *
 * @param input What the composer holds. See {@link BoardPostInput}.
 * @returns The inserted post, author attached. Prepend it to your list.
 * @throws {BoardError} With copy that's ready to render.
 */
export async function createPost(input: BoardPostInput): Promise<BoardPost> {
  const values = cleanInput(input);
  const { userId, universityId } = await requireCampus();

  const { data, error } = await supabase
    .from("board_posts")
    .insert({ ...values, author_id: userId, university_id: universityId })
    .select(BOARD_LIST_SELECT)
    .single();

  if (error) {
    // 42501 is the RLS refusal: the campus on the row didn't match the session.
    if (errorCode(error) === "42501") {
      throw new BoardError(
        "We couldn't post that to your campus board. Sign in again and try once more."
      );
    }
    // 23514 is a length or range check we somehow let through. Say which.
    if (errorCode(error) === "23514") {
      throw new BoardError(
        `Titles run ${BOARD_TITLE_MIN}-${BOARD_TITLE_MAX} characters, details up to ${BOARD_BODY_MAX}, and prices up to $${BOARD_PRICE_MAX_DOLLARS.toLocaleString()}.`
      );
    }
    throw new BoardError(WRITE_FAILED);
  }

  const post = toBoardPost(data, userId);
  if (!post) throw new BoardError(WRITE_FAILED);
  return post;
}

/**
 * Save an edit. Takes the same shape as {@link createPost} because an edit is
 * a save of the whole composer: every editable column is written, so a post
 * that stops being for sale doesn't keep a price nobody meant to leave on it.
 *
 * Author-scoped twice over: the update policy is `author_id = auth.uid()`,
 * and the query filters on it too, so a post that isn't yours comes back as an
 * honest "not found" instead of a silent no-op.
 *
 * @param id    The post's `board_posts.id`.
 * @param input The composer's whole contents. See {@link BoardPostInput}.
 * @returns The saved post, author attached. Swap it into your list.
 * @throws {BoardError} When the post is gone, isn't yours, or the input
 *   doesn't pass. Copy is ready to render.
 */
export async function updatePost(
  id: string,
  input: BoardPostInput
): Promise<BoardPost> {
  const values = cleanInput(input);
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from("board_posts")
    .update(values)
    .eq("id", id)
    .eq("author_id", userId)
    .select(BOARD_LIST_SELECT)
    .maybeSingle();

  if (error) {
    if (errorCode(error) === "23514") {
      throw new BoardError(
        `Titles run ${BOARD_TITLE_MIN}-${BOARD_TITLE_MAX} characters, details up to ${BOARD_BODY_MAX}, and prices up to $${BOARD_PRICE_MAX_DOLLARS.toLocaleString()}.`
      );
    }
    throw new BoardError("We couldn't save that edit. Give it another go.");
  }

  const post = toBoardPost(data, userId);
  if (!post) throw new BoardError(GONE);
  return post;
}

/**
 * Mark a post handled: the ride filled, the bottle came home, the couch went.
 *
 * This is the ordinary end of a post's life, and it is not a delete: the row
 * stays readable and {@link fetchBoard} sinks it below the open ones when the
 * reader asks to see closed posts at all. Reach for {@link deletePost} only
 * for something that shouldn't have been written.
 *
 * Only touches rows that are still open, so a double tap can't move the time
 * it closed. Closing something already closed (or something that isn't yours,
 * which the policy hides) resolves with null rather than throwing: the
 * author's intent already holds.
 *
 * Safe to run optimistically: grey the card, call this, and un-grey it with a
 * warm inline error if it throws.
 *
 * @param id The post's `board_posts.id`.
 * @returns The closed post, or null if there was nothing open to close.
 * @throws {BoardError} With copy that's ready to render.
 */
export async function closePost(id: string): Promise<BoardPost | null> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("board_posts")
    .update({ closed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("author_id", userId)
    .is("closed_at", null)
    .select(BOARD_LIST_SELECT)
    .maybeSingle();
  if (error) {
    throw new BoardError("We couldn't close that post. Give it another go.");
  }
  return toBoardPost(data, userId);
}

/**
 * Put a closed post back on the board: the ride fell through, the couch came
 * back. Clears `closed_at` and nothing else, so the post returns with its
 * original date on it; a stale one should be edited or reposted rather than
 * quietly reopened, and {@link isStale} is how a screen can say so.
 *
 * Only touches rows that are actually closed, so reopening twice is a no-op
 * and resolves with null.
 *
 * Safe to run optimistically.
 *
 * @param id The post's `board_posts.id`.
 * @returns The reopened post, or null if there was nothing closed to reopen.
 * @throws {BoardError} With copy that's ready to render.
 */
export async function reopenPost(id: string): Promise<BoardPost | null> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("board_posts")
    .update({ closed_at: null })
    .eq("id", id)
    .eq("author_id", userId)
    .not("closed_at", "is", null)
    .select(BOARD_LIST_SELECT)
    .maybeSingle();
  if (error) {
    throw new BoardError("We couldn't put that back up. Give it another go.");
  }
  return toBoardPost(data, userId);
}

/**
 * Take a post off the board for good.
 *
 * The board's normal ending is {@link closePost}: closed posts stay readable,
 * and that is the whole reason the column exists. Delete is for a post that
 * shouldn't have been written: the wrong number in the body, a duplicate, a
 * thing the author would rather leave no trace of. Confirmation copy should
 * name that consequence ("It comes off the board and nobody can read it
 * again") rather than asking whether they're sure.
 *
 * A row that's already gone (or that isn't the caller's, which the policy
 * hides) resolves quietly: the intent already holds. That makes this safe to
 * run optimistically.
 *
 * Any reports filed against the post survive it; `reports.board_post_id` is
 * `on delete set null`, so moderators keep the record without the row.
 *
 * @param id The post's `board_posts.id`.
 * @throws {BoardError} With copy that's ready to render.
 */
export async function deletePost(id: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from("board_posts")
    .delete()
    .eq("id", id)
    .eq("author_id", userId);
  if (error) {
    throw new BoardError("We couldn't take that post down. Give it another go.");
  }
}

/* ═══════════════════════════ pure helpers ════════════════════════════ */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight for the given moment. Same definition as `@/lib/study-plan`. */
function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Whole calendar days from `now`'s day to `day` (local time). Positive is the
 * future. Rounded, so a daylight-saving hour can't produce an off-by-one.
 */
function calendarDaysUntil(now: Date, day: Date): number {
  return Math.round(
    (startOfDay(day).getTime() - startOfDay(now).getTime()) / DAY_MS
  );
}

/**
 * What a price says on a card: `null` when there isn't one, `"Free"` at zero,
 * `"$45"` at whole dollars, `"$12.50"` when there are cents.
 *
 * Zero is deliberately a word rather than `$0`: "Free" is the thing a student
 * is scanning for, and `$0.00` reads like a bug. Missing is null rather than a
 * dash, so a card with no price renders nothing at all instead of a placeholder.
 *
 * Pure.
 *
 * @param cents `board_posts.price_cents`, straight off the row.
 */
export function priceLabel(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  if (!Number.isFinite(cents)) return null;
  const whole = Math.max(0, Math.round(cents));
  if (whole === 0) return "Free";
  const dollars = Math.floor(whole / 100);
  const remainder = whole % 100;
  const amount = dollars.toLocaleString();
  return remainder === 0
    ? `$${amount}`
    : `$${amount}.${String(remainder).padStart(2, "0")}`;
}

/**
 * When a ride leaves, said the way a person would: "Leaving today", "Leaving
 * tomorrow", "Leaving Friday" inside the coming week, "Leaving Nov 14" beyond
 * it, then the past tense once the day has gone: "Left yesterday", "Left
 * Friday", "Left last week", "Left Nov 14".
 *
 * The past tense is the point. A ride whose day has passed is still on the
 * board (nobody comes back to close a post about a drive they already took),
 * so the label has to be the thing that tells a reader not to bother. Pair it
 * with {@link isStale}, which draws the same line for the list's sorting.
 *
 * Returns null for a post that isn't a ride or has no date. Render nothing
 * rather than a placeholder.
 *
 * Pure: pass the moment in, from a screen's state or a test.
 *
 * @param happensOn `board_posts.happens_on`, straight off the row.
 * @param now       The current moment. Never read the clock in here.
 */
export function rideLabel(
  happensOn: string | null | undefined,
  now: Date
): string | null {
  const day = parseBoardDay(happensOn);
  if (day === null) return null;
  const days = calendarDaysUntil(now, day);

  if (days === 0) return "Leaving today";
  if (days === 1) return "Leaving tomorrow";
  if (days > 1 && days < 7) {
    return `Leaving ${day.toLocaleDateString([], { weekday: "long" })}`;
  }
  if (days >= 7) return `Leaving ${monthDay(day)}`;

  if (days === -1) return "Left yesterday";
  if (days > -7) {
    return `Left ${day.toLocaleDateString([], { weekday: "long" })}`;
  }
  if (days > -14) return "Left last week";
  return `Left ${monthDay(day)}`;
}

/** "Nov 14", the same short date the calendar and the club page print. */
function monthDay(day: Date): string {
  return day.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Whether a post has quietly gone past being useful: a ride whose day has
 * been and gone, or anything at all that's been up for more than
 * {@link BOARD_STALE_DAYS} days.
 *
 * This is not a hidden state and not a database column. Nothing expires. It
 * is the list's own judgement, so a board that nobody has tidied still reads
 * as a live board: stale posts sink under the fresh ones, draw quieter, and
 * stay perfectly readable and perfectly tappable for the student who wants
 * them. A post the author has closed is a different thing entirely; check
 * `closed_at` for that.
 *
 * Pure: pass the moment in.
 *
 * @param post Anything carrying a category, a date, and a created time.
 * @param now  The current moment.
 */
export function isStale(
  post: Pick<BoardPost, "category" | "happens_on" | "created_at">,
  now: Date
): boolean {
  if (post.category === "ride") {
    const day = parseBoardDay(post.happens_on);
    if (day !== null && calendarDaysUntil(now, day) < 0) return true;
  }
  const created = new Date(post.created_at).getTime();
  if (Number.isNaN(created)) return false;
  return now.getTime() - created > BOARD_STALE_DAYS * DAY_MS;
}

/**
 * Whether the signed-in student wrote this post: the client-side twin of the
 * `author_id = auth.uid()` policies. Use it to decide whether a card offers
 * edit, close, and delete at all, so nobody taps an action RLS will refuse,
 * and to decide whether the card offers "report" instead.
 *
 * Pure.
 *
 * @param post The post in question.
 * @param myId Your own `profiles.id`, or null while it's still resolving.
 */
export function isMine(
  post: Pick<BoardPost, "author_id">,
  myId: string | null
): boolean {
  if (myId === null || myId.length === 0) return false;
  return post.author_id === myId;
}
