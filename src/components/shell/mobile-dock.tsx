"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Home,
  LayoutGrid,
  MessageCircle,
  Pin,
  UsersRound,
} from "lucide-react";
import { resetPresenceThrottle, touchPresence } from "@/lib/friends";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/* Six primary destinations, so the dock's pills run tighter than they did at
   five. The touch target is the whole 44px-tall link, not the pill inside it,
   so the squeeze costs nothing to reach. */
const TABS = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/channels", label: "Rooms", icon: LayoutGrid },
  { href: "/messages", label: "Messages", icon: MessageCircle },
  { href: "/clubs", label: "Clubs", icon: UsersRound },
  { href: "/events", label: "Events", icon: CalendarDays },
  { href: "/board", label: "Board", icon: Pin },
] as const;

/** How often the open tab re-announces itself, matching "Active now"'s
    five-minute window so an idle-but-open Hearth stays "Active now". */
const HEARTBEAT_MS = 5 * 60 * 1000;

/** Floating frosted tab dock, mobile only. */
export function MobileDock({ unreadDms = 0 }: { unreadDms?: number }) {
  const pathname = usePathname();

  /* Who the heartbeat is beating for. The dock isn't handed the user, so it
     reads the session itself and keeps listening: sign out and back in on
     the same tab and the id here changes with it. */
  const [heartbeatUserId, setHeartbeatUserId] = useState<string | null>(null);
  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data }) => {
      setHeartbeatUserId(data.session?.user.id ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setHeartbeatUserId(session?.user.id ?? null);
      }
    );
    return () => listener.subscription.unsubscribe();
  }, []);

  /* touchPresence's quiet period is module state, and module state outlives
     a sign-out. Without this reset, whoever signs in next on the same tab
     inherits the previous student's throttle and their first touch is
     silently skipped, so keyed on the user: a new id starts a fresh clock
     and announces itself right away. */
  useEffect(() => {
    if (heartbeatUserId === null) return;
    resetPresenceThrottle();
    void touchPresence();
  }, [heartbeatUserId]);

  /* The presence heartbeat lives here because the dock is the one client
     component mounted on every signed-in page: once on mount, again when
     the tab comes back into view, and on an interval while it stays open.
     touchPresence() throttles itself, never throws, and stays silent while
     sharing is off, so there is nothing to render and nothing to catch. */
  useEffect(() => {
    void touchPresence();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void touchPresence();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(() => {
      void touchPresence();
    }, HEARTBEAT_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, []);

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
