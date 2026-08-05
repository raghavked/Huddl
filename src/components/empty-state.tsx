import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Empty states recruit: illustration (or icon tile), invitation, and
 * ideally an action. Pass a scene from `@/components/illustrations` as
 * `illustration` on the empty states that deserve the full treatment;
 * the icon tile remains the compact default.
 */
export function EmptyState({
  icon: Icon,
  illustration,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  illustration?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex animate-fade-up flex-col items-center justify-center gap-4 px-6 py-16 text-center",
        className
      )}
    >
      {illustration ?? (
        <span className="relative flex size-16 items-center justify-center rounded-2xl bg-brand-soft">
          <Icon className="size-7 text-brand" aria-hidden />
          <span
            aria-hidden
            className="absolute -right-1.5 -top-1.5 size-3 rounded-full bg-brand-2/60"
          />
          <span
            aria-hidden
            className="absolute -bottom-1 -left-2 size-2 rounded-full bg-accent/40"
          />
        </span>
      )}
      <div>
        <p className="font-bold tracking-tight">{title}</p>
        {description ? (
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted text-pretty">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
