import { Suspense } from "react";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  GraduationCap,
  Hash,
  Lock,
  Megaphone,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Badge, Card, buttonClasses } from "@/components/ui";
import { ChatRoom, JoinChannelButton } from "@/features/chat/chat-room";
import { MessageSearch } from "@/features/chat/message-search";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  Channel,
  ChannelMember,
  Course,
  MessageWithAuthor,
} from "@/lib/types";

type ChannelRow = Channel & {
  course: Pick<Course, "id" | "code" | "title"> | null;
};

const KIND_ICONS: Record<Channel["kind"], LucideIcon> = {
  campus: Megaphone,
  course: GraduationCap,
  topic: Hash,
  club: UsersRound,
};

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const { channelId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: channelData } = await supabase
    .from("channels")
    .select("*, course:courses(id, code, title)")
    .eq("id", channelId)
    .maybeSingle();
  const channel = channelData as ChannelRow | null;

  // RLS hides channels from other universities, so "not found" covers both
  // bad ids and other campuses.
  if (!channel) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
        <EmptyState
          icon={Lock}
          title="Channel not available"
          description="This channel doesn't exist, or it belongs to another campus."
          action={
            <Link href="/channels" className={buttonClasses({ size: "sm" })}>
              Back to your channels
            </Link>
          }
        />
      </div>
    );
  }

  const { data: membershipData } = await supabase
    .from("channel_members")
    .select("*")
    .eq("channel_id", channelId)
    .eq("user_id", user.userId)
    .maybeSingle();
  const membership = membershipData as ChannelMember | null;

  if (!membership) {
    // Campus + topic channels are open to anyone at the university — offer a
    // one-tap join. Course/club channels are managed by enrollment/membership.
    if (channel.kind === "campus" || channel.kind === "topic") {
      async function joinChannel() {
        "use server";
        const sb = await createClient();
        const {
          data: { user: authUser },
        } = await sb.auth.getUser();
        if (!authUser) redirect("/login");
        // RLS limits this to the student's own row at their own university;
        // a duplicate join is a no-op error we can safely ignore.
        await sb
          .from("channel_members")
          .insert({ channel_id: channelId, user_id: authUser.id });
        revalidatePath(`/channels/${channelId}`);
      }

      const KindIcon = KIND_ICONS[channel.kind];
      return (
        <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
          <Card padding="lg" className="animate-fade-up text-center">
            <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
              <KindIcon className="size-6" aria-hidden />
            </span>
            <h1 className="mt-3 text-lg font-bold tracking-tight">
              #{channel.slug}
            </h1>
            {channel.description ? (
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted text-pretty">
                {channel.description}
              </p>
            ) : null}
            <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-muted">
              {channel.kind === "campus" ? "Campus channel" : "Topic channel"} ·
              open to everyone at your school
            </p>
            <form action={joinChannel} className="mt-5">
              <JoinChannelButton />
            </form>
            <Link
              href="/channels"
              className="mt-4 inline-block text-sm font-semibold text-accent hover:underline"
            >
              Back to your channels
            </Link>
          </Card>
        </div>
      );
    }

    const isCourse = channel.kind === "course";
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
        <EmptyState
          icon={isCourse ? GraduationCap : UsersRound}
          title={isCourse ? "This is a course channel" : "This is a club channel"}
          description={
            isCourse
              ? "Course channels are joined automatically from your schedule. Add this course and you're in."
              : "Join the club and its channel comes with it."
          }
          action={
            <Link
              href={isCourse ? "/setup" : "/clubs"}
              className={buttonClasses({ size: "sm" })}
            >
              {isCourse ? "Add your courses" : "Explore clubs"}
            </Link>
          }
        />
      </div>
    );
  }

  const [{ data: messageRows }, { count: memberCount }] = await Promise.all([
    supabase
      .from("messages")
      .select(
        "*, author:profiles(id, handle, display_name, avatar_url, phone_verified_at, major, grad_year, is_public, university_id)"
      )
      .eq("channel_id", channelId)
      .is("parent_id", null)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("channel_members")
      .select("user_id", { count: "exact", head: true })
      .eq("channel_id", channelId),
  ]);
  const initialMessages = (
    (messageRows ?? []) as unknown as MessageWithAuthor[]
  ).reverse();

  const KindIcon = KIND_ICONS[channel.kind];

  return (
    <div className="mx-auto flex h-[calc(100dvh-8.5rem)] max-w-3xl flex-col px-4 md:h-[calc(100dvh-5rem)]">
      <header className="relative flex shrink-0 items-center gap-3 border-b border-border py-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <KindIcon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold tracking-tight">
            {channel.kind === "course" ? channel.name : `#${channel.slug}`}
          </h1>
          {channel.course_id ? (
            <Link
              href={`/courses/${channel.course_id}`}
              className="flex w-fit items-center gap-1 text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
            >
              <GraduationCap className="size-3.5" aria-hidden />
              Course hub · notes &amp; classmates
            </Link>
          ) : channel.description ? (
            <p className="truncate text-xs text-muted">{channel.description}</p>
          ) : null}
        </div>
        <MessageSearch channelId={channel.id} />
        <Badge tone="neutral" title={`${memberCount ?? 0} members`}>
          <Users className="size-3.5" aria-hidden />
          {memberCount ?? 0}
          <span className="sr-only">members</span>
        </Badge>
      </header>
      <Suspense fallback={null}>
        <ChatRoom
          channel={channel}
          membership={membership}
          profile={user.profile}
          userId={user.userId}
          initialMessages={initialMessages}
        />
      </Suspense>
    </div>
  );
}
