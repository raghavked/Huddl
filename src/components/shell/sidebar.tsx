"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  CalendarDays,
  GraduationCap,
  Hash,
  Home,
  MessageCircle,
  Settings,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { Wordmark } from "@/components/logo";
import { Avatar } from "@/components/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/lib/auth";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
};

function NavLink({
  item,
  active,
}: {
  item: NavItem;
  active: boolean;
}) {
  const { href, label, icon: Icon, badge = 0 } = item;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand",
        active
          ? "bg-brand-soft font-semibold text-brand-ink"
          : "font-medium text-muted hover:bg-surface-2 hover:text-foreground"
      )}
    >
      <Icon
        className={cn(
          "size-5",
          active ? "text-brand" : "text-muted group-hover:text-foreground"
        )}
        aria-hidden
      />
      {label}
      {badge > 0 ? (
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-bold text-brand-fg">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
}

/** Full-height desktop sidebar: nav groups + user card. Hidden on mobile. */
export function Sidebar({
  user,
  unreadCount = 0,
}: {
  user: CurrentUser;
  unreadCount?: number;
}) {
  const pathname = usePathname();

  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: "You",
      items: [
        { href: "/home", label: "Home", icon: Home },
        { href: "/messages", label: "Messages", icon: MessageCircle },
        {
          href: "/notifications",
          label: "Notifications",
          icon: Bell,
          badge: unreadCount,
        },
      ],
    },
    {
      label: "Campus",
      items: [
        { href: "/channels", label: "Channels", icon: Hash },
        { href: "/courses", label: "Courses", icon: GraduationCap },
        { href: "/clubs", label: "Clubs", icon: UsersRound },
        { href: "/events", label: "Events", icon: CalendarDays },
        { href: "/people", label: "People", icon: Users },
      ],
    },
  ];

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-border bg-surface md:flex">
      <div className="px-5 pb-2 pt-6">
        <Link
          href="/home"
          aria-label="Huddl home"
          className="inline-block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
        >
          <Wordmark />
        </Link>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-muted">
          <span aria-hidden className="size-1.5 rounded-full bg-success" />
          {user.university.short_name}
        </p>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-3">
        {groups.map((group) => (
          <div key={group.label} className="mb-5">
            <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted/70">
              {group.label}
            </p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink
                    item={item}
                    active={
                      pathname === item.href ||
                      pathname.startsWith(`${item.href}/`)
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border px-3 py-3">
        <div className="flex items-center gap-1">
          <Link
            href={`/u/${user.profile.handle}`}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-2 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
          >
            <Avatar
              name={user.profile.display_name}
              src={user.profile.avatar_url}
              size="sm"
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                {user.profile.display_name}
              </span>
              <span className="block truncate text-xs text-muted">
                @{user.profile.handle}
              </span>
            </span>
          </Link>
          <Link
            href="/settings"
            aria-label="Settings"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Settings className="size-4.5" aria-hidden />
          </Link>
        </div>
        <div className="mt-2 flex justify-center">
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
