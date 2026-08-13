import { cn } from "@/lib/utils";

/** Loading placeholder block. Pair shapes to the content they stand for. */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-xl bg-surface-2", className)}
      {...props}
    />
  );
}

/** A standard list-row skeleton: icon tile + two text lines. */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3 shadow-soft",
        className
      )}
    >
      <Skeleton className="size-10 shrink-0" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="mt-2 h-3 w-2/3" />
      </div>
    </div>
  );
}

/** Page-level loading state: header ghost + a stack of row ghosts. */
export function SkeletonPage({ rows = 5 }: { rows?: number }) {
  return (
    <div
      className="mx-auto max-w-3xl px-4 py-6 md:py-10"
      role="status"
      aria-label="Loading"
    >
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-3 h-8 w-48" />
      <Skeleton className="mt-3 h-3.5 w-72 max-w-full" />
      <div className="mt-8 flex flex-col gap-2.5">
        {Array.from({ length: rows }, (_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
