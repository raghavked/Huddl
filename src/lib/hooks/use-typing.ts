"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/** At most one broadcast per this window while the user keeps typing. */
const BROADCAST_EVERY_MS = 2000;
/** A typer goes quiet once their last event is older than this. */
const TYPING_TTL_MS = 4000;
/** How often stale typers are pruned from the visible list. */
const PRUNE_EVERY_MS = 1000;

type TypingPayload = { userId: string; name: string; at: number };

/**
 * Live "who's typing" over a Supabase Realtime broadcast channel
 * (`typing:${channelKey}`). Call `noteTyping()` from the composer's onChange —
 * it throttles itself to one broadcast per ~2s. `typers` holds the display
 * names of OTHER people whose latest event is fresh (<4s), pruned on an
 * interval so names fade shortly after they stop. Mirrors the channel
 * lifecycle idiom of `useRealtimeInserts` (subscribe in effect, removeChannel
 * on cleanup).
 */
export function useTyping(
  channelKey: string,
  self: { id: string; name: string }
): { typers: string[]; noteTyping: () => void } {
  const [typers, setTypers] = useState<string[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSentAtRef = useRef(0);
  const selfRef = useRef(self);
  selfRef.current = self;

  useEffect(() => {
    if (typeof window === "undefined") return; // SSR: no realtime, no timers
    // userId -> latest event; lives inside the effect so a channelKey change
    // starts from a clean slate.
    const active = new Map<string, { name: string; at: number }>();

    const sync = () => {
      const cutoff = Date.now() - TYPING_TTL_MS;
      for (const [id, entry] of active) {
        if (entry.at <= cutoff) active.delete(id);
      }
      const names = [...active.values()].map((entry) => entry.name);
      setTypers((prev) =>
        prev.length === names.length && names.every((n, i) => n === prev[i])
          ? prev
          : names
      );
    };

    const supabase = createClient();
    const channel = supabase
      .channel(`typing:${channelKey}`)
      .on("broadcast", { event: "typing" }, (message) => {
        const payload = message.payload as Partial<TypingPayload> | undefined;
        if (!payload?.userId || !payload.name) return;
        if (payload.userId === selfRef.current.id) return; // own echo
        // Freshness is judged from local receipt time so clock skew between
        // clients can't pin a name on screen (payload.at is informational).
        active.set(payload.userId, { name: payload.name, at: Date.now() });
        sync();
      })
      .subscribe();
    channelRef.current = channel;

    const interval = window.setInterval(sync, PRUNE_EVERY_MS);

    return () => {
      window.clearInterval(interval);
      channelRef.current = null;
      setTypers([]);
      supabase.removeChannel(channel);
    };
  }, [channelKey]);

  const noteTyping = useCallback(() => {
    const channel = channelRef.current;
    if (!channel) return;
    const now = Date.now();
    if (now - lastSentAtRef.current < BROADCAST_EVERY_MS) return;
    lastSentAtRef.current = now;
    const payload: TypingPayload = {
      userId: selfRef.current.id,
      name: selfRef.current.name,
      at: now,
    };
    void channel.send({ type: "broadcast", event: "typing", payload });
  }, []);

  return { typers, noteTyping };
}

/**
 * Shared copy for the strip under a message list. Returns "" when nobody's
 * typing so callers can height-reserve the line without conditionals.
 */
export function typingLabel(typers: string[]): string {
  if (typers.length === 0) return "";
  if (typers.length === 1) return `${typers[0]} is typing…`;
  if (typers.length === 2) return `${typers[0]} and ${typers[1]} are typing…`;
  return "Several people are typing…";
}
