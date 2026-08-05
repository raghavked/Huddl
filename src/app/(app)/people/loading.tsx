import { Skeleton } from "@/components/ui";

/** Route-level loading ghost for /people: header, search, card grid. */
export default function PeopleLoading() {
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

      {/* Search bar ghost */}
      <Skeleton className="mt-6 h-10 w-full rounded-full" />
      <Skeleton className="mt-3 h-4 w-32" />

      {/* Person card grid */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-card border border-border bg-surface p-4 shadow-soft"
          >
            <Skeleton className="size-12 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-28 max-w-full" />
              <Skeleton className="mt-2 h-3 w-20" />
              <Skeleton className="mt-2.5 h-5 w-24 rounded-full" />
            </div>
          </div>
        ))}
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
