import { Skeleton, SkeletonRow } from "@/components/ui";

/** Route-level loading ghost for a club page: hero card + sections. */
export default function ClubLoading() {
  return (
    <div
      className="mx-auto max-w-3xl px-4 py-6 md:py-10"
      role="status"
      aria-label="Loading"
    >
      {/* Back link + page header ghost */}
      <Skeleton className="h-4 w-20 rounded-full" />
      <div className="mt-3">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="mt-3 h-8 w-56 max-w-full" />
      </div>

      {/* Identity card ghost: badges, description, actions */}
      <div className="mt-6 rounded-card border border-border bg-surface p-5 shadow-soft">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-28 rounded-full" />
        </div>
        <Skeleton className="mt-4 h-3 w-full" />
        <Skeleton className="mt-2 h-3 w-5/6" />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-32 rounded-full" />
        </div>
      </div>

      {/* Upcoming events */}
      <div className="mt-8">
        <Skeleton className="h-4 w-36" />
        <div className="mt-3 flex flex-col gap-2.5">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </div>

      {/* Members */}
      <div className="mt-8">
        <Skeleton className="h-4 w-28" />
        <div className="mt-3 flex flex-col gap-2.5">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
