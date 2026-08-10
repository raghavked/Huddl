import { supabase } from "@/lib/supabase";

/* Club announcements — the data layer.
 *
 * An announcement is an officer writing to the whole club at once: a title, a
 * body, and one notification each ("club_post"), with none of the chat noise a
 * pinned message in the club channel would make. Members read them; officers
 * and owners write them; authors can take their own back down.
 *
 * Migration 0028 created `club_announcements` with three policies and no RPCs,
 * so every rule here is enforced by RLS on a plain query:
 *
 *   read    is_club_member(club_id)  — join the club to see the board
 *   insert  author_id = auth.uid() AND is_club_officer(club_id)
 *   delete  author_id = auth.uid()   — your words, your call
 *
 * The notification fan-out is a database trigger on insert. It skips the
 * author and anyone on either side of a block, so the client never writes a
 * notification row and never needs to think about blocks.
 *
 * No React, no theme, no navigation — queries, validation, and two pure
 * predicates. Failures arrive as a {@link ClubAnnouncementError} whose message
 * is warm, specific, and safe to render straight into an inline error.
 */

/* ------------------------------ shapes ------------------------------ */

/**
 * A club role as `club_members.role` stores it. `"officer"` and `"owner"` are
 * the two that can post — see {@link canPostAnnouncements} rather than
 * comparing strings at each call site.
 */
export type ClubRole = "member" | "officer" | "owner";

/** Just enough of the officer who wrote a post to render a byline. */
export type AnnouncementAuthor = {
  /** `profiles.id` — push `/u/<id>` with it if the byline is tappable. */
  id: string;
  /** Their display name. Never blank: a nameless row is dropped instead. */
  display_name: string;
  /** Their avatar, or null — fall back to initials via `@/components/avatar`. */
  avatar_url: string | null;
};

/**
 * One `club_announcements` row with its author attached, exactly as
 * {@link fetchAnnouncements} and {@link postAnnouncement} hand it over.
 */
export type ClubAnnouncement = {
  /** `club_announcements.id` — your list key, and what a delete takes. */
  id: string;
  /** Which club it belongs to (`clubs.id`). */
  club_id: string;
  /** Who wrote it (`profiles.id`), or null once they've left Huddl. */
  author_id: string | null;
  /** The headline, 1-120 characters. */
  title: string;
  /** The notice itself, 1-2000 characters. */
  body: string;
  /** ISO timestamp it was posted. Newest first is the only order we use. */
  created_at: string;
  /**
   * The author's profile, or null when they've deleted their account (the
   * column is `on delete set null`) or their profile isn't readable. Show a
   * quiet "A past officer" byline rather than hiding the notice — the post
   * still matters to the club.
   */
  author: AnnouncementAuthor | null;
};

/* ------------------------------ limits ------------------------------ */

/**
 * Shortest title the database accepts, after trimming. A composer should keep
 * its post button disabled until the title has at least this much in it.
 */
export const ANNOUNCEMENT_TITLE_MIN = 1;

/** Longest title the database accepts — cap your title TextInput here. */
export const ANNOUNCEMENT_TITLE_MAX = 120;

/** Shortest body the database accepts, after trimming. */
export const ANNOUNCEMENT_BODY_MIN = 1;

/** Longest body the database accepts — cap your body TextInput here. */
export const ANNOUNCEMENT_BODY_MAX = 2000;

/** How many posts {@link fetchAnnouncements} loads when you don't say. */
export const ANNOUNCEMENTS_PAGE_SIZE = 20;

/** Most posts one {@link fetchAnnouncements} call will ever return. */
export const ANNOUNCEMENTS_MAX = 100;

/** Columns every announcement query selects. Keep selects consistent. */
export const ANNOUNCEMENT_SELECT =
  "id, club_id, author_id, title, body, created_at, author:profiles(id, display_name, avatar_url)";

/* ----------------------------- failures ----------------------------- */

/**
 * A club-announcement failure with a message written for a person, not a log.
 * Show `err.message` directly in your inline error — it never leaks SQL, ids,
 * or PostgREST codes.
 */
export class ClubAnnouncementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClubAnnouncementError";
  }
}

/** PostgREST hands RLS refusals back as 42501, check violations as 23514. */
function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

/* ---------------------------- narrowing ----------------------------- */

/**
 * The Supabase client here is untyped, and PostgREST hands an embedded
 * relation back as an object OR a one-element array depending on how it
 * resolves the relationship (and as null when there's nothing to embed).
 * Unwrap every shape to a plain record. Same defence as
 * `@/features/mentions/use-mention-suggestions` and `@/lib/focus`.
 */
function embedded(raw: unknown): Record<string, unknown> | null {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

/** Narrow an embedded `profiles` row; null when there's no usable name on it. */
function toAuthor(raw: unknown): AnnouncementAuthor | null {
  const record = embedded(raw);
  if (!record) return null;
  const id = record["id"];
  const displayName = record["display_name"];
  const avatarUrl = record["avatar_url"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof displayName !== "string" || displayName.length === 0) return null;
  return {
    id,
    display_name: displayName,
    avatar_url: typeof avatarUrl === "string" ? avatarUrl : null,
  };
}

/**
 * Narrow one joined row into a {@link ClubAnnouncement}, or null if it's
 * missing something we promise callers — better to drop a half-row than to
 * render a notice with no words in it. A missing author is fine and stays
 * null; a missing title or body is not.
 */
function toAnnouncement(raw: unknown): ClubAnnouncement | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = record["id"];
  const clubId = record["club_id"];
  const title = record["title"];
  const body = record["body"];
  const createdAt = record["created_at"];
  const authorId = record["author_id"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof clubId !== "string" || clubId.length === 0) return null;
  if (typeof title !== "string" || title.length === 0) return null;
  if (typeof body !== "string" || body.length === 0) return null;
  if (typeof createdAt !== "string" || createdAt.length === 0) return null;
  return {
    id,
    club_id: clubId,
    author_id:
      typeof authorId === "string" && authorId.length > 0 ? authorId : null,
    title,
    body,
    created_at: createdAt,
    author: toAuthor(record["author"]),
  };
}

/** Narrow `club_members.role`; anything unexpected reads as no role at all. */
function toRole(raw: unknown): ClubRole | null {
  if (raw === "member" || raw === "officer" || raw === "owner") return raw;
  return null;
}

/* ---------------------------- validation ---------------------------- */

/**
 * Trim a proposed title and check it against the same 1-120 window the
 * database enforces, so an empty or runaway title never costs a round trip.
 *
 * @returns The trimmed title, ready to insert.
 * @throws {ClubAnnouncementError} With copy that's ready to render.
 */
function requireTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < ANNOUNCEMENT_TITLE_MIN) {
    throw new ClubAnnouncementError("Give this post a title first.");
  }
  if (trimmed.length > ANNOUNCEMENT_TITLE_MAX) {
    throw new ClubAnnouncementError(
      `Titles stop at ${ANNOUNCEMENT_TITLE_MAX} characters — try a shorter one.`
    );
  }
  return trimmed;
}

/**
 * Trim a proposed body and check it against the same 1-2000 window the
 * database enforces.
 *
 * @returns The trimmed body, ready to insert.
 * @throws {ClubAnnouncementError} With copy that's ready to render.
 */
function requireBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length < ANNOUNCEMENT_BODY_MIN) {
    throw new ClubAnnouncementError(
      "Write something for your members to read."
    );
  }
  if (trimmed.length > ANNOUNCEMENT_BODY_MAX) {
    throw new ClubAnnouncementError(
      `Posts stop at ${ANNOUNCEMENT_BODY_MAX} characters. Trim it, or put the long version in the club chat.`
    );
  }
  return trimmed;
}

/**
 * The caller's `profiles.id`, read from the stored session (no network hop —
 * supabase-js refreshes the token itself when it's stale).
 *
 * @throws {ClubAnnouncementError} When nobody's signed in.
 */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (error || typeof id !== "string" || id.length === 0) {
    throw new ClubAnnouncementError("Sign in again to post to your club.");
  }
  return id;
}

/* ------------------------------ reads ------------------------------- */

/**
 * A club's announcements, newest first, each with its author's name and
 * avatar attached.
 *
 * RLS means only club members get rows back, so an empty array is the honest
 * answer for both "nothing posted yet" and "you're not in this club" — pair
 * it with {@link fetchMyClubRole} if the screen needs to tell those apart
 * (empty board versus a join prompt).
 *
 * @param clubId The club's `clubs.id`.
 * @param limit  How many to load; defaults to 20, clamped to 1-100.
 * @throws {ClubAnnouncementError} With copy that's ready to render.
 */
export async function fetchAnnouncements(
  clubId: string,
  limit: number = ANNOUNCEMENTS_PAGE_SIZE
): Promise<ClubAnnouncement[]> {
  const count = Number.isFinite(limit)
    ? Math.min(Math.max(Math.round(limit), 1), ANNOUNCEMENTS_MAX)
    : ANNOUNCEMENTS_PAGE_SIZE;

  const { data, error } = await supabase
    .from("club_announcements")
    .select(ANNOUNCEMENT_SELECT)
    .eq("club_id", clubId)
    .order("created_at", { ascending: false })
    .limit(count);
  if (error) {
    throw new ClubAnnouncementError(
      "We couldn't load this club's posts. Check your connection and give it another go."
    );
  }
  if (!Array.isArray(data)) return [];

  const out: ClubAnnouncement[] = [];
  for (const row of data) {
    const announcement = toAnnouncement(row);
    if (announcement) out.push(announcement);
  }
  return out;
}

/**
 * The caller's role in a club — `"owner"`, `"officer"`, `"member"`, or null
 * when they haven't joined. Screens use it to decide what to show (a compose
 * button, a "members only" note) instead of guessing from a failed write.
 *
 * Rosters are readable campus-wide, so this is a cheap single-row lookup. A
 * signed-out caller gets null rather than an error — no session, no role.
 *
 * @param clubId The club's `clubs.id`.
 * @throws {ClubAnnouncementError} With copy that's ready to render.
 */
export async function fetchMyClubRole(
  clubId: string
): Promise<ClubRole | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (typeof userId !== "string" || userId.length === 0) return null;

  const { data, error } = await supabase
    .from("club_members")
    .select("role")
    .eq("club_id", clubId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new ClubAnnouncementError("We couldn't check your club membership.");
  }
  if (typeof data !== "object" || data === null) return null;
  return toRole((data as Record<string, unknown>)["role"]);
}

/* ------------------------------ writes ------------------------------ */

/**
 * Post a notice to the whole club. Officers and owners only — the insert
 * policy checks `is_club_officer(club_id)` and pins `author_id` to the
 * caller, so there's no way to post as someone else.
 *
 * Title and body are trimmed and length-checked here first, so the database's
 * checks stay a backstop rather than an error path anyone sees. Every member
 * except the author (and anyone either of them has blocked) gets a
 * `club_post` notification from a trigger the moment this returns.
 *
 * Not optimistic-friendly: wait for the row before adding it to the list, so
 * the board never shows a post that RLS refused.
 *
 * @param opts.clubId The club's `clubs.id`.
 * @param opts.title  The headline; trimmed, 1-120 characters.
 * @param opts.body   The notice; trimmed, 1-2000 characters.
 * @returns The inserted row, author attached — prepend it to your list.
 * @throws {ClubAnnouncementError} With copy that's ready to render.
 */
export async function postAnnouncement({
  clubId,
  title,
  body,
}: {
  clubId: string;
  title: string;
  body: string;
}): Promise<ClubAnnouncement> {
  const cleanTitle = requireTitle(title);
  const cleanBody = requireBody(body);
  const authorId = await requireUserId();

  const { data, error } = await supabase
    .from("club_announcements")
    .insert({
      club_id: clubId,
      author_id: authorId,
      title: cleanTitle,
      body: cleanBody,
    })
    .select(ANNOUNCEMENT_SELECT)
    .single();

  if (error) {
    // 42501 is the RLS refusal: the caller isn't an officer of this club.
    if (errorCode(error) === "42501") {
      throw new ClubAnnouncementError("Only officers can post to the club.");
    }
    // 23514 is a length check we somehow let through — say which one.
    if (errorCode(error) === "23514") {
      throw new ClubAnnouncementError(
        `Titles run up to ${ANNOUNCEMENT_TITLE_MAX} characters and posts up to ${ANNOUNCEMENT_BODY_MAX}.`
      );
    }
    throw new ClubAnnouncementError(
      "We couldn't post that just now. Give it another go."
    );
  }

  const announcement = toAnnouncement(data);
  if (!announcement) {
    throw new ClubAnnouncementError(
      "We couldn't post that just now. Give it another go."
    );
  }
  return announcement;
}

/**
 * Take a post back down. Authors only — the delete policy matches on
 * `author_id`, so an officer can't remove a colleague's notice and a member
 * can't remove anything.
 *
 * A row that's already gone (or that the policy hides) resolves quietly: the
 * intent, "this post shouldn't be on the board", already holds. That makes
 * the call safe to run optimistically — drop the row from your list, call
 * this, and only roll back if it throws.
 *
 * Notifications already delivered stay put; this removes the post, not the
 * memory of it.
 *
 * @param id The post's `club_announcements.id`.
 * @throws {ClubAnnouncementError} With copy that's ready to render.
 */
export async function deleteAnnouncement(id: string): Promise<void> {
  const { error } = await supabase
    .from("club_announcements")
    .delete()
    .eq("id", id);
  if (error) {
    throw new ClubAnnouncementError(
      "We couldn't take that post down. Give it another go."
    );
  }
}

/* --------------------------- pure helpers --------------------------- */

/**
 * Whether a role may write announcements — the client-side twin of
 * `is_club_officer`. Keep the officer/owner rule here so a compose button and
 * an empty state can never disagree about who gets to post.
 *
 * Pure.
 *
 * @param role A role from {@link fetchMyClubRole}; null means not a member.
 */
export function canPostAnnouncements(role: ClubRole | null): boolean {
  return role === "officer" || role === "owner";
}

/**
 * Whether the signed-in person may delete a post — the client-side twin of
 * the "authors can remove their announcements" policy. Being an owner doesn't
 * grant it: only the author can take their own words down.
 *
 * Pure. Use it to decide whether the row offers a delete action at all, so
 * nobody taps one that RLS will quietly ignore.
 *
 * @param announcement The post in question.
 * @param myId         Your own `profiles.id`, or null while it's resolving.
 */
export function canDeleteAnnouncement(
  announcement: Pick<ClubAnnouncement, "author_id">,
  myId: string | null
): boolean {
  if (myId === null || myId.length === 0) return false;
  return announcement.author_id === myId;
}
