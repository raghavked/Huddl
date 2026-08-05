import { Skeleton } from "@/components/ui";

/** Varied chip widths so the category filter ghost reads naturally. */
const CHIP_WIDTHS = ["w-12", "w-24", "w-28", "w-20", "w-16", "w-20"];

/** Route-level loading ghost for /clubs: header, filter chips, card grid. */
export default function ClubsLoading() {
  return (
    <div
      className="mx-auto max-w-3xl px-4 py-6 md:py-10"
      role="status"
      aria-label="Loading"
    >
      {/* Page header ghost */}
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-3 h-8 w-28" />
      <Skeleton className="mt-3 h-3.5 w-80 max-w-full" />

      {/* Category chip row ghost */}
      <div className="mt-6 flex gap-2 overflow-hidden pb-1">
        {CHIP_WIDTHS.map((width, i) => (
          <Skeleton key={i} className={`h-8 shrink-0 rounded-full ${width}`} />
        ))}
      </div>

      {/* Club card grid */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="rounded-card border border-border bg-surface p-4 shadow-soft"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 shrink-0" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-32 max-w-full" />
                <Skeleton className="mt-2 h-3 w-20" />
              </div>
            </div>
            <Skeleton className="mt-3 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-2/3" />
          </div>
        ))}
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
