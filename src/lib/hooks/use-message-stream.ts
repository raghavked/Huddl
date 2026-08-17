"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/** What `realtime.broadcast_changes` puts on the wire: the raw row, plus the
 *  prior row on UPDATE. Broadcast payloads are loosely typed upstream, so the
 *  caller's row type is asserted at the edge, same trust as postgres_changes. */
type BroadcastChange = {
  record: Record<string, unknown>;
  old_record: Record<string, unknown> | null;
};

type Listener = {
  onInsert: (record: Record<string, unknown>) => void;
  onUpdate: (
    record: Record<string, unknown>,
    oldRecord: Record<string, unknown> | null
  ) => void;
};

type Entry = { channel: RealtimeChannel; listeners: Set<Listener> };

/* One Phoenix channel per topic, shared. A room and its open thread panel
   both want `room:<id>`, and a second join on the same topic closes the
   first, so screens attach as listeners to a ref-counted entry instead of
   subscribing themselves. */
const entries = new Map<string, Entry>();

function acquire(topic: string): Entry {
  const existing = entries.get(topic);
  if (existing) return existing;

  const supabase = createClient();
  const channel = supabase.channel(topic, { config: { private: true } });
  const entry: Entry = { channel, listeners: new Set() };
  entries.set(topic, entry);

  channel
    .on("broadcast", { event: "INSERT" }, ({ payload }) => {
      const { record } = payload as BroadcastChange;
      for (const listener of entry.listeners) listener.onInsert(record);
    })
    .on("broadcast", { event: "UPDATE" }, ({ payload }) => {
      const { record, old_record } = payload as BroadcastChange;
      for (const listener of entry.listeners) {
        listener.onUpdate(record, old_record);
      }
    });

  // Private topics are authorized against the caller's JWT at join time, so
  // the socket has to hold a fresh token before the subscribe goes out. If
  // every listener left while we waited, the entry is already gone: joining
  // now would orphan a channel nobody will remove.
  void supabase.realtime.setAuth().then(() => {
    if (entries.get(topic) === entry) channel.subscribe();
  });

  return entry;
}

function release(topic: string, listener: Listener) {
  const entry = entries.get(topic);
  if (!entry) return;
  entry.listeners.delete(listener);
  if (entry.listeners.size > 0) return;
  entries.delete(topic);
  void createClient().removeChannel(entry.channel);
}

/**
 * Live INSERTs and UPDATEs for one chat surface, from the private broadcast
 * topic (`room:<channelId>` or `dm:<threadId>`) fed by database triggers.
 * The topic scopes the audience, not the row: a thread panel listening on its
 * room's topic hears the whole room and filters in its handlers. Handlers
 * live in refs, mirroring `useRealtimeInserts`, so re-renders never
 * resubscribe. Pass null while the topic is unknown.
 */
export function useMessageStream<T extends Record<string, unknown>>(
  topic: string | null,
  handlers: {
    onInsert?: (record: T) => void;
    onUpdate?: (record: T, oldRecord: T | null) => void;
  }
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!topic) return;
    const listener: Listener = {
      onInsert: (record) => handlersRef.current.onInsert?.(record as T),
      onUpdate: (record, oldRecord) =>
        handlersRef.current.onUpdate?.(record as T, oldRecord as T | null),
    };
    acquire(topic).listeners.add(listener);
    return () => release(topic, listener);
  }, [topic]);
}
