import { supabase } from "@/lib/supabase";

/* Communities: the data layer.
 *
 * Where the board is one campus-wide list, a community is a place: a named
 * interest space any student can start, with a roster, a feed of posts the
 * whole campus can read and vote on, comments under each post, and topic
 * rooms that stem off it for live talk. Five tables from migration 0070,
 * every rule enforced by RLS on plain queries:
 *
 *   communities        campus-visible; any student starts one and the DB
 *                      seats them as its steward. Stewards (and moderators)
 *                      update or delete it.
 *   community_members  campus-visible roster; join yourself as a member,
 *                      leave yourself; stewards manage everyone else.
 *   community_posts    the feed. The campus reads it, but a folded or
 *                      deleted row stays visible only to its author, the
 *                      steward, and moderators. Posting requires membership.
 *   post_votes         one row per voter per post, value -1 or 1, readable
 *                      only by the voter. The aggregate lives on the post
 *                      as `score`, maintained by a trigger, which also folds
 *                      a post at -5 and unfolds it on recovery.
 *   post_comments      campus reads and writes; `comment_count` is
 *                      trigger-maintained, and the post's author gets a
 *                      'post_comment' notification.
 *
 * Migration 0071 added the craft on top. One community per campus is the
 * default, The Quad, which every student joins at signup and nobody can
 * close. Stewards write `rules`. Stewards and moderators pin posts, with
 * the trigger stamping who pinned. A post's author crowns one live comment
 * as `best_comment_id`, which notifies the comment's author. A post can
 * carry an event or a course, author-set, cleared by the DB if the target
 * goes. `edited_at` records a saved change, and a post can sit on the
 * private shelf via `message_bookmarks.community_post_id`. The aggregates
 * (`score`, `comment_count`, `hidden_at`) are the triggers' alone now:
 * nothing here writes them, and nothing here should.
 *
 * Removal here is SOFT, and that is the design decision the module leans on:
 * a post or comment comes down by `deleted_at`, never by DELETE, so the
 * author, the steward, and moderators can still see what was said, and a
 * report filed against it keeps its subject. The one hard delete is
 * {@link closeCommunity}, which takes the whole place down.
 *
 * No React, no theme, no navigation in here: queries, narrowing, validation,
 * and pure helpers. Every failure arrives as a {@link CommunityError} whose
 * message is warm, specific, and safe to drop straight into an inline error.
 */

/* ══════════════════════════════ limits ═══════════════════════════════ */

/** Shortest community name the database accepts, after trimming. */
export const COMMUNITY_NAME_MIN = 3;

/** Longest community name the database accepts. */
export const COMMUNITY_NAME_MAX = 48;

/** Longest description the database accepts. */
export const COMMUNITY_DESCRIPTION_MAX = 280;

/** Longest rules text the database accepts. */
export const COMMUNITY_RULES_MAX = 1000;

/** Shortest post title the database accepts, after trimming. */
export const POST_TITLE_MIN = 3;

/** Longest post title the database accepts. */
export const POST_TITLE_MAX = 120;

/** Longest post body the database accepts. */
export const POST_BODY_MAX = 4000;

/** Longest comment the database accepts. */
export const COMMENT_MAX = 2000;

/** How many posts one page of the feed carries. */
export const POSTS_PAGE = 30;

/** How many people one page of the roster carries. */
export const MEMBERS_PAGE = 60;

/** The score at which the trigger folds a post away. For copy, not logic. */
export const FOLD_SCORE = -5;

/* ═══════════════════════════ the vocabulary ══════════════════════════ */

/** The two seats on a roster, exactly as `community_members.role` stores them. */
export type CommunityRole = "member" | "steward";

/** The two ways a feed can read: newest first, or best first. */
export type PostSort = "new" | "top";

/** A vote is one of exactly two words. Absence is the third state. */
export type VoteValue = 1 | -1;

/* ══════════════════════════════ shapes ═══════════════════════════════ */

/**
 * The student behind a post or comment, as a byline renders them.
 *
 * A classmate who keeps their profile private is stripped to their handle
 * before anything renders, the same rule the board and the directory follow:
 * posting to a campus-readable feed is not consent to publish the profile
 * they deliberately closed. See {@link toAuthor}.
 */
export type CommunityAuthor = {
  /** Their `profiles.id`. Push `/u/<handle>` if the byline is tappable. */
  id: string;
  /** Their handle, without the leading `@`. */
  handle: string;
  /** Their display name, or their handle when private or nameless. */
  display_name: string;
  /** Their avatar, or null. Fall back to initials via `@/components/avatar`. */
  avatar_url: string | null;
  /**
   * True when this person keeps their profile private and the byline has
   * already been stripped to their handle. Always false on your own rows.
   */
  locked: boolean;
};

/**
 * One seat on a community's roster, its holder attached, as the Members
 * section draws a row. The profile passes through {@link toAuthor}, so a
 * private classmate arrives already stripped to their handle.
 */
export type CommunityMember = {
  /** Their `profiles.id`, and the roster's list key. */
  user_id: string;
  /** Their seat: 'member', or 'steward' with every steward power. */
  role: CommunityRole;
  /** ISO timestamp they joined. */
  joined_at: string;
  /** Their profile, stripped when private, or null when unreadable. */
  profile: CommunityAuthor | null;
};

/** One community, with its headcount attached: a browse card, entire. */
export type Community = {
  /** `communities.id`: your list key, and what every other query takes. */
  id: string;
  /** The campus it belongs to. Always the caller's own; RLS sees to that. */
  university_id: string;
  /** What it's called, 3-48 characters. */
  name: string;
  /** The kebab twin of the name. Stored for uniqueness, never shown. */
  slug: string;
  /** What it's about, up to 280 characters, or null. */
  description: string | null;
  /** Who started it, or null once that account is gone. */
  created_by: string | null;
  /** ISO timestamp it opened. */
  created_at: string;
  /**
   * True on exactly one community per campus: The Quad, the campus-wide
   * feed every student joins at signup. It renders first, offers no Leave,
   * and cannot be closed; the DB holds that line even if a screen forgets.
   */
  is_default: boolean;
  /** The steward's house rules, up to 1000 characters, or null. */
  rules: string | null;
  /** How many people are in it, counted by the same query that read it. */
  member_count: number;
};

/** The event a post carries, as the compact card draws it. */
export type PostEvent = {
  /** `events.id`. Push `/event/<id>` when the card is tapped. */
  id: string;
  title: string;
  /** ISO timestamp it starts. The card shows the day. */
  starts_at: string;
  location: string | null;
};

/** The course a post tags. The code is the chip. */
export type PostCourse = { id: string; code: string };

/** One `community_posts` row with its author attached. */
export type CommunityPost = {
  id: string;
  community_id: string;
  author_id: string;
  /** The headline, 3-120 characters. Never blank. */
  title: string;
  /** The rest of it, up to 4000 characters, or null. */
  body: string | null;
  /** Upvotes minus downvotes, maintained by the trigger. Never write it. */
  score: number;
  /** Live comments underneath, maintained by the trigger. Never write it. */
  comment_count: number;
  /**
   * Set while the campus has voted this post down past -5. The trigger
   * clears it if the score recovers. Only the author, the steward, and
   * moderators can still read a folded row; everyone else never receives it.
   */
  hidden_at: string | null;
  /** Set when the author saved a change. Null on an untouched post. */
  edited_at: string | null;
  /**
   * Set while a steward or moderator holds this post above the feed. The
   * trigger stamps `pinned_by`; the client only ever moves this one field.
   */
  pinned_at: string | null;
  /** Who pinned it. The trigger's to write, never ours. */
  pinned_by: string | null;
  /**
   * The comment the post's author crowned most helpful, or null. Only the
   * author may set it, it must be a live comment on this post, and setting
   * it tells the comment's author. All three rules live in the DB.
   */
  best_comment_id: string | null;
  /** The carried event's id, or null. `event` is the readable half. */
  event_id: string | null;
  /** The tagged course's id, or null. `course` is the readable half. */
  course_id: string | null;
  /** The carried event, embedded, or null when there isn't one to read. */
  event: PostEvent | null;
  /** The tagged course, embedded, or null. */
  course: PostCourse | null;
  /**
   * Set when the author, the steward, or a moderator took it down. The row
   * survives for exactly those three, so "This post was removed." can be an
   * honest sentence instead of a vanishing.
   */
  deleted_at: string | null;
  created_at: string;
  /** The author's profile, or null when it isn't readable. */
  author: CommunityAuthor | null;
};

/** One comment under a post, author attached. */
export type PostComment = {
  id: string;
  post_id: string;
  author_id: string;
  /** What they said, 1-2000 characters. */
  body: string;
  /** Set when it was taken down. The row stays as a tombstone for everyone. */
  deleted_at: string | null;
  created_at: string;
  author: CommunityAuthor | null;
};

/* ═════════════════════════════ failures ══════════════════════════════ */

/**
 * A communities failure with a message written for a person, not a log.
 * Show `err.message` directly in your inline error. It never leaks SQL,
 * ids, or PostgREST codes.
 */
export class CommunityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommunityError";
  }
}

/** What we say when a write didn't land and we don't know anything sharper. */
const WRITE_FAILED = "That didn't save just now. Give it another go.";

/** PostgREST hands unique collisions back as 23505, checks as 23514. */
function errorCode(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) return "";
  const code = (raw as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

/* ════════════════════════════ narrowing ══════════════════════════════ */

/**
 * An embedded relation comes back as an object OR a one-element array
 * depending on how PostgREST resolves it, and sometimes as null. Unwrap
 * every shape to a plain record. Same defence as `@/lib/board`.
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

/** A whole number, or the fallback when the wire handed back nonsense. */
function wholeNumber(raw: unknown, fallback: number): number {
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.trunc(value);
}

/**
 * Narrow an embedded `profiles` row into a {@link CommunityAuthor}; null
 * when there's no readable handle to stand behind the row. Fails closed:
 * anything other than an explicit `is_public: true` counts as private, so a
 * select that forgets the column strips rather than leaks. Your own rows
 * are never stripped: you always see yourself in full.
 */
function toAuthor(raw: unknown, myId: string | null): CommunityAuthor | null {
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

/** Narrow one `communities` row, or null when a card can't be drawn from it. */
function toCommunity(raw: unknown): Community | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = optionalText(record["id"]);
  const universityId = optionalText(record["university_id"]);
  const name = optionalText(record["name"]);
  const slug = optionalText(record["slug"]);
  const createdAt = optionalText(record["created_at"]);
  if (!id || !universityId || !name || !slug || !createdAt) return null;
  // `community_members(count)` arrives as [{ count }].
  const countRow = embedded(record["community_members"]);
  return {
    id,
    university_id: universityId,
    name,
    slug,
    description: optionalText(record["description"]),
    created_by: optionalText(record["created_by"]),
    created_at: createdAt,
    is_default: record["is_default"] === true,
    rules: optionalText(record["rules"]),
    member_count: wholeNumber(countRow?.["count"], 0),
  };
}

/** Narrow an embedded `events` row into a {@link PostEvent}, or null. */
function toPostEvent(raw: unknown): PostEvent | null {
  const record = embedded(raw);
  if (!record) return null;
  const id = optionalText(record["id"]);
  const title = optionalText(record["title"]);
  const startsAt = optionalText(record["starts_at"]);
  if (!id || !title || !startsAt) return null;
  return {
    id,
    title,
    starts_at: startsAt,
    location: optionalText(record["location"]),
  };
}

/** Narrow an embedded `courses` row into a {@link PostCourse}, or null. */
function toPostCourse(raw: unknown): PostCourse | null {
  const record = embedded(raw);
  if (!record) return null;
  const id = optionalText(record["id"]);
  const code = optionalText(record["code"]);
  if (!id || !code) return null;
  return { id, code };
}

/** Narrow one joined post row, or null. Better an honest drop than a blank card. */
function toPost(raw: unknown, myId: string | null): CommunityPost | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = optionalText(record["id"]);
  const communityId = optionalText(record["community_id"]);
  const authorId = optionalText(record["author_id"]);
  const title = optionalText(record["title"]);
  const createdAt = optionalText(record["created_at"]);
  if (!id || !communityId || !authorId || !title || !createdAt) return null;
  return {
    id,
    community_id: communityId,
    author_id: authorId,
    title,
    body: optionalText(record["body"]),
    score: wholeNumber(record["score"], 0),
    comment_count: wholeNumber(record["comment_count"], 0),
    hidden_at: optionalText(record["hidden_at"]),
    edited_at: optionalText(record["edited_at"]),
    pinned_at: optionalText(record["pinned_at"]),
    pinned_by: optionalText(record["pinned_by"]),
    best_comment_id: optionalText(record["best_comment_id"]),
    event_id: optionalText(record["event_id"]),
    course_id: optionalText(record["course_id"]),
    event: toPostEvent(record["event"]),
    course: toPostCourse(record["course"]),
    deleted_at: optionalText(record["deleted_at"]),
    created_at: createdAt,
    author: toAuthor(record["author"], myId),
  };
}

/** Narrow one joined comment row, or null. */
function toComment(raw: unknown, myId: string | null): PostComment | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = optionalText(record["id"]);
  const postId = optionalText(record["post_id"]);
  const authorId = optionalText(record["author_id"]);
  const createdAt = optionalText(record["created_at"]);
  // A deleted comment keeps its row but may not keep readable words; the
  // tombstone doesn't need them, so the body falls back to empty.
  if (!id || !postId || !authorId || !createdAt) return null;
  return {
    id,
    post_id: postId,
    author_id: authorId,
    body: optionalText(record["body"]) ?? "",
    deleted_at: optionalText(record["deleted_at"]),
    created_at: createdAt,
    author: toAuthor(record["author"], myId),
  };
}

/** Narrow one roster row, or null. Better an honest drop than a blank seat. */
function toMember(raw: unknown, myId: string | null): CommunityMember | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const userId = optionalText(record["user_id"]);
  const joinedAt = optionalText(record["joined_at"]);
  const role = record["role"];
  if (!userId || !joinedAt) return null;
  if (role !== "member" && role !== "steward") return null;
  return {
    user_id: userId,
    role,
    joined_at: joinedAt,
    profile: toAuthor(record["profile"], myId),
  };
}

/* ═════════════════════════════ selects ═══════════════════════════════ */

/**
 * `is_public` rides along everywhere an author does, because stripping a
 * private classmate to their handle is this module's job; see {@link toAuthor}.
 */
const AUTHOR_EMBED =
  "author:profiles(id, handle, display_name, avatar_url, is_public)";

const COMMUNITY_SELECT =
  "id, university_id, name, slug, description, created_by, created_at, is_default, rules, community_members(count)";

const POST_SELECT = `id, community_id, author_id, title, body, score, comment_count, hidden_at, edited_at, pinned_at, pinned_by, best_comment_id, event_id, course_id, deleted_at, created_at, event:events(id, title, starts_at, location), course:courses(id, code), ${AUTHOR_EMBED}`;

const COMMENT_SELECT = `id, post_id, author_id, body, deleted_at, created_at, ${AUTHOR_EMBED}`;

const MEMBER_SELECT =
  "user_id, role, joined_at, profile:profiles(id, handle, display_name, avatar_url, is_public)";

/* ═════════════════════════════ identity ══════════════════════════════ */

/**
 * The caller's `profiles.id`, read from the stored session (no network hop;
 * supabase-js refreshes the token itself when it's stale).
 *
 * @throws {CommunityError} When nobody's signed in.
 */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (error || typeof id !== "string" || id.length === 0) {
    throw new CommunityError("Sign in again and give it another go.");
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
 * `university_id` to `current_university_id()`, so there is exactly one
 * value the database will accept, which is precisely why no screen should
 * be passing one.
 *
 * @throws {CommunityError} With copy that's ready to render.
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
    throw new CommunityError(
      "We couldn't reach your campus just now. Check your connection and give it another go."
    );
  }
  const universityId =
    typeof data === "object" && data !== null
      ? optionalText((data as Record<string, unknown>)["university_id"])
      : null;
  if (universityId === null) {
    throw new CommunityError(
      "Finish setting up your profile and communities open up."
    );
  }
  return { userId, universityId };
}

/* ═══════════════════════════ communities ═════════════════════════════ */

/**
 * Every community on campus, headcounts attached, alphabetical, plus the
 * caller's own seats keyed by community id. The browse screen lifts the
 * joined ones to the top itself; the two halves come back together because
 * a list that can't say "yours" isn't worth drawing.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function fetchCommunities(): Promise<{
  communities: Community[];
  roles: Record<string, CommunityRole>;
}> {
  const myId = await currentUserId();
  const [listRes, mineRes] = await Promise.all([
    supabase.from("communities").select(COMMUNITY_SELECT).order("name"),
    myId
      ? supabase
          .from("community_members")
          .select("community_id, role")
          .eq("user_id", myId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (listRes.error || mineRes.error) {
    throw new CommunityError(
      "We couldn't load the communities. Check your connection and give it another go."
    );
  }
  const communities: Community[] = [];
  for (const row of listRes.data ?? []) {
    const community = toCommunity(row);
    if (community) communities.push(community);
  }
  const roles: Record<string, CommunityRole> = {};
  for (const raw of mineRes.data ?? []) {
    const record = raw as Record<string, unknown>;
    const id = optionalText(record["community_id"]);
    const role = record["role"];
    if (id && (role === "member" || role === "steward")) roles[id] = role;
  }
  return { communities, roles };
}

/**
 * One community by id, headcount attached, or null when it isn't there:
 * closed, or on another campus, which RLS renders as the same thing.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function fetchCommunity(id: string): Promise<Community | null> {
  const { data, error } = await supabase
    .from("communities")
    .select(COMMUNITY_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new CommunityError(
      "We couldn't open that community. Check your connection and give it another go."
    );
  }
  return toCommunity(data);
}

/** The caller's seat in one community, or null when they're not in it. */
export async function fetchMyRole(
  communityId: string
): Promise<CommunityRole | null> {
  const myId = await currentUserId();
  if (!myId) return null;
  const { data, error } = await supabase
    .from("community_members")
    .select("role")
    .eq("community_id", communityId)
    .eq("user_id", myId)
    .maybeSingle();
  if (error || !data) return null;
  const role = (data as Record<string, unknown>)["role"];
  return role === "member" || role === "steward" ? role : null;
}

/** "Board Games!!" -> "board-games": lowercase, runs of anything
    non-alphanumeric collapsed to single dashes, ends trimmed. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, COMMUNITY_NAME_MAX)
    .replace(/-+$/g, "");
}

/** A short random tail for the rare slug collision retry. */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

/**
 * Start a community. One insert; the DB trigger seats the founder as its
 * steward. The slug is derived here from the name, never typed and never
 * shown, and a collision with an existing community retries once with a
 * short random tail rather than bouncing the whole form.
 *
 * @returns The new community's id. Push `/communities/<id>` with it.
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function createCommunity(
  name: string,
  description: string
): Promise<string> {
  const trimmed = name.trim();
  if (trimmed.length < COMMUNITY_NAME_MIN) {
    throw new CommunityError(
      "Give it a name. A few characters is plenty, and it's what people scan."
    );
  }
  if (trimmed.length > COMMUNITY_NAME_MAX) {
    throw new CommunityError(
      `Names stop at ${COMMUNITY_NAME_MAX} characters. Put the rest in the description.`
    );
  }
  const baseSlug = slugify(trimmed);
  // The slug column wants three characters minimum, both ends alphanumeric.
  if (baseSlug.length < 3) {
    throw new CommunityError("Try a name with a few letters or numbers in it.");
  }
  const about = description.trim();
  if (about.length > COMMUNITY_DESCRIPTION_MAX) {
    throw new CommunityError(
      `Descriptions stop at ${COMMUNITY_DESCRIPTION_MAX} characters. The feed is where the long version lives.`
    );
  }

  const { userId, universityId } = await requireCampus();
  const insert = (slug: string) =>
    supabase
      .from("communities")
      .insert({
        university_id: universityId,
        created_by: userId,
        name: trimmed,
        slug,
        description: about || null,
      })
      .select("id")
      .single();

  // First the natural slug; if a classmate already took it (23505), once
  // more with a random tail. Two different names can share one kebab form.
  let { data, error } = await insert(baseSlug);
  if (errorCode(error) === "23505") {
    ({ data, error } = await insert(`${baseSlug}-${randomSuffix()}`));
  }
  const id = optionalText((data as Record<string, unknown> | null)?.["id"]);
  if (error || !id) {
    throw new CommunityError(
      errorCode(error) === "23505"
        ? "A community with that name already exists here. Find it in the list, or pick another name."
        : "We couldn't start that community just now. Give it another go."
    );
  }
  return id;
}

/**
 * Take the whole community down: the roster, the feed, everything. Only a
 * steward (or a moderator) can, and the confirmation that leads here should
 * name that consequence out loud.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function closeCommunity(id: string): Promise<void> {
  await requireUserId();
  // Ask for the row back: RLS refuses a non-steward with zero rows and no
  // error, and a close that silently didn't happen is the worst outcome.
  const { data, error } = await supabase
    .from("communities")
    .delete()
    .eq("id", id)
    .select("id");
  if (error || !data || data.length === 0) {
    throw new CommunityError(
      "We couldn't close the community just now. Give it another go."
    );
  }
}

/* ═══════════════════════════ membership ══════════════════════════════ */

/**
 * Join a community as a member. The insert policy allows exactly this
 * shape: yourself, role 'member', your own campus. A 23505 means you're
 * somehow already in, which is the state the tap wanted anyway.
 *
 * Safe to run optimistically.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function joinCommunity(communityId: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from("community_members")
    .insert({ community_id: communityId, user_id: userId });
  if (error && errorCode(error) !== "23505") {
    throw new CommunityError(
      "We couldn't add you just now. Give it another try."
    );
  }
}

/**
 * Leave a community. Deleting a row that's already gone resolves quietly:
 * the intent holds either way. Safe to run optimistically.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function leaveCommunity(communityId: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", userId);
  if (error) {
    throw new CommunityError(
      "We couldn't take you off the roster just now. Give it another try."
    );
  }
}

/* ═════════════════════════════ the roster ════════════════════════════ */

/**
 * One page of the community's roster, sixty people at a time: stewards
 * first, then everyone else in the order they joined. A page shorter than
 * {@link MEMBERS_PAGE} is the last.
 *
 * @param page Zero-based.
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function fetchCommunityMembers(
  communityId: string,
  page: number
): Promise<CommunityMember[]> {
  const myId = await currentUserId();
  const from = page * MEMBERS_PAGE;
  const { data, error } = await supabase
    .from("community_members")
    .select(MEMBER_SELECT)
    .eq("community_id", communityId)
    // 'steward' sorts after 'member', so descending puts the stewards first.
    .order("role", { ascending: false })
    .order("joined_at", { ascending: true })
    .range(from, from + MEMBERS_PAGE - 1);
  if (error) {
    throw new CommunityError(
      "We couldn't load the members. Give it another go."
    );
  }
  const members: CommunityMember[] = [];
  for (const raw of data ?? []) {
    const member = toMember(raw, myId);
    if (member) members.push(member);
  }
  return members;
}

/**
 * Hand a member the trowel: their seat becomes 'steward', with every
 * steward power that comes with it. The update policy is named "stewards
 * can share the trowel" for a reason: a community can have several, and
 * yours doesn't go anywhere. Asking for the row back turns an RLS refusal
 * into an honest error instead of a silent no-op.
 *
 * Not optimistic-friendly: a role is a permission, and a chip that lies
 * about permissions is worse than a beat of waiting.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function makeSteward(
  communityId: string,
  userId: string
): Promise<void> {
  await requireUserId();
  const { data, error } = await supabase
    .from("community_members")
    .update({ role: "steward" })
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .select("user_id");
  if (error || !data || data.length === 0) {
    throw new CommunityError(
      "We couldn't make them a steward just now. Give it another go."
    );
  }
}

/**
 * Take someone off the roster. A steward's delete on somebody else's row;
 * {@link leaveCommunity} is the door for your own. Nothing bars the way
 * back: they can rejoin like anyone else, and the confirmation should say
 * so. Asking for the row back turns a refusal into an honest error.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function removeCommunityMember(
  communityId: string,
  userId: string
): Promise<void> {
  await requireUserId();
  const { data, error } = await supabase
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .select("user_id");
  if (error || !data || data.length === 0) {
    throw new CommunityError(
      "We couldn't remove them just now. Give it another go."
    );
  }
}

/* ══════════════════════════════ rooms ════════════════════════════════ */

/** A topic room that belongs to a community, as its Rooms list draws one. */
export type CommunityRoom = { id: string; name: string | null; slug: string };

/**
 * The community's rooms: topic channels carrying its `community_id`. They
 * are ordinary channels in every other way, so opening one is just
 * `/channel/<id>` and creating one is the existing channel-create flow with
 * the community preset.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function fetchCommunityRooms(
  communityId: string
): Promise<CommunityRoom[]> {
  const { data, error } = await supabase
    .from("channels")
    .select("id, name, slug")
    .eq("community_id", communityId)
    .order("name");
  if (error) {
    throw new CommunityError(
      "We couldn't load the rooms. Give it another go."
    );
  }
  const rooms: CommunityRoom[] = [];
  for (const raw of data ?? []) {
    const record = raw as Record<string, unknown>;
    const id = optionalText(record["id"]);
    const slug = optionalText(record["slug"]);
    if (id && slug) {
      rooms.push({ id, name: optionalText(record["name"]), slug });
    }
  }
  return rooms;
}

/* ══════════════════════════════ the feed ═════════════════════════════ */

/**
 * One page of a community's feed, thirty posts at a time.
 *
 * "New" is strictly newest first. "Top" is score first within the last
 * seven days, newest breaking ties, so two posts the campus liked equally
 * keep arriving in the order they happened. RLS keeps folded and deleted
 * rows out of everyone's page
 * except the author's, the steward's, and a moderator's, so a page can
 * honestly carry a "Hidden by downvotes." row for exactly the people who
 * can do something about it.
 *
 * Pinned posts never appear here: {@link fetchPinnedPosts} carries them, so
 * the same post can't arrive twice as the pages walk past it.
 *
 * @param page Zero-based. A page shorter than {@link POSTS_PAGE} is the last.
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function fetchFeedPage(
  communityId: string,
  sort: PostSort,
  page: number
): Promise<CommunityPost[]> {
  const myId = await currentUserId();
  const from = page * POSTS_PAGE;
  let query = supabase
    .from("community_posts")
    .select(POST_SELECT)
    .eq("community_id", communityId)
    .is("pinned_at", null);
  // Top reads the last seven days only. An all-time Top fossilizes: the
  // first posts to gather votes hold the front page forever, and a feed
  // that never changes stops being worth opening. A week keeps it alive.
  query =
    sort === "top"
      ? query
          .gte(
            "created_at",
            new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
          )
          .order("score", { ascending: false })
          .order("created_at", { ascending: false })
      : query.order("created_at", { ascending: false });
  const { data, error } = await query.range(from, from + POSTS_PAGE - 1);
  if (error) {
    throw new CommunityError(
      "We couldn't load the feed. Check your connection and give it another go."
    );
  }
  const posts: CommunityPost[] = [];
  for (const row of data ?? []) {
    const post = toPost(row, myId);
    if (post) posts.push(post);
  }
  return posts;
}

/**
 * The community's pinned posts, newest pin first, however the feed under
 * them is sorted. A handful at most; a steward pinning thirty posts has
 * reinvented the feed and will notice on their own.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function fetchPinnedPosts(
  communityId: string
): Promise<CommunityPost[]> {
  const myId = await currentUserId();
  const { data, error } = await supabase
    .from("community_posts")
    .select(POST_SELECT)
    .eq("community_id", communityId)
    .not("pinned_at", "is", null)
    .order("pinned_at", { ascending: false });
  if (error) {
    throw new CommunityError(
      "We couldn't load the feed. Check your connection and give it another go."
    );
  }
  const posts: CommunityPost[] = [];
  for (const row of data ?? []) {
    const post = toPost(row, myId);
    if (post) posts.push(post);
  }
  return posts;
}

/**
 * One post by id, author attached, or null when it isn't readable: taken
 * down, folded away from you, or on another campus. For the post screen,
 * which is opened from the feed and from notifications alike.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function fetchCommunityPost(
  postId: string
): Promise<CommunityPost | null> {
  const myId = await currentUserId();
  const { data, error } = await supabase
    .from("community_posts")
    .select(POST_SELECT)
    .eq("id", postId)
    .maybeSingle();
  if (error) {
    throw new CommunityError(
      "We couldn't open that post. Check your connection and give it another go."
    );
  }
  return toPost(data, myId);
}

/**
 * Put a post on the feed. Membership is the door and RLS is the lock; the
 * screen should already be showing "Join to post." to anyone this would
 * refuse.
 *
 * Not optimistic-friendly: wait for the row before adding it to the list,
 * so the feed never shows a post the database refused.
 *
 * A post can carry an event or tag a course, or both; either id is the
 * author's to set and the DB clears it if the target is ever deleted.
 *
 * @returns The inserted post, author attached. Prepend it to your list.
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function createCommunityPost(
  communityId: string,
  title: string,
  body: string,
  carries?: { eventId?: string | null; courseId?: string | null }
): Promise<CommunityPost> {
  const cleanTitle = title.trim();
  if (cleanTitle.length < POST_TITLE_MIN) {
    throw new CommunityError(
      "Give your post a title. A few words is plenty, and it's what people scan."
    );
  }
  if (cleanTitle.length > POST_TITLE_MAX) {
    throw new CommunityError(
      `Titles stop at ${POST_TITLE_MAX} characters. Say the rest underneath.`
    );
  }
  const cleanBody = body.trim();
  if (cleanBody.length > POST_BODY_MAX) {
    throw new CommunityError(
      `Posts stop at ${POST_BODY_MAX} characters. Trim it, or carry on in the comments.`
    );
  }
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("community_posts")
    .insert({
      community_id: communityId,
      author_id: userId,
      title: cleanTitle,
      body: cleanBody || null,
      event_id: carries?.eventId ?? null,
      course_id: carries?.courseId ?? null,
    })
    .select(POST_SELECT)
    .single();
  if (error) {
    // 42501 is the RLS refusal: membership lapsed under the composer.
    if (errorCode(error) === "42501") {
      throw new CommunityError("Join the community first, then post.");
    }
    throw new CommunityError(WRITE_FAILED);
  }
  const post = toPost(data, userId);
  if (!post) throw new CommunityError(WRITE_FAILED);
  return post;
}

/**
 * Take a post down, softly: `deleted_at` lands and the row stays readable
 * to its author, the steward, and moderators. The UPDATE policy admits
 * exactly those three, so asking for the row back is what turns a refusal
 * into an honest error instead of a silent no-op.
 *
 * Safe to run optimistically.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function removeCommunityPost(postId: string): Promise<void> {
  await requireUserId();
  const { data, error } = await supabase
    .from("community_posts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", postId)
    .is("deleted_at", null)
    .select("id");
  if (error || !data || data.length === 0) {
    throw new CommunityError(
      "We couldn't take that post down. Give it another go."
    );
  }
}

/**
 * Save the author's changes to their own post: the title, the body, and
 * `edited_at` in one update, so the "Edited" marker lights up with the
 * words that earned it. Author-only by policy; asking for the row back
 * turns a refusal into an honest error.
 *
 * Not optimistic-friendly: wait for the row, then swap it in.
 *
 * @returns The updated post, author attached.
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function updateCommunityPost(
  postId: string,
  title: string,
  body: string
): Promise<CommunityPost> {
  const cleanTitle = title.trim();
  if (cleanTitle.length < POST_TITLE_MIN) {
    throw new CommunityError(
      "Give your post a title. A few words is plenty, and it's what people scan."
    );
  }
  if (cleanTitle.length > POST_TITLE_MAX) {
    throw new CommunityError(
      `Titles stop at ${POST_TITLE_MAX} characters. Say the rest underneath.`
    );
  }
  const cleanBody = body.trim();
  if (cleanBody.length > POST_BODY_MAX) {
    throw new CommunityError(
      `Posts stop at ${POST_BODY_MAX} characters. Trim it, or carry on in the comments.`
    );
  }
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("community_posts")
    .update({
      title: cleanTitle,
      body: cleanBody || null,
      edited_at: new Date().toISOString(),
    })
    .eq("id", postId)
    .is("deleted_at", null)
    .select(POST_SELECT);
  const post = toPost(
    Array.isArray(data) ? data[0] : null,
    userId
  );
  if (error || !post) {
    throw new CommunityError(
      "We couldn't save those changes. Give it another go."
    );
  }
  return post;
}

/**
 * Pin a post above the feed, or take it back down. Stewards and moderators
 * only; the trigger stamps `pinned_by`, so the client moves exactly one
 * field. Safe to run optimistically; the screen owns the rollback.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function setPostPinned(
  postId: string,
  pinned: boolean
): Promise<void> {
  await requireUserId();
  const { data, error } = await supabase
    .from("community_posts")
    .update({ pinned_at: pinned ? new Date().toISOString() : null })
    .eq("id", postId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw new CommunityError(
      pinned
        ? "We couldn't pin that post just now. Give it another go."
        : "We couldn't unpin that post just now. Give it another go."
    );
  }
}

/**
 * Crown one comment most helpful, or take the crown back with null. The
 * author's call alone, the comment must be live and on this post, and the
 * comment's author hears about it; all three rules are the DB's, so a
 * refusal here is the database saying no, not a guess.
 *
 * Safe to run optimistically; the screen owns the rollback.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function setBestComment(
  postId: string,
  commentId: string | null
): Promise<void> {
  await requireUserId();
  const { data, error } = await supabase
    .from("community_posts")
    .update({ best_comment_id: commentId })
    .eq("id", postId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw new CommunityError(
      commentId
        ? "We couldn't mark that comment just now. Give it another go."
        : "We couldn't unmark that comment just now. Give it another go."
    );
  }
}

/**
 * Write the community's rules. Steward's pen; an empty draft clears them
 * rather than leaving a blank heading on the doorway.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function updateCommunityRules(
  communityId: string,
  rules: string
): Promise<void> {
  const clean = rules.trim();
  if (clean.length > COMMUNITY_RULES_MAX) {
    throw new CommunityError(
      `Rules stop at ${COMMUNITY_RULES_MAX} characters. Short rules get read.`
    );
  }
  await requireUserId();
  const { data, error } = await supabase
    .from("communities")
    .update({ rules: clean || null })
    .eq("id", communityId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw new CommunityError(
      "We couldn't save the rules just now. Give it another go."
    );
  }
}

/* ══════════════════════════════ votes ════════════════════════════════ */

/**
 * The caller's own votes on the posts of one visible page, in a single
 * query, keyed by post id. Votes are private to their voter, so this is
 * the only vote read the app ever makes: your own arrows light up, and the
 * aggregate is `posts.score`.
 *
 * A failure resolves empty rather than throwing: arrows that haven't lit
 * yet are a lesser wrong than a feed that won't draw.
 */
export async function fetchMyVotes(
  postIds: readonly string[]
): Promise<Record<string, VoteValue>> {
  const votes: Record<string, VoteValue> = {};
  if (postIds.length === 0) return votes;
  const myId = await currentUserId();
  if (!myId) return votes;
  const { data, error } = await supabase
    .from("post_votes")
    .select("post_id, value")
    .eq("user_id", myId)
    .in("post_id", [...postIds]);
  if (error) return votes;
  for (const raw of data ?? []) {
    const record = raw as Record<string, unknown>;
    const id = optionalText(record["post_id"]);
    const value = wholeNumber(record["value"], 0);
    if (id && (value === 1 || value === -1)) votes[id] = value;
  }
  return votes;
}

/**
 * Cast or flip a vote: one upsert on the (post, voter) key, so tapping the
 * other arrow moves the same row rather than stacking a second one. The
 * trigger settles `score` and handles the fold at -5. Safe to run
 * optimistically; the screen owns the rollback.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function castVote(
  postId: string,
  value: VoteValue
): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from("post_votes")
    .upsert(
      { post_id: postId, user_id: userId, value },
      { onConflict: "post_id,user_id" }
    );
  if (error) {
    throw new CommunityError("That vote didn't land. Give it another tap.");
  }
}

/**
 * Take a vote back: tapping the lit arrow again. Deleting a vote that's
 * already gone resolves quietly.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function clearVote(postId: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from("post_votes")
    .delete()
    .eq("post_id", postId)
    .eq("user_id", userId);
  if (error) {
    throw new CommunityError("That vote didn't land. Give it another tap.");
  }
}

/* ═════════════════════════════ comments ══════════════════════════════ */

/**
 * Every comment under a post, oldest first, tombstones included: a removed
 * comment stays in the list as "This comment was removed." so the thread
 * underneath it still makes sense.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function fetchComments(postId: string): Promise<PostComment[]> {
  const myId = await currentUserId();
  const { data, error } = await supabase
    .from("post_comments")
    .select(COMMENT_SELECT)
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) {
    throw new CommunityError(
      "We couldn't load the comments. Give it another go."
    );
  }
  const comments: PostComment[] = [];
  for (const row of data ?? []) {
    const comment = toComment(row, myId);
    if (comment) comments.push(comment);
  }
  return comments;
}

/**
 * Say something under a post. Anyone on campus can; the post's author hears
 * about it through the notification the trigger writes.
 *
 * Not optimistic-friendly: wait for the row, then append it.
 *
 * @returns The inserted comment, author attached.
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function addComment(
  postId: string,
  body: string
): Promise<PostComment> {
  const clean = body.trim();
  if (clean.length === 0) {
    throw new CommunityError("Write something first.");
  }
  if (clean.length > COMMENT_MAX) {
    throw new CommunityError(
      `Comments stop at ${COMMENT_MAX} characters. Split the rest into another one.`
    );
  }
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("post_comments")
    .insert({ post_id: postId, author_id: userId, body: clean })
    .select(COMMENT_SELECT)
    .single();
  if (error) {
    throw new CommunityError(WRITE_FAILED);
  }
  const comment = toComment(data, userId);
  if (!comment) throw new CommunityError(WRITE_FAILED);
  return comment;
}

/**
 * Take a comment down, softly. The row stays as a tombstone for everyone,
 * which is what keeps the replies around it legible. Author, steward, and
 * moderators only; asking for the row back turns a refusal into an error.
 *
 * Safe to run optimistically.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function removeComment(commentId: string): Promise<void> {
  await requireUserId();
  const { data, error } = await supabase
    .from("post_comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", commentId)
    .is("deleted_at", null)
    .select("id");
  if (error || !data || data.length === 0) {
    throw new CommunityError(
      "We couldn't take that comment down. Give it another go."
    );
  }
}

/* ═════════════════════════════ the shelf ═════════════════════════════ */

/**
 * Which of these posts the caller has saved, as a set of post ids. The
 * same shelf as saved messages, one subject per bookmark, private to its
 * owner. A failure resolves empty rather than throwing: a bookmark icon
 * that hasn't lit yet is a lesser wrong than a feed that won't draw.
 */
export async function fetchMySavedPostIds(
  postIds: readonly string[]
): Promise<Set<string>> {
  const saved = new Set<string>();
  if (postIds.length === 0) return saved;
  const myId = await currentUserId();
  if (!myId) return saved;
  const { data, error } = await supabase
    .from("message_bookmarks")
    .select("community_post_id")
    .eq("user_id", myId)
    .in("community_post_id", [...postIds]);
  if (error) return saved;
  for (const raw of data ?? []) {
    const id = optionalText(
      (raw as Record<string, unknown>)["community_post_id"]
    );
    if (id) saved.add(id);
  }
  return saved;
}

/**
 * Put a post on the private shelf. A 23505 means it's already there,
 * which is the state the tap wanted anyway. Safe to run optimistically.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function savePost(postId: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from("message_bookmarks")
    .insert({ user_id: userId, community_post_id: postId });
  if (error && errorCode(error) !== "23505") {
    throw new CommunityError(
      "We couldn't save that post just now. Give it another try."
    );
  }
}

/**
 * Take a post off the shelf. Deleting a bookmark that's already gone
 * resolves quietly: the intent holds either way. Safe to run
 * optimistically.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function unsavePost(postId: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from("message_bookmarks")
    .delete()
    .eq("user_id", userId)
    .eq("community_post_id", postId);
  if (error) {
    throw new CommunityError(
      "We couldn't take that off your shelf just now. Give it another try."
    );
  }
}

/* ════════════════════════════ the carries ════════════════════════════ */

/**
 * Upcoming events on this campus, soonest first, for the composer's
 * picker: the same rows the events tab reads, trimmed to what a carried
 * post needs. Read-only reuse; the events screens stay the authority on
 * everything else about an event.
 *
 * @throws {CommunityError} With copy that's ready to render.
 */
export async function fetchUpcomingEvents(): Promise<PostEvent[]> {
  const { universityId } = await requireCampus();
  const { data, error } = await supabase
    .from("events")
    .select("id, title, starts_at, location")
    .eq("university_id", universityId)
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(50);
  if (error) {
    throw new CommunityError(
      "We couldn't load the calendar. Check your connection and give it another go."
    );
  }
  const events: PostEvent[] = [];
  for (const row of data ?? []) {
    const event = toPostEvent(row);
    if (event) events.push(event);
  }
  return events;
}

/* ═══════════════════════════ pure helpers ════════════════════════════ */

/**
 * "{n} members" with the singular handled: the one string every card and
 * header prints, kept here so no screen pluralises it a second way. Pure.
 */
export function membersLabel(count: number): string {
  return count === 1 ? "1 member" : `${count} members`;
}

/** "{n} comments" with the singular handled. Pure. */
export function commentsLabel(count: number): string {
  return count === 1 ? "1 comment" : `${count} comments`;
}

/**
 * Whether the signed-in student wrote this row: the client-side twin of the
 * `author_id = auth.uid()` policies. Use it to decide whether a row offers
 * delete or report, so nobody taps an action RLS will refuse. Pure.
 */
export function isMine(
  row: { author_id: string },
  myId: string | null
): boolean {
  if (myId === null || myId.length === 0) return false;
  return row.author_id === myId;
}
