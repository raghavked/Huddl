import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSharesTyping } from "@/hooks/use-privacy-prefs";
import { supabase } from "@/lib/supabase";

/* React Native port of the web app's use-typing hook. Same broadcast
   protocol: channel `typing:${channelKey}`, event "typing", payload
   {userId, name, at}, so web and native students see each other typing.
   The payload shape is shared with the web client; changing it would break
   typing across runtimes, so the privacy preference below gates whether we
   join at all rather than adding a field to the wire. */

/** At most one broadcast per this window while the user keeps typing. */
const BROADCAST_EVERY_MS = 2000;
/** A typer goes quiet once their last event is older than this. */
const TYPING_TTL_MS = 4000;
/** How often stale typers are pruned from the visible list. */
const PRUNE_EVERY_MS = 1000;

type TypingPayload = { userId: string; name: string; at: number };

/**
 * Live "who's typing" over a Supabase Realtime broadcast channel
 * (`typing:${channelKey}`). Call `noteTyping()` from the composer's
 * onChangeText. It throttles itself to one broadcast per ~2s. `typers`
 * holds the display names of OTHER people whose latest event is fresh
 * (<4s), pruned on an interval so names fade shortly after they stop.
 * Pass an empty channelKey to keep the hook idle (no subscription).
 *
 * Honours `profiles.share_typing` RECIPROCALLY, via
 * {@link useSharesTyping}: a student who turns typing indicators off stops
 * broadcasting *and* stops seeing everyone else's. That is one condition,
 * not two, so the hook never joins the channel at all: nothing to send on,
 * nothing to receive from, and `typers` stays empty. Flipping the
 * preference back subscribes again on the next render; flipping it off
 * tears the channel down and clears the names already on screen.
 *
 * The preference reads as true until the profile row lands, so the common
 * case never blinks a name off and back on.
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

  const sharesTyping = useSharesTyping();
  // Opted out reads exactly like "no room yet": idle, no subscription.
  const liveKey = sharesTyping ? channelKey : "";
  // noteTyping is stable across renders, so it reads the choice off a ref.
  // Belt and braces with the empty key above: a privacy promise shouldn't
  // rest on effect-cleanup ordering.
  const sharesRef = useRef(sharesTyping);
  sharesRef.current = sharesTyping;

  useEffect(() => {
    if (!liveKey) return; // no room yet, or typing indicators are off
    // userId -> latest event; lives inside the effect so a room change (or a
    // flip of the preference) starts from a clean slate.
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

    const channel = supabase
      .channel(`typing:${liveKey}`)
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

    const interval = setInterval(sync, PRUNE_EVERY_MS);

    return () => {
      clearInterval(interval);
      channelRef.current = null;
      setTypers([]);
      void supabase.removeChannel(channel);
    };
  }, [liveKey]);

  const noteTyping = useCallback(() => {
    if (!sharesRef.current) return; // opted out, never broadcast
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
 * Strings match the web app exactly: one voice, two runtimes.
 */
export function typingLabel(typers: string[]): string {
  if (typers.length === 0) return "";
  if (typers.length === 1) return `${typers[0]} is typing…`;
  if (typers.length === 2) return `${typers[0]} and ${typers[1]} are typing…`;
  return "Several people are typing…";
}
