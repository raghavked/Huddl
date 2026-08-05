import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Small uppercase section label with an optional "see all" link. */
export function SectionHeader({
  title,
  href,
  linkLabel,
  className,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", className)}>
      <h2 className="px-1 text-xs font-bold uppercase tracking-widest text-muted">
        {title}
      </h2>
      {href && linkLabel ? (
        <Link
          href={href}
          className="group inline-flex items-center gap-1 rounded-full text-xs font-semibold text-accent transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {linkLabel}
          <ArrowRight
            className="size-3 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
      ) : null}
    </div>
  );
}
