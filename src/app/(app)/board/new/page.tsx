import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CloudOff, Coffee } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Card, PageHeader, buttonClasses } from "@/components/ui";
import { BoardComposer } from "@/features/board/board-composer";
import { getCurrentUser } from "@/lib/auth";
import {
  BoardError,
  asBoardCategory,
  fetchPost,
  isMine,
  type BoardPost,
} from "@/lib/board";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Post to the board" };

/**
 * The board composer, and with an `id` param, the editor.
 *
 * The post being edited is fetched here rather than in the browser, so the
 * three ways an edit can fail (it's gone, it isn't yours, the network is) are
 * settled before the form draws. `isMine` is the client-side twin of the
 * `author_id = auth.uid()` update policy, so nobody is offered a form the
 * database would refuse to save.
 */
export default async function BoardComposerPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; id?: string }>;
}) {
  const [{ category: rawCategory, id: rawId }, user] = await Promise.all([
    searchParams,
    getCurrentUser(),
  ]);
  if (!user) redirect("/login");

  const postId = typeof rawId === "string" && rawId.trim() ? rawId.trim() : null;
  const initialCategory = asBoardCategory(rawCategory);

  let post: BoardPost | null = null;
  let loadError: string | null = null;
  if (postId !== null) {
    const supabase = await createClient();
    try {
      post = await fetchPost(postId, {
        client: supabase,
        userId: user.userId,
      });
    } catch (caught) {
      loadError =
        caught instanceof BoardError
          ? caught.message
          : "We couldn't open that post to edit it. Check your connection and give it another go.";
    }
  }

  const editing = postId !== null;
  const backToBoard = (
    <Link
      href="/board"
      className={buttonClasses({ variant: "soft", size: "sm" })}
    >
      Back to the board
    </Link>
  );

  const shell = (children: React.ReactNode, title: string) => (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref="/board"
        backLabel="Campus board"
        title={title}
        description="Everyone on campus can read this, and anyone can message you about it."
      />
      <div className="mt-8">{children}</div>
    </div>
  );

  if (editing && loadError !== null) {
    return shell(
      <Card className="flex flex-col items-center gap-2.5 text-center">
        <CloudOff className="size-5 text-muted" aria-hidden />
        <p className="font-bold tracking-tight">Something hiccuped</p>
        <p className="max-w-xs text-sm text-muted text-pretty">{loadError}</p>
        {backToBoard}
      </Card>,
      "Edit your post"
    );
  }

  if (editing && (post === null || !isMine(post, user.userId))) {
    return shell(
      <div className="rounded-card border border-dashed border-border">
        <EmptyState
          className="py-10"
          icon={Coffee}
          title={post === null ? "That post isn't there" : "That one isn't yours"}
          description={
            post === null
              ? "It may have already come down. The board will have the rest."
              : "Only the person who put a post up can change it. You can still message them from the post itself."
          }
          action={backToBoard}
        />
      </div>,
      "Edit your post"
    );
  }

  return shell(
    <BoardComposer post={post} initialCategory={initialCategory} />,
    editing ? "Edit your post" : "Post to the board"
  );
}
