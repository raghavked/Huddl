import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarDays,
  Compass,
  GraduationCap,
  Hash,
  Megaphone,
  Plus,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  PageHeader,
  SectionHeader,
  buttonClasses,
  cardClasses,
} from "@/components/ui";
import { KindBadge } from "@/features/events/event-chips";
import { JoinButton } from "@/features/discover/join-button";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatEventTime, formatMessageTime } from "@/lib/utils";
import type { CampusEvent, Channel, Course } from "@/lib/types";

export const metadata: Metadata = { title: "Home" };

type ChannelRow = Channel & {
  course: Pick<Course, "id" | "code" | "title"> | null;
};

type MessagePreview = {
  content: string;
  created_at: string;
  author: { display_name: string } | null;
};

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const [membershipRes, eventsRes, topicsRes] = await Promise.all([
    supabase
      .from("channel_members")
      .select("channel:channels(*, course:courses(id, code, title))")
      .eq("user_id", user.userId),
    supabase
      .from("events")
      .select("*")
      .eq("university_id", user.university.id)
      .gte("starts_at", nowIso)
      .order("starts_at", { ascending: true })
      .limit(4),
    supabase
      .from("channels")
      .select("*")
      .eq("university_id", user.university.id)
      .eq("kind", "topic")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const myChannels = (
    (membershipRes.data ?? []) as unknown as { channel: ChannelRow | null }[]
  )
    .map((row) => row.channel)
    .filter((c): c is ChannelRow => Boolean(c));

  const campusChannels = myChannels
    .filter((c) => c.kind === "campus")
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const courseChannels = myChannels
    .filter((c) => c.kind === "course")
    .sort((a, b) =>
      (a.course?.code ?? a.name).localeCompare(b.course?.code ?? b.name)
    );

  const events = (eventsRes.data ?? []) as CampusEvent[];

  const joinedIds = new Set(myChannels.map((c) => c.id));
  const discover = ((topicsRes.data ?? []) as Channel[])
    .filter((c) => !joinedIds.has(c.id))
    .slice(0, 5);

  // Latest message per campus/course channel: one tiny indexed lookup each
  // (messages has a (channel_id, created_at desc) index), run in parallel.
  const previews = new Map<string, MessagePreview>();
  await Promise.all(
    [...campusChannels, ...courseChannels].map(async (channel) => {
      const { data } = await supabase
        .from("messages")
        .select("content, created_at, author:profiles(display_name)")
        .eq("channel_id", channel.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) previews.set(channel.id, data as unknown as MessagePreview);
    })
  );

  const firstName =
    user.profile.display_name.trim().split(/\s+/)[0] || user.profile.handle;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        title={`Hey ${firstName}`}
        description="Here's what's happening on campus."
      />

      {/* 1 — campus channels I'm in, with latest-message previews */}
      <section className="mt-8" aria-label="Your campus">
        <SectionHeader
          title="Your campus"
          href="/channels"
          linkLabel="All channels"
        />
        {campusChannels.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-border">
            <EmptyState
              icon={Megaphone}
              title="No campus channels yet"
              description="Campus channels usually come free with your profile — browse to find and join them."
              action={
                <Link
                  href="/channels/browse"
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                >
                  Browse channels
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2.5">
            {campusChannels.map((channel) => {
              const preview = previews.get(channel.id);
              const authorFirst =
                preview?.author?.display_name.trim().split(/\s+/)[0] ??
                "Someone";
              return (
                <li key={channel.id}>
                  <Link
                    href={`/channels/${channel.id}`}
                    className={cardClasses({
                      padding: "none",
                      interactive: true,
                      className: "flex items-center gap-3 px-4 py-3",
                    })}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                      <Megaphone className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold">
                          #{channel.slug}
                        </span>
                        {preview ? (
                          <span className="shrink-0 text-xs text-muted">
                            {formatMessageTime(preview.created_at)}
                          </span>
                        ) : null}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {preview ? (
                          <>
                            <span className="font-medium text-foreground">
                              {authorFirst}:
                            </span>{" "}
                            {preview.content}
                          </>
                        ) : (
                          "No messages yet — say hi!"
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 2 — course channels grid */}
      <section className="mt-8" aria-label="Your courses">
        <SectionHeader title="Your courses" />
        {courseChannels.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-border">
            <EmptyState
              icon={GraduationCap}
              title="No courses yet"
              description="Connect Canvas or add your schedule and you'll get a chat channel for every class."
              action={
                <Link href="/setup" className={buttonClasses({ size: "sm" })}>
                  Set up your courses
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {courseChannels.map((channel) => {
              const preview = previews.get(channel.id);
              return (
                <li key={channel.id}>
                  <Link
                    href={`/channels/${channel.id}`}
                    className={cardClasses({
                      padding: "sm",
                      interactive: true,
                      className: "flex h-full flex-col gap-1",
                    })}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-bold">
                      <GraduationCap
                        className="size-4 shrink-0 text-brand"
                        aria-hidden
                      />
                      <span className="truncate">
                        {channel.course?.code ?? channel.name}
                      </span>
                    </span>
                    {channel.course?.title ? (
                      <span className="truncate text-xs text-muted">
                        {channel.course.title}
                      </span>
                    ) : null}
                    <span className="mt-auto pt-1 text-xs text-muted">
                      {preview
                        ? `Active ${formatMessageTime(preview.created_at)}`
                        : "No messages yet"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 3 — next events at my university */}
      <section className="mt-8" aria-label="Coming up">
        <SectionHeader title="Coming up" href="/events" linkLabel="All events" />
        {events.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-border">
            <EmptyState
              className="py-10"
              icon={CalendarDays}
              title="Nothing on the calendar yet"
              description="Browse what's coming up, or plan a study session of your own."
              action={
                <Link
                  href="/events"
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                >
                  Browse events
                </Link>
              }
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
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <CalendarDays className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {event.title}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {formatEventTime(event.starts_at, event.ends_at)}
                      {event.location ? ` · ${event.location}` : ""}
                    </span>
                  </span>
                  <KindBadge kind={event.kind} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4 — topic channels I haven't joined */}
      <section className="mt-8" aria-label="Discover">
        <SectionHeader title="Discover" />
        {discover.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-border">
            <EmptyState
              className="py-10"
              icon={Hash}
              title="You're in on everything"
              description="Nothing new to discover right now — maybe it's time to start the next big channel."
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2.5">
            {discover.map((channel) => (
              <li
                key={channel.id}
                className={cardClasses({
                  padding: "none",
                  className: "flex items-center gap-3 px-4 py-3",
                })}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <Hash className="size-5" aria-hidden />
                </span>
                <Link
                  href={`/channels/${channel.id}`}
                  className="min-w-0 flex-1 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <span className="block truncate text-sm font-semibold">
                    #{channel.slug}
                  </span>
                  {channel.description ? (
                    <span className="line-clamp-2 text-xs text-muted">
                      {channel.description}
                    </span>
                  ) : null}
                </Link>
                <JoinButton
                  channelId={channel.id}
                  channelName={`#${channel.slug}`}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex items-center gap-3 px-1">
          <Link
            href="/channels/browse"
            className={buttonClasses({
              variant: "secondary",
              size: "sm",
              className: "gap-1.5",
            })}
          >
            <Compass className="size-4" aria-hidden />
            Browse all channels
          </Link>
          <Link
            href="/channels/new"
            className={buttonClasses({
              variant: "ghost",
              size: "sm",
              className: "gap-1.5",
            })}
          >
            <Plus className="size-4" aria-hidden />
            Start your own
          </Link>
        </div>
      </section>
    </div>
  );
}
