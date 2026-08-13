import { Skeleton, SkeletonRow } from "@/components/ui";

/** Route-level loading ghost for /settings: profile card + settings list. */
export default function SettingsLoading() {
  return (
    <div
      className="mx-auto max-w-3xl px-4 py-6 md:py-10"
      role="status"
      aria-label="Loading"
    >
      {/* Page header ghost */}
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-3 h-8 w-36" />
      <Skeleton className="mt-3 h-3.5 w-80 max-w-full" />

      {/* Profile card ghost */}
      <div className="mt-8 rounded-card border border-border bg-surface p-5 shadow-soft">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-5 w-40 max-w-full" />
            <Skeleton className="mt-2 h-3.5 w-24" />
            <Skeleton className="mt-2 h-3.5 w-52 max-w-full" />
          </div>
        </div>
      </div>

      {/* Settings list ghost: one card, divided rows */}
      <div className="mt-4 overflow-hidden rounded-card border border-border bg-surface shadow-soft">
        <div className="divide-y divide-border">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <Skeleton className="size-10 shrink-0" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3.5 w-32 max-w-full" />
                <Skeleton className="mt-2 h-3 w-52 max-w-full" />
              </div>
              <Skeleton className="size-4 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Appearance */}
      <div className="mt-8">
        <Skeleton className="h-4 w-28" />
        <SkeletonRow className="mt-3" />
      </div>

      {/* Sign out button ghost */}
      <Skeleton className="mt-8 h-11 w-full rounded-full sm:w-32" />

      <span className="sr-only">Loading…</span>
    </div>
  );
}
