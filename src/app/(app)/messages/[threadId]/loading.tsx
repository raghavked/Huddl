import { Skeleton } from "@/components/ui";

/** Alternating sides + varied widths so the ghost reads as a real DM thread. */
const BUBBLES = [
  { mine: false, width: "w-1/2" },
  { mine: false, width: "w-2/3" },
  { mine: true, width: "w-2/5" },
  { mine: false, width: "w-3/5" },
  { mine: true, width: "w-1/2" },
  { mine: true, width: "w-1/3" },
  { mine: false, width: "w-3/4" },
];

/**
 * Route-level loading ghost for a DM thread. Mirrors the page's full-height
 * layout (same height calc) so nothing jumps when it loads: header bar,
 * message bubbles on both sides, composer pinned at the bottom.
 */
export default function DmThreadLoading() {
  return (
    <div
      className="mx-auto flex h-[calc(100dvh-8.5rem)] max-w-3xl flex-col px-4"
      role="status"
      aria-label="Loading"
    >
      {/* Header bar ghost */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border py-3">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-32 max-w-full" />
          <Skeleton className="mt-2 h-3 w-24" />
        </div>
      </div>

      {/* Message column ghost */}
      <div className="flex-1 space-y-4 overflow-hidden pt-4">
        {BUBBLES.map(({ mine, width }, i) =>
          mine ? (
            <div key={i} className="flex justify-end px-2">
              <Skeleton className={`h-9 rounded-2xl ${width}`} />
            </div>
          ) : (
            <div key={i} className="flex items-end gap-2 px-2">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <Skeleton className={`h-9 rounded-2xl ${width}`} />
            </div>
          )
        )}
      </div>

      {/* Composer ghost */}
      <div className="shrink-0 pb-3 pt-1">
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2 shadow-soft">
          <Skeleton className="h-5 flex-1" />
          <Skeleton className="size-10 shrink-0 rounded-full" />
        </div>
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
