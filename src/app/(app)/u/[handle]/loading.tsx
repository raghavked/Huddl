import { Skeleton } from "@/components/ui";

/** Route-level loading ghost for a profile: hero card + chip sections. */
export default function ProfileLoading() {
  return (
    <div
      className="mx-auto max-w-3xl px-4 py-6 md:py-10"
      role="status"
      aria-label="Loading"
    >
      {/* Back link ghost */}
      <Skeleton className="h-4 w-20 rounded-full" />

      {/* Hero card ghost: centered on mobile, row on sm+ like the real page */}
      <div className="mt-3 rounded-card border border-border bg-surface p-6 shadow-soft sm:p-8">
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
          <Skeleton className="size-24 shrink-0 rounded-full" />
          <div className="flex w-full min-w-0 flex-1 flex-col items-center sm:items-start">
            <Skeleton className="h-7 w-48 max-w-full" />
            <Skeleton className="mt-2 h-3.5 w-36" />
            <div className="mt-3 flex flex-wrap justify-center gap-1.5 sm:justify-start">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-28 rounded-full" />
            </div>
            <Skeleton className="mt-5 h-11 w-32 rounded-full" />
          </div>
        </div>
      </div>

      {/* Courses chips */}
      <div className="mt-8">
        <Skeleton className="h-4 w-32" />
        <div className="mt-3 flex flex-wrap gap-2">
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
      </div>

      {/* Campus channel chips */}
      <div className="mt-8">
        <Skeleton className="h-4 w-44" />
        <div className="mt-3 flex flex-wrap gap-2">
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-32 rounded-full" />
        </div>
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
