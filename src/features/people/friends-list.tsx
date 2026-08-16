"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Loader2, UserRoundPlus } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import {
  Button,
  PageHeader,
  SectionHeader,
  buttonClasses,
  cardClasses,
} from "@/components/ui";
import {
  FriendsError,
  acceptRequest,
  listFriendships,
  presenceLabel,
  removeEdge,
  splitFriendships,
  type FriendEdgeRow,
  type FriendListItem,
} from "@/lib/friends";

/* The Friends screen: Requests, Sent, Friends, in that order.
 *
 * The server shell hands over every edge the viewer is on and this component
 * does the standing-on with `splitFriendships`, the same pure split the unit
 * tests hold still. Every write is optimistic: the row moves (or leaves)
 * first, and the whole list flips back with one inline error if the server
 * disagrees. Cancel, ignore and unfriend are all `removeEdge`, because the
 * database makes no distinction and neither should the copy: the edge just
 * stops existing, quietly.
 *
 * Presence renders through `presenceLabel` and nothing else: the quiet
 * "Active now" line under a friend's name when there is one, and no line at
 * all when there isn't. `toFriendPerson` already nulled `last_seen_at` for
 * anyone not sharing, and the toggle is checked again here anyway, so a raw
 * timestamp can never reach a row.
 */

/** One stable key per edge: the pair IS the primary key. */
function edgeKey(item: FriendListItem): string {
  return `${item.edge.requester_id}:${item.edge.addressee_id}`;
}

/** Whether a raw row and a rendered item are the same edge. */
function sameEdge(row: FriendEdgeRow, item: FriendListItem): boolean {
  return (
    row.requester_id === item.edge.requester_id &&
    row.addressee_id === item.edge.addressee_id
  );
}

export function FriendsList({
  initial,
  userId,
}: {
  initial: FriendEdgeRow[];
  userId: string;
}) {
  const [rows, setRows] = useState<FriendEdgeRow[]>(initial);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sections = useMemo(
    () => splitFriendships(rows, userId),
    [rows, userId]
  );

  // Pure helpers take `now` as an argument; a render is a fine moment.
  const now = new Date();

  /** Flip the list first, write second, flip back with warm copy on failure.
   *
   * When `refetchOnFail` is set, failure re-fetches the list instead of
   * restoring the snapshot. Accepting needs that: a request can be cancelled
   * (or quietly withdrawn across a block) while it's on screen, and putting
   * the old row back would resurrect an edge the server no longer has, with
   * every retry looping into the same wall. If even the refetch fails, the
   * snapshot is still warmer than an empty screen. */
  async function run(
    item: FriendListItem,
    next: (prev: FriendEdgeRow[]) => FriendEdgeRow[],
    write: () => Promise<void>,
    refetchOnFail = false
  ) {
    if (busyKey) return;
    setError(null);
    setBusyKey(edgeKey(item));
    const previous = rows;
    setRows(next(previous));
    try {
      await write();
    } catch (err) {
      if (refetchOnFail) {
        try {
          setRows(await listFriendships());
        } catch {
          setRows(previous);
        }
      } else {
        setRows(previous);
      }
      setError(
        err instanceof FriendsError
          ? err.message
          : "That didn't go through. Give it another go in a moment."
      );
    } finally {
      setBusyKey(null);
    }
  }

  function handleAccept(item: FriendListItem) {
    void run(
      item,
      (prev) =>
        prev.map((row) =>
          sameEdge(row, item)
            ? {
                ...row,
                status: "accepted",
                responded_at: new Date().toISOString(),
              }
            : row
        ),
      () => acceptRequest(item.person.id),
      true
    );
  }

  /** Cancel, ignore and unfriend: the same quiet delete, whichever word. */
  function handleDrop(item: FriendListItem) {
    void run(
      item,
      (prev) => prev.filter((row) => !sameEdge(row, item)),
      () => removeEdge(item.person.id)
    );
  }

  function handleRemoveFriend(item: FriendListItem) {
    const sure = window.confirm(
      `Remove ${item.person.display_name} from your friends? They aren't told, and you can always ask again.`
    );
    if (!sure) return;
    handleDrop(item);
  }

  /** The row everyone shares: avatar and name into their profile, then
   *  whatever buttons the section calls for. */
  function personCell(item: FriendListItem, withPresence: boolean) {
    const { person } = item;
    const label = withPresence
      ? presenceLabel(
          person.share_last_seen ? person.last_seen_at : null,
          now
        )
      : null;
    return (
      <Link
        href={`/u/${person.handle}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-0.5 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <Avatar name={person.display_name} src={person.avatar_url} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {person.display_name}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted">
            @{person.handle}
          </span>
          {label ? (
            <span className="mt-0.5 block text-xs font-medium text-success">
              {label}
            </span>
          ) : null}
        </span>
      </Link>
    );
  }

  function sectionCard(children: React.ReactNode) {
    return (
      <div className={cardClasses({ padding: "none", className: "mt-3" })}>
        <ul className="divide-y divide-border">{children}</ul>
      </div>
    );
  }

  const rowClass = "flex min-h-11 items-center gap-3 px-4 py-3";

  return (
    <div>
      <PageHeader
        title="Friends"
        description="Who's asked you, who you've asked, and everyone who said yes."
      />

      {error ? (
        <p role="alert" className="mt-4 px-1 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}

      {sections.requests.length > 0 ? (
        <section aria-label="Requests" className="mt-8">
          <SectionHeader title="Requests" />
          {sectionCard(
            sections.requests.map((item) => {
              /* `busy` marks the row whose spinner is turning. Every button
                 in the list rests while ANY write is in flight, because
                 run() would swallow their clicks anyway; a button that looks
                 alive but does nothing is worse than one that plainly waits. */
              const busy = busyKey === edgeKey(item);
              return (
                <li key={edgeKey(item)} className={rowClass}>
                  {personCell(item, false)}
                  <Button
                    size="sm"
                    disabled={busyKey !== null}
                    aria-label={`Accept the friend request from ${item.person.display_name}`}
                    onClick={() => handleAccept(item)}
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Check className="size-4" aria-hidden />
                    )}
                    Accept
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyKey !== null}
                    aria-label={`Ignore the friend request from ${item.person.display_name}`}
                    onClick={() => handleDrop(item)}
                  >
                    Ignore
                  </Button>
                </li>
              );
            })
          )}
        </section>
      ) : null}

      {sections.sent.length > 0 ? (
        <section aria-label="Sent" className="mt-8">
          <SectionHeader title="Sent" />
          {sectionCard(
            sections.sent.map((item) => {
              const busy = busyKey === edgeKey(item);
              return (
                <li key={edgeKey(item)} className={rowClass}>
                  {personCell(item, false)}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busyKey !== null}
                    aria-label={`Cancel your friend request to ${item.person.display_name}`}
                    onClick={() => handleDrop(item)}
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : null}
                    Cancel request
                  </Button>
                </li>
              );
            })
          )}
        </section>
      ) : null}

      <section aria-label="Friends" className="mt-8">
        <SectionHeader title="Friends" />
        {sections.friends.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-border">
            <EmptyState
              className="py-10"
              icon={UserRoundPlus}
              title="No friends here yet"
              description="Find your people in the directory and ask. Friends stay across every class and club."
              action={
                <Link
                  href="/people"
                  className={buttonClasses({ variant: "soft", size: "sm" })}
                >
                  <UserRoundPlus className="size-4" aria-hidden />
                  Find your people
                </Link>
              }
            />
          </div>
        ) : (
          sectionCard(
            sections.friends.map((item) => {
              const busy = busyKey === edgeKey(item);
              return (
                <li key={edgeKey(item)} className={rowClass}>
                  {personCell(item, true)}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busyKey !== null}
                    aria-label={`Remove ${item.person.display_name} from your friends`}
                    onClick={() => handleRemoveFriend(item)}
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : null}
                    Remove friend
                  </Button>
                </li>
              );
            })
          )
        )}
      </section>
    </div>
  );
}
