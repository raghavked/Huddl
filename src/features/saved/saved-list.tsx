"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, Bookmark, BookmarkX } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { buttonClasses, cardClasses } from "@/components/ui";
import { splitMentions } from "@/features/chat/mentions";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * One saved message, flattened by the server page so the client never has to
 * know which side of the bookmark it came from — only `kind`, which picks the
 * column to delete by when the row is let go.
 */
export type SavedItem = {
  /** Which subject column the bookmark uses (exactly one is ever set). */
  kind: "channel" | "dm";
  /** messages.id or dm_messages.id — the bookmark's subject. */
  messageId: string;
  /** When the message itself was sent. */
  sentAt: string;
  authorName: string;
  authorAvatar: string | null;
  content: string;
  /** "#general" for a channel, "DM" for a conversation. */
  context: string;
  /** Back to where it was said. */
  href: string;
};

/**
 * The /saved list: your private pins, newest save first. Each row carries
 * enough to place the message — who said it, where, and when — and a single
 * button to let it go again (optimistic, restored if the server disagrees).
 */
/** Same bookmark? Both halves, since the two id columns are separate tables. */
function sameItem(a: SavedItem, b: SavedItem): boolean {
  return a.kind === b.kind && a.messageId === b.messageId;
}

export function SavedList({
  initial,
  userId,
}: {
  initial: SavedItem[];
  userId: string;
}) {
  const [items, setItems] = useState<SavedItem[]>(initial);
  const [error, setError] = useState<string | null>(null);

  async function handleRemove(item: SavedItem) {
    setError(null);
    // Optimistic: the row leaves now. On failure it slides back into the
    // same slot — restoring by index rather than by snapshot, so a second
    // removal in flight doesn't get resurrected along with it.
    const index = items.findIndex((row) => sameItem(row, item));
    setItems((prev) => prev.filter((row) => !sameItem(row, item)));
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("message_bookmarks")
      .delete()
      .eq("user_id", userId)
      .eq(item.kind === "dm" ? "dm_message_id" : "message_id", item.messageId);
    if (deleteError) {
      setItems((prev) => {
        if (prev.some((row) => sameItem(row, item))) return prev;
        const next = [...prev];
        next.splice(index < 0 ? next.length : index, 0, item);
        return next;
      });
      setError("Couldn't remove that from saved — give it another try.");
    }
  }

  if (items.length === 0) {
    return (
      <div className="mt-6 rounded-card border border-dashed border-border">
        <EmptyState
          icon={Bookmark}
          title="Nothing saved yet"
          description="Hit save on a message — the room number, the homework hint, the study spot — and it waits for you here."
          action={
            <Link
              href="/channels"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              Back to your channels
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <>
      {error ? (
        <p
          role="alert"
          className="mt-6 flex items-center gap-2 rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <ul
        aria-label="Saved messages"
        className="mt-6 flex animate-fade-up flex-col gap-2.5"
      >
        {items.map((item) => (
          <li
            key={`${item.kind}:${item.messageId}`}
            className={cardClasses({
              padding: "none",
              className: "flex items-start gap-3 px-4 py-3.5",
            })}
          >
            <Avatar
              name={item.authorName}
              src={item.authorAvatar}
              size="sm"
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="truncate text-sm font-semibold">
                  {item.authorName}
                </span>
                <span
                  className={cn(
                    "inline-flex max-w-full shrink-0 items-center truncate rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    item.kind === "dm"
                      ? "bg-accent-soft text-accent"
                      : "bg-brand-soft text-brand-ink"
                  )}
                >
                  {item.context}
                </span>
                <time
                  dateTime={item.sentAt}
                  className="shrink-0 text-[11px] text-muted"
                >
                  {formatDistanceToNow(new Date(item.sentAt), {
                    addSuffix: true,
                  })}
                </time>
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
                {splitMentions(item.content).map((segment, index) =>
                  segment.mention ? (
                    <span key={index} className="font-semibold text-brand">
                      {segment.text}
                    </span>
                  ) : (
                    <Fragment key={index}>{segment.text}</Fragment>
                  )
                )}
              </p>
              <Link
                href={item.href}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
              >
                Open {item.kind === "dm" ? "conversation" : item.context}
                <span aria-hidden>→</span>
              </Link>
            </div>
            <button
              type="button"
              onClick={() => void handleRemove(item)}
              aria-label={`Remove from saved: ${item.content.slice(0, 60)}`}
              title="Remove from saved"
              className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
            >
              <BookmarkX className="size-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
