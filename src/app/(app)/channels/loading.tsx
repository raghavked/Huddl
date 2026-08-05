import { Skeleton, SkeletonRow } from "@/components/ui";

/** Route-level loading ghost for /channels: header, tabs, grouped rows. */
export default function ChannelsLoading() {
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

      {/* Segmented tabs ghost */}
      <Skeleton className="mt-6 h-10 w-56 max-w-full rounded-full" />

      {/* Two channel groups */}
      <div className="mt-8">
        <Skeleton className="h-4 w-24" />
        <div className="mt-3 flex flex-col gap-2.5">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </div>
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
