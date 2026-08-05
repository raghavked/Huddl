import { Skeleton } from "@/components/ui";

/** Route-level loading ghost for /courses: header + course card grid. */
export default function CoursesLoading() {
  return (
    <div
      className="mx-auto max-w-3xl px-4 py-6 md:py-10"
      role="status"
      aria-label="Loading"
    >
      {/* Page header ghost */}
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-3 h-8 w-44" />
      <Skeleton className="mt-3 h-3.5 w-56 max-w-full" />

      {/* Course card grid */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="rounded-card border border-border bg-surface p-4 shadow-soft"
          >
            <Skeleton className="size-10" />
            <div className="mt-3 flex items-center gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="mt-2 h-3.5 w-3/4" />
            <Skeleton className="mt-3 h-3 w-32 max-w-full" />
          </div>
        ))}
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
