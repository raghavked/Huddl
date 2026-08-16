import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  BadgeCheck,
  BookOpen,
  Calendar,
  ChevronLeft,
  Coffee,
  Compass,
  GraduationCap,
  Lock,
  MapPin,
  MessageCircle,
  MessageSquare,
  Pencil,
  Tag,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import {
  Badge,
  SectionHeader,
  buttonClasses,
  cardClasses,
} from "@/components/ui";
import { PresenceLine } from "@/features/people/presence-line";
import {
  FriendButton,
  ReportPersonButton,
} from "@/features/people/profile-actions";
import { BlockPersonButton } from "@/features/settings/blocked-list";
import { getCurrentUser } from "@/lib/auth";
import { fetchFriendState, type FriendState } from "@/lib/friends";
import { roomGlyph, roomTitle } from "@/lib/room-identity";
import { createClient } from "@/lib/supabase/server";
import type { Channel, Course, Profile, University } from "@/lib/types";

type ProfileRow = Profile & {
  university: Pick<University, "short_name"> | null;
};

type SharedCourse = Pick<Course, "id" | "code" | "title">;
type SharedChannel = Pick<Channel, "id" | "name" | "slug" | "kind">;

/* A pill is too cramped for the RoomTile itself, so each shared room wears
   its kind's glyph instead. roomGlyph speaks Feather; this map is the whole
   translation to lucide for the campus purpose marks. Never the hash. */
const ROOM_PILL_GLYPHS: Record<string, LucideIcon> = {
  coffee: Coffee,
  users: Users,
  calendar: Calendar,
  tag: Tag,
  "map-pin": MapPin,
};

type EnrollmentCourseRow = { course: SharedCourse | null };
type MemberChannelRow = { channel: SharedChannel | null };

/** text[] straight off the row, kept honest before it reaches the chips. */
function interestsOf(profile: ProfileRow): string[] {
  return Array.isArray(profile.interests)
    ? profile.interests.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0
      )
    : [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  return { title: `@${decodeURIComponent(handle)}` };
}

/**
 * Public profile page. handle is citext in the database, so a plain .eq()
 * match is already case-insensitive. Shared courses fall out of RLS (classmate
 * enrollments are only visible for courses the viewer is enrolled in), but we
 * still intersect with the viewer's own rows explicitly so the page stays
 * correct, including on your own profile, where "shared" means "all yours".
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle: rawHandle } = await params;
  const handle = decodeURIComponent(rawHandle);

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*, university:universities(short_name)")
    .eq("handle", handle)
    .maybeSingle();

  // A query error is a connection blip, not a missing person. Throwing hands
  // it to the route error boundary (src/app/error.tsx), which offers a real
  // Try again, where notFound() would brand a retryable failure as a
  // permanent "this handle doesn't exist" and dead-end the reader.
  if (error) throw error;

  const profile = data as ProfileRow | null;
  if (!profile) notFound();

  const isMe = profile.id === user.userId;
  const universityName =
    profile.university?.short_name ?? user.university.short_name;

  /* Have I blocked them? Read here, before either branch renders, so the hero
     paints Message or Blocked on the first frame rather than flipping a beat
     later. One row off a primary key, and RLS only ever shows you your own. */
  let iBlocked = false;
  if (!isMe) {
    const { data: blockRow } = await supabase
      .from("blocks")
      .select("blocked_id")
      .eq("blocker_id", user.userId)
      .eq("blocked_id", profile.id)
      .maybeSingle();
    iBlocked = blockRow !== null;
  }

  /* Where the two of you stand, read here so the friend button paints its
     real state on the first frame. A failed read quietly falls back to
     "none" rather than taking the whole page down with it: the button is a
     side dish here, and sendRequest answers an already-existing edge with
     warm copy of its own. */
  let friendState: FriendState = "none";
  if (!isMe) {
    try {
      friendState = await fetchFriendState(user.userId, profile.id, {
        client: supabase,
        userId: user.userId,
      });
    } catch {
      friendState = "none";
    }
  }

  /* A block shuts the DM door both ways: `create_dm_thread` refuses across
     one, so offering Message here would be offering a dead end. Unblock sits
     beside the badge instead, for whenever they want the door back. */
  const messageButton = iBlocked ? null : (
    <Link
      href={`/messages/new?to=${profile.id}`}
      className={buttonClasses()}
    >
      <MessageCircle className="size-4" aria-hidden />
      Message
    </Link>
  );

  /* A private profile withholds the display name, so anything that says this
     person out loud (the block confirmation, the report panel, either
     button's label) uses the handle, which is the only name the viewer can
     actually see. */
  const visibleName = profile.is_public
    ? profile.display_name
    : `@${profile.handle}`;

  /* First on the action row: asking is the warmest thing this page offers.
     While you've blocked them the database refuses new edges, so a bare
     "Add friend" would be a dead end and stays off the page; an edge that
     already exists still shows its true state. */
  const friendButton =
    isMe || (iBlocked && friendState === "none") ? null : (
      <FriendButton
        personId={profile.id}
        viewerId={user.userId}
        name={visibleName}
        initialState={friendState}
      />
    );

  /* The quiet presence line, a client component because "Active today" means
     the VIEWER's calendar day and only their browser knows their midnight.
     Withheld once you've blocked someone: you asked for quiet from them, and
     that includes their comings and goings. The other direction stays as it
     is, because a profile that hid its presence only from the person who was
     blocked would be a tell. */
  const presenceLine = iBlocked ? null : (
    <PresenceLine
      lastSeenAt={profile.last_seen_at}
      shareLastSeen={profile.share_last_seen}
    />
  );

  /* Reporting and blocking are different acts and stay separately reachable:
     one asks us to look at someone, the other is what a student does for
     themselves in the meantime. Neither is a step inside the other, and a
     block is never a condition of being heard, so both sit on the action row
     regardless of which has already been used. */
  const reportButton = isMe ? null : (
    <ReportPersonButton personId={profile.id} name={visibleName} />
  );

  const blockButton = isMe ? null : (
    <BlockPersonButton
      viewerId={user.userId}
      personId={profile.id}
      name={visibleName}
      initiallyBlocked={iBlocked}
    />
  );

  /* Private profile viewed by someone else: handle + avatar only. Everything
     else on the row (name, bio, major, grad year, interests, looking_for)
     stays off this page. Interests and looking_for are profile columns like
     any other, so they're hidden here too. */
  if (!profile.is_public && !isMe) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
        <section
          aria-label={`@${profile.handle}, private profile`}
          className={cardClasses({
            padding: "lg",
            className:
              "flex animate-fade-up flex-col items-center gap-4 text-center",
          })}
        >
          <Avatar name={profile.handle} src={profile.avatar_url} size="xl" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              @{profile.handle}
            </h1>
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted">
              <Lock className="size-4" aria-hidden />
              This profile is private
            </p>
            {/* "Say hi" is only true while the door is open. Once you've
                blocked them there's no Message button under this line. */}
            <p className="mt-1 max-w-sm text-sm text-muted text-pretty">
              {iBlocked
                ? "Only their handle and avatar are visible, and you've blocked them, so nothing of theirs reaches you anyway."
                : "Only their handle and avatar are visible, but you can still say hi."}
            </p>
          </div>
          {/* Reporting and blocking belong here too, and arguably most of
              all: a private profile is often the only page you have on
              someone who has started bothering you. */}
          <div className="flex flex-col items-center gap-3">
            {friendButton}
            {messageButton}
            {reportButton}
            {blockButton}
          </div>
        </section>
      </div>
    );
  }

  const [theirCoursesRes, myCoursesRes, theirChannelsRes, myChannelsRes] =
    await Promise.all([
      supabase
        .from("enrollments")
        .select("course:courses(id, code, title)")
        .eq("user_id", profile.id),
      supabase.from("enrollments").select("course_id").eq("user_id", user.userId),
      supabase
        .from("channel_members")
        .select("channel:channels(id, name, slug, kind)")
        .eq("user_id", profile.id),
      supabase
        .from("channel_members")
        .select("channel_id")
        .eq("user_id", user.userId),
    ]);

  const myCourseIds = new Set(
    ((myCoursesRes.data ?? []) as { course_id: string }[]).map(
      (r) => r.course_id
    )
  );
  const myChannelIds = new Set(
    ((myChannelsRes.data ?? []) as { channel_id: string }[]).map(
      (r) => r.channel_id
    )
  );

  const sharedCourses = (
    (theirCoursesRes.data ?? []) as unknown as EnrollmentCourseRow[]
  )
    .map((r) => r.course)
    .filter((c): c is SharedCourse => c !== null && myCourseIds.has(c.id))
    .sort((a, b) => a.code.localeCompare(b.code));

  const sharedChannels = (
    (theirChannelsRes.data ?? []) as unknown as MemberChannelRow[]
  )
    .map((r) => r.channel)
    .filter(
      (c): c is SharedChannel =>
        c !== null && c.kind === "campus" && myChannelIds.has(c.id)
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const firstName = profile.display_name.split(/\s+/)[0] ?? profile.handle;
  const interests = interestsOf(profile);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <Link
        href="/people"
        className="mb-3 inline-flex items-center gap-1 rounded-full text-sm font-semibold text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
      >
        <ChevronLeft className="size-4" aria-hidden />
        People
      </Link>

      {/* Hero */}
      <section
        className={cardClasses({ padding: "lg", className: "animate-fade-up" })}
      >
        <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-start sm:text-left">
          <Avatar
            name={profile.display_name}
            src={profile.avatar_url}
            size="xl"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <h1 className="text-2xl font-bold tracking-tight">
                {profile.display_name}
              </h1>
              {profile.verified_at ? (
                <Badge tone="success" title="Phone number verified">
                  <BadgeCheck className="size-3.5" aria-hidden />
                  Verified
                </Badge>
              ) : null}
              {isMe && !profile.is_public ? (
                <Badge tone="neutral" title="Only you can see your full profile">
                  <Lock className="size-3" aria-hidden />
                  Private
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted">
              @{profile.handle} · {universityName}
            </p>
            {presenceLine}
            {profile.major || profile.grad_year ? (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 sm:justify-start">
                {profile.major ? (
                  <Badge tone="neutral">
                    <GraduationCap className="size-3.5" aria-hidden />
                    {profile.major}
                  </Badge>
                ) : null}
                {profile.grad_year ? (
                  <Badge tone="neutral">Class of {profile.grad_year}</Badge>
                ) : null}
              </div>
            ) : null}
            {profile.bio ? (
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">
                {profile.bio}
              </p>
            ) : null}
            {/* The one line on this page somebody can act on, so it gets the
                ember and sits directly above the button that answers it. */}
            {profile.looking_for ? (
              <div className="mt-4 rounded-xl bg-brand-soft px-4 py-3 text-left">
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-ink">
                  <Compass className="size-3.5 text-brand" aria-hidden />
                  Looking for
                </p>
                <p className="mt-1 font-semibold text-brand-ink text-pretty">
                  {profile.looking_for}
                </p>
              </div>
            ) : null}
            {/* Message, Report and Block sit on one line until one of the
                panels opens; both are full-width, so they wrap onto their own
                row and the question isn't crowded by the button that raised
                it. */}
            <div className="mt-5 flex flex-wrap items-start justify-center gap-3 sm:justify-start">
              {isMe ? (
                <Link
                  href="/settings/account"
                  className={buttonClasses({ variant: "secondary" })}
                >
                  <Pencil className="size-4" aria-hidden />
                  Edit profile
                </Link>
              ) : (
                <>
                  {friendButton}
                  {messageButton}
                  {reportButton}
                  {blockButton}
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Interests, hidden entirely on someone else's profile when they
          haven't added any; on your own it's an invitation. */}
      {isMe || interests.length > 0 ? (
        <section
          className="mt-8"
          aria-label={isMe ? "What you're into" : `What ${firstName}'s into`}
        >
          <SectionHeader
            title={isMe ? "What you're into" : `What ${firstName}'s into`}
          />
          {interests.length === 0 ? (
            <div className="mt-3 rounded-card border border-dashed border-border">
              <EmptyState
                className="py-10"
                icon={Compass}
                title="Nothing on here yet"
                description={
                  profile.looking_for
                    ? "Add a few things you're into. It's how classmates spot the overlap."
                    : "A few things you're into, plus a line on what you're looking for, is how classmates know where to start."
                }
                action={
                  <Link
                    href="/settings/account"
                    className={buttonClasses({
                      variant: "secondary",
                      size: "sm",
                    })}
                  >
                    Edit profile
                  </Link>
                }
              />
            </div>
          ) : (
            /* Each chip is a way into the directory: "she's into intramurals
               too" is one click from the people who are. */
            <ul className="mt-3 flex flex-wrap gap-2">
              {interests.map((interest) => (
                <li key={interest}>
                  <Link
                    href={`/people?interest=${encodeURIComponent(interest)}`}
                    title={`Everyone into ${interest}`}
                    className="inline-flex min-h-11 items-center rounded-full bg-brand-soft px-3.5 text-sm font-semibold text-brand-ink transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    {interest}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* Shared courses */}
      <section
        className="mt-8"
        aria-label={isMe ? "Your courses" : "Courses together"}
      >
        <SectionHeader title={isMe ? "Your courses" : "Courses together"} />
        {sharedCourses.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-border">
            <EmptyState
              className="py-10"
              icon={BookOpen}
              title={isMe ? "No courses yet" : "No courses together"}
              description={
                isMe
                  ? "Add your classes to get course chat and shared notes."
                  : `You and ${firstName} don't share any courses this term.`
              }
              action={
                isMe ? (
                  <Link
                    href="/setup"
                    className={buttonClasses({
                      variant: "secondary",
                      size: "sm",
                    })}
                  >
                    Add your classes
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {sharedCourses.map((course) => (
              <li key={course.id}>
                <Link
                  href={`/courses/${course.id}`}
                  title={course.title}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-sm font-semibold text-brand-ink transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <BookOpen className="size-3.5" aria-hidden />
                  {course.code}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Campus channels in common */}
      <section
        className="mt-8"
        aria-label={isMe ? "Your campus channels" : "Campus channels in common"}
      >
        <SectionHeader
          title={isMe ? "Your campus channels" : "Campus channels in common"}
        />
        {sharedChannels.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-border">
            <EmptyState
              className="py-10"
              icon={MessageSquare}
              title={
                isMe ? "No campus rooms yet" : "No channels in common"
              }
              description={
                isMe
                  ? "Browse the campus rooms and join the conversations you care about."
                  : `No campus channels in common with ${firstName} yet.`
              }
              action={
                isMe ? (
                  <Link
                    href="/channels/browse"
                    className={buttonClasses({
                      variant: "secondary",
                      size: "sm",
                    })}
                  >
                    Browse rooms
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {sharedChannels.map((channel) => {
              const glyph = roomGlyph(channel.kind, channel.slug);
              const Glyph = glyph ? ROOM_PILL_GLYPHS[glyph] : null;
              return (
                <li key={channel.id}>
                  <Link
                    href={`/channels/${channel.id}`}
                    className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent transition-colors hover:bg-accent hover:text-brand-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {Glyph ? (
                      <Glyph className="size-3.5" aria-hidden />
                    ) : null}
                    {roomTitle(channel.name, channel.slug)}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
