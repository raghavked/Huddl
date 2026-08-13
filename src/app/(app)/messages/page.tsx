import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertCircle,
  MessageCircle,
  UserRoundSearch,
  UsersRound,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ChatScene } from "@/components/illustrations";
import { PageHeader, buttonClasses } from "@/components/ui";
import { ThreadListItem } from "@/features/dm/thread-list-item";
import {
  firstNameOf,
  threadDisplay,
  type ThreadPerson,
} from "@/features/dm/group-dm";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { DmMessage, DmThread } from "@/lib/types";

/** My side of each thread, with the thread's created_at as an activity floor. */
type MyParticipantRow = {
  thread_id: string;
  last_read_at: string;
  thread: Pick<DmThread, "created_at" | "is_group" | "title"> | null;
};

type ParticipantRow = {
  thread_id: string;
  user_id: string;
  profile: ThreadPerson | null;
};

/** Friendly copy for the ?error= codes set by /messages/new. */
const ERROR_COPY: Record<string, string> = {
  self: "You can't start a conversation with yourself.",
  "no-user": "That person doesn't seem to be on Huddl.",
  invalid: "That link didn't point at anyone to message.",
  failed: "Couldn't start the conversation. Try again.",
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
    .select(
      "thread_id, last_read_at, thread:dm_threads(created_at, is_group, title)"
    )
    .eq("user_id", user.userId);
  const mine = (mineData ?? []) as unknown as MyParticipantRow[];
  const threadIds = mine.map((row) => row.thread_id);

  // Everyone in each thread (me included, so a group's headcount is honest),
  // plus the latest message per thread, all in parallel.
  const [peopleResult, latestResults] =
    threadIds.length > 0
      ? await Promise.all([
          supabase
            .from("dm_participants")
            .select(
              "thread_id, user_id, profile:profiles(id, handle, display_name, avatar_url)"
            )
            .in("thread_id", threadIds),
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

  const peopleByThread = new Map<string, ThreadPerson[]>();
  for (const row of (peopleResult?.data ??
    []) as unknown as ParticipantRow[]) {
    if (!row.profile) continue;
    const seated = peopleByThread.get(row.thread_id);
    if (seated) seated.push(row.profile);
    else peopleByThread.set(row.thread_id, [row.profile]);
  }
  const latestByThread = new Map<string, DmMessage>();
  threadIds.forEach((id, i) => {
    const latest = latestResults[i]?.data as DmMessage | null;
    if (latest) latestByThread.set(id, latest);
  });

  const threads = mine
    .map((row) => {
      const isGroup = row.thread?.is_group === true;
      const everyone = peopleByThread.get(row.thread_id) ?? [];
      const others = everyone.filter((person) => person.id !== user.userId);
      // A 1:1 whose other account is gone has nothing left to show; a group
      // stands on its own name.
      if (!isGroup && others.length === 0) return null;
      const latest = latestByThread.get(row.thread_id) ?? null;
      const author = latest
        ? (everyone.find((person) => person.id === latest.author_id) ?? null)
        : null;
      // One naming rule for both shapes, straight from the data layer.
      const named = threadDisplay(
        { is_group: isGroup, title: row.thread?.title ?? null },
        everyone,
        user.userId
      );
      return {
        threadId: row.thread_id,
        isGroup,
        name: named.title,
        subtitle: named.subtitle,
        others,
        latest,
        latestIsMine: latest?.author_id === user.userId,
        latestAuthorName: author ? firstNameOf(author.display_name) : null,
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
          <div className="flex items-center gap-2">
            {threads.length === 0 ? null : (
              <Link
                href="/people"
                className={buttonClasses({
                  variant: "secondary",
                  size: "sm",
                  className: "gap-1.5",
                })}
              >
                <UserRoundSearch className="size-4" aria-hidden />
                New message
              </Link>
            )}
            <Link
              href="/messages/new-group"
              className={buttonClasses({ size: "sm", className: "gap-1.5" })}
            >
              <UsersRound className="size-4" aria-hidden />
              New group
            </Link>
          </div>
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
            description="Everyone at your campus is in the directory, with their major and their year. Find someone to trade notes with, or pick a few and start a group."
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
              isGroup={t.isGroup}
              name={t.name}
              subtitle={t.subtitle}
              others={t.others}
              latest={t.latest}
              latestIsMine={t.latestIsMine}
              latestAuthorName={t.latestAuthorName}
              unread={t.unread}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
