import Link from "next/link";
import { Users } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { cardClasses } from "@/components/ui";
import { threadPreview, type ThreadPerson } from "@/features/dm/group-dm";
import type { DmMessage } from "@/lib/types";
import { cn, formatMessageTime } from "@/lib/utils";

/**
 * A group's face: two of its members overlapped in a small cluster, falling
 * back to a single avatar or the plain group glyph when there's nobody left
 * to draw. Decorative: the row's own name carries the meaning.
 */
function GroupCluster({ people }: { people: ThreadPerson[] }) {
  const [first, second] = people;

  if (!first) {
    return (
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink"
      >
        <Users className="size-5" />
      </span>
    );
  }

  if (!second) {
    return (
      <Avatar name={first.display_name} src={first.avatar_url} size="md" />
    );
  }

  return (
    <span aria-hidden className="relative block size-10 shrink-0">
      <Avatar
        name={first.display_name}
        src={first.avatar_url}
        size="sm"
        className="absolute left-0 top-0"
      />
      <span className="absolute bottom-0 right-0 rounded-full bg-surface p-0.5">
        <Avatar name={second.display_name} src={second.avatar_url} size="sm" />
      </span>
    </span>
  );
}

/**
 * One row on the /messages list, in either shape: a 1:1 named after the
 * other student, or a group named after itself with a stacked cluster of
 * the people in it. Purely presentational: the page computes the naming,
 * the latest message, and unread state, and hands them down.
 */
export function ThreadListItem({
  threadId,
  isGroup,
  name,
  subtitle,
  others,
  latest,
  latestIsMine,
  latestAuthorName,
  unread,
}: {
  threadId: string;
  /** True for a named group of 3-16; false for a 1:1. */
  isGroup: boolean;
  /** The group's title, or the other student's display name. */
  name: string;
  /** "6 people" on a group; null on a 1:1. */
  subtitle: string | null;
  /** Everyone but you, for the avatar cluster. */
  others: ThreadPerson[];
  latest: DmMessage | null;
  /** Whether the signed-in student authored the latest message ("You: …"). */
  latestIsMine: boolean;
  /** Who wrote the latest message in a group ("Maya: see you at 6"). */
  latestAuthorName: string | null;
  unread: boolean;
}) {
  const preview = threadPreview({
    isGroup,
    latest,
    latestIsMine,
    latestAuthorName,
  });
  const solo = others[0] ?? null;

  return (
    <li>
      <Link
        href={`/messages/${threadId}`}
        aria-label={
          isGroup
            ? `Group chat ${name}${subtitle ? `, ${subtitle}` : ""}`
            : `Conversation with ${name}`
        }
        className={cardClasses({
          padding: "none",
          interactive: true,
          className: "flex items-center gap-3 px-4 py-3",
        })}
      >
        {isGroup ? (
          <GroupCluster people={others} />
        ) : (
          <Avatar
            name={solo?.display_name ?? name}
            src={solo?.avatar_url ?? null}
            size="md"
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={cn(
                "truncate text-sm",
                unread ? "font-bold" : "font-semibold"
              )}
            >
              {name}
            </span>
            {latest ? (
              <time
                dateTime={latest.created_at}
                className={cn(
                  "shrink-0 text-xs",
                  unread ? "font-semibold text-brand" : "text-muted"
                )}
              >
                {formatMessageTime(latest.created_at)}
              </time>
            ) : null}
          </span>
          <span
            className={cn(
              "mt-0.5 block truncate text-xs",
              latest?.deleted_at ? "italic" : null,
              unread ? "font-medium text-foreground" : "text-muted"
            )}
          >
            {preview}
          </span>
        </span>
        {unread ? (
          <>
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full bg-brand"
            />
            <span className="sr-only">Unread messages</span>
          </>
        ) : null}
      </Link>
    </li>
  );
}
