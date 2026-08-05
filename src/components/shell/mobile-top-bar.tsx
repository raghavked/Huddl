import Link from "next/link";
import { Bell, Settings } from "lucide-react";
import { Wordmark } from "@/components/logo";
import { Avatar } from "@/components/avatar";
import type { CurrentUser } from "@/lib/auth";

/** Frosted mobile header — the desktop shell lives in the sidebar. */
export function MobileTopBar({
  user,
  unreadCount = 0,
}: {
  user: CurrentUser;
  unreadCount?: number;
}) {
  return (
    <header className="glass sticky top-0 z-40 border-b border-border/60 md:hidden">
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            href="/home"
            aria-label="Huddl home"
            className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
          >
            <Wordmark />
          </Link>
          <span className="truncate rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-muted">
            {user.university.short_name}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <Link
            href="/notifications"
            aria-label={
              unreadCount > 0
                ? `Notifications, ${unreadCount} unread`
                : "Notifications"
            }
            className="relative flex size-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Bell className="size-5" aria-hidden />
            {unreadCount > 0 ? (
              <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-brand text-[9px] font-bold text-brand-fg">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            ) : null}
          </Link>
          <Link
            href="/settings"
            aria-label="Settings"
            className="flex size-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Settings className="size-5" aria-hidden />
          </Link>
          <Link
            href={`/u/${user.profile.handle}`}
            aria-label="Your profile"
            className="ml-1 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Avatar
              name={user.profile.display_name}
              src={user.profile.avatar_url}
              size="sm"
            />
          </Link>
        </div>
      </div>
    </header>
  );
}
