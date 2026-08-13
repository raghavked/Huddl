import Link from "next/link";
import { Check } from "lucide-react";
import { Badge, cardClasses } from "@/components/ui";
import {
  categoryInfo,
  isStale,
  priceLabel,
  rideLabel,
  type BoardPost,
} from "@/lib/board";
import { cn } from "@/lib/utils";

/* One post as it reads at arm's length: what kind of thing it is, what it
 * costs or when it leaves, the headline, the first lines of the details, and
 * who put it up.
 *
 * A closed post keeps every one of those and just steps back: dimmed, with a
 * fern "Sorted" chip in front of the category. Nothing is hidden; the card is
 * as clickable as any other, because a ride that filled still tells you who
 * drives to LA on Fridays.
 *
 * Server-rendered: `now` comes down from the page so every relative label on
 * the board reads off one moment and two cards can't disagree about what
 * "today" means. */

/** "Just now", "5m ago", "3h ago", "2d ago", then "Aug 2". Pure. */
export function timeAgo(iso: string, now: Date): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function BoardRow({
  post,
  now,
  mine,
}: {
  post: BoardPost;
  /** The page's single moment. Never read the clock in here. */
  now: Date;
  /** True when the viewer wrote it; the byline says "You". */
  mine: boolean;
}) {
  const info = categoryInfo(post.category);
  const Icon = info.icon;
  const closed = post.closed_at !== null;
  const stale = isStale(post, now);
  const price = priceLabel(post.price_cents);
  const ride = rideLabel(post.happens_on, now);
  const author = mine
    ? "You"
    : (post.author?.display_name ?? "Someone on campus");

  return (
    <li>
      <Link
        href={`/board/${post.id}`}
        aria-label={`${info.label}. ${post.title}${closed ? ". Sorted." : ""}`}
        className={cardClasses({
          padding: "none",
          interactive: true,
          className: cn(
            "flex min-h-16 flex-col gap-2 p-4",
            closed && "opacity-70"
          ),
        })}
      >
        <span className="flex flex-wrap items-center gap-1.5">
          {closed ? (
            <Badge tone="accent">
              <Check className="size-3" aria-hidden />
              Sorted
            </Badge>
          ) : null}
          <Badge tone="brand">
            <Icon className="size-3" aria-hidden />
            {info.label}
          </Badge>
          {price ? <Badge tone="neutral">{price}</Badge> : null}
          {/* A ride still ahead is a plan; one that's been and gone is just
              metadata, so it drops back to a neutral pill. */}
          {ride ? (
            <Badge tone={stale ? "neutral" : "accent"}>{ride}</Badge>
          ) : null}
        </span>

        <span className="line-clamp-2 text-sm font-semibold text-pretty">
          {post.title}
        </span>

        {post.body ? (
          <span className="line-clamp-2 text-sm text-muted text-pretty">
            {post.body}
          </span>
        ) : null}

        <span className="truncate text-xs text-muted">
          {author} · {timeAgo(post.created_at, now)}
        </span>
      </Link>
    </li>
  );
}
