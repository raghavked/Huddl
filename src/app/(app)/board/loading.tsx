import { Skeleton } from "@/components/ui";

/** Route-level loading ghost for /board: header, category rail, post rows. */
export default function BoardLoading() {
  return (
    <div
      className="mx-auto max-w-3xl px-4 py-6 md:py-10"
      role="status"
      aria-label="Loading"
    >
      {/* Page header ghost */}
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-8 w-44" />
      <Skeleton className="mt-3 h-3.5 w-72 max-w-full" />

      {/* Category rail ghost — all boards plus the seven categories */}
      <div className="mt-6 flex gap-2 overflow-hidden pb-1">
        <Skeleton className="h-8 w-24 shrink-0 rounded-full" />
        <Skeleton className="h-8 w-20 shrink-0 rounded-full" />
        <Skeleton className="h-8 w-16 shrink-0 rounded-full" />
        <Skeleton className="h-8 w-20 shrink-0 rounded-full" />
        <Skeleton className="h-8 w-14 shrink-0 rounded-full" />
      </div>

      {/* Post rows — category chip, title, body line, author and time */}
      <div className="mt-6 flex flex-col gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className="rounded-card border border-border bg-surface p-4 shadow-soft"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-14 rounded-full" />
            </div>
            <Skeleton className="mt-3 h-4 w-2/3" />
            <Skeleton className="mt-2.5 h-3.5 w-11/12" />
            <div className="mt-3 flex items-center justify-between gap-2">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3.5 w-16" />
            </div>
          </div>
        ))}
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
