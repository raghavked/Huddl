import { redirect } from "next/navigation";
import { DmRoom } from "@/features/dm/dm-room";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { DmMessage, DmParticipant, Profile } from "@/lib/types";

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

  const [{ data: otherData }, { data: messageRows }] = await Promise.all([
    supabase
      .from("dm_participants")
      .select(
        "user_id, profile:profiles(id, handle, display_name, avatar_url, phone_verified_at, major, grad_year, is_public, university_id)"
      )
      .eq("thread_id", threadId)
      .neq("user_id", user.userId)
      .maybeSingle(),
    supabase
      .from("dm_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const other =
    (otherData as unknown as { profile: Profile | null } | null)?.profile ??
    null;
  // The other account is gone (cascade removed their participant row) — the
  // thread has nothing left to show.
  if (!other) redirect("/messages");

  // Last 50, oldest first for rendering.
  const initialMessages = ((messageRows ?? []) as DmMessage[]).reverse();

  return (
    <div className="mx-auto flex h-[calc(100dvh-8.5rem)] max-w-3xl flex-col px-4">
      <DmRoom
        threadId={threadId}
        userId={user.userId}
        other={other}
        initialMessages={initialMessages}
        initialLastReadAt={myParticipant.last_read_at}
      />
    </div>
  );
}
