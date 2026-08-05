"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  Bell,
  CalendarDays,
  CheckCheck,
  Hash,
  Info,
  Loader2,
  MessageCircle,
  Reply,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeInserts } from "@/lib/hooks/use-realtime-inserts";
import type { AppNotification, NotificationKind } from "@/lib/types";
import { cn } from "@/lib/utils";

/** AppNotification shaped for the realtime hook's Record constraint. */
type NotificationRow = AppNotification & Record<string, unknown>;

const KIND_META: Record<NotificationKind, { icon: LucideIcon; label: string }> =
  {
    dm: { icon: MessageCircle, label: "Direct message" },
    thread_reply: { icon: Reply, label: "Thread reply" },
    schedule_privacy: { icon: ShieldCheck, label: "Privacy notice" },
    event: { icon: CalendarDays, label: "Event" },
    channel: { icon: Hash, label: "Channel" },
    system: { icon: Info, label: "System" },
  };

/**
 * The /notifications inbox: server-fetched rows come in as `initial`, new ones
 * stream in over realtime. Clicking a row marks it read (optimistically) and
 * follows its link when it has one; router.refresh() keeps the TopBar unread
 * badge honest after every mutation.
 */
export function NotificationList({
  initial,
  userId,
}: {
  initial: AppNotification[];
  userId: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<AppNotification[]>(initial);
  const [markingAll, setMarkingAll] = useState(false);

  useRealtimeInserts<NotificationRow>(
    "notifications",
    `user_id=eq.${userId}`,
    (row) => {
      setItems((prev) =>
        prev.some((n) => n.id === row.id)
          ? prev
          : [row as AppNotification, ...prev]
      );
      router.refresh(); // bump the TopBar badge
    }
  );

  const unreadCount = items.filter((n) => !n.read_at).length;

  const markRead = useCallback(
    (notification: AppNotification) => {
      if (notification.read_at) return;
      const readAt = new Date().toISOString();
      setItems((prev) =>
        prev.map((n) =>
          n.id === notification.id ? { ...n, read_at: readAt } : n
        )
      );
      void supabase
        .from("notifications")
        .update({ read_at: readAt })
        .eq("id", notification.id)
        .then(() => router.refresh());
    },
    [supabase, router]
  );

  const markAllRead = useCallback(async () => {
    setMarkingAll(true);
    const readAt = new Date().toISOString();
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: readAt })
      .eq("user_id", userId)
      .is("read_at", null);
    if (!error) {
      setItems((prev) =>
        prev.map((n) => (n.read_at ? n : { ...n, read_at: readAt }))
      );
      router.refresh();
    }
    setMarkingAll(false);
  }, [supabase, userId, router]);

  return (
    <div>
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Notifications</h1>
          <p aria-live="polite" className="text-sm text-muted">
            {unreadCount > 0
              ? `${unreadCount} unread`
              : "You're all caught up"}
          </p>
        </div>
        <button
          type="button"
          onClick={markAllRead}
          disabled={markingAll || unreadCount === 0}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          {markingAll ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <CheckCheck className="size-4" aria-hidden />
          )}
          Mark all read
        </button>
      </header>

      {items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications yet"
          description="New messages, thread replies, event updates and privacy notices about your schedule uploads will land here."
        />
      ) : (
        <>
          <ul className="mt-4 divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            {items.map((notification) => {
              const meta = KIND_META[notification.kind] ?? KIND_META.system;
              const Icon = meta.icon;
              const unread = !notification.read_at;

              const inner = (
                <>
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-full",
                      unread
                        ? "bg-brand text-brand-fg"
                        : "bg-surface-2 text-muted"
                    )}
                    title={meta.label}
                  >
                    <Icon className="size-5" aria-hidden />
                    <span className="sr-only">{meta.label}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block text-sm",
                        unread ? "font-semibold" : "font-medium"
                      )}
                    >
                      {notification.title}
                    </span>
                    {notification.body ? (
                      <span className="mt-0.5 line-clamp-2 block text-sm text-muted">
                        {notification.body}
                      </span>
                    ) : null}
                    <time
                      dateTime={notification.created_at}
                      suppressHydrationWarning
                      className="mt-1 block text-xs text-muted"
                    >
                      {formatDistanceToNow(new Date(notification.created_at), {
                        addSuffix: true,
                      })}
                    </time>
                  </span>
                  {unread ? (
                    <>
                      <span
                        aria-hidden
                        className="mt-1.5 size-2.5 shrink-0 rounded-full bg-brand"
                      />
                      <span className="sr-only">Unread</span>
                    </>
                  ) : null}
                </>
              );

              const rowClass = cn(
                "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand",
                unread && "bg-brand-soft"
              );

              return (
                <li key={notification.id}>
                  {notification.link ? (
                    <Link
                      href={notification.link}
                      onClick={() => markRead(notification)}
                      className={cn(
                        rowClass,
                        unread
                          ? "hover:bg-brand-soft/70"
                          : "hover:bg-surface-2"
                      )}
                    >
                      {inner}
                    </Link>
                  ) : unread ? (
                    <button
                      type="button"
                      onClick={() => markRead(notification)}
                      aria-label={`Mark as read: ${notification.title}`}
                      className={cn(rowClass, "hover:bg-brand-soft/70")}
                    >
                      {inner}
                    </button>
                  ) : (
                    <div className={rowClass}>{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {items.length >= 50 ? (
            <p className="mt-3 text-center text-xs text-muted">
              Showing your 50 most recent notifications.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
