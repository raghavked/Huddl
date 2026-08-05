import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ChevronRight,
  Compass,
  GraduationCap,
  Hash,
  Megaphone,
  Plus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Channel, ChannelKind, Course } from "@/lib/types";

export const metadata: Metadata = { title: "Channels" };

type ChannelRow = Channel & {
  course: Pick<Course, "id" | "code" | "title"> | null;
};

const GROUPS: { kind: ChannelKind; label: string; icon: LucideIcon }[] = [
  { kind: "campus", label: "Campus", icon: Megaphone },
  { kind: "course", label: "Courses", icon: GraduationCap },
  { kind: "topic", label: "Topics", icon: Hash },
  { kind: "club", label: "Clubs", icon: UsersRound },
];

function channelTitle(channel: ChannelRow): string {
  if (channel.kind === "course") return channel.course?.code ?? channel.name;
  if (channel.kind === "club") return channel.name;
  return `#${channel.slug}`;
}

function channelSubtitle(channel: ChannelRow): string | null {
  if (channel.kind === "course") {
    return channel.course?.title ?? channel.description;
  }
  return channel.description;
}

export default async function ChannelsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase
    .from("channel_members")
    .select("channel:channels(*, course:courses(id, code, title))")
    .eq("user_id", user.userId);

  const channels = ((data ?? []) as unknown as { channel: ChannelRow | null }[])
    .map((row) => row.channel)
    .filter((c): c is ChannelRow => Boolean(c))
    .sort((a, b) => a.name.localeCompare(b.name));

  const byKind = new Map<ChannelKind, ChannelRow[]>();
  for (const channel of channels) {
    const list = byKind.get(channel.kind) ?? [];
    list.push(channel);
    byKind.set(channel.kind, list);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Channels</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/channels/browse"
            className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Compass className="size-4" aria-hidden />
            Browse
          </Link>
          <Link
            href="/channels/new"
            className="flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Plus className="size-4" aria-hidden />
            New
          </Link>
        </div>
      </div>

      {channels.length === 0 ? (
        <EmptyState
          icon={Hash}
          title="No channels yet"
          description="Add your courses and you'll land in a channel for each class automatically — campus channels come free with your profile."
          action={
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <Link
                href="/setup"
                className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Set up your courses
              </Link>
              <Link
                href="/channels/browse"
                className="text-sm font-semibold text-accent hover:underline"
              >
                or browse campus channels
              </Link>
            </div>
          }
        />
      ) : (
        <>
          {GROUPS.map(({ kind, label, icon: Icon }) => {
            const group = byKind.get(kind);
            if (!group || group.length === 0) return null;
            return (
              <section key={kind} className="mt-6" aria-label={label}>
                <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-muted">
                  {label}
                </h2>
                <ul className="mt-2 divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
                  {group.map((channel) => {
                    const subtitle = channelSubtitle(channel);
                    return (
                      <li key={channel.id}>
                        <Link
                          href={`/channels/${channel.id}`}
                          className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                        >
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-strong">
                            <Icon className="size-5" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">
                              {channelTitle(channel)}
                            </span>
                            {subtitle ? (
                              <span className="block truncate text-xs text-muted">
                                {subtitle}
                              </span>
                            ) : null}
                          </span>
                          <ChevronRight
                            className="size-4 shrink-0 text-muted"
                            aria-hidden
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          {!byKind.get("course")?.length ? (
            <div className="mt-6 rounded-card border border-dashed border-border p-4 text-sm text-muted">
              No course channels yet.{" "}
              <Link
                href="/setup"
                className="font-semibold text-accent hover:underline"
              >
                Add your courses
              </Link>{" "}
              to auto-join one per class.
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
