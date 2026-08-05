import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * v3 page header: optional back link, big display title that carries its
 * own weight (no kickers), muted description, right-aligned action slot.
 */
export function PageHeader({
  title,
  description,
  action,
  backHref,
  backLabel,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  className?: string;
}) {
  return (
    <header className={cn("animate-fade-up", className)}>
      {backHref ? (
        <Link
          href={backHref}
          className="mb-3 inline-flex items-center gap-1 rounded-full text-sm font-semibold text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {backLabel ?? "Back"}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.5 max-w-xl text-sm text-muted text-pretty">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </header>
  );
}
