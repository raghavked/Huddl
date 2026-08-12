"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/* Blocking (migration 0019) is one-way and private: the blocked person
   never finds out. The server refuses new DM threads across a block and
   silences notifications; hiding a blocked student's existing messages is
   the client's job, driven by the id set below.

   For a long time this module could only take a block off. That meant a
   student being hassled on their laptop had to pick up their phone to make
   it stop, which is exactly the wrong moment to ask someone to change
   devices — so `blockUser` is here now, same upsert the native app uses. */

/**
 * Block someone. Upsert rather than insert: the primary key is
 * (blocker_id, blocked_id), so a second attempt on an already-blocked
 * classmate is a no-op instead of a duplicate-key error a caller would have
 * to decode. Blocking twice should feel like blocking once.
 */
export async function blockUser(blockerId: string, blockedId: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("blocks")
    .upsert(
      { blocker_id: blockerId, blocked_id: blockedId },
      { onConflict: "blocker_id,blocked_id" }
    );
  if (error) throw error;
}

/** Everyone the given user has blocked, as a Set for O(1) filtering. */
export async function fetchBlockedIds(userId: string): Promise<Set<string>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("blocks")
    .select("blocked_id")
    .eq("blocker_id", userId);
  if (error) throw error;
  const rows = (data ?? []) as { blocked_id: string }[];
  return new Set(rows.map((r) => r.blocked_id));
}

export async function unblockUser(blockerId: string, blockedId: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId);
  if (error) throw error;
}

/**
 * The signed-in student's block list, loaded once per mount, plus an
 * optimistic unblock (the id leaves the set immediately, and returns on
 * failure). Chat, threads, and DMs all filter through this set.
 */
export function useBlockedIds(userId: string) {
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    fetchBlockedIds(userId)
      .then((ids) => {
        if (active) setBlockedIds(ids);
      })
      // A failed load just means no filtering this visit — never block chat.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [userId]);

  const unblock = useCallback(
    async (blockedId: string): Promise<boolean> => {
      setBlockedIds((prev) => {
        const next = new Set(prev);
        next.delete(blockedId);
        return next;
      });
      try {
        await unblockUser(userId, blockedId);
        return true;
      } catch {
        setBlockedIds((prev) => new Set(prev).add(blockedId));
        return false;
      }
    },
    [userId]
  );

  return { blockedIds, unblock };
}
