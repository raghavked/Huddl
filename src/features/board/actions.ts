"use server";

import { createClient } from "@/lib/supabase/server";

/* Reporting a board post.
 *
 * Migration 0034 gave `reports` a `board_post_id` and widened the
 * "reports_have_subject" check to accept it, so a campus-wide post can be
 * named directly instead of being described in the reason. The author rides
 * along as `reported_user_id` — `board_post_id` is `on delete set null`, so a
 * report survives the author taking the post down, and moderators keep the
 * record either way.
 *
 * RLS only lets a signed-in student file reports as themselves; triage is
 * moderator work through the queue policies from the same migration. */

export type BoardActionResult = { error?: string };

const REASON_MAX = 500;

/**
 * File a report against a board post.
 *
 * The lookup doubles as an access check: the board's select policy is scoped
 * to `current_university_id()`, so a post from another campus reads as gone
 * rather than as a refusal.
 *
 * @param postId The post's `board_posts.id`.
 * @param reason Why it was reported — one of the two-tap reasons, or typed.
 */
export async function reportBoardPost(
  postId: string,
  reason: string
): Promise<BoardActionResult> {
  const trimmed = reason.trim();
  if (!trimmed) return { error: "Add a reason so we know what to look at." };
  if (trimmed.length > REASON_MAX) {
    return { error: "Reasons can be at most 500 characters." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again to report a post." };

  const { data: post } = await supabase
    .from("board_posts")
    .select("author_id")
    .eq("id", postId)
    .maybeSingle();

  if (!post) {
    return { error: "Couldn't find that post — it may have come down already." };
  }
  if (post.author_id === user.id) {
    return { error: "You can't report your own post." };
  }

  const { error } = await supabase.from("reports").insert({
    reporter_id: user.id,
    board_post_id: postId,
    reported_user_id: post.author_id,
    reason: trimmed,
  });

  if (error) return { error: "Couldn't send the report. Please try again." };
  return {};
}
