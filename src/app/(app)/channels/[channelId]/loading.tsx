import { Skeleton } from "@/components/ui";

/** Bubble widths vary so the ghost reads as a real conversation. */
const BUBBLE_WIDTHS = ["w-3/5", "w-2/5", "w-3/4", "w-1/2", "w-2/3", "w-1/3"];

/**
 * Route-level loading ghost for a channel room. Mirrors the page's
 * full-height layout (same height calc) so nothing jumps when it loads:
 * header bar, message column, composer pinned at the bottom.
 */
export default function ChannelLoading() {
  return (
    <div
      className="mx-auto flex h-[calc(100dvh-8.5rem)] max-w-3xl flex-col px-4"
      role="status"
      aria-label="Loading"
    >
      {/* Header bar ghost */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border py-3">
        <Skeleton className="size-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-36 max-w-full" />
          <Skeleton className="mt-2 h-3 w-52 max-w-full" />
        </div>
        <Skeleton className="h-6 w-14 rounded-full" />
      </div>

      {/* Message column ghost */}
      <div className="flex-1 space-y-5 overflow-hidden pt-4">
        {BUBBLE_WIDTHS.map((width, i) => (
          <div key={i} className="flex items-start gap-2.5 px-2">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className={`mt-2 h-9 rounded-2xl ${width}`} />
            </div>
          </div>
        ))}
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
