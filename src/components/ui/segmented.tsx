"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pill-style link tabs on a recessed track. Active state follows the
 * current pathname (exact match, or prefix when `prefix` is set).
 */
export function Segmented({
  items,
  className,
}: {
  items: {
    href: string;
    label: string;
    icon?: LucideIcon;
    /** Match nested routes too (e.g. /channels matching /channels/123). */
    prefix?: boolean;
  }[];
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <nav
      className={cn(
        "inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-border bg-surface-2 p-1",
        className
      )}
    >
      {items.map(({ href, label, icon: Icon, prefix }) => {
        const active =
          pathname === href || (prefix && pathname.startsWith(`${href}/`));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
              active
                ? "bg-surface text-foreground shadow-soft"
                : "text-muted hover:text-foreground"
            )}
          >
            {Icon ? <Icon className="size-4" aria-hidden /> : null}
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
