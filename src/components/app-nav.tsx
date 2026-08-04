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
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface md:inset-y-0 md:left-0 md:right-auto md:w-56 md:border-r md:border-t-0"
    >
      <ul className="flex justify-around md:mt-20 md:flex-col md:justify-start md:gap-1 md:px-3">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="md:w-full">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-3 py-2 text-[11px] font-medium transition-colors md:flex-row md:gap-3 md:rounded-lg md:px-3 md:py-2.5 md:text-sm",
                  active
                    ? "text-brand md:bg-brand-soft md:text-brand-strong"
                    : "text-muted hover:text-foreground"
                )}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
