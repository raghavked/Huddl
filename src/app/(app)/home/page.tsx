import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarDays,
  ChevronRight,
  Compass,
  GraduationCap,
  ListChecks,
  Megaphone,
  Plus,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { RoomTile } from "@/components/room-tile";
import {
  PageHeader,
  SectionHeader,
  buttonClasses,
  cardClasses,
} from "@/components/ui";
import { KindBadge } from "@/features/events/event-chips";
import { JoinButton } from "@/features/discover/join-button";
import { TodayStrip } from "@/features/home/today-strip";
import type { PlanItemRow } from "@/features/study/plan-section";
import { getCurrentUser } from "@/lib/auth";
import { roomTitle } from "@/lib/room-identity";
import { buildPlan, toPlanKind, type PlanItem } from "@/lib/study-plan";
import { createClient } from "@/lib/supabase/server";
import { formatEventTime, formatMessageTime } from "@/lib/utils";
import type { CampusEvent, Channel, Course } from "@/lib/types";

export const metadata: Metadata = { title: "Home" };

type ChannelRow = Channel & {
  course: Pick<Course, "id" | "code" | "title"> | null;
};

/**
 * `is_public` rides along because nothing in the database withholds a private
 * student's name. See {@link authorFirstName}, which is the whole of the
 * redaction on this surface.
 */
type MessagePreview = {
  content: string;
  created_at: string;
  author: {
    id: string;
    handle: string;
    display_name: string;
    is_public: boolean;
  } | null;
};

/**
 * The one word a preview line calls whoever spoke last. A classmate with
 * Public profile off stands under their handle here, the same way the board,
 * the people directory and in-channel search read them, and it fails closed:
 * anything other than an explicit `is_public: true` counts as private, so a
 * select that loses the column redacts rather than leaks. You always see
 * yourself in full.
 */
function authorFirstName(
  author: MessagePreview["author"],
  viewerId: string
): string {
  if (!author) return "Someone";
  const locked = author.id !== viewerId && author.is_public !== true;
  if (locked) return author.handle;
  return author.display_name.trim().split(/\s+/)[0] || author.handle;
}

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const [membershipRes, eventsRes, topicsRes, enrollRes, blocksRes] =
    await Promise.all([
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
      supabase
        .from("enrollments")
        .select("course:courses(id, code)")
        .eq("user_id", user.userId),
      // Everyone this student has blocked. It travels with the opening trip
      // because the channel previews are asked for against it, and RLS on
      // `blocks` scopes the read to the reader, so `blocker_id` is the only
      // filter it needs.
      supabase
        .from("blocks")
        .select("blocked_id")
        .eq("blocker_id", user.userId),
    ]);

  // The study-plan card: shared class calendars + private check-offs,
  // crunched by the same pure lib the /plan page uses. Same one-week-back
  // window, so the numbers here match the plan page exactly.
  const planCourses = (
    (enrollRes.data ?? []) as unknown as {
      course: { id: string; code: string } | null;
    }[]
  )
    .map((row) => row.course)
    .filter((c): c is { id: string; code: string } => c !== null);
  let planStats: ReturnType<typeof buildPlan>["stats"] | null = null;
  let planRows: PlanItemRow[] = [];
  let checkedIds: string[] = [];
  if (planCourses.length > 0) {
    const codeById = new Map(planCourses.map((c) => [c.id, c.code]));
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [itemsRes, checksRes] = await Promise.all([
      supabase
        .from("course_calendar_items")
        .select("id, course_id, kind, title, due_at")
        .in("course_id", [...codeById.keys()])
        .gte("due_at", since),
      supabase
        .from("study_checkoffs")
        .select("item_id")
        .eq("user_id", user.userId),
    ]);
    planRows = (
      (itemsRes.data ?? []) as {
        id: string;
        course_id: string;
        kind: string;
        title: string;
        due_at: string;
      }[]
    ).map((row) => ({
      id: row.id,
      courseCode: codeById.get(row.course_id) ?? "Course",
      kind: row.kind,
      title: row.title,
      due_at: row.due_at,
    }));
    checkedIds = ((checksRes.data ?? []) as { item_id: string }[]).map(
      (row) => row.item_id
    );
    // Only the headline stats are settled here: they're counts plus the
    // earliest unhandled item, so no calendar day comes into it and the
    // server's zone can't colour them. The Today strip does need a day, so
    // it gets the same rows and works them out in the browser.
    const planItems = planRows.map(
      (row): PlanItem => ({
        id: row.id,
        courseCode: row.courseCode,
        kind: toPlanKind(row.kind),
        title: row.title,
        dueAt: new Date(row.due_at),
      })
    );
    planStats = buildPlan(planItems, new Set(checkedIds), new Date()).stats;
  }

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

  /* Latest readable message per campus/course channel: one tiny indexed
     lookup each (messages has a (channel_id, created_at desc) index), run in
     parallel.

     "Readable" includes the block list, and a blocked classmate is excluded
     IN the query rather than dropped from the answer, so a channel whose
     newest message is theirs falls back to the newest one this student can
     actually see, instead of the row going quiet.

     A `blocks` read that didn't land leaves this null rather than empty: with
     no set to cut against, any preview could be quoting someone the rooms
     themselves hide. The rows then carry no second line at all, which is the
     one honest option. "No messages yet" would be a claim about a channel we
     never looked in. */
  let previews: Map<string, MessagePreview> | null = null;
  if (!blocksRes.error) {
    const hidden = ((blocksRes.data ?? []) as { blocked_id: string }[]).map(
      (row) => row.blocked_id
    );
    const found = new Map<string, MessagePreview>();
    await Promise.all(
      [...campusChannels, ...courseChannels].map(async (channel) => {
        let query = supabase
          .from("messages")
          .select(
            "content, created_at, author:profiles!messages_author_id_fkey(id, handle, display_name, is_public)"
          )
          .eq("channel_id", channel.id)
          .is("deleted_at", null);
        // `not.in.()` is not a filter PostgREST will take, so an empty block
        // list simply doesn't add one.
        if (hidden.length > 0) {
          query = query.not("author_id", "in", `(${hidden.join(",")})`);
        }
        const { data } = await query
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data) found.set(channel.id, data as unknown as MessagePreview);
      })
    );
    previews = found;
  }

  const firstName =
    user.profile.display_name.trim().split(/\s+/)[0] || user.profile.handle;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        title={`Hey ${firstName}`}
        description="Here's what's happening on campus."
      />

      {/* 0: today at a glance, only when today actually holds something.
          Drawn in the browser: what counts as "today" is the student's day,
          not the server's. */}
      <TodayStrip
        nowIso={nowIso}
        items={planRows}
        checkedIds={checkedIds}
        events={events.map((event) => ({
          title: event.title,
          starts_at: event.starts_at,
        }))}
      />

      {/* 1: the study plan, when there are classes to plan around */}
      {planStats ? (
        <section className="mt-8" aria-label="Your plan">
          <SectionHeader title="Your plan" />
          <Link
            href="/plan"
            className={cardClasses({
              padding: "none",
              interactive: true,
              className: "mt-3 flex items-center gap-3 px-4 py-3",
            })}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <ListChecks className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {planStats.total === 0
                  ? "Nothing on your plan yet"
                  : planStats.nextUp
                    ? `Next up: ${planStats.nextUp.courseCode} ${planStats.nextUp.title}`
                    : "All caught up. Go touch grass."}
              </span>
              <span className="block truncate text-xs text-muted">
                {planStats.total === 0
                  ? "Import a syllabus and your whole term plans itself"
                  : `${planStats.handled} of ${planStats.total} handled`}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
          </Link>
        </section>
      ) : null}

      {/* 2: campus channels I'm in, with latest-message previews */}
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
              title="No campus rooms yet"
              description="Campus rooms usually come free with your profile."
              action={
                <Link
                  href="/channels/browse"
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                >
                  Browse rooms
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2.5">
            {campusChannels.map((channel) => {
              const preview = previews?.get(channel.id);
              const authorFirst = preview
                ? authorFirstName(preview.author, user.userId)
                : null;
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
                    <RoomTile
                      kind={channel.kind}
                      name={channel.name}
                      slug={channel.slug}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold">
                          {roomTitle(channel.name, channel.slug)}
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
                        ) : previews ? (
                          "No messages yet. Say hi."
                        ) : null}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 3: course channels grid */}
      <section className="mt-8" aria-label="Your courses">
        <SectionHeader title="Your courses" />
        {courseChannels.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-border">
            <EmptyState
              icon={GraduationCap}
              title="No courses yet"
              description="Add your classes and each one opens its own chat. The campus catalog fills in the details as you type."
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
              const preview = previews?.get(channel.id);
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
                        : previews
                          ? "No messages yet"
                          : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 4: next events at my university */}
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

      {/* 5: topic channels I haven't joined */}
      <section className="mt-8" aria-label="Discover">
        <SectionHeader title="Discover" />
        {discover.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-border">
            <EmptyState
              className="py-10"
              icon={Compass}
              title="You're in on everything"
              description="Nothing new to discover right now. Maybe it's time to start the next big channel."
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
                <RoomTile
                  kind={channel.kind}
                  name={channel.name}
                  slug={channel.slug}
                  size="sm"
                />
                <Link
                  href={`/channels/${channel.id}`}
                  className="min-w-0 flex-1 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <span className="block truncate text-sm font-semibold">
                    {roomTitle(channel.name, channel.slug)}
                  </span>
                  {channel.description ? (
                    <span className="line-clamp-2 text-xs text-muted">
                      {channel.description}
                    </span>
                  ) : null}
                </Link>
                <JoinButton
                  channelId={channel.id}
                  channelName={roomTitle(channel.name, channel.slug)}
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
