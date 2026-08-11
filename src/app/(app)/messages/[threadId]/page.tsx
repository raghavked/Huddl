import { redirect } from "next/navigation";
import { DmRoom } from "@/features/dm/dm-room";
import { GROUP_THREAD_SELECT, type ThreadPerson } from "@/features/dm/group-dm";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { DmMessage, DmParticipant, DmThread } from "@/lib/types";

type ParticipantRow = {
  user_id: string;
  profile: ThreadPerson | null;
};

export default async function DmThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  // Membership check: RLS hides threads I'm not in, so a missing row covers
  // bad ids, other people's threads, and malformed uuids alike.
  const { data: myParticipantData } = await supabase
    .from("dm_participants")
    .select("*")
    .eq("thread_id", threadId)
    .eq("user_id", user.userId)
    .maybeSingle();
  const myParticipant = myParticipantData as DmParticipant | null;
  if (!myParticipant) redirect("/messages");

  const [{ data: threadData }, { data: peopleData }, { data: messageRows }] =
    await Promise.all([
      supabase
        .from("dm_threads")
        .select(GROUP_THREAD_SELECT)
        .eq("id", threadId)
        .maybeSingle(),
      // Everyone in the thread, me included — a group needs the full roster
      // for author names and its "N people" line.
      supabase
        .from("dm_participants")
        .select("user_id, profile:profiles(id, handle, display_name, avatar_url)")
        .eq("thread_id", threadId),
      supabase
        .from("dm_messages")
        .select("*")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  const thread = threadData as DmThread | null;
  if (!thread) redirect("/messages");

  const people = ((peopleData ?? []) as unknown as ParticipantRow[])
    .map((row) => row.profile)
    .filter((profile): profile is ThreadPerson => profile !== null)
    .sort(
      (a, b) =>
        a.display_name.localeCompare(b.display_name) ||
        a.handle.localeCompare(b.handle)
    );

  const other = thread.is_group
    ? null
    : (people.find((person) => person.id !== user.userId) ?? null);
  // On a 1:1, the other account is gone (a cascade took their participant
  // row with it) — the thread has nothing left to show.
  if (!thread.is_group && !other) redirect("/messages");

  // Last 50, oldest first for rendering.
  const initialMessages = ((messageRows ?? []) as DmMessage[]).reverse();

  return (
    <div className="mx-auto flex h-[calc(100dvh-8.5rem)] max-w-3xl flex-col px-4">
      <DmRoom
        threadId={threadId}
        userId={user.userId}
        other={other}
        group={
          thread.is_group ? { title: thread.title, people } : null
        }
        initialMessages={initialMessages}
        initialLastReadAt={myParticipant.last_read_at}
      />
    </div>
  );
}
