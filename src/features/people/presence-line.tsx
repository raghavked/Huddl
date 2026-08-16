"use client";

import { useEffect, useState } from "react";
import { presenceLabel } from "@/lib/friends";

/**
 * The quiet presence line under a profile's name, drawn on the CLIENT.
 *
 * "Active today" means the same LOCAL calendar day, and only the reader's
 * browser knows where their midnight falls. Rendered on the server this line
 * would use the server's clock and timezone, quietly wrong for every viewer
 * anywhere else, so the label is computed here with the reader's own clock.
 *
 * Renders nothing until mounted: the server sends no line, and hydration has
 * to agree with that before the client draws its own answer.
 *
 * Same guarantees as everywhere else presence appears: through
 * {@link presenceLabel} and nothing else, one of three phrases or no line at
 * all, never a raw timestamp. The server erases `last_seen_at` when sharing
 * goes off, and the toggle is checked again here so a stale row can't leak
 * what its owner switched off.
 */
export function PresenceLine({
  lastSeenAt,
  shareLastSeen,
}: {
  lastSeenAt: string | null;
  shareLastSeen: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null;

  const label = presenceLabel(shareLastSeen ? lastSeenAt : null, new Date());
  if (!label) return null;

  return (
    <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-success">
      <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden />
      {label}
    </p>
  );
}
