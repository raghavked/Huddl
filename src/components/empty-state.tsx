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
      <span className="flex size-14 items-center justify-center rounded-full bg-surface-2">
        <Icon className="size-6 text-muted" aria-hidden />
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        {description ? (
          <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
