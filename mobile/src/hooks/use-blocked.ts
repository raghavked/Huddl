import { useCallback, useEffect, useState } from "react";
import { fetchBlockedIds } from "@/lib/blocks";
import { useAuth } from "@/providers/auth-provider";

/* The signed-in student's block list, shaped for filtering: screens drop
   rows whose author is in the set. Call refresh() after a block/unblock so
   open screens catch up without a remount. */

export function useBlockedIds(): {
  blocked: Set<string>;
  refresh: () => Promise<void>;
} {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [blocked, setBlocked] = useState<Set<string>>(() => new Set());

  const refresh = useCallback(async () => {
    if (!userId) {
      setBlocked(new Set());
      return;
    }
    try {
      setBlocked(await fetchBlockedIds(userId));
    } catch {
      // Filtering is best-effort; keep the last known set on a failed fetch.
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { blocked, refresh };
}
