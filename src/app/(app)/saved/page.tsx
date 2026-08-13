import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { SavedList, type SavedItem } from "@/features/saved/saved-list";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Saved",
  description: "The messages you kept: room numbers, hints, plans.",
};

/**
 * One bookmark row with both possible subjects embedded. Exactly one of the
 * two id columns is set (the DB check guarantees it), and its embed comes
 * back null whenever the message itself is out of reach: soft-deleted, or
 * behind a channel you've since left, since the embed reads through the
 * message's own RLS.
 */
type BookmarkRow = {
  created_at: string;
  message_id: string | null;
  dm_message_id: string | null;
  message: {
    id: string;
    channel_id: string;
    content: string;
    created_at: string;
    deleted_at: string | null;
    author: { display_name: string; avatar_url: string | null } | null;
    channel: { slug: string } | null;
  } | null;
  dm_message: {
    id: string;
    thread_id: string;
    content: string;
    created_at: string;
    deleted_at: string | null;
    author: { display_name: string; avatar_url: string | null } | null;
  } | null;
};

const BOOKMARK_SELECT =
  "created_at, message_id, dm_message_id, " +
  "message:messages(id, channel_id, content, created_at, deleted_at, " +
  "author:profiles(display_name, avatar_url), channel:channels(slug)), " +
  "dm_message:dm_messages(id, thread_id, content, created_at, deleted_at, " +
  "author:profiles(display_name, avatar_url))";

/**
 * Saved messages, private to you, newest save first. One query covers both
 * sides of the bookmark (channel and DM), so the ordering by save time is
 * already the merge; rows whose message no longer resolves drop out quietly.
 */
export default async function SavedPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase
    .from("message_bookmarks")
    .select(BOOKMARK_SELECT)
    .eq("user_id", user.userId)
    .order("created_at", { ascending: false })
    .limit(100);

  const items = ((data ?? []) as unknown as BookmarkRow[])
    .map((row): SavedItem | null => {
      const channelMessage = row.message;
      if (channelMessage && !channelMessage.deleted_at) {
        const slug = channelMessage.channel?.slug;
        return {
          kind: "channel",
          messageId: channelMessage.id,
          sentAt: channelMessage.created_at,
          authorName: channelMessage.author?.display_name ?? "A classmate",
          authorAvatar: channelMessage.author?.avatar_url ?? null,
          content: channelMessage.content,
          context: slug ? `#${slug}` : "#channel",
          href: `/channels/${channelMessage.channel_id}`,
        };
      }
      const dmMessage = row.dm_message;
      if (dmMessage && !dmMessage.deleted_at) {
        return {
          kind: "dm",
          messageId: dmMessage.id,
          sentAt: dmMessage.created_at,
          authorName: dmMessage.author?.display_name ?? "A classmate",
          authorAvatar: dmMessage.author?.avatar_url ?? null,
          content: dmMessage.content,
          context: "DM",
          href: `/messages/${dmMessage.thread_id}`,
        };
      }
      return null;
    })
    .filter((item): item is SavedItem => item !== null);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        title="Saved"
        description="The messages you kept, newest save first. Nobody else sees this list."
      />
      <SavedList initial={items} userId={user.userId} />
    </div>
  );
}
