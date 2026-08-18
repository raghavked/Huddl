import { supabase } from "@/lib/supabase";

/* Club privacy, invitations, and the presidency: the data layer.
 *
 * Migration 0069 gave every club a door policy. An open club admits anyone
 * on campus, exactly as before; an invite club admits only through
 * `club_invites`, where officers write the guest list and the invitee alone
 * answers. The join policy on `club_members` refuses self-serve inserts into
 * invite clubs, so acceptance goes through `respond_to_club_invite()`, a
 * definer function that settles the invitation, seats the member, and tells
 * the inviter the good news in one transaction.
 *
 * The same round gave the presidency its guardrails: any role change that
 * touches 'owner' requires the caller to BE the owner, the owner cannot
 * leave while anyone else is still in the club, and the crown moves only
 * through `transfer_club_presidency()`, which promotes first and steps the
 * caller down to officer.
 *
 * No React, no theme, no navigation: queries, RPCs, and narrowing. Failures
 * arrive as a {@link ClubInviteError} whose message is warm, specific, and
 * safe to render straight into an inline error.
 */

/* ------------------------------ shapes ------------------------------ */

/** `clubs.privacy`: who gets through the door without an invitation. */
export type ClubPrivacy = "open" | "invite";

/** `club_invites.status`. Only `"pending"` invitations are live. */
export type ClubInviteStatus = "pending" | "accepted" | "declined" | "revoked";

/**
 * Just enough of an invitee to draw their row in the officers' panel. A
 * private classmate arrives with `display_name` null; show `@handle`.
 */
export type InviteeProfile = {
  /** `profiles.id`. */
  id: string;
  /** Their handle, always present. */
  handle: string;
  /** Their display name, or null when their profile is private. */
  display_name: string | null;
  /** Their avatar, or null; fall back to initials via `@/components/avatar`. */
  avatar_url: string | null;
  /** Whether their profile is public. Private rows come back masked. */
  is_public: boolean;
};

/** One pending invitation, as the officers' panel lists them. */
export type PendingClubInvite = {
  /** `club_invites.id`: your list key, and what a revoke takes. */
  id: string;
  /** The invitee (`profiles.id`). */
  user_id: string;
  /** ISO timestamp the invitation went out. */
  created_at: string;
  /** The invitee's card, or null if their profile isn't readable. */
  profile: InviteeProfile | null;
};

/** The signed-in student's own pending invitation to one club. */
export type MyClubInvite = {
  /** `club_invites.id`: what Accept and Decline answer. */
  id: string;
};

/** One campus profile card from `search_directory`. */
export type DirectoryCard = InviteeProfile;

/* ----------------------------- failures ----------------------------- */

/**
 * A club-invitation failure with a message written for a person, not a log.
 * Show `err.message` directly in your inline error. It never leaks SQL, ids,
 * or PostgREST codes.
 */
export class ClubInviteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClubInviteError";
  }
}

/** The database's own sentence for a stale invitation, passed through. */
const INVITE_GONE = "That invitation is gone or was already answered.";

/** PostgREST hands RLS refusals back as 42501, unique collisions as 23505. */
function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

/** The raised message inside an RPC error, if there is one to read. */
function errorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

/* ---------------------------- narrowing ----------------------------- */

/** Anything unexpected in `clubs.privacy` reads as the default the DB uses. */
export function toPrivacy(raw: unknown): ClubPrivacy {
  return raw === "invite" ? "invite" : "open";
}

/**
 * The Supabase client here is untyped, and PostgREST hands an embedded
 * relation back as an object OR a one-element array depending on how it
 * resolves the relationship (and as null when there's nothing to embed).
 * Unwrap every shape to a plain record. Same defence as
 * `@/lib/club-announcements`.
 */
function embedded(raw: unknown): Record<string, unknown> | null {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

/** Narrow a profile card; null when there's no usable handle on it. */
function toProfile(raw: unknown): InviteeProfile | null {
  const record = embedded(raw);
  if (!record) return null;
  const id = record["id"];
  const handle = record["handle"];
  const displayName = record["display_name"];
  const avatarUrl = record["avatar_url"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof handle !== "string" || handle.length === 0) return null;
  return {
    id,
    handle,
    display_name:
      typeof displayName === "string" && displayName.length > 0
        ? displayName
        : null,
    avatar_url: typeof avatarUrl === "string" ? avatarUrl : null,
    is_public: record["is_public"] === true,
  };
}

/** Narrow one joined row into a {@link PendingClubInvite}, or drop it. */
function toPendingInvite(raw: unknown): PendingClubInvite | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = record["id"];
  const userId = record["user_id"];
  const createdAt = record["created_at"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof userId !== "string" || userId.length === 0) return null;
  if (typeof createdAt !== "string" || createdAt.length === 0) return null;
  return {
    id,
    user_id: userId,
    created_at: createdAt,
    profile: toProfile(record["profile"]),
  };
}

/**
 * The caller's `profiles.id`, read from the stored session (no network hop:
 * supabase-js refreshes the token itself when it's stale).
 *
 * @throws {ClubInviteError} When nobody's signed in.
 */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (error || typeof id !== "string" || id.length === 0) {
    throw new ClubInviteError("Sign in again to manage club invitations.");
  }
  return id;
}

/* ------------------------------ reads ------------------------------- */

/**
 * The signed-in student's own pending invitation to a club, or null. The
 * club page uses it to draw the Accept / Decline banner for non-members.
 *
 * @param clubId The club's `clubs.id`.
 * @throws {ClubInviteError} With copy that's ready to render.
 */
export async function fetchMyClubInvite(
  clubId: string
): Promise<MyClubInvite | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (typeof userId !== "string" || userId.length === 0) return null;

  const { data, error } = await supabase
    .from("club_invites")
    .select("id")
    .eq("club_id", clubId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .maybeSingle();
  if (error) {
    throw new ClubInviteError("We couldn't check for an invitation.");
  }
  const id = (data as { id?: unknown } | null)?.id;
  return typeof id === "string" && id.length > 0 ? { id } : null;
}

/**
 * A club's outstanding invitations, newest first, each with the invitee's
 * card attached. Officers only by RLS; anyone else gets an empty list.
 *
 * @param clubId The club's `clubs.id`.
 * @throws {ClubInviteError} With copy that's ready to render.
 */
export async function fetchPendingClubInvites(
  clubId: string
): Promise<PendingClubInvite[]> {
  const { data, error } = await supabase
    .from("club_invites")
    .select(
      "id, user_id, created_at, profile:profiles!club_invites_user_id_fkey(id, handle, display_name, avatar_url, is_public)"
    )
    .eq("club_id", clubId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) {
    throw new ClubInviteError(
      "We couldn't load the invitations. Give it another go."
    );
  }
  if (!Array.isArray(data)) return [];

  const out: PendingClubInvite[] = [];
  for (const row of data) {
    const invite = toPendingInvite(row);
    if (invite) out.push(invite);
  }
  return out;
}

/**
 * Campus profile cards matching a name or handle, through the
 * `search_directory` RPC with `p_public_only` false, so private classmates
 * show up too (masked to handle and avatar). The server caps the page at 60.
 *
 * Callers filter out existing members and pending invitees themselves; the
 * directory doesn't know which club is asking.
 *
 * @param query What was typed. Blank still searches: it's the A-to-Z walk.
 * @throws {ClubInviteError} With copy that's ready to render.
 */
export async function searchClassmates(query: string): Promise<DirectoryCard[]> {
  const { data, error } = await supabase.rpc("search_directory", {
    p_query: query,
    p_offset: 0,
    p_public_only: false,
  });
  if (error) {
    throw new ClubInviteError(
      "The search didn't go through. Give it another go."
    );
  }
  if (!Array.isArray(data)) return [];

  const out: DirectoryCard[] = [];
  for (const row of data) {
    const card = toProfile(row);
    if (card) out.push(card);
  }
  return out;
}

/* ------------------------------ writes ------------------------------ */

/**
 * Invite a classmate to the club. Officers only: the insert policy pins
 * `invited_by` to the caller, requires the invitee to share the campus, and
 * refuses anyone already on the roster. A trigger notifies the invitee the
 * moment the row lands.
 *
 * @param clubId    The club's `clubs.id`.
 * @param inviteeId The classmate's `profiles.id`.
 * @returns The new invitation's id and timestamp, for the pending list.
 * @throws {ClubInviteError} With copy that's ready to render.
 */
export async function sendClubInvite(
  clubId: string,
  inviteeId: string
): Promise<{ id: string; created_at: string }> {
  const invitedBy = await requireUserId();

  const { data, error } = await supabase
    .from("club_invites")
    .insert({ club_id: clubId, user_id: inviteeId, invited_by: invitedBy })
    .select("id, created_at")
    .single();
  if (error) {
    // 23505 is the partial unique index: they already hold a live invitation.
    if (errorCode(error) === "23505") {
      throw new ClubInviteError("They already have an invitation waiting.");
    }
    // 42501 is the RLS refusal: not an officer, or they're already a member.
    if (errorCode(error) === "42501") {
      throw new ClubInviteError(
        "That invitation couldn't be sent. They may already be in the club."
      );
    }
    throw new ClubInviteError(
      "We couldn't send that invitation. Give it another go."
    );
  }

  const row = data as { id?: unknown; created_at?: unknown } | null;
  const id = row?.id;
  const createdAt = row?.created_at;
  if (typeof id !== "string" || typeof createdAt !== "string") {
    throw new ClubInviteError(
      "We couldn't send that invitation. Give it another go."
    );
  }
  return { id, created_at: createdAt };
}

/**
 * Take a pending invitation back. Officers only, and only to `'revoked'`:
 * accept and decline belong to the invitee. A row already settled resolves
 * quietly, since the intent, "this invitation shouldn't be out", holds.
 *
 * @param inviteId The invitation's `club_invites.id`.
 * @throws {ClubInviteError} With copy that's ready to render.
 */
export async function revokeClubInvite(inviteId: string): Promise<void> {
  const { error } = await supabase
    .from("club_invites")
    .update({ status: "revoked" })
    .eq("id", inviteId)
    .eq("status", "pending");
  if (error) {
    throw new ClubInviteError(
      "We couldn't take that invitation back. Give it another go."
    );
  }
}

/**
 * Answer an invitation. Invitee only, through the definer RPC that is the
 * one path from invitation to membership: accepting seats you on the roster
 * and in the club's rooms and thanks the inviter, declining just settles it.
 *
 * @param inviteId The invitation's `club_invites.id`.
 * @param accept   True to join, false to pass.
 * @throws {ClubInviteError} The database's own sentence when the invitation
 *   went stale under you, or generic retry copy for anything else.
 */
export async function respondToClubInvite(
  inviteId: string,
  accept: boolean
): Promise<void> {
  const { error } = await supabase.rpc("respond_to_club_invite", {
    p_invite_id: inviteId,
    p_accept: accept,
  });
  if (error) {
    // The RPC's stale-invite sentence is written for people; pass it on.
    if (errorMessage(error).includes(INVITE_GONE)) {
      throw new ClubInviteError(INVITE_GONE);
    }
    throw new ClubInviteError(
      "We couldn't answer that invitation. Give it another go."
    );
  }
}

/**
 * Hand the presidency to another member. President only; the RPC promotes
 * them first and steps the caller down to officer, in one transaction, so
 * nobody ever observes a club with no president.
 *
 * @param clubId   The club's `clubs.id`.
 * @param toUserId The next president's `profiles.id`. Must already be a member.
 * @throws {ClubInviteError} With copy that's ready to render.
 */
export async function transferClubPresidency(
  clubId: string,
  toUserId: string
): Promise<void> {
  const { error } = await supabase.rpc("transfer_club_presidency", {
    p_club_id: clubId,
    p_to_user: toUserId,
  });
  if (error) {
    throw new ClubInviteError(
      "We couldn't hand off the presidency. Give it another go."
    );
  }
}

/* --------------------------- pure helpers --------------------------- */

/**
 * The role in UI words. The data says owner / officer / member; the club
 * says President, Officer, Member. Keep the translation here so a badge and
 * a sheet can never disagree about what to call the same row.
 *
 * Pure.
 */
export function roleTitle(role: "owner" | "officer" | "member"): string {
  if (role === "owner") return "President";
  if (role === "officer") return "Officer";
  return "Member";
}

/** The name a profile card shows: display name, or the handle when private. */
export function cardName(profile: InviteeProfile): string {
  return profile.display_name ?? `@${profile.handle}`;
}
