import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  BadgeCheck,
  BookOpen,
  GraduationCap,
  Hash,
  Lock,
  MessageCircle,
  Pencil,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
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

  // Private profile viewed by someone else: handle + avatar only.
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

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
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
                <Badge tone="accent" title="Phone number verified">
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

      {/* Shared courses */}
      <section
        className="mt-8"
        aria-label={isMe ? "Your courses" : "Courses together"}
      >
        <SectionHeader title={isMe ? "Your courses" : "Courses together"} />
        {sharedCourses.length === 0 ? (
          <p className="mt-3 px-1 text-sm text-muted">
            {isMe ? (
              <>
                You haven&apos;t added any courses yet.{" "}
                <Link
                  href="/setup"
                  className="font-semibold text-accent hover:underline"
                >
                  Add your classes
                </Link>{" "}
                to unlock course chat and notes.
              </>
            ) : (
              `You and ${firstName} don't share any courses this term.`
            )}
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {sharedCourses.map((course) => (
              <li key={course.id}>
                <Link
                  href={`/courses/${course.id}`}
                  title={course.title}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-sm font-semibold text-brand-strong transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
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
          <p className="mt-3 px-1 text-sm text-muted">
            {isMe ? (
              <>
                You&apos;re not in any campus channels yet.{" "}
                <Link
                  href="/channels/browse"
                  className="font-semibold text-accent hover:underline"
                >
                  Browse channels
                </Link>
              </>
            ) : (
              `No campus channels in common with ${firstName} yet.`
            )}
          </p>
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
