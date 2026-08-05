import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  BookOpen,
  CheckCircle2,
  Clock,
  HelpCircle,
  MapPin,
  Pencil,
  Users,
  UsersRound,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import {
  Badge,
  PageHeader,
  SectionHeader,
  buttonClasses,
  cardClasses,
} from "@/components/ui";
import {
  DeleteEventButton,
  EventForm,
  type CourseOption,
} from "@/features/events/event-form";
import { DateTile, KindBadge } from "@/features/events/event-chips";
import { RsvpBar } from "@/features/events/rsvp-bar";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn, formatEventTime } from "@/lib/utils";
import type {
  CampusEvent,
  Course,
  EventRsvp,
  Profile,
  RsvpStatus,
} from "@/lib/types";

type EventDetail = CampusEvent & {
  creator: Profile | null;
  course: Pick<Course, "id" | "code" | "title"> | null;
  club: { id: string; name: string } | null;
};

type RsvpRow = EventRsvp & { profile: Profile | null };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ eventId: string }>;
}): Promise<Metadata> {
  const { eventId } = await params;
  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select("title")
    .eq("id", eventId)
    .maybeSingle();
  return { title: event?.title ?? "Event" };
}


function AttendeeGroup({
  icon: Icon,
  label,
  attendees,
  creatorId,
}: {
  icon: LucideIcon;
  label: string;
  attendees: RsvpRow[];
  creatorId: string;
}) {
  if (attendees.length === 0) return null;
  return (
    <div>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="size-4 text-muted" aria-hidden />
        {label}
        <span className="font-normal text-muted">({attendees.length})</span>
      </h3>
      <ul className="mt-2 flex flex-col gap-1">
        {attendees.map((row) =>
          row.profile ? (
            <li key={row.user_id}>
              <Link
                href={`/u/${row.profile.handle}`}
                className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
              >
                <Avatar
                  name={row.profile.display_name}
                  src={row.profile.avatar_url}
                  size="sm"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {row.profile.display_name}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    @{row.profile.handle}
                  </span>
                </span>
                {row.user_id === creatorId ? (
                  <Badge tone="brand" className="ml-auto">
                    Host
                  </Badge>
                ) : null}
              </Link>
            </li>
          ) : null
        )}
      </ul>
    </div>
  );
}

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const [{ eventId }, { edit }] = await Promise.all([params, searchParams]);
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: eventRow } = await supabase
    .from("events")
    .select(
      "*, creator:profiles(id, handle, display_name, avatar_url, phone_verified_at, major, grad_year, is_public, university_id), course:courses(id, code, title), club:clubs(id, name)"
    )
    .eq("id", eventId)
    .maybeSingle();
  if (!eventRow) notFound();
  const event = eventRow as EventDetail;

  const isCreator = event.creator_id === user.userId;

  // ---- Inline edit mode (creator only) -------------------------------------
  if (edit === "1") {
    if (!isCreator) redirect(`/events/${event.id}`);

    const { data: enrollmentRows } = await supabase
      .from("enrollments")
      .select("course:courses(id, code, title)")
      .eq("user_id", user.userId);
    let courseOptions = (
      (enrollmentRows ?? []) as unknown as { course: CourseOption | null }[]
    )
      .map((row) => row.course)
      .filter((course): course is CourseOption => Boolean(course))
      .sort((a, b) => a.code.localeCompare(b.code));
    // Keep the current course pickable even if the host has since dropped it.
    if (event.course && !courseOptions.some((c) => c.id === event.course!.id)) {
      courseOptions = [event.course, ...courseOptions];
    }

    return (
      <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
        <PageHeader
          backHref={`/events/${event.id}`}
          backLabel="Back to event"
          title="Edit event"
        />
        <div
          className={cardClasses({
            padding: "lg",
            className: "mt-6 animate-fade-up",
          })}
        >
          <EventForm
            universityId={user.university.id}
            userId={user.userId}
            courses={courseOptions}
            event={event}
            club={event.club}
          />
        </div>
      </div>
    );
  }

  // ---- Detail view ---------------------------------------------------------
  const { data: rsvpRows } = await supabase
    .from("event_rsvps")
    .select(
      "*, profile:profiles(id, handle, display_name, avatar_url, phone_verified_at, major, grad_year, is_public, university_id)"
    )
    .eq("event_id", event.id)
    .order("created_at", { ascending: true });
  const rsvps = (rsvpRows ?? []) as RsvpRow[];

  const going = rsvps.filter((r) => r.status === "going");
  const maybe = rsvps.filter((r) => r.status === "maybe");
  const declined = rsvps.filter((r) => r.status === "declined");
  const myStatus: RsvpStatus | null =
    rsvps.find((r) => r.user_id === user.userId)?.status ?? null;
  const atCapacity =
    event.capacity !== null && going.length >= event.capacity;
  const isPast = new Date(event.ends_at ?? event.starts_at) < new Date();
  const spotsLeft =
    event.capacity !== null ? Math.max(0, event.capacity - going.length) : null;
  const fillPct =
    event.capacity !== null
      ? Math.min(100, Math.round((going.length / event.capacity) * 100))
      : 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref="/events"
        backLabel="All events"
        title={event.title}
        description={
          event.creator ? (
            <Link
              href={`/u/${event.creator.handle}`}
              className="inline-flex items-center gap-1.5 rounded-full transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <Avatar
                name={event.creator.display_name}
                src={event.creator.avatar_url}
                size="xs"
              />
              Hosted by{" "}
              <span className="font-semibold text-foreground">
                {event.creator.display_name}
              </span>
            </Link>
          ) : undefined
        }
      />

      {/* Detail card: date tile hero + meta rows. */}
      <section
        className={cardClasses({ className: "mt-6 animate-fade-up" })}
        aria-label="Event details"
      >
        <div className="flex items-start gap-4">
          <DateTile iso={event.starts_at} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <KindBadge kind={event.kind} />
              {event.course ? (
                <Badge tone="neutral" className="font-mono">
                  {event.course.code}
                </Badge>
              ) : null}
              {event.club ? (
                <Link
                  href={`/clubs/${event.club.id}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-muted transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <UsersRound className="size-3.5" aria-hidden />
                  {event.club.name}
                </Link>
              ) : null}
              {isPast ? (
                <Badge tone="neutral">
                  <Clock className="size-3" aria-hidden />
                  Ended
                </Badge>
              ) : null}
            </div>

            <dl className="mt-3 flex flex-col gap-2.5 text-sm">
              <div className="flex items-start gap-2.5">
                <dt>
                  <Clock className="mt-0.5 size-4 text-accent" aria-hidden />
                  <span className="sr-only">When</span>
                </dt>
                <dd className="font-medium">
                  {formatEventTime(event.starts_at, event.ends_at)}
                </dd>
              </div>
              {event.location ? (
                <div className="flex items-start gap-2.5">
                  <dt>
                    <MapPin className="mt-0.5 size-4 text-muted" aria-hidden />
                    <span className="sr-only">Where</span>
                  </dt>
                  <dd>{event.location}</dd>
                </div>
              ) : null}
              {event.course ? (
                <div className="flex items-start gap-2.5">
                  <dt>
                    <BookOpen
                      className="mt-0.5 size-4 text-muted"
                      aria-hidden
                    />
                    <span className="sr-only">Course</span>
                  </dt>
                  <dd>
                    <span className="font-mono font-medium">
                      {event.course.code}
                    </span>{" "}
                    <span className="text-muted">· {event.course.title}</span>
                  </dd>
                </div>
              ) : null}
              <div className="flex items-start gap-2.5">
                <dt>
                  <Users className="mt-0.5 size-4 text-muted" aria-hidden />
                  <span className="sr-only">Attendance</span>
                </dt>
                <dd>
                  {going.length} going
                  {event.capacity !== null ? (
                    <span className="text-muted"> of {event.capacity} spots</span>
                  ) : null}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {event.description ? (
          <p className="mt-4 whitespace-pre-line border-t border-border pt-4 text-sm text-muted">
            {event.description}
          </p>
        ) : null}

        {event.capacity !== null ? (
          <div className="mt-4">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">
                {going.length} of {event.capacity}{" "}
                {event.capacity === 1 ? "spot" : "spots"} filled
              </span>
              <span
                className={cn(
                  "text-xs",
                  atCapacity ? "font-semibold text-danger" : "text-muted"
                )}
              >
                {atCapacity ? "Full" : `${spotsLeft} left`}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Spots filled"
              aria-valuemin={0}
              aria-valuemax={event.capacity}
              aria-valuenow={Math.min(going.length, event.capacity)}
              className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width]",
                  atCapacity ? "bg-danger" : "bg-brand"
                )}
                style={{ width: `${fillPct}%` }}
              />
            </div>
          </div>
        ) : null}
      </section>

      <section className="mt-5" aria-label="Your RSVP">
        {isPast ? (
          <p className="rounded-card border border-border bg-surface-2 px-4 py-3 text-sm text-muted">
            This event has ended
            {myStatus === "going" ? " — hope it was a good one." : "."}
          </p>
        ) : (
          <RsvpBar
            eventId={event.id}
            initialStatus={myStatus}
            atCapacity={atCapacity}
          />
        )}
      </section>

      {isCreator ? (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link
            href={`/events/${event.id}?edit=1`}
            className={buttonClasses({
              variant: "secondary",
              size: "sm",
              className: "gap-1.5",
            })}
          >
            <Pencil className="size-4" aria-hidden />
            Edit
          </Link>
          <DeleteEventButton eventId={event.id} />
        </div>
      ) : null}

      <section className="mt-8" aria-label="Who's in">
        <SectionHeader title={`Who's in · ${rsvps.length}`} />
        {rsvps.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-border">
            <EmptyState
              icon={Users}
              title="No RSVPs yet"
              description={
                isPast
                  ? "Nobody RSVP'd to this one."
                  : "Be the first — tap an RSVP above."
              }
              className="py-10"
            />
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-5">
            <AttendeeGroup
              icon={CheckCircle2}
              label="Going"
              attendees={going}
              creatorId={event.creator_id}
            />
            <AttendeeGroup
              icon={HelpCircle}
              label="Maybe"
              attendees={maybe}
              creatorId={event.creator_id}
            />
            <AttendeeGroup
              icon={XCircle}
              label="Can't go"
              attendees={declined}
              creatorId={event.creator_id}
            />
          </div>
        )}
      </section>
    </div>
  );
}
