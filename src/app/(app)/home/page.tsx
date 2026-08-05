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

function SectionHeading({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-muted">
        {title}
      </h2>
      {href && linkLabel ? (
        <Link
          href={href}
          className="text-xs font-semibold text-accent hover:underline"
        >
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}

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
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-2xl font-bold">Hey {firstName}</h1>
        <span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-strong">
          {user.university.short_name}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">
        Here&apos;s what&apos;s happening on campus.
      </p>

      {/* 1 — campus channels I'm in, with latest-message previews */}
      <section className="mt-8" aria-label="Your campus">
        <SectionHeading
          title="Your campus"
          href="/channels"
          linkLabel="All channels"
        />
        {campusChannels.length === 0 ? (
          <div className="mt-3 rounded-card border border-border bg-surface">
            <EmptyState
              icon={Megaphone}
              title="No campus channels yet"
              description="Campus channels usually come free with your profile — browse to find and join them."
              action={
                <Link
                  href="/channels/browse"
                  className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  Browse channels
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {campusChannels.map((channel) => {
              const preview = previews.get(channel.id);
              const authorFirst =
                preview?.author?.display_name.trim().split(/\s+/)[0] ??
                "Someone";
              return (
                <li key={channel.id}>
                  <Link
                    href={`/channels/${channel.id}`}
                    className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-strong">
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
        <SectionHeading title="Your courses" />
        {courseChannels.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-border">
            <EmptyState
              icon={GraduationCap}
              title="No courses yet"
              description="Connect Canvas or add your schedule and you'll get a chat channel for every class."
              action={
                <Link
                  href="/setup"
                  className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
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
                    className="flex h-full flex-col gap-1 rounded-card border border-border bg-surface p-4 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
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
        <SectionHeading title="Coming up" href="/events" linkLabel="All events" />
        {events.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-border p-4 text-sm text-muted">
            Nothing on the calendar yet.{" "}
            <Link
              href="/events"
              className="font-semibold text-accent hover:underline"
            >
              Browse events
            </Link>{" "}
            or plan a study session of your own.
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {events.map((event) => (
              <li key={event.id}>
                <Link
                  href="/events"
                  className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
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
                  <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-muted">
                    {event.kind === "study_session" ? "Study session" : "Meetup"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4 — topic channels I haven't joined */}
      <section className="mt-8" aria-label="Discover">
        <SectionHeading title="Discover" />
        {discover.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-border p-4 text-sm text-muted">
            Nothing new to discover right now — you&apos;re in on everything.{" "}
            <Link
              href="/channels/new"
              className="font-semibold text-accent hover:underline"
            >
              Start the next big channel
            </Link>
            .
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {discover.map((channel) => (
              <li
                key={channel.id}
                className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-strong">
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
        <div className="mt-3 flex items-center gap-4 px-1">
          <Link
            href="/channels/browse"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
          >
            <Compass className="size-4" aria-hidden />
            Browse all channels
          </Link>
          <Link
            href="/channels/new"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
          >
            <Plus className="size-4" aria-hidden />
            Start your own
          </Link>
        </div>
      </section>
    </div>
  );
}
