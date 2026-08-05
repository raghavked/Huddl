import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import {
  ChannelBrowser,
  type BrowseChannel,
} from "@/features/discover/join-button";
import { getCurrentUser } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Channel, Course } from "@/lib/types";

export const metadata: Metadata = { title: "Browse channels" };

type ChannelRow = Channel & {
  course: Pick<Course, "id" | "code" | "title"> | null;
  members: { count: number }[] | null;
};

export default async function BrowseChannelsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  // RLS only reveals channel_members rows of channels I'm in (plus my own),
  // so accurate member counts for *other* channels need the service client.
  // Without the key we degrade: counts show only on channels I've joined.
  const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const reader = hasServiceKey ? createServiceClient() : supabase;

  const [{ data: membershipData }, { data: channelData }] = await Promise.all([
    supabase
      .from("channel_members")
      .select("channel_id")
      .eq("user_id", user.userId),
    reader
      .from("channels")
      .select("*, course:courses(id, code, title), members:channel_members(count)")
      .eq("university_id", user.university.id)
      .order("name"),
  ]);

  const joinedIds = new Set(
    ((membershipData ?? []) as { channel_id: string }[]).map(
      (row) => row.channel_id
    )
  );

  const channels: BrowseChannel[] = (
    (channelData ?? []) as unknown as ChannelRow[]
  ).map((row) => {
    const joined = joinedIds.has(row.id);
    const count = row.members?.[0]?.count ?? 0;
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      slug: row.slug,
      description: row.description,
      courseCode: row.course?.code ?? null,
      courseTitle: row.course?.title ?? null,
      clubId: row.club_id,
      memberCount: hasServiceKey || joined ? count : null,
      joined,
    };
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href="/channels"
        className="inline-flex items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Your channels
      </Link>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Browse channels</h1>
          <p className="mt-1 text-sm text-muted">
            Everything happening at {user.university.short_name}.
          </p>
        </div>
        <Link
          href="/channels/new"
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <Plus className="size-4" aria-hidden />
          New
        </Link>
      </div>

      <div className="mt-5">
        <ChannelBrowser channels={channels} />
      </div>
    </div>
  );
}
