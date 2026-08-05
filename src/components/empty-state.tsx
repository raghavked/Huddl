import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-16 text-center",
        className
      )}
    >
      <span className="flex size-16 items-center justify-center rounded-full bg-brand-gradient-soft ring-1 ring-border">
        <Icon className="size-7 text-brand-strong" aria-hidden />
      </span>
      <div>
        <p className="text-lg font-bold tracking-tight">{title}</p>
        {description ? (
          <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
