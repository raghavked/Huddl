"use client";

import { useEffect, useRef } from "react";
import type { RealtimePostgresUpdatePayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribe to UPDATEs on a table (optionally filtered, e.g.
 * `channel_id=eq.<uuid>`) and hand each changed row to the callback. Mirrors
 * `useRealtimeInserts` so edits and soft-deletes made by others propagate live.
 */
export function useRealtimeUpdates<T extends object>(
  table: string,
  filter: string | undefined,
  onUpdate: (row: T) => void
) {
  const handlerRef = useRef(onUpdate);
  handlerRef.current = onUpdate;

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`realtime-update:${table}:${filter ?? "all"}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table,
          ...(filter ? { filter } : {}),
        },
        (payload: RealtimePostgresUpdatePayload<T>) => {
          handlerRef.current(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filter]);
}
