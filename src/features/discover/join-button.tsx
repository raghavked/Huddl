"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  Check,
  GraduationCap,
  Hash,
  Loader2,
  Megaphone,
  Plus,
  Search,
  SearchX,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { joinChannel } from "@/features/discover/actions";
import { cn } from "@/lib/utils";
import type { ChannelKind } from "@/lib/types";

/**
 * Join button used on Home's Discover section and the channel browser below.
 * Optimistically flips to "Joined" and refreshes server data behind it.
 */
export function JoinButton({
  channelId,
  channelName,
  className,
}: {
  channelId: string;
  /** Accessible name, e.g. "#dorm-life" — screen readers hear "Join #dorm-life". */
  channelName: string;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (joined) {
    return <JoinedChip className={className} />;
  }

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <button
        type="button"
        disabled={isPending}
        aria-label={`Join ${channelName}`}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await joinChannel(channelId);
            if (result.error) {
              setError(result.error);
            } else {
              setJoined(true);
              router.refresh();
            }
          });
        }}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand px-3.5 py-1.5 text-xs font-semibold text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
      >
        {isPending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Plus className="size-3.5" aria-hidden />
        )}
        Join
      </button>
      {error ? (
        <p role="alert" className="max-w-40 text-right text-[11px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function JoinedChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand-strong",
        className
      )}
    >
      <Check className="size-3.5" aria-hidden />
      Joined
    </span>
  );
}

// ---------------------------------------------------------------------------
// Channel browser (client half of /channels/browse). It lives in this file —
// the discover module's client entry point — because it is built around
// JoinButton and the browse page itself stays a server component.
// ---------------------------------------------------------------------------

/** Serializable row shape the browse page passes down. */
export interface BrowseChannel {
  id: string;
  kind: ChannelKind;
  name: string;
  slug: string;
  description: string | null;
  courseCode: string | null;
  courseTitle: string | null;
  clubId: string | null;
  /** null = unknown (member counts of channels you haven't joined are hidden by RLS). */
  memberCount: number | null;
  joined: boolean;
}

const GROUPS: { kind: ChannelKind; label: string; icon: LucideIcon }[] = [
  { kind: "campus", label: "Campus", icon: Megaphone },
  { kind: "course", label: "Courses", icon: GraduationCap },
  { kind: "topic", label: "Topics", icon: Hash },
  { kind: "club", label: "Clubs", icon: UsersRound },
];

function channelTitle(channel: BrowseChannel): string {
  if (channel.kind === "course") return channel.courseCode ?? channel.name;
  if (channel.kind === "club") return channel.name;
  return `#${channel.slug}`;
}

function channelSubtitle(channel: BrowseChannel): string | null {
  if (channel.kind === "course") {
    return channel.courseTitle ?? channel.description;
  }
  return channel.description;
}

function matches(channel: BrowseChannel, query: string): boolean {
  const haystack = [
    channel.name,
    channel.slug,
    channel.description,
    channel.courseCode,
    channel.courseTitle,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

/** How a non-member gets in, per kind. */
function JoinAffordance({ channel }: { channel: BrowseChannel }) {
  if (channel.joined) return <JoinedChip />;
  if (channel.kind === "course") {
    // Course channels come from enrollment — send folks through setup instead
    // of letting them lurk in a class they're not in.
    return (
      <Link
        href="/setup"
        className="shrink-0 text-xs font-semibold text-accent hover:underline"
      >
        Add course
      </Link>
    );
  }
  if (channel.kind === "club") {
    // Club chat membership mirrors the club roster — join via the club page.
    return (
      <Link
        href={channel.clubId ? `/clubs/${channel.clubId}` : "/clubs"}
        className="shrink-0 text-xs font-semibold text-accent hover:underline"
      >
        View club
      </Link>
    );
  }
  return <JoinButton channelId={channel.id} channelName={channelTitle(channel)} />;
}

export function ChannelBrowser({ channels }: { channels: BrowseChannel[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter((channel) => matches(channel, q));
  }, [channels, query]);

  const byKind = useMemo(() => {
    const map = new Map<ChannelKind, BrowseChannel[]>();
    for (const channel of filtered) {
      const list = map.get(channel.kind) ?? [];
      list.push(channel);
      map.set(channel.kind, list);
    }
    return map;
  }, [filtered]);

  return (
    <div>
      <div className="relative">
        <label htmlFor="channel-search" className="sr-only">
          Search channels
        </label>
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          id="channel-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, course code or topic…"
          className="w-full rounded-full border border-border bg-surface py-2.5 pl-10 pr-4 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </div>
      <p aria-live="polite" className="sr-only">
        {filtered.length} channel{filtered.length === 1 ? "" : "s"} shown
      </p>

      {filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No channels match"
          description={
            query.trim()
              ? `Nothing matches "${query.trim()}". Try a different search — or start the channel yourself.`
              : "There are no channels here yet."
          }
          action={
            <Link
              href="/channels/new"
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Start a channel
            </Link>
          }
        />
      ) : (
        GROUPS.map(({ kind, label, icon: Icon }) => {
          const group = byKind.get(kind);
          if (!group || group.length === 0) return null;
          return (
            <section key={kind} className="mt-6" aria-label={label}>
              <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-muted">
                {label}
                <span className="ml-1.5 font-medium normal-case tracking-normal">
                  · {group.length}
                </span>
              </h2>
              <ul className="mt-2 divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
                {group.map((channel) => {
                  const subtitle = channelSubtitle(channel);
                  return (
                    <li
                      key={channel.id}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-strong">
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <Link
                        href={`/channels/${channel.id}`}
                        className="min-w-0 flex-1 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      >
                        <span className="block truncate text-sm font-semibold">
                          {channelTitle(channel)}
                        </span>
                        {subtitle ? (
                          <span className="block truncate text-xs text-muted">
                            {subtitle}
                          </span>
                        ) : null}
                        {channel.memberCount !== null ? (
                          <span className="block text-xs text-muted">
                            {channel.memberCount} member
                            {channel.memberCount === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </Link>
                      <JoinAffordance channel={channel} />
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
