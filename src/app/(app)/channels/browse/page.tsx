import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Compass, Hash, Plus } from "lucide-react";
import { PageHeader, Segmented, buttonClasses } from "@/components/ui";
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
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        title="Browse channels"
        description={`Everything happening at ${user.university.short_name}.`}
        action={
          <Link
            href="/channels/new"
            className={buttonClasses({ size: "sm", className: "gap-1.5" })}
          >
            <Plus className="size-4" aria-hidden />
            New channel
          </Link>
        }
      />

      <div className="mt-6 animate-fade-up">
        <Segmented
          items={[
            { href: "/channels", label: "Yours", icon: Hash },
            { href: "/channels/browse", label: "Browse", icon: Compass },
          ]}
        />
      </div>

      <div className="mt-6">
        <ChannelBrowser channels={channels} />
      </div>
    </div>
  );
}
