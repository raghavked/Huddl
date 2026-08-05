"use server";

import { createClient } from "@/lib/supabase/server";

export type ModerationActionResult = { error?: string };

const REASON_MAX = 500;

/**
 * Report a message. RLS only lets the signed-in student file reports as
 * themselves; triage (status changes) is admin work through the service role.
 * The message's author is pinned on the report as reported_user_id so the
 * report keeps a subject even if the message row is later hard-deleted
 * (message_id nulls out via on delete set null).
 */
export async function reportMessage(
  messageId: string,
  reason: string
): Promise<ModerationActionResult> {
  const trimmed = reason.trim();
  if (!trimmed) return { error: "Add a reason so we know what to look at." };
  if (trimmed.length > REASON_MAX) {
    return { error: "Reasons can be at most 500 characters." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in to report a message." };

  // RLS only exposes messages in channels the reporter belongs to, so this
  // lookup doubles as an access check.
  const { data: message } = await supabase
    .from("messages")
    .select("author_id")
    .eq("id", messageId)
    .maybeSingle();

  if (!message) {
    return { error: "Couldn't find that message — it may have been deleted." };
  }
  if (message.author_id === user.id) {
    return { error: "You can't report your own message." };
  }

  const { error } = await supabase.from("reports").insert({
    reporter_id: user.id,
    message_id: messageId,
    reported_user_id: message.author_id,
    reason: trimmed,
  });

  if (error) return { error: "Couldn't send the report. Please try again." };
  return {};
}
