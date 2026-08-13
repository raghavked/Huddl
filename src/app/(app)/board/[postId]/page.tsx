import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Calendar,
  Check,
  CircleCheck,
  CloudOff,
  Coffee,
  Lock,
  Tag,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { Badge, Card, PageHeader, buttonClasses } from "@/components/ui";
import { timeAgo } from "@/features/board/board-row";
import { MessageAuthorButton, PostMenu } from "@/features/board/post-actions";
import { getCurrentUser } from "@/lib/auth";
import {
  BoardError,
  categoryInfo,
  fetchPost,
  isMine,
  parseBoardDay,
  priceLabel,
  rideLabel,
  type BoardPost,
} from "@/lib/board";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ postId: string }>;
}): Promise<Metadata> {
  const { postId } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("board_posts")
    .select("title")
    .eq("id", postId)
    .maybeSingle();
  return { title: data?.title ?? "Campus board" };
}

/** "Friday, October 14": the long form under a ride's short label. */
function longDay(day: Date): string {
  return day.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** One line of the details card: a soft ember tile and whatever it labels. */
function MetaRow({
  icon: Icon,
  children,
}: {
  icon: typeof Tag;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 pt-1">{children}</div>
    </div>
  );
}

/**
 * One post on the campus board.
 *
 * For a reader this page exists for the Message button. A board post is only
 * ever half an arrangement. For the author it exists for the menu: mark it
 * sorted when the ride fills (the post stays readable, sunk to the bottom of
 * the board), edit it, or take it down for good.
 */
export default async function BoardPostPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const [{ postId }, user] = await Promise.all([params, getCurrentUser()]);
  if (!user) redirect("/login");

  const supabase = await createClient();
  const now = new Date();

  let post: BoardPost | null = null;
  let loadError: string | null = null;
  try {
    post = await fetchPost(postId, { client: supabase, userId: user.userId });
  } catch (caught) {
    loadError =
      caught instanceof BoardError
        ? caught.message
        : "We couldn't open that post. Check your connection and give it another go.";
  }

  const backToBoard = (
    <Link
      href="/board"
      className={buttonClasses({ variant: "soft", size: "sm" })}
    >
      Back to the board
    </Link>
  );

  if (loadError !== null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
        <PageHeader
          backHref="/board"
          backLabel="Campus board"
          title="Something hiccuped"
        />
        <Card className="mt-8 flex flex-col items-center gap-2.5 text-center">
          <CloudOff className="size-5 text-muted" aria-hidden />
          <p className="max-w-xs text-sm text-muted text-pretty">{loadError}</p>
          {backToBoard}
        </Card>
      </div>
    );
  }

  if (post === null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
        <PageHeader
          backHref="/board"
          backLabel="Campus board"
          title="That post isn't there"
        />
        <div className="mt-8 rounded-card border border-dashed border-border">
          <EmptyState
            className="py-10"
            icon={Coffee}
            title="It may have already come down"
            description="The board will have the rest of what's going on."
            action={backToBoard}
          />
        </div>
      </div>
    );
  }

  const info = categoryInfo(post.category);
  const CategoryIcon = info.icon;
  const mine = isMine(post, user.userId);
  const closed = post.closed_at !== null;
  const price = priceLabel(post.price_cents);
  const ride = rideLabel(post.happens_on, now);
  const rideDay = parseBoardDay(post.happens_on);
  const author = post.author;
  // "Just now" opens a sentence everywhere else in the app; here it finishes
  // one. Only that one label needs lowering; "Put up aug 2" would be worse.
  const posted = timeAgo(post.created_at, now);
  const postedLine = posted === "Just now" ? "Put up just now" : `Put up ${posted}`;
  const authorName = mine
    ? "You"
    : author
      ? author.locked
        ? `@${author.handle}`
        : author.display_name
      : "Someone on campus";

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref="/board"
        backLabel="Campus board"
        title={post.title}
        description={postedLine}
        action={<PostMenu post={post} mine={mine} />}
      />

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Badge tone="brand">
          <CategoryIcon className="size-3.5" aria-hidden />
          {info.label}
        </Badge>
        {closed ? (
          <Badge tone="accent">
            <Check className="size-3.5" aria-hidden />
            Sorted
          </Badge>
        ) : null}
      </div>

      {price !== null || ride !== null ? (
        <Card className="mt-5 flex flex-col gap-3">
          {price !== null ? (
            <MetaRow icon={Tag}>
              <p className="text-sm font-semibold">{price}</p>
            </MetaRow>
          ) : null}
          {ride !== null ? (
            <MetaRow icon={Calendar}>
              <p className="text-sm font-medium">{ride}</p>
              {rideDay ? (
                <p className="mt-0.5 text-xs text-muted">{longDay(rideDay)}</p>
              ) : null}
            </MetaRow>
          ) : null}
        </Card>
      ) : null}

      {post.body ? (
        <p className="mt-5 whitespace-pre-line text-sm leading-relaxed text-pretty">
          {post.body}
        </p>
      ) : null}

      {closed ? (
        <div className="mt-5 flex items-start gap-2.5 rounded-xl bg-accent-soft px-3.5 py-3">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          <p className="text-xs leading-relaxed text-pretty">
            {mine
              ? "You marked this sorted. It stays on the board, at the bottom, so people can still read it."
              : "This one's been sorted. It stays up so you can still see what happened."}
          </p>
        </div>
      ) : null}

      {/* Who's behind it, and the way to say something about it. */}
      <Card className="mt-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          {author && !mine ? (
            <Link
              href={`/u/${author.handle}`}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <Avatar
                name={author.locked ? author.handle : author.display_name}
                src={author.avatar_url}
                size="lg"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {authorName}
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                  {author.locked ? (
                    <>
                      <Lock className="size-3" aria-hidden />
                      Private profile
                    </>
                  ) : (
                    `@${author.handle}`
                  )}
                </span>
              </span>
            </Link>
          ) : (
            <div className="flex min-h-11 min-w-0 flex-1 items-center gap-3">
              <Avatar
                name={authorName}
                src={author?.avatar_url ?? null}
                size="lg"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{authorName}</p>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {mine ? "This one's yours" : "Their profile isn't around"}
                </p>
              </div>
            </div>
          )}
          {mine ? <Badge tone="brand">You</Badge> : null}
        </div>

        {!mine ? <MessageAuthorButton authorId={post.author_id} /> : null}
      </Card>
    </div>
  );
}
