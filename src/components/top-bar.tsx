import Link from "next/link";
import { Bell, Settings, Users } from "lucide-react";
import { Wordmark } from "@/components/logo";
import { Avatar } from "@/components/avatar";
import type { CurrentUser } from "@/lib/auth";

export function TopBar({
  user,
  unreadCount = 0,
}: {
  user: CurrentUser;
  unreadCount?: number;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur md:pl-56">
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/home" aria-label="Huddl home">
            <Wordmark />
          </Link>
          <span className="hidden truncate rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted sm:block">
            {user.university.short_name}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/people"
            aria-label="People directory"
            className="rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <Users className="size-5" aria-hidden />
          </Link>
          <Link
            href="/notifications"
            aria-label={
              unreadCount > 0
                ? `Notifications, ${unreadCount} unread`
                : "Notifications"
            }
            className="relative rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
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
            className="rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <Settings className="size-5" aria-hidden />
          </Link>
          <Link
            href={`/u/${user.profile.handle}`}
            aria-label="Your profile"
            className="ml-1"
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
