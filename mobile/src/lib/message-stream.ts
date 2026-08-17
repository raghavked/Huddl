import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

/* Live message rows over private broadcast topics: `room:<channelId>` for
   messages, `dm:<threadId>` for dm_messages. Database triggers publish every
   insert and update into the topic via realtime.broadcast_changes, and a
   policy on realtime.messages authorizes the join once per subscribe, so the
   row arrives raw, with no joined relations.

   Topics are shared and ref-counted because a room screen and its thread
   screen can be mounted at the same time, and two Phoenix channels on one
   topic fight each other: the second join closes the first. So there is one
   channel per topic and many listeners. The first listener creates and joins
   the channel, the last one out tears it down. */

/** What realtime.broadcast_changes puts on the wire. */
type ChangePayload = {
  operation?: "INSERT" | "UPDATE";
  record?: Record<string, unknown>;
  old_record?: Record<string, unknown> | null;
};

type Listener = {
  onInsert: (record: Record<string, unknown>) => void;
  onUpdate: (
    record: Record<string, unknown>,
    oldRecord: Record<string, unknown> | null
  ) => void;
};

type Entry = { channel: RealtimeChannel; listeners: Set<Listener> };

const entries = new Map<string, Entry>();

function acquire(topic: string, listener: Listener): () => void {
  let entry = entries.get(topic);
  if (!entry) {
    const channel = supabase.channel(topic, { config: { private: true } });
    const created: Entry = { channel, listeners: new Set() };
    entries.set(topic, created);
    channel
      .on("broadcast", { event: "INSERT" }, (message) => {
        const payload = message.payload as ChangePayload | undefined;
        if (!payload?.record) return;
        for (const l of created.listeners) l.onInsert(payload.record);
      })
      .on("broadcast", { event: "UPDATE" }, (message) => {
        const payload = message.payload as ChangePayload | undefined;
        if (!payload?.record) return;
        for (const l of created.listeners) {
          l.onUpdate(payload.record, payload.old_record ?? null);
        }
      });
    // A private topic won't accept the join without the access token on the
    // socket; setAuth is safe to repeat, so every first listener pays it.
    void supabase.realtime.setAuth().then(() => {
      // The last listener may have left while the token was being set.
      if (entries.get(topic) === created) channel.subscribe();
    });
    entry = created;
  }
  const active = entry;
  active.listeners.add(listener);
  return () => {
    active.listeners.delete(listener);
    if (active.listeners.size === 0 && entries.get(topic) === active) {
      entries.delete(topic);
      void supabase.removeChannel(active.channel);
    }
  };
}

/**
 * Attach to a topic's live insert/update stream. Handlers live in refs, so
 * re-renders never resubscribe; only a change of topic (or null, which keeps
 * the hook idle) touches the underlying channel. The topic scopes the room
 * or thread, nothing narrower: a caller that used to lean on a postgres
 * filter, like a thread screen that hears its whole room, must keep only its
 * own rows in the handler.
 */
export function useMessageStream<Row extends Record<string, unknown>>(
  topic: string | null,
  handlers: {
    onInsert: (record: Row) => void;
    onUpdate: (record: Row, oldRecord: Row | null) => void;
  }
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!topic) return;
    const listener: Listener = {
      onInsert: (record) => handlersRef.current.onInsert(record as Row),
      onUpdate: (record, oldRecord) =>
        handlersRef.current.onUpdate(record as Row, oldRecord as Row | null),
    };
    return acquire(topic, listener);
  }, [topic]);
}
