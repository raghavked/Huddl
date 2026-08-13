import { supabase } from "@/lib/supabase";

/* Pinned messages: any channel member can pin or unpin (campus rooms are
   small and self-governing). The RPC from migration 0019 enforces
   membership server-side. Pinned state travels on the messages row
   (pinned_at / pinned_by), so realtime UPDATE events keep clients in sync. */

export async function setMessagePinned(messageId: string, pinned: boolean) {
  const { error } = await supabase.rpc("set_message_pinned", {
    p_message_id: messageId,
    p_pinned: pinned,
  });
  if (error) throw error;
}
