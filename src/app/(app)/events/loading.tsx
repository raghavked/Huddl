import { Skeleton } from "@/components/ui";

/** Route-level loading ghost for /events: header, filter chips, event cards. */
export default function EventsLoading() {
  return (
    <div
      className="mx-auto max-w-3xl px-4 py-6 md:py-10"
      role="status"
      aria-label="Loading"
    >
      {/* Page header ghost */}
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-3 h-8 w-32" />
      <Skeleton className="mt-3 h-3.5 w-80 max-w-full" />

      {/* Kind filter chip row ghost */}
      <div className="mt-6 flex gap-2 overflow-hidden pb-1">
        <Skeleton className="h-8 w-12 shrink-0 rounded-full" />
        <Skeleton className="h-8 w-32 shrink-0 rounded-full" />
        <Skeleton className="h-8 w-24 shrink-0 rounded-full" />
      </div>

      {/* Event cards: date tile + badges + title + meta */}
      <div className="mt-6 flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="flex gap-3.5 rounded-card border border-border bg-surface p-4 shadow-soft"
          >
            <Skeleton className="h-14 w-12 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-6 w-24 rounded-full" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
              <Skeleton className="mt-3 h-4 w-3/4" />
              <Skeleton className="mt-2.5 h-3.5 w-1/2" />
              <div className="mt-3 flex items-center justify-between gap-2">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-20" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
