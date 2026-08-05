import { Skeleton } from "@/components/ui";

/** Route-level loading ghost for an event page: hero card, RSVP bar, attendees. */
export default function EventLoading() {
  return (
    <div
      className="mx-auto max-w-3xl px-4 py-6 md:py-10"
      role="status"
      aria-label="Loading"
    >
      {/* Back link + page header ghost */}
      <Skeleton className="h-4 w-24 rounded-full" />
      <div className="mt-3">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="mt-3 h-8 w-72 max-w-full" />
        <Skeleton className="mt-3 h-4 w-44 max-w-full" />
      </div>

      {/* Detail card ghost: date tile hero + badges + meta rows */}
      <div className="mt-6 rounded-card border border-border bg-surface p-5 shadow-soft">
        <div className="flex items-start gap-4">
          <Skeleton className="h-16 w-14 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            <div className="mt-3 flex flex-col gap-2.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/5" />
            </div>
          </div>
        </div>
        <Skeleton className="mt-4 h-3 w-full" />
        <Skeleton className="mt-2 h-3 w-4/5" />
      </div>

      {/* RSVP bar ghost */}
      <div className="mt-5 flex gap-2">
        <Skeleton className="h-10 flex-1 rounded-full" />
        <Skeleton className="h-10 flex-1 rounded-full" />
        <Skeleton className="h-10 flex-1 rounded-full" />
      </div>

      {/* Who's in */}
      <div className="mt-8">
        <Skeleton className="h-4 w-24" />
        <div className="mt-3 flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-2.5 px-2 py-1.5">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3.5 w-32 max-w-full" />
                <Skeleton className="mt-1.5 h-3 w-20" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
