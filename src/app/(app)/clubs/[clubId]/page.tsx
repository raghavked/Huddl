import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  CalendarPlus,
  MapPin,
  MessageCircle,
  Users,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { CategoryBadge, MembershipActions } from "@/features/clubs/club-card";
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
        .select("*, profile:profiles(*)")
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
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href="/clubs"
        className="inline-flex items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All clubs
      </Link>

      <header className="mt-4">
        <h1 className="text-2xl font-bold leading-tight">{club.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <CategoryBadge category={club.category} />
          <span className="inline-flex items-center gap-1 text-sm text-muted">
            <Users className="size-4" aria-hidden />
            {roster.length} {roster.length === 1 ? "member" : "members"}
          </span>
        </div>
        {club.description ? (
          <p className="mt-3 whitespace-pre-line text-sm text-muted">
            {club.description}
          </p>
        ) : null}
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {isMember && channel ? (
          <Link
            href={`/channels/${channel.id}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-fg transition-opacity hover:opacity-90"
          >
            <MessageCircle className="size-4" aria-hidden />
            Open chat
          </Link>
        ) : null}
        {isOfficer ? (
          <Link
            href={`/events/new?club=${club.id}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-2"
          >
            <CalendarPlus className="size-4" aria-hidden />
            Plan an event
          </Link>
        ) : null}
        <MembershipActions clubId={club.id} clubName={club.name} role={myRole} />
        {isOfficer ? <ClubEditor club={club} /> : null}
      </div>

      {!isMember && channel ? (
        <p className="mt-2 text-xs text-muted">
          Join to get into{" "}
          <span className="font-mono text-foreground">#{channel.slug}</span> and
          meet the members.
        </p>
      ) : null}

      <section className="mt-8" aria-labelledby="club-events-heading">
        <h2
          id="club-events-heading"
          className="flex items-center gap-2 text-base font-semibold"
        >
          <CalendarDays className="size-4 text-muted" aria-hidden />
          Upcoming events
        </h2>
        {events.length === 0 ? (
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
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {events.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/events/${event.id}`}
                  className="block rounded-card border border-border bg-surface p-4 transition-colors hover:bg-surface-2"
                >
                  <p className="font-medium leading-snug">{event.title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                    <span className="inline-flex items-center gap-1 text-accent">
                      <CalendarDays className="size-3.5" aria-hidden />
                      {formatEventTime(event.starts_at, event.ends_at)}
                    </span>
                    {event.location ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3.5" aria-hidden />
                        {event.location}
                      </span>
                    ) : null}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8" aria-labelledby="club-members-heading">
        <h2
          id="club-members-heading"
          className="flex items-center gap-2 text-base font-semibold"
        >
          <Users className="size-4 text-muted" aria-hidden />
          Members
          <span className="font-normal text-muted">({roster.length})</span>
        </h2>
        {roster.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No members yet"
            description="Join to get this club going."
            className="py-10"
          />
        ) : (
          <div className="mt-3">
            <Roster members={roster} />
          </div>
        )}
      </section>

      {isOwner ? (
        <section
          className="mt-10 rounded-card border border-border bg-surface p-4"
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
