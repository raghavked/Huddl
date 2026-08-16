"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  AtSign,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCheck,
  Heart,
  Info,
  LayoutGrid,
  Loader2,
  Megaphone,
  MessageCircle,
  Reply,
  ShieldCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button, PageHeader } from "@/components/ui";
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
    channel: { icon: LayoutGrid, label: "Channel" },
    system: { icon: Info, label: "System" },
    course_calendar: { icon: BookOpen, label: "Class calendar" },
    mention: { icon: AtSign, label: "Mention" },
    thanks: { icon: Heart, label: "Thanks" },
    club_post: { icon: Megaphone, label: "Club post" },
    friend: { icon: UserPlus, label: "Friend" },
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
      <PageHeader
        title="Notifications"
        description={
          <span aria-live="polite">
            {unreadCount > 0
              ? `${unreadCount} unread`
              : "You're all caught up"}
          </span>
        }
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={markAllRead}
            disabled={markingAll || unreadCount === 0}
          >
            {markingAll ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <CheckCheck className="size-4" aria-hidden />
            )}
            Mark all read
          </Button>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="All quiet. You're caught up."
          /* Word for word with the native empty state in
             mobile/src/app/notifications.tsx. The old copy named four of the
             ten kinds and one of the four, schedule privacy notices, is the
             rarest thing that arrives here. */
          description="Replies, mentions, event changes, club posts and thanks for your notes land here."
        />
      ) : (
        <>
          <ul className="mt-6 flex animate-fade-up flex-col gap-2.5">
            {items.map((notification) => {
              const meta = KIND_META[notification.kind] ?? KIND_META.system;
              const Icon = meta.icon;
              const unread = !notification.read_at;

              const inner = (
                <>
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-xl",
                      unread
                        ? "bg-surface text-brand"
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
                      <span
                        className={cn(
                          "mt-0.5 line-clamp-2 block text-sm",
                          // On the tinted unread row, secondary text tints from
                          // the surface hue, never gray on a colored surface.
                          unread ? "text-brand-ink/80" : "text-muted"
                        )}
                      >
                        {notification.body}
                      </span>
                    ) : null}
                    <time
                      dateTime={notification.created_at}
                      suppressHydrationWarning
                      className={cn(
                        "mt-1 block text-xs",
                        unread ? "text-brand-ink/60" : "text-muted"
                      )}
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

              // Card row, tinted while unread. Hand-built (not cardClasses) so
              // the background can swap without conflicting utility classes.
              const rowClass = cn(
                "flex w-full items-start gap-3 rounded-card border px-4 py-3 text-left shadow-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                unread
                  ? "border-brand/50 bg-brand-soft"
                  : "border-border bg-surface"
              );
              const interactiveClass =
                "transition-all hover:-translate-y-px hover:shadow-lift";

              return (
                <li key={notification.id}>
                  {notification.link ? (
                    <Link
                      href={notification.link}
                      onClick={() => markRead(notification)}
                      className={cn(
                        rowClass,
                        interactiveClass,
                        unread
                          ? "hover:border-brand/70"
                          : "hover:border-brand/25"
                      )}
                    >
                      {inner}
                    </Link>
                  ) : unread ? (
                    <button
                      type="button"
                      onClick={() => markRead(notification)}
                      aria-label={`Mark as read: ${notification.title}`}
                      className={cn(
                        rowClass,
                        interactiveClass,
                        "hover:bg-brand-soft/60"
                      )}
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
