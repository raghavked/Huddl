import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { cardClasses } from "@/components/ui";
import type { DmMessage, Profile } from "@/lib/types";
import { cn, formatMessageTime } from "@/lib/utils";

/**
 * One row on the /messages list: the other participant, a preview of the
 * latest message, timestamp, and an unread dot. Purely presentational —
 * the page computes unread/latest and hands them down.
 */
export function ThreadListItem({
  threadId,
  other,
  latest,
  latestIsMine,
  unread,
}: {
  threadId: string;
  other: Profile;
  latest: DmMessage | null;
  /** Whether the signed-in user authored the latest message ("You: …"). */
  latestIsMine: boolean;
  unread: boolean;
}) {
  const preview = latest
    ? latest.deleted_at
      ? "Message deleted"
      : `${latestIsMine ? "You: " : ""}${latest.content}`
    : "No messages yet — say hi!";

  return (
    <li>
      <Link
        href={`/messages/${threadId}`}
        className={cardClasses({
          padding: "none",
          interactive: true,
          className: "flex items-center gap-3 px-4 py-3",
        })}
      >
        <Avatar name={other.display_name} src={other.avatar_url} size="md" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={cn(
                "truncate text-sm",
                unread ? "font-bold" : "font-semibold"
              )}
            >
              {other.display_name}
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
