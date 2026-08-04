"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ClubCategory } from "@/lib/types";

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
 * Join a club (open join — RLS restricts to own row at own university).
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
 * Leave a club. Owners are blocked here — an ownerless club would be stuck,
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
    // Nothing to leave — refresh so the UI settles.
    revalidateClub(clubId);
    return {};
  }
  if (membership.role === "owner") {
    return {
      error:
        "Owners can't leave their own club — promote a new owner or disband it instead.",
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
 * Edit name / category / description. RLS only lets officers and the owner
 * through; the slug (and therefore the chat channel slug) stays stable.
 */
export async function updateClub(
  clubId: string,
  fields: { name: string; category: ClubCategory; description: string }
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

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clubs")
    .update({
      name,
      category: fields.category,
      description: description || null,
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
