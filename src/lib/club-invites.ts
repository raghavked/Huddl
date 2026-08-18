import { createClient } from "@/lib/supabase/client";

/* Club invitations: the data layer.
 *
 * An invitation is an officer holding the door of an invite-only club open
 * for one classmate. The row itself is plain (club, invitee, inviter,
 * status), so this module is mostly shapes: the select both clients of this
 * file agree on, and the narrowing that keeps a half-row off the screen.
 * Mutations live in `@/features/clubs/actions`, next to every other club
 * write; the one browser-side query here is the classmate search, because
 * it runs on every keystroke and a server action round trip per keystroke
 * would be rude to the typist.
 */

/** Pending invitations shown to officers, joined to both profiles. */
export const CLUB_INVITE_SELECT =
  "id, club_id, user_id, invited_by, status, created_at, " +
  "invitee:profiles!club_invites_user_id_fkey(id, handle, display_name, avatar_url, is_public), " +
  "inviter:profiles!club_invites_invited_by_fkey(id, display_name)";

/** Just enough of the invitee to draw their row on the invitations panel. */
export type InviteeProfile = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  is_public: boolean;
};

/** One pending invitation, both ends attached, as the officer panel reads it. */
export type PendingClubInvite = {
  id: string;
  club_id: string;
  user_id: string;
  invited_by: string | null;
  created_at: string;
  /** Null when the invitee's profile is gone; a row with nobody on it is no row, so callers drop those. */
  invitee: InviteeProfile | null;
  /** The inviter's name, or null once they've left. */
  inviter: { id: string; display_name: string } | null;
};

/**
 * One search_directory hit, as the invite search renders it. A private
 * profile arrives with display_name already nulled by the definer function,
 * so redaction is a fact of the row rather than a step the client can skip.
 */
export type InviteCandidate = {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  is_public: boolean;
};

/**
 * PostgREST hands an embedded relation back as an object OR a one-element
 * array depending on how it resolves the relationship. Unwrap both shapes.
 */
function embedded(raw: unknown): Record<string, unknown> | null {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function toInvitee(raw: unknown): InviteeProfile | null {
  const record = embedded(raw);
  if (!record) return null;
  const id = record["id"];
  const handle = record["handle"];
  const displayName = record["display_name"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof handle !== "string" || handle.length === 0) return null;
  if (typeof displayName !== "string" || displayName.length === 0) return null;
  return {
    id,
    handle,
    display_name: displayName,
    avatar_url:
      typeof record["avatar_url"] === "string"
        ? (record["avatar_url"] as string)
        : null,
    is_public: record["is_public"] === true,
  };
}

function toInviter(raw: unknown): { id: string; display_name: string } | null {
  const record = embedded(raw);
  if (!record) return null;
  const id = record["id"];
  const displayName = record["display_name"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof displayName !== "string" || displayName.length === 0) return null;
  return { id, display_name: displayName };
}

/** Narrow one joined row, or null when it's missing what callers rely on. */
export function toPendingInvite(raw: unknown): PendingClubInvite | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = record["id"];
  const clubId = record["club_id"];
  const userId = record["user_id"];
  const createdAt = record["created_at"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof clubId !== "string" || clubId.length === 0) return null;
  if (typeof userId !== "string" || userId.length === 0) return null;
  if (typeof createdAt !== "string" || createdAt.length === 0) return null;
  const invitedBy = record["invited_by"];
  return {
    id,
    club_id: clubId,
    user_id: userId,
    invited_by:
      typeof invitedBy === "string" && invitedBy.length > 0 ? invitedBy : null,
    created_at: createdAt,
    invitee: toInvitee(record["invitee"]),
    inviter: toInviter(record["inviter"]),
  };
}

/** One browser client for the whole tab, made on first use. */
let browserDb: ReturnType<typeof createClient> | null = null;

/**
 * Classmates matching a name or handle, through search_directory: the same
 * definer function the people directory uses, with private profiles kept in
 * (masked to handle + avatar) because an officer can invite someone whose
 * card is private. The database caps a page at 60; callers filter members
 * and already-invited classmates out themselves, since only they know the
 * roster in hand. Browser only. Throws nothing: a failed search is an empty
 * list, because a search box mid-keystroke is no place for an error state.
 */
export async function searchInvitees(query: string): Promise<InviteCandidate[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  browserDb ??= createClient();
  const { data, error } = await browserDb.rpc("search_directory", {
    p_query: trimmed,
    p_offset: 0,
    p_public_only: false,
  });
  if (error || !Array.isArray(data)) return [];

  const out: InviteCandidate[] = [];
  for (const row of data) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;
    const id = record["id"];
    const handle = record["handle"];
    if (typeof id !== "string" || typeof handle !== "string") continue;
    out.push({
      id,
      handle,
      display_name:
        typeof record["display_name"] === "string"
          ? (record["display_name"] as string)
          : null,
      avatar_url:
        typeof record["avatar_url"] === "string"
          ? (record["avatar_url"] as string)
          : null,
      is_public: record["is_public"] === true,
    });
  }
  return out;
}
