import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { CATEGORIES, type BoardCategory } from "@/lib/board";
import { cn } from "@/lib/utils";

/* The rail of boards, built straight from `CATEGORIES` in `@/lib/board`. A
 * category added there shows up here with its own icon and label and nothing
 * to edit in this file.
 *
 * Each chip is a link, not a client-side slice: picking a board runs a real
 * query, so a busy "for sale" run can't push a quiet "lost" post out of the
 * hundred rows the database returns. The rail bleeds into both gutters so a
 * long list runs off the edge instead of stopping short of it, and scrolls
 * inside itself, so the page never moves sideways. */

function chipClasses(active: boolean): string {
  return cn(
    "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
    active
      ? "bg-brand text-brand-fg shadow-soft"
      : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-foreground"
  );
}

export function CategoryRail({ active }: { active: BoardCategory | null }) {
  return (
    <nav
      aria-label="Filter the board by category"
      className="-mx-4 mt-6 flex animate-fade-up gap-2 overflow-x-auto px-4 pb-1"
    >
      <Link
        href="/board"
        aria-current={active === null ? "page" : undefined}
        className={chipClasses(active === null)}
      >
        <LayoutGrid className="size-4" aria-hidden />
        All
      </Link>
      {CATEGORIES.map(({ key, label, icon: Icon }) => (
        <Link
          key={key}
          href={`/board?category=${key}`}
          aria-current={active === key ? "page" : undefined}
          className={chipClasses(active === key)}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}
