import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, MessageCircle, UserRoundSearch } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ChatScene } from "@/components/illustrations";
import { PageHeader, buttonClasses } from "@/components/ui";
import { ThreadListItem } from "@/features/dm/thread-list-item";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { DmMessage, DmThread, Profile } from "@/lib/types";

/** My side of each thread, with the thread's created_at as an activity floor. */
type MyParticipantRow = {
  thread_id: string;
  last_read_at: string;
  thread: Pick<DmThread, "created_at"> | null;
};

type OtherParticipantRow = {
  thread_id: string;
  profile: Profile | null;
};

/** Friendly copy for the ?error= codes set by /messages/new. */
const ERROR_COPY: Record<string, string> = {
  self: "You can't start a conversation with yourself.",
  "no-user": "That person doesn't seem to be on Huddl.",
  invalid: "That link didn't point at anyone to message.",
  failed: "Couldn't start the conversation. Please try again.",
};

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, user] = await Promise.all([searchParams, getCurrentUser()]);
  if (!user) redirect("/login");
  const errorCopy = error ? (ERROR_COPY[error] ?? ERROR_COPY.failed) : null;

  const supabase = await createClient();
  const { data: mineData } = await supabase
    .from("dm_participants")
    .select("thread_id, last_read_at, thread:dm_threads(created_at)")
    .eq("user_id", user.userId);
  const mine = (mineData ?? []) as unknown as MyParticipantRow[];
  const threadIds = mine.map((row) => row.thread_id);

  // Other participants + the latest message per thread, all in parallel.
  const [othersResult, latestResults] =
    threadIds.length > 0
      ? await Promise.all([
          supabase
            .from("dm_participants")
            .select(
              "thread_id, profile:profiles(id, handle, display_name, avatar_url, phone_verified_at, major, grad_year, is_public, university_id)"
            )
            .in("thread_id", threadIds)
            .neq("user_id", user.userId),
          Promise.all(
            threadIds.map((id) =>
              supabase
                .from("dm_messages")
                .select("*")
                .eq("thread_id", id)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle()
            )
          ),
        ])
      : [null, []];

  const otherByThread = new Map<string, Profile>();
  for (const row of (othersResult?.data ??
    []) as unknown as OtherParticipantRow[]) {
    if (row.profile) otherByThread.set(row.thread_id, row.profile);
  }
  const latestByThread = new Map<string, DmMessage>();
  threadIds.forEach((id, i) => {
    const latest = latestResults[i]?.data as DmMessage | null;
    if (latest) latestByThread.set(id, latest);
  });

  const threads = mine
    .map((row) => {
      // No other participant (e.g. a deleted account) — nothing to show.
      const other = otherByThread.get(row.thread_id);
      if (!other) return null;
      const latest = latestByThread.get(row.thread_id) ?? null;
      return {
        threadId: row.thread_id,
        other,
        latest,
        latestIsMine: latest?.author_id === user.userId,
        unread: Boolean(
          latest &&
            latest.author_id !== user.userId &&
            new Date(latest.created_at).getTime() >
              new Date(row.last_read_at).getTime()
        ),
        activityAt: latest?.created_at ?? row.thread?.created_at ?? "",
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .sort(
      (a, b) =>
        new Date(b.activityAt).getTime() - new Date(a.activityAt).getTime()
    );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        title="Direct messages"
        description="Trade notes, plan study sessions, or just say hi."
        action={
          threads.length === 0 ? undefined : (
            <Link
              href="/people"
              className={buttonClasses({ size: "sm", className: "gap-1.5" })}
            >
              <UserRoundSearch className="size-4" aria-hidden />
              New message
            </Link>
          )
        }
      />

      {errorCopy ? (
        <p
          role="alert"
          className="mt-6 flex items-center gap-2 rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          {errorCopy}
        </p>
      ) : null}

      {threads.length === 0 ? (
        <div className="mt-6 rounded-card border border-dashed border-border">
          <EmptyState
            illustration={<ChatScene />}
            icon={MessageCircle}
            title="No conversations yet"
            description="DM classmates to trade notes, plan study sessions, or just say hi. Find people from your courses to get started."
            action={
              <Link href="/people" className={buttonClasses({ size: "sm" })}>
                Find classmates
              </Link>
            }
          />
        </div>
      ) : (
        <ul
          aria-label="Conversations"
          className="mt-6 flex animate-fade-up flex-col gap-2.5"
        >
          {threads.map((t) => (
            <ThreadListItem
              key={t.threadId}
              threadId={t.threadId}
              other={t.other}
              latest={t.latest}
              latestIsMine={t.latestIsMine}
              unread={t.unread}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
