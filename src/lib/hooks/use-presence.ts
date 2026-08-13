"use client";

import { useEffect, useState } from "react";
import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * Who's in the room right now, via Supabase Realtime presence on
 * `presence:${channelKey}`. Each client tracks itself under its own user id
 * as the presence key, so the returned Set holds the user ids currently
 * online (including our own). Attaching the presence listeners before
 * `subscribe()` opts this client into receiving presence state; `track()` on
 * SUBSCRIBED makes us visible to everyone else, and re-fires on reconnect,
 * so presence survives network blips. Channel is removed on unmount,
 * mirroring `useRealtimeInserts`.
 */
export function usePresence(channelKey: string, selfId: string): Set<string> {
  const [online, setOnline] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (typeof window === "undefined") return; // SSR: no realtime
    const supabase = createClient();
    const channel = supabase.channel(`presence:${channelKey}`, {
      config: { presence: { key: selfId } },
    });

    const sync = () => {
      const ids = Object.keys(channel.presenceState());
      setOnline((prev) =>
        prev.size === ids.length && ids.every((id) => prev.has(id))
          ? prev
          : new Set(ids)
      );
    };

    channel
      .on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .subscribe((status) => {
        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
          void channel.track({ userId: selfId, at: new Date().toISOString() });
        }
      });

    return () => {
      setOnline(new Set());
      supabase.removeChannel(channel);
    };
  }, [channelKey, selfId]);

  return online;
}
