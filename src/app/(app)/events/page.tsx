import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  HelpCircle,
  History,
  MapPin,
  PartyPopper,
  Plus,
  Users,
  XCircle,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn, formatEventTime } from "@/lib/utils";
import type {
  CampusEvent,
  Course,
  EventKind,
  EventRsvp,
  Profile,
  RsvpStatus,
} from "@/lib/types";

export const metadata: Metadata = { title: "Events" };

const KIND_FILTERS: readonly { value: EventKind; label: string }[] = [
  { value: "study_session", label: "Study sessions" },
  { value: "meetup", label: "Meetups" },
];

type EventRow = CampusEvent & {
  creator: Profile | null;
  course: Pick<Course, "id" | "code"> | null;
  rsvps: Pick<EventRsvp, "user_id" | "status">[];
};

function eventsHref(kind: EventKind | null, past: boolean): string {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (past) params.set("past", "1");
  const qs = params.toString();
  return qs ? `/events?${qs}` : "/events";
}

function KindBadge({ kind }: { kind: EventKind }) {
  const isStudy = kind === "study_session";
  const Icon = isStudy ? BookOpen : PartyPopper;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
        isStudy ? "bg-accent-soft text-accent" : "bg-brand-soft text-brand-strong"
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {isStudy ? "Study session" : "Meetup"}
    </span>
  );
}

function MyStatusChip({ status }: { status: RsvpStatus }) {
  if (status === "going") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-strong">
        <CheckCircle2 className="size-3" aria-hidden />
        Going
      </span>
    );
  }
  if (status === "maybe") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
        <HelpCircle className="size-3" aria-hidden />
        Maybe
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
      <XCircle className="size-3" aria-hidden />
      Can&apos;t go
    </span>
  );
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; past?: string }>;
}) {
  const [{ kind: rawKind, past: rawPast }, user] = await Promise.all([
    searchParams,
    getCurrentUser(),
  ]);
  if (!user) redirect("/login");

  const activeKind = KIND_FILTERS.some((f) => f.value === rawKind)
    ? (rawKind as EventKind)
    : null;
  const showPast = rawPast === "1";
  const nowIso = new Date().toISOString();

  const supabase = await createClient();
  let query = supabase
    .from("events")
    .select(
      "*, creator:profiles(*), course:courses(id, code), rsvps:event_rsvps(user_id, status)"
    )
    .eq("university_id", user.university.id);
  if (activeKind) query = query.eq("kind", activeKind);

  const { data: rows } = await (showPast
    ? query.lt("starts_at", nowIso).order("starts_at", { ascending: false }).limit(20)
    : query.gte("starts_at", nowIso).order("starts_at", { ascending: true }).limit(50));

  const events = (rows ?? []) as EventRow[];

  const newEventButton = (
    <Link
      href="/events/new"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-fg transition-opacity hover:opacity-90"
    >
      <Plus className="size-4" aria-hidden />
      New event
    </Link>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">
            {showPast ? "Past events" : "Events"}
          </h1>
          <p className="truncate text-sm text-muted">
            {showPast
              ? `What already happened at ${user.university.short_name}`
              : `Study sessions & meetups at ${user.university.short_name}`}
          </p>
        </div>
        {showPast ? (
          <Link
            href={eventsHref(activeKind, false)}
            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Upcoming
          </Link>
        ) : null}
      </header>

      <nav
        aria-label="Filter events by type"
        className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1"
      >
        <Link
          href={eventsHref(null, showPast)}
          aria-current={activeKind === null ? "page" : undefined}
          className={cn(
            "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
            activeKind === null
              ? "bg-brand text-brand-fg"
              : "bg-surface-2 text-muted hover:text-foreground"
          )}
        >
          All
        </Link>
        {KIND_FILTERS.map(({ value, label }) => (
          <Link
            key={value}
            href={eventsHref(value, showPast)}
            aria-current={activeKind === value ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              activeKind === value
                ? "bg-brand text-brand-fg"
                : "bg-surface-2 text-muted hover:text-foreground"
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {events.length === 0 ? (
        <EmptyState
          icon={showPast ? History : CalendarDays}
          title={
            showPast
              ? "No past events"
              : activeKind === "study_session"
                ? "No study sessions coming up"
                : activeKind === "meetup"
                  ? "No meetups coming up"
                  : "Nothing on the calendar yet"
          }
          description={
            showPast
              ? "Once events wrap up, they'll show here."
              : `Get something going at ${user.university.short_name} — a library grind or a hangout, your call.`
          }
          action={showPast ? undefined : newEventButton}
        />
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {events.map((event) => {
            const goingCount = event.rsvps.filter(
              (r) => r.status === "going"
            ).length;
            const myStatus =
              event.rsvps.find((r) => r.user_id === user.userId)?.status ??
              null;
            const isFull =
              event.capacity !== null && goingCount >= event.capacity;
            return (
              <li key={event.id}>
                <Link
                  href={`/events/${event.id}`}
                  className="block rounded-card border border-border bg-surface p-4 transition-colors hover:bg-surface-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <KindBadge kind={event.kind} />
                    {event.course ? (
                      <span className="inline-flex items-center rounded-full bg-surface-2 px-2.5 py-1 font-mono text-xs font-medium text-muted">
                        {event.course.code}
                      </span>
                    ) : null}
                    {myStatus ? (
                      <span className="ml-auto">
                        <MyStatusChip status={myStatus} />
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-2.5 font-semibold leading-snug">
                    {event.title}
                  </p>

                  <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                    <span className="inline-flex items-center gap-1 text-accent">
                      <CalendarDays className="size-3.5" aria-hidden />
                      {formatEventTime(event.starts_at, event.ends_at)}
                    </span>
                    {event.location ? (
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <MapPin className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{event.location}</span>
                      </span>
                    ) : null}
                  </p>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    {event.creator ? (
                      <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-muted">
                        <Avatar
                          name={event.creator.display_name}
                          src={event.creator.avatar_url}
                          size="xs"
                        />
                        <span className="truncate">
                          {event.creator.display_name}
                        </span>
                      </span>
                    ) : (
                      <span />
                    )}
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 text-sm",
                        isFull ? "font-medium text-danger" : "text-muted"
                      )}
                    >
                      <Users className="size-4" aria-hidden />
                      {goingCount} going
                      {event.capacity !== null
                        ? isFull
                          ? " · Full"
                          : ` of ${event.capacity}`
                        : ""}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {!showPast ? (
        <div className="mt-6 text-center">
          <Link
            href={eventsHref(activeKind, true)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground"
          >
            <History className="size-4" aria-hidden />
            Past events
          </Link>
        </div>
      ) : null}

      <Link
        href="/events/new"
        aria-label="New event"
        className="fixed bottom-20 right-4 z-30 inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-3 text-sm font-semibold text-brand-fg shadow-lg transition-opacity hover:opacity-90 md:bottom-8 md:right-8"
      >
        <Plus className="size-5" aria-hidden />
        New event
      </Link>
    </div>
  );
}
