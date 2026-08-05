"use client";

import { useEffect, useRef } from "react";
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribe to INSERTs on a table (optionally filtered, e.g.
 * `channel_id=eq.<uuid>`) and hand each new row to the callback. Shared by
 * chat, DMs and notifications so realtime wiring lives in one place.
 */
export function useRealtimeInserts<T extends object>(
  table: string,
  filter: string | undefined,
  onInsert: (row: T) => void
) {
  const handlerRef = useRef(onInsert);
  handlerRef.current = onInsert;

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`realtime:${table}:${filter ?? "all"}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table,
          ...(filter ? { filter } : {}),
        },
        (payload: RealtimePostgresInsertPayload<T>) => {
          handlerRef.current(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filter]);
}
