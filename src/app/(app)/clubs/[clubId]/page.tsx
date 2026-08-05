import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  CalendarDays,
  CalendarPlus,
  Check,
  Clock,
  MapPin,
  MessageCircle,
  Users,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  Badge,
  PageHeader,
  SectionHeader,
  buttonClasses,
  cardClasses,
} from "@/components/ui";
import { CategoryBadge, MembershipActions } from "@/features/clubs/club-card";
import { DateTile } from "@/features/events/event-chips";
import { ClubEditor, DisbandClubButton } from "@/features/clubs/club-form";
import { Roster, sortRoster, type RosterEntry } from "@/features/clubs/roster";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatEventTime } from "@/lib/utils";
import type { CampusEvent, Channel, Club } from "@/lib/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ clubId: string }>;
}): Promise<Metadata> {
  const { clubId } = await params;
  const supabase = await createClient();
  const { data: club } = await supabase
    .from("clubs")
    .select("name")
    .eq("id", clubId)
    .maybeSingle();
  return { title: club?.name ?? "Club" };
}


export default async function ClubPage({
  params,
}: {
  params: Promise<{ clubId: string }>;
}) {
  const { clubId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: clubRow } = await supabase
    .from("clubs")
    .select("*")
    .eq("id", clubId)
    .maybeSingle();
  if (!clubRow) notFound();
  const club = clubRow as Club;

  const [{ data: memberRows }, { data: channelRow }, { data: eventRows }] =
    await Promise.all([
      supabase
        .from("club_members")
        .select(
          "*, profile:profiles(id, handle, display_name, avatar_url, phone_verified_at, major, grad_year, is_public, university_id)"
        )
        .eq("club_id", club.id),
      supabase
        .from("channels")
        .select("id, slug")
        .eq("club_id", club.id)
        .maybeSingle(),
      supabase
        .from("events")
        .select("*")
        .eq("club_id", club.id)
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true })
        .limit(20),
    ]);

  const roster = sortRoster(
    ((memberRows ?? []) as RosterEntry[]).filter((m) => m.profile)
  );
  const channel = channelRow as Pick<Channel, "id" | "slug"> | null;
  const events = (eventRows ?? []) as CampusEvent[];

  const me = roster.find((m) => m.user_id === user.userId) ?? null;
  const myRole = me?.role ?? null;
  const isMember = myRole !== null;
  const isOfficer = myRole === "officer" || myRole === "owner";
  const isOwner = myRole === "owner";

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref="/clubs"
        backLabel="All clubs"
        eyebrow="Clubs"
        title={club.name}
      />

      {/* Identity card: category, size, description, join / joined state. */}
      <section
        className={cardClasses({ className: "mt-6 animate-fade-up" })}
        aria-label="About this club"
      >
        <div className="flex flex-wrap items-center gap-2">
          <CategoryBadge category={club.category} />
          <Badge tone="neutral">
            <Users className="size-3" aria-hidden />
            {roster.length} {roster.length === 1 ? "member" : "members"}
          </Badge>
          {myRole ? (
            <Badge tone="brand">
              <Check className="size-3" aria-hidden />
              {myRole === "member"
                ? "Joined"
                : myRole === "owner"
                  ? "Owner"
                  : "Officer"}
            </Badge>
          ) : null}
        </div>

        {club.description ? (
          <p className="mt-3 whitespace-pre-line text-sm text-muted">
            {club.description}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {isMember && channel ? (
            <Link
              href={`/channels/${channel.id}`}
              className={buttonClasses({ size: "sm", className: "gap-1.5" })}
            >
              <MessageCircle className="size-4" aria-hidden />
              Open chat
            </Link>
          ) : null}
          {isOfficer ? (
            <Link
              href={`/events/new?club=${club.id}`}
              className={buttonClasses({
                variant: "secondary",
                size: "sm",
                className: "gap-1.5",
              })}
            >
              <CalendarPlus className="size-4" aria-hidden />
              Plan an event
            </Link>
          ) : null}
          <MembershipActions
            clubId={club.id}
            clubName={club.name}
            role={myRole}
          />
          {isOfficer ? <ClubEditor club={club} /> : null}
        </div>

        {!isMember && channel ? (
          <p className="mt-3 text-xs text-muted">
            Join to get into{" "}
            <span className="font-mono text-foreground">#{channel.slug}</span>{" "}
            and meet the members.
          </p>
        ) : null}
      </section>

      <section className="mt-8" aria-label="Upcoming events">
        <SectionHeader title="Upcoming events" />
        {events.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-border">
            <EmptyState
              icon={CalendarDays}
              title="No upcoming events"
              description={
                isOfficer
                  ? "Plan the first one — members will see it here and on the events board."
                  : "Nothing on the calendar yet. Check back soon."
              }
              className="py-10"
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2.5">
            {events.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/events/${event.id}`}
                  className={cardClasses({
                    padding: "none",
                    interactive: true,
                    className: "flex items-center gap-3 px-4 py-3",
                  })}
                >
                  <DateTile iso={event.starts_at} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {event.title}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
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
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8" aria-label="Members">
        <SectionHeader title={`Members · ${roster.length}`} />
        {roster.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-border">
            <EmptyState
              icon={Users}
              title="No members yet"
              description="Join to get this club going."
              className="py-10"
            />
          </div>
        ) : (
          <div className="mt-3">
            <Roster members={roster} />
          </div>
        )}
      </section>

      {isOwner ? (
        <section
          className={cardClasses({ padding: "sm", className: "mt-10" })}
          aria-labelledby="club-danger-heading"
        >
          <h2 id="club-danger-heading" className="text-sm font-semibold">
            Disband {club.name}
          </h2>
          <p className="mt-1 text-sm text-muted">
            Permanently delete this club, its chat channel and its events for
            everyone.
          </p>
          <div className="mt-3">
            <DisbandClubButton clubId={club.id} clubName={club.name} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
