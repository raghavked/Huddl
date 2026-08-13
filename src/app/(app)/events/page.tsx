import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  Clock,
  HelpCircle,
  History,
  MapPin,
  Plus,
  Users,
  XCircle,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { CalendarScene } from "@/components/illustrations";
import {
  Badge,
  PageHeader,
  buttonClasses,
  cardClasses,
} from "@/components/ui";
import { DateTile, KindBadge } from "@/features/events/event-chips";
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

function chipClasses(active: boolean): string {
  return cn(
    "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
    active
      ? "bg-brand text-brand-fg shadow-soft"
      : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-foreground"
  );
}

function MyStatusChip({ status }: { status: RsvpStatus }) {
  if (status === "going") {
    return (
      <Badge tone="brand">
        <CheckCircle2 className="size-3" aria-hidden />
        Going
      </Badge>
    );
  }
  if (status === "maybe") {
    return (
      <Badge tone="neutral">
        <HelpCircle className="size-3" aria-hidden />
        Maybe
      </Badge>
    );
  }
  return (
    <Badge tone="neutral">
      <XCircle className="size-3" aria-hidden />
      Can&apos;t go
    </Badge>
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

  const planButton = (
    <Link
      href="/events/new"
      className={buttonClasses({ size: "sm", className: "gap-1.5" })}
    >
      <Plus className="size-4" aria-hidden />
      Plan something
    </Link>
  );

  // Your whole month at a glance: class dates and the events you're going to.
  const calendarButton = (
    <Link
      href="/calendar"
      className={buttonClasses({
        variant: "secondary",
        size: "sm",
        className: "gap-1.5",
      })}
    >
      <CalendarRange className="size-4" aria-hidden />
      Your calendar
    </Link>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        title={showPast ? "Past events" : "Events"}
        description={
          showPast
            ? `What already happened at ${user.university.short_name}.`
            : `Study sessions and meetups at ${user.university.short_name}.`
        }
        backHref={showPast ? eventsHref(activeKind, false) : undefined}
        backLabel="Upcoming events"
        action={
          events.length === 0 && !showPast ? (
            calendarButton
          ) : (
            <span className="flex flex-wrap items-center justify-end gap-2">
              {calendarButton}
              {planButton}
            </span>
          )
        }
      />

      <nav
        aria-label="Filter events by type"
        className="-mx-4 mt-6 flex animate-fade-up gap-2 overflow-x-auto px-4 pb-1"
      >
        <Link
          href={eventsHref(null, showPast)}
          aria-current={activeKind === null ? "page" : undefined}
          className={chipClasses(activeKind === null)}
        >
          All
        </Link>
        {KIND_FILTERS.map(({ value, label }) => (
          <Link
            key={value}
            href={eventsHref(value, showPast)}
            aria-current={activeKind === value ? "page" : undefined}
            className={chipClasses(activeKind === value)}
          >
            {label}
          </Link>
        ))}
      </nav>

      {events.length === 0 ? (
        <div className="mt-6 rounded-card border border-dashed border-border">
          <EmptyState
            illustration={showPast ? undefined : <CalendarScene />}
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
                : `Get something going at ${user.university.short_name}. A library grind or a hangout, your call.`
            }
            action={showPast ? undefined : planButton}
          />
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
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
                  className={cardClasses({
                    padding: "sm",
                    interactive: true,
                    className: "flex gap-3.5",
                  })}
                >
                  <DateTile iso={event.starts_at} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <KindBadge kind={event.kind} />
                      {event.course ? (
                        <Badge tone="neutral" className="font-mono">
                          {event.course.code}
                        </Badge>
                      ) : null}
                      {myStatus ? (
                        <span className="ml-auto">
                          <MyStatusChip status={myStatus} />
                        </span>
                      ) : null}
                    </span>

                    <span className="mt-2 block font-semibold leading-snug">
                      {event.title}
                    </span>

                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3.5" aria-hidden />
                        {formatEventTime(event.starts_at, event.ends_at)}
                      </span>
                      {event.location ? (
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <MapPin className="size-3.5 shrink-0" aria-hidden />
                          <span className="truncate">{event.location}</span>
                        </span>
                      ) : null}
                    </span>

                    <span className="mt-2.5 flex items-center justify-between gap-2">
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
                          isFull ? "font-semibold text-danger" : "text-muted"
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
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {!showPast ? (
        <div className="mt-8 text-center">
          <Link
            href={eventsHref(activeKind, true)}
            className={buttonClasses({
              variant: "ghost",
              size: "sm",
              className: "gap-1.5",
            })}
          >
            <History className="size-4" aria-hidden />
            Past events
          </Link>
        </div>
      ) : null}
    </div>
  );
}
