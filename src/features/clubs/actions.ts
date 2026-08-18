"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ClubCategory, ClubPrivacy } from "@/lib/types";

const CATEGORIES: readonly ClubCategory[] = [
  "academic",
  "professional",
  "cultural",
  "sports",
  "social",
  "service",
  "other",
];

export type ClubActionResult = { error?: string };

function revalidateClub(clubId: string) {
  revalidatePath("/clubs");
  revalidatePath(`/clubs/${clubId}`);
}

/**
 * Join a club (open join; RLS restricts to own row at own university).
 * A DB trigger mirrors the membership into the club's chat channel.
 */
export async function joinClub(clubId: string): Promise<ClubActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in to join a club." };

  const { error } = await supabase
    .from("club_members")
    .insert({ club_id: clubId, user_id: user.id });

  // 23505 = already a member; treat as success so the UI just settles.
  if (error && error.code !== "23505") {
    return { error: "Couldn't join this club. Please try again." };
  }
  revalidateClub(clubId);
  return {};
}

/**
 * Leave a club. Owners are blocked here, since an ownerless club would be stuck,
 * so the owner path is disbandClub (or promoting a successor first).
 * A DB trigger removes the member from the club's chat channel.
 */
export async function leaveClub(clubId: string): Promise<ClubActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in." };

  const { data: membership } = await supabase
    .from("club_members")
    .select("role")
    .eq("club_id", clubId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    // Nothing to leave. Refresh so the UI settles.
    revalidateClub(clubId);
    return {};
  }
  if (membership.role === "owner") {
    return {
      error:
        "Owners can't leave their own club. Promote a new owner, or disband it instead.",
    };
  }

  const { error } = await supabase
    .from("club_members")
    .delete()
    .eq("club_id", clubId)
    .eq("user_id", user.id);

  if (error) return { error: "Couldn't leave this club. Please try again." };
  revalidateClub(clubId);
  return {};
}

/**
 * Edit name / category / description / privacy. RLS only lets officers and
 * the owner through; the slug (and therefore the chat channel slug) stays
 * stable.
 */
export async function updateClub(
  clubId: string,
  fields: {
    name: string;
    category: ClubCategory;
    description: string;
    privacy: ClubPrivacy;
  }
): Promise<ClubActionResult> {
  const name = fields.name.trim();
  const description = fields.description.trim();

  if (name.length < 3) {
    return { error: "Club names need at least 3 characters." };
  }
  if (name.length > 80) {
    return { error: "Club names can be at most 80 characters." };
  }
  if (description.length > 500) {
    return { error: "Descriptions can be at most 500 characters." };
  }
  if (!CATEGORIES.includes(fields.category)) {
    return { error: "Pick a valid category." };
  }
  if (fields.privacy !== "open" && fields.privacy !== "invite") {
    return { error: "Pick who can join." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clubs")
    .update({
      name,
      category: fields.category,
      description: description || null,
      privacy: fields.privacy,
    })
    .eq("id", clubId)
    .select("id");

  if (error) return { error: "Couldn't save changes. Please try again." };
  if (!data || data.length === 0) {
    return { error: "Only club officers can edit this club." };
  }
  revalidateClub(clubId);
  return {};
}

/**
 * Disband (delete) a club. RLS restricts this to the owner; cascades take
 * the roster, the chat channel and club events with it. Redirects to /clubs
 * on success.
 */
export async function disbandClub(clubId: string): Promise<ClubActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clubs")
    .delete()
    .eq("id", clubId)
    .select("id");

  if (error) return { error: "Couldn't disband the club. Please try again." };
  if (!data || data.length === 0) {
    return { error: "Only the club owner can disband this club." };
  }
  revalidatePath("/clubs");
  redirect("/clubs");
}

/* -------------------------- invitations -------------------------- */

export type SendInviteResult = ClubActionResult & {
  /** The inserted row, so the panel can show it without a refetch. */
  invite?: { id: string; created_at: string };
};

/**
 * Hold the door open for one classmate. RLS pins invited_by to the caller,
 * requires officer standing and a same-campus invitee, and refuses existing
 * members; the partial unique index keeps it to one pending invitation per
 * person per club (23505 when a colleague beat you to it).
 */
export async function sendClubInvite(
  clubId: string,
  inviteeId: string
): Promise<SendInviteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in." };

  const { data, error } = await supabase
    .from("club_invites")
    .insert({ club_id: clubId, user_id: inviteeId, invited_by: user.id })
    .select("id, created_at")
    .single();

  if (error || !data) {
    return {
      error:
        error?.code === "23505"
          ? "They already have an invitation waiting."
          : "Couldn't send that invitation. Please try again.",
    };
  }
  revalidateClub(clubId);
  return { invite: data as { id: string; created_at: string } };
}

/**
 * Take a pending invitation back. Officers only, and only to 'revoked':
 * both halves are the update policy, and a trigger refuses to touch a row
 * that's already settled.
 */
export async function revokeClubInvite(
  inviteId: string,
  clubId: string
): Promise<ClubActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("club_invites")
    .update({ status: "revoked" })
    .eq("id", inviteId)
    .eq("status", "pending");

  if (error) {
    return { error: "Couldn't revoke that invitation. Please try again." };
  }
  revalidateClub(clubId);
  return {};
}

/**
 * Answer your own invitation. The RPC is the one path from invitation to
 * membership: accepting creates the club and chat memberships and tells the
 * inviter; declining just settles the row. Its stale-invite message is
 * written for people, so it ships to the screen as-is.
 */
export async function respondToClubInvite(
  inviteId: string,
  clubId: string,
  accept: boolean
): Promise<ClubActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_club_invite", {
    p_invite_id: inviteId,
    p_accept: accept,
  });

  if (error) {
    // The RPC's one raise is the stale case; anything else is weather.
    const stale = error.message.includes(
      "That invitation is gone or was already answered."
    );
    revalidateClub(clubId);
    return {
      error: stale
        ? "That invitation is gone or was already answered."
        : "Couldn't answer that invitation. Please try again.",
    };
  }
  revalidateClub(clubId);
  return {};
}

/* ------------------------ roles and the crown ------------------------ */

/**
 * Promote to officer or set back to member. RLS lets officers manage roles;
 * the crown trigger keeps 'owner' out of everyone's reach but the owner's,
 * which is why this only ever writes the two lesser roles.
 */
export async function setClubMemberRole(
  clubId: string,
  userId: string,
  role: "officer" | "member"
): Promise<ClubActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("club_members")
    .update({ role })
    .eq("club_id", clubId)
    .eq("user_id", userId);

  if (error) {
    return { error: "Couldn't change that role. Please try again." };
  }
  revalidateClub(clubId);
  return {};
}

/**
 * Remove a member. Officers only through RLS, and the database refuses to
 * touch the owner's row, so the UI never offers this on the president.
 */
export async function removeClubMember(
  clubId: string,
  userId: string
): Promise<ClubActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("club_members")
    .delete()
    .eq("club_id", clubId)
    .eq("user_id", userId);

  if (error) {
    return { error: "Couldn't remove them. Please try again." };
  }
  revalidateClub(clubId);
  return {};
}

/**
 * Hand the presidency to another member. The RPC promotes them first and
 * steps the caller down to officer in the same transaction, so the club is
 * never crownless and never sees two presidents.
 */
export async function transferClubPresidency(
  clubId: string,
  toUserId: string
): Promise<ClubActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_club_presidency", {
    p_club_id: clubId,
    p_to_user: toUserId,
  });

  if (error) {
    return { error: "Couldn't hand off the presidency. Please try again." };
  }
  revalidateClub(clubId);
  return {};
}
