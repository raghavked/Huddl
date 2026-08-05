import { Skeleton, SkeletonRow } from "@/components/ui";

/** Route-level loading ghost for /home: header + sections mirroring the page. */
export default function HomeLoading() {
  return (
    <div
      className="mx-auto max-w-3xl px-4 py-6 md:py-10"
      role="status"
      aria-label="Loading"
    >
      {/* Page header ghost */}
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-3 h-8 w-48" />
      <Skeleton className="mt-3 h-3.5 w-72 max-w-full" />

      {/* "Your campus" — channel rows */}
      <div className="mt-8">
        <Skeleton className="h-4 w-28" />
        <div className="mt-3 flex flex-col gap-2.5">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </div>

      {/* "Your courses" — card grid */}
      <div className="mt-8">
        <Skeleton className="h-4 w-28" />
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="rounded-card border border-border bg-surface p-4 shadow-soft"
            >
              <Skeleton className="h-4 w-20 max-w-full" />
              <Skeleton className="mt-2 h-3 w-full" />
              <Skeleton className="mt-3 h-3 w-16" />
            </div>
          ))}
        </div>
      </div>

      {/* "Coming up" — event rows */}
      <div className="mt-8">
        <Skeleton className="h-4 w-24" />
        <div className="mt-3 flex flex-col gap-2.5">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
