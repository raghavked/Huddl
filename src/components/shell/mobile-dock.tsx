"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Hash,
  Home,
  MessageCircle,
  Pin,
  UsersRound,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* Six primary destinations, so the dock's pills run tighter than they did at
   five. The touch target is the whole 44px-tall link, not the pill inside it,
   so the squeeze costs nothing to reach. */
const TABS = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/channels", label: "Channels", icon: Hash },
  { href: "/messages", label: "Messages", icon: MessageCircle },
  { href: "/clubs", label: "Clubs", icon: UsersRound },
  { href: "/events", label: "Events", icon: CalendarDays },
  { href: "/board", label: "Board", icon: Pin },
] as const;

/** Floating frosted tab dock, mobile only. */
export function MobileDock({ unreadDms = 0 }: { unreadDms?: number }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="pb-safe pointer-events-none fixed inset-x-0 bottom-0 z-40"
    >
      <ul className="glass pointer-events-auto mx-auto mb-3 flex max-w-sm items-center justify-around rounded-3xl border border-border/70 px-1.5 py-1.5 shadow-lift">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          const showUnreadDot = href === "/messages" && unreadDms > 0;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <span
                  className={cn(
                    "relative flex h-7 items-center justify-center rounded-full px-2.5 transition-colors",
                    active
                      ? "bg-brand-soft text-brand-ink"
                      : "text-muted"
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                  {showUnreadDot ? (
                    <>
                      <span
                        aria-hidden
                        className="absolute right-2 top-0 size-2 rounded-full bg-brand"
                      />
                      <span className="sr-only">unread messages</span>
                    </>
                  ) : null}
                </span>
                <span
                  className={cn(
                    "text-[10px] font-semibold",
                    active ? "text-brand-ink" : "text-muted"
                  )}
                >
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
