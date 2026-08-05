"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Hash,
  Home,
  MessageCircle,
  UsersRound,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/channels", label: "Channels", icon: Hash },
  { href: "/messages", label: "Messages", icon: MessageCircle },
  { href: "/clubs", label: "Clubs", icon: UsersRound },
  { href: "/events", label: "Events", icon: CalendarDays },
] as const;

/** Bottom tab bar on mobile, left rail on md+ screens. */
export function AppNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/85 backdrop-blur-lg md:inset-y-0 md:left-0 md:right-auto md:w-56 md:border-r md:border-t-0 md:bg-surface/70"
    >
      <ul className="flex justify-around px-1 py-1 md:mt-20 md:flex-col md:justify-start md:gap-1 md:px-3 md:py-0">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="md:w-full">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex flex-col items-center gap-1 rounded-2xl px-3 py-1.5 text-[11px] font-semibold transition-colors md:flex-row md:gap-3 md:px-3 md:py-2.5 md:text-sm",
                  active
                    ? "text-brand-strong md:bg-brand-gradient md:text-white md:shadow-glow"
                    : "text-muted hover:text-foreground md:hover:bg-surface-2"
                )}
              >
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full transition-all md:size-auto md:rounded-none md:bg-transparent",
                    active
                      ? "bg-brand-gradient text-white shadow-glow md:bg-none md:shadow-none"
                      : "bg-transparent"
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
