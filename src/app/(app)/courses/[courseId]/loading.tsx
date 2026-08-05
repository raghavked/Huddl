import { Skeleton, SkeletonRow } from "@/components/ui";

/** Route-level loading ghost for a course hub: header, badges, tabs, notes. */
export default function CourseLoading() {
  return (
    <div
      className="mx-auto max-w-3xl px-4 py-6 md:py-10"
      role="status"
      aria-label="Loading"
    >
      {/* Back link + page header ghost */}
      <Skeleton className="h-4 w-24 rounded-full" />
      <div className="mt-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="mt-3 h-8 w-40 max-w-full" />
        <Skeleton className="mt-3 h-3.5 w-64 max-w-full" />
      </div>

      {/* Term + source badges */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-36 rounded-full" />
      </div>

      {/* Notes / classmates tabs ghost */}
      <Skeleton className="mt-6 h-10 w-64 max-w-full rounded-full" />

      {/* Section content rows */}
      <div className="mt-6 flex flex-col gap-2.5">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
