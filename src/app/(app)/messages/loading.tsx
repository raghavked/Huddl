import { Skeleton } from "@/components/ui";

/** Route-level loading ghost for /messages: header + thread rows with avatars. */
export default function MessagesLoading() {
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

      {/* Conversation rows — round avatar + preview lines + timestamp */}
      <div className="mt-6 flex flex-col gap-2.5">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3 shadow-soft"
          >
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="mt-2 h-3 w-2/3" />
            </div>
            <Skeleton className="h-3 w-10 shrink-0" />
          </div>
        ))}
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
