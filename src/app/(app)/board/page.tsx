import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CloudOff, Pin, Plus } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { DiscoverScene } from "@/components/illustrations";
import { Card, PageHeader, buttonClasses } from "@/components/ui";
import { BoardRow } from "@/features/board/board-row";
import { CategoryRail } from "@/features/board/category-rail";
import { getCurrentUser } from "@/lib/auth";
import {
  BoardError,
  asBoardCategory,
  categoryInfo,
  fetchBoard,
  isMine,
  isStale,
  type BoardCategory,
  type BoardPost,
} from "@/lib/board";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Campus board",
  description:
    "Rides home, lost water bottles, couches that need a new apartment.",
};

/**
 * What each board says when it's empty. The all-boards empty recruits — an
 * empty board is a board nobody has tried yet. A single quiet category is
 * usually just quiet, so those reassure first and invite second.
 */
const EMPTIES: Record<BoardCategory, { title: string; body: string }> = {
  ride: {
    title: "No rides up yet",
    body: "Nobody's posted a drive home. If you're going, say where and when — the seats fill fast.",
  },
  lost: {
    title: "Nothing lost",
    body: "Nobody's missing anything right now. That's the good kind of empty.",
  },
  found: {
    title: "Nothing found",
    body: "When something turns up on the quad, this is where it finds its way home.",
  },
  free: {
    title: "Nothing going free",
    body: "Free stuff moves fast, especially around move-out. Worth another look next week.",
  },
  sale: {
    title: "Nothing for sale",
    body: "No desks, bikes, or last quarter's textbooks up at the moment.",
  },
  ask: {
    title: "Nobody's asking",
    body: "No one needs a hand this minute. Ask when you do — people around here answer.",
  },
  offer: {
    title: "No offers up",
    body: "Nobody's put their hours up yet. If you're good at something, say so.",
  },
};

/**
 * The campus board — everything the room is offering and asking for.
 *
 * Two things sink rather than disappear, and the difference matters:
 *
 *   closed — the author marked it sorted. It stays readable at the bottom
 *            with a fern "Sorted" chip, because a ride that filled still
 *            tells you who drives to LA on Fridays.
 *   stale  — nobody's judgement but the list's: a ride whose day has gone, or
 *            anything a month old. It keeps its place in the open run but
 *            settles under the fresh posts. See `isStale`.
 *
 * Closed posts are asked for on purpose — they belong at the bottom of the
 * board, not off it — which does mean they eat into the hundred-row cap.
 */
export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const [{ category: rawCategory }, user] = await Promise.all([
    searchParams,
    getCurrentUser(),
  ]);
  if (!user) redirect("/login");

  const active = asBoardCategory(rawCategory);
  const supabase = await createClient();
  const now = new Date();

  let posts: BoardPost[] = [];
  let loadError: string | null = null;
  try {
    /* The block list travels with the posts rather than after them: one extra
       round trip on a page that already makes one, and RLS on `blocks` scopes
       it to the reader, so `blocker_id` is the only filter it needs.

       It is the half that must not fail soft. An empty set would quietly put a
       blocked classmate back on the board, so a `blocks` read that didn't land
       throws into the same catch as a board read that didn't — the reader gets
       the error card and a retry, not a board with the wrong people on it. */
    const [board, blocks] = await Promise.all([
      fetchBoard(
        { category: active, includeClosed: true },
        { client: supabase, userId: user.userId }
      ),
      supabase
        .from("blocks")
        .select("blocked_id")
        .eq("blocker_id", user.userId),
    ]);
    if (blocks.error) throw blocks.error;
    const blocked = new Set(
      ((blocks.data ?? []) as { blocked_id: string }[]).map(
        (row) => row.blocked_id
      )
    );
    /* Dropped here rather than excluded in the query, because `fetchBoard`
       takes no author filter — which means a reader who has blocked someone
       sees fewer than the hundred rows the cap allows, on the rare board
       that's over it. Trimming the tail is the safe direction to be wrong in. */
    posts = board.filter((post) => !blocked.has(post.author_id));
  } catch (caught) {
    loadError =
      caught instanceof BoardError
        ? caught.message
        : "We couldn't load the board. Check your connection and give it another go.";
  }

  /* Open posts first, then the ones that have quietly gone past — then the
     ones the author closed. `sort` is stable, so each tier keeps the
     newest-first order the query gave it. */
  const rank = (post: BoardPost): number =>
    post.closed_at !== null ? 2 : isStale(post, now) ? 1 : 0;
  const rows = [...posts].sort((a, b) => rank(a) - rank(b));

  const postButton = (
    <Link
      href={active ? `/board/new?category=${active}` : "/board/new"}
      className={buttonClasses({ size: "sm", className: "gap-1.5" })}
    >
      <Plus className="size-4" aria-hidden />
      Post something
    </Link>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        title="Campus board"
        description="Rides home, lost water bottles, couches that need a new apartment."
        action={postButton}
      />

      <CategoryRail active={active} />

      {loadError ? (
        <Card className="mt-6 flex flex-col items-center gap-2.5 text-center">
          <CloudOff className="size-5 text-muted" aria-hidden />
          <p className="font-bold tracking-tight">Something went sideways</p>
          <p className="max-w-xs text-sm text-muted text-pretty">
            {loadError}
          </p>
        </Card>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-card border border-dashed border-border">
          {active === null ? (
            <EmptyState
              illustration={<DiscoverScene />}
              icon={Pin}
              title="Nothing on the board"
              description="Put the first thing up — a ride home, a couch, a question."
              action={postButton}
            />
          ) : (
            <EmptyState
              className="py-10"
              icon={categoryInfo(active).icon}
              title={EMPTIES[active].title}
              description={EMPTIES[active].body}
              action={
                <Link
                  href={`/board/new?category=${active}`}
                  className={buttonClasses({ variant: "soft", size: "sm" })}
                >
                  Put one up
                </Link>
              }
            />
          )}
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-2.5">
          {rows.map((post) => (
            <BoardRow
              key={post.id}
              post={post}
              now={now}
              mine={isMine(post, user.userId)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
