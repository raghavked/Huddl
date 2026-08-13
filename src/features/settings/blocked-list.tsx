"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, CloudOff, Loader2, UserRoundX } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import {
  Badge,
  Button,
  SkeletonRow,
  cardClasses,
} from "@/components/ui";
import { blockUser, unblockUser } from "@/features/chat/blocks";
import { createClient } from "@/lib/supabase/client";

/* Your block list, and the one control that puts someone on it.
 *
 * Both halves live here because they are the same fact seen from two sides:
 * the profile page's Block button is the only thing that writes a row, and
 * the privacy page's list is the only place a student can see what they've
 * written. Keeping them apart would mean two files disagreeing about what
 * blocking costs, and the whole difficulty of this feature is that it costs
 * nothing visible.
 *
 * BLOCKING IS SILENT, AND THAT IS THE DESIGN. The blocked person gets no
 * notification, sees no badge, and watches nothing change; the server just
 * refuses DM threads across the block (`create_dm_thread`, migration 0019)
 * and mutes their notifications, while the client filters their messages out
 * of your rooms. That silence is right, because a block that announces itself
 * invites retaliation, but it has one cost worth designing around: a block
 * you didn't mean to make is invisible from both ends. Nobody complains,
 * nothing looks broken, and a classmate simply stops existing. So the Block
 * button confirms before it writes, and the list is the receipt.
 *
 * Unblocking needs no confirmation. It undoes something rather than doing it,
 * and it's a click away from being redone, so the row just leaves and comes
 * back with a warm line if the server disagrees.
 */

/* -------------------------------- shapes --------------------------------- */

/** One row of the list: who they are, and nothing else about them. */
type BlockedPerson = {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
};

/** The join row, before it's narrowed. The client is untyped. */
type BlockRow = {
  blocked_id: string;
  profile: {
    handle: string;
    display_name: string;
    avatar_url: string | null;
  } | null;
};

const LOAD_ERROR =
  "We couldn't load your block list just now. Every block you've made is still in place. Check your connection and give it another go.";

/* ---------------------------- the list section ---------------------------- */

/**
 * Everyone the signed-in student has blocked, newest first, each with a way
 * back. The native sibling is `mobile/src/app/blocked.tsx`.
 *
 * It loads itself rather than taking rows from the privacy page. The section
 * is below the fold, it needs a join nothing else on that page needs, and it
 * is interactive the moment it appears, so making the whole page's server
 * render wait on it would hold up the switch at the top for a list most
 * students will find empty. The cost is a beat of skeleton, which is honest:
 * these rows have a shape worth ghosting.
 */
export function BlockedList({ userId }: { userId: string }) {
  const [people, setPeople] = useState<BlockedPerson[] | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">(
    "loading"
  );
  const [rowError, setRowError] = useState<string | null>(null);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setRowError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("blocks")
      .select(
        "blocked_id, created_at, profile:profiles!blocks_blocked_id_fkey(handle, display_name, avatar_url)"
      )
      .eq("blocker_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      setStatus("error");
      return;
    }

    /* A row whose profile came back null is someone who has since deleted
       their account. The block outlived them and there is nobody left to
       unblock, so it isn't drawn. */
    setPeople(
      ((data ?? []) as unknown as BlockRow[]).flatMap((row) =>
        row.profile
          ? [
              {
                id: row.blocked_id,
                handle: row.profile.handle,
                displayName: row.profile.display_name,
                avatarUrl: row.profile.avatar_url,
              },
            ]
          : []
      )
    );
    setStatus("ready");
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleUnblock(person: BlockedPerson) {
    if (unblockingId) return;
    setRowError(null);
    setUnblockingId(person.id);
    // Optimistic: the row leaves right away and comes back on failure.
    const previous = people ?? [];
    setPeople(previous.filter((p) => p.id !== person.id));
    try {
      await unblockUser(userId, person.id);
    } catch {
      setPeople(previous);
      setRowError(
        `We couldn't unblock ${person.displayName} just now. Give it another try.`
      );
    } finally {
      setUnblockingId(null);
    }
  }

  if (status === "loading") {
    return (
      <div className="mt-3 flex flex-col gap-2.5" role="status">
        {[0, 1, 2].map((i) => (
          <SkeletonRow key={i} />
        ))}
        <span className="sr-only">Loading your block list…</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="mt-3 flex flex-col items-center gap-3 rounded-card border border-dashed border-border px-6 py-10 text-center">
        <span className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-muted">
          <CloudOff className="size-5" aria-hidden />
        </span>
        <div>
          <p className="font-bold tracking-tight">
            That list didn&apos;t come through
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted text-pretty">
            {LOAD_ERROR}
          </p>
        </div>
        <Button variant="soft" size="sm" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }

  if ((people ?? []).length === 0) {
    return (
      <div className="mt-3 rounded-card border border-dashed border-border">
        <EmptyState
          className="py-10"
          icon={UserRoundX}
          title="No one on the list"
          description="You haven't blocked anyone. Hopefully it stays that way."
        />
      </div>
    );
  }

  return (
    <>
      {rowError ? (
        <p role="alert" className="mt-3 px-1 text-sm font-medium text-danger">
          {rowError}
        </p>
      ) : null}
      <div className={cardClasses({ padding: "none", className: "mt-3" })}>
        <ul className="divide-y divide-border">
          {(people ?? []).map((person) => {
            const busy = unblockingId === person.id;
            return (
              <li
                key={person.id}
                className="flex min-h-11 items-center gap-3 px-4 py-3"
              >
                {/* The native list draws a deliberately colourless circle here
                    (DESIGN.md §4) so a block list can't read as a friends
                    list. On web that mark would be a second hand-rolled copy
                    of `Avatar`, which the same note forbids, so this row
                    uses the primitive, and it is the first caller in line the
                    day `Avatar` grows a documented quiet variant. */}
                <Avatar
                  name={person.displayName}
                  src={person.avatarUrl}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {person.displayName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    @{person.handle}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  aria-label={`Unblock ${person.displayName}`}
                  onClick={() => void handleUnblock(person)}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : null}
                  Unblock
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

/* --------------------------- the profile control -------------------------- */

/**
 * Block or unblock one classmate, from their profile.
 *
 * The confirmation is an inline panel, not `confirm()`, on the same reasoning
 * as `delete-account.tsx`: a browser dialog is a thing people dismiss
 * reflexively, and this one has to be read, because what it describes is
 * something the reader will never otherwise see happen.
 *
 * The Block button stays mounted while the panel is open, as a disclosure
 * with `aria-expanded`, the same shape as the board's post menu. Swapping
 * the button out for the panel would have dropped keyboard focus onto the
 * body at exactly the moment a destructive question appeared; leaving it
 * there means the answer is the next thing in the tab order.
 *
 * `blocked` starts from a server-rendered lookup, so the hero paints the
 * right control on the first frame instead of flipping from Message to
 * Blocked a moment later. After either write we refresh the route, which is
 * what keeps the rest of the app (rooms, the DM list) agreeing with this
 * button.
 *
 * It renders bare flex children rather than its own wrapper, so the caller's
 * row owns the layout: the confirmation is `w-full` and drops onto its own
 * line beside a Message button that doesn't move.
 *
 * @param name What to call them out loud. On a private profile the page
 *   passes "@handle", because the display name is the thing being withheld.
 */
export function BlockPersonButton({
  viewerId,
  personId,
  name,
  initiallyBlocked,
}: {
  viewerId: string;
  personId: string;
  name: string;
  initiallyBlocked: boolean;
}) {
  const router = useRouter();
  const panelId = useId();
  const [blocked, setBlocked] = useState(initiallyBlocked);
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleBlock() {
    if (working) return;
    setError(null);
    setWorking(true);
    try {
      await blockUser(viewerId, personId);
      setBlocked(true);
      setAsking(false);
      router.refresh();
    } catch {
      setError(
        "We couldn't block them just now, so nothing changed. Give it another go."
      );
      // The panel stays open: they meant to do this, and one more click does it.
    } finally {
      setWorking(false);
    }
  }

  async function handleUnblock() {
    if (working) return;
    setError(null);
    setWorking(true);
    try {
      await unblockUser(viewerId, personId);
      setBlocked(false);
      router.refresh();
    } catch {
      setError(
        "We couldn't unblock them just now, so the block is still on. Give it another go."
      );
    } finally {
      setWorking(false);
    }
  }

  /* Full-width so it lands on its own line in the caller's wrapping row,
     rather than squeezing in beside the button that raised it. */
  const notice = error ? (
    <p
      role="alert"
      className="w-full text-sm font-medium text-danger text-pretty"
    >
      {error}
    </p>
  ) : null;

  if (blocked) {
    return (
      <>
        <Badge tone="neutral" className="self-center">
          <Ban className="size-3.5" aria-hidden />
          Blocked
        </Badge>
        <Button
          variant="secondary"
          disabled={working}
          aria-label={`Unblock ${name}`}
          onClick={() => void handleUnblock()}
        >
          {working ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : null}
          Unblock
        </Button>
        {notice}
      </>
    );
  }

  return (
    <>
      {/* Locked while the write is in flight. Closing the panel underneath a
          request would take its error message with it. */}
      <Button
        variant="danger-ghost"
        disabled={working}
        aria-expanded={asking}
        aria-controls={asking ? panelId : undefined}
        aria-label={`Block ${name}`}
        onClick={() => {
          setError(null);
          setAsking((open) => !open);
        }}
      >
        <Ban className="size-4" aria-hidden />
        Block
      </Button>

      {asking ? (
        <div
          id={panelId}
          role="group"
          aria-label={`Block ${name}?`}
          className="w-full max-w-sm animate-scale-in rounded-card border border-danger/30 bg-surface p-4 text-left shadow-soft"
        >
          <p className="text-sm font-semibold">Block {name}?</p>
          <p className="mt-1 text-sm text-muted text-pretty">
            They can&apos;t DM you, and their posts stay out of sight.
            They&apos;re never told and nothing changes on their side, so a
            block you didn&apos;t mean is easy to miss. You can take it off
            any time under Settings, then Privacy.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={working}
              onClick={() => void handleBlock()}
            >
              {working ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              Block them
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={working}
              onClick={() => {
                setError(null);
                setAsking(false);
              }}
            >
              Never mind
            </Button>
          </div>
          {error ? <div className="mt-3">{notice}</div> : null}
        </div>
      ) : null}
    </>
  );
}
