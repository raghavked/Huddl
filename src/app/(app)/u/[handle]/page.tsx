import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  BadgeCheck,
  BookOpen,
  ChevronLeft,
  Compass,
  GraduationCap,
  Hash,
  Lock,
  MessageCircle,
  Pencil,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import {
  Badge,
  SectionHeader,
  buttonClasses,
  cardClasses,
} from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Channel, Course, Profile, University } from "@/lib/types";

type ProfileRow = Profile & {
  university: Pick<University, "short_name"> | null;
};

type SharedCourse = Pick<Course, "id" | "code" | "title">;
type SharedChannel = Pick<Channel, "id" | "name" | "kind">;

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
 * correct — including on your own profile, where "shared" means "all yours".
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
  const { data } = await supabase
    .from("profiles")
    .select("*, university:universities(short_name)")
    .eq("handle", handle)
    .maybeSingle();

  const profile = data as ProfileRow | null;
  if (!profile) notFound();

  const isMe = profile.id === user.userId;
  const universityName =
    profile.university?.short_name ?? user.university.short_name;

  const messageButton = (
    <Link
      href={`/messages/new?to=${profile.id}`}
      className={buttonClasses()}
    >
      <MessageCircle className="size-4" aria-hidden />
      Message
    </Link>
  );

  /* Private profile viewed by someone else: handle + avatar only. Everything
     else on the row — name, bio, major, grad year, interests, looking_for —
     stays off this page. Interests and looking_for are profile columns like
     any other, so they're hidden here too. */
  if (!profile.is_public && !isMe) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
        <section
          aria-label={`@${profile.handle} — private profile`}
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
            <p className="mt-1 max-w-sm text-sm text-muted text-pretty">
              Only their handle and avatar are visible, but you can still say
              hi.
            </p>
          </div>
          {messageButton}
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
        .select("channel:channels(id, name, kind)")
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
              {profile.phone_verified_at ? (
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
            <div className="mt-5 flex justify-center sm:justify-start">
              {isMe ? (
                <Link
                  href="/settings/account"
                  className={buttonClasses({ variant: "secondary" })}
                >
                  <Pencil className="size-4" aria-hidden />
                  Edit profile
                </Link>
              ) : (
                messageButton
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Interests — hidden entirely on someone else's profile when they
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
                    ? "Add a few things you're into — it's how classmates spot the overlap."
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
                  ? "Add your classes to unlock course chat and notes."
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
              icon={Hash}
              title={
                isMe ? "No campus channels yet" : "No channels in common"
              }
              description={
                isMe
                  ? "Browse the campus channels and join the conversations you care about."
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
                    Browse channels
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {sharedChannels.map((channel) => (
              <li key={channel.id}>
                <Link
                  href={`/channels/${channel.id}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent transition-colors hover:bg-accent hover:text-brand-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <Hash className="size-3.5" aria-hidden />
                  {channel.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
