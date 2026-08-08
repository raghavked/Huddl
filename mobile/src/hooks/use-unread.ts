import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* The app's unread pulse: one number, kept honest by a head-only count on
   mount and a realtime INSERT subscription after that. The home badge and
   anything else that wants a dot read from here. */

/** Just the column the counter cares about, shaped for the payload type. */
type UnreadRow = { read_at: string | null } & Record<string, unknown>;

/**
 * Live unread-notifications count for the signed-in student.
 *
 * - `count` starts from a server-side head count (no rows shipped) and bumps
 *   the moment a new notification row lands over realtime.
 * - `refresh` re-counts from the server — call it after marking rows read
 *   (e.g. when returning from the notifications screen) so the badge drops.
 */
export function useUnreadNotifications(): {
  count: number;
  refresh: () => Promise<void>;
} {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId) {
      setCount(0);
      return;
    }
    const { count: unread, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null);
    if (!error && unread !== null) setCount(unread);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime INSERTs on my notifications bump the count as they arrive.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`unread-count:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload: RealtimePostgresInsertPayload<UnreadRow>) => {
          // Rows are born unread, but stay defensive about the column.
          if (!payload.new.read_at) setCount((c) => c + 1);
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return { count, refresh };
}
