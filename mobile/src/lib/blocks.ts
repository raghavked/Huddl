import { supabase } from "@/lib/supabase";

/* Blocking is one-way and private: the blocked person never finds out.
   The server refuses new DM threads across a block (create_dm_thread), mutes
   their notifications, and since 0042 drops their direct messages from the
   blocker's reads outright — their sends still succeed and still show up in
   their own copy of the thread, which is what keeps the block invisible.

   Everything else is still filtered here, off the id set from
   fetchBlockedIds / useBlockedIds: channel messages, board posts, previews.
   Screens keep filtering DMs too, so unblocking brings the conversation back
   on the spot rather than after a refetch. */

export async function blockUser(blockerId: string, blockedId: string) {
  const { error } = await supabase
    .from("blocks")
    .upsert(
      { blocker_id: blockerId, blocked_id: blockedId },
      { onConflict: "blocker_id,blocked_id" }
    );
  if (error) throw error;
}

export async function unblockUser(blockerId: string, blockedId: string) {
  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId);
  if (error) throw error;
}

/** Everyone the given user has blocked, as a Set for O(1) filtering. */
export async function fetchBlockedIds(blockerId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("blocks")
    .select("blocked_id")
    .eq("blocker_id", blockerId);
  if (error) throw error;
  const rows = (data ?? []) as { blocked_id: string }[];
  return new Set(rows.map((r) => r.blocked_id));
}
