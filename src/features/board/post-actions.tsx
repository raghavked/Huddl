"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CircleCheck,
  Flag,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui";
import { reportBoardPost } from "@/features/board/actions";
import {
  BoardError,
  closePost,
  deletePost,
  reopenPost,
  type BoardPost,
} from "@/lib/board";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/* The two things that can happen to a post, and who gets to do them.
 *
 * For a reader, the point is the Message button: a board post is only ever
 * half an arrangement, and the other half is a conversation. It goes through
 * the same find-or-create `create_dm_thread` the profile and study-partner
 * pages use, so "message the person with the couch" lands in the same thread
 * as every other time you've talked.
 *
 * For the author, the point is the menu. Marking a post sorted is the
 * ordinary end of its life — the row stays readable, sunk to the bottom of
 * the board. Delete is the narrow case of a post that shouldn't have been
 * written, and its confirmation names what is actually lost rather than
 * asking whether they're sure. */

/** The two-tap report reasons — concrete, no free-text friction. */
const REPORT_REASONS = ["Doesn't belong here", "Harassment or harm"] as const;

/** How long a finished report sits there before the menu bows out. */
const NOTICE_MS = 4000;

const MENU_ROW =
  "flex w-full min-h-11 items-center gap-2.5 rounded-xl px-3 text-left text-sm font-semibold transition-colors " +
  "hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand " +
  "disabled:pointer-events-none disabled:opacity-60";

/* ─────────────────────────── the message button ─────────────────────────── */

/**
 * Open the 1:1 thread with whoever put this up. `create_dm_thread` is
 * find-or-create on the server, so one call covers both "we've talked before"
 * and "we haven't" — and it refuses across a block, which is the one failure
 * worth naming out loud.
 */
export function MessageAuthorButton({ authorId }: { authorId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleMessage() {
    if (pending) return;
    setError(null);
    setPending(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_dm_thread", {
      other_user: authorId,
    });
    const threadId = typeof data === "string" ? data : null;
    if (rpcError || !threadId) {
      const raw = rpcError?.message ?? "";
      setError(
        raw.includes("message this person")
          ? "You two can't message each other."
          : "We couldn't open that conversation. Give it another go."
      );
      setPending(false);
      return;
    }
    router.push(`/messages/${threadId}`);
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        onClick={() => void handleMessage()}
        disabled={pending}
        className="w-full"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <MessageCircle className="size-4" aria-hidden />
        )}
        {pending ? "Opening…" : "Message"}
      </Button>
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ────────────────────────────── the menu ────────────────────────────────── */

type Step = "menu" | "confirmDelete" | "report";

/**
 * The overflow menu on a post: edit, mark sorted and delete for the author,
 * report for everyone else. Escape and a click outside close it, the way the
 * chat search panel does.
 */
export function PostMenu({
  post,
  mine,
}: {
  post: BoardPost;
  /** True when the viewer wrote it, from `isMine`. */
  mine: boolean;
}) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("menu");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const closed = post.closed_at !== null;

  const close = useCallback(() => {
    setOpen(false);
    setStep("menu");
    setError(null);
    setNotice(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
      triggerRef.current?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        panelRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      close();
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  // A finished report gets a beat to be read, then the menu gets out of the way.
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => {
      setNotice(null);
      close();
    }, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, close]);

  /**
   * Mark it sorted, or put it back up. `closePost` and `reopenPost` are
   * guarded on the server, so a second click resolves with null rather than
   * moving the time it closed — null means "already in that state", which is
   * exactly what the page is showing.
   */
  async function toggleSorted() {
    if (working) return;
    setError(null);
    setWorking(true);
    try {
      if (closed) await reopenPost(post.id);
      else await closePost(post.id);
      close();
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof BoardError
          ? caught.message
          : "That didn't save just now. Give it another go."
      );
    } finally {
      setWorking(false);
    }
  }

  /** Take it down for good, once the author has heard what that costs. */
  async function handleDelete() {
    if (working) return;
    setError(null);
    setWorking(true);
    try {
      await deletePost(post.id);
      router.replace("/board");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof BoardError
          ? caught.message
          : "We couldn't take that post down. Give it another go."
      );
      setWorking(false);
    }
  }

  async function submitReport(reason: string) {
    if (working) return;
    setError(null);
    setWorking(true);
    const result = await reportBoardPost(post.id, reason);
    setWorking(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setStep("menu");
    setNotice("Reported — thanks for looking out.");
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={mine ? "Post options" : "Report this post"}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex size-11 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {working ? (
          <Loader2 className="size-5 animate-spin" aria-hidden />
        ) : (
          <MoreHorizontal className="size-5" aria-hidden />
        )}
      </button>

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={mine ? "Post options" : "Report this post"}
          className="absolute right-0 top-12 z-30 w-64 animate-scale-in rounded-card border border-border bg-surface p-1.5 shadow-lift"
        >
          {notice ? (
            <p
              aria-live="polite"
              className="px-3 py-2.5 text-sm font-semibold text-accent"
            >
              {notice}
            </p>
          ) : step === "confirmDelete" ? (
            <div className="px-2 py-1.5">
              <p className="text-sm font-semibold">Take this down?</p>
              <p className="mt-1 text-xs text-muted text-pretty">
                It comes off the board and nobody can read it again. Marking it
                sorted leaves it up for anyone still looking.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={working}
                  onClick={() => void handleDelete()}
                >
                  {working ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : null}
                  Take it down
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={working}
                  onClick={() => setStep("menu")}
                >
                  Keep it
                </Button>
              </div>
            </div>
          ) : step === "report" ? (
            <div className="px-2 py-1.5">
              <p className="text-sm font-semibold">What&apos;s wrong with it?</p>
              <p className="mt-1 text-xs text-muted text-pretty">
                A moderator reads every report. The author never sees who sent
                it.
              </p>
              <div className="mt-2 flex flex-col">
                {REPORT_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    disabled={working}
                    onClick={() => void submitReport(reason)}
                    className={MENU_ROW}
                  >
                    {reason}
                  </button>
                ))}
              </div>
            </div>
          ) : mine ? (
            <div className="flex flex-col">
              <Link
                href={`/board/new?id=${post.id}`}
                onClick={close}
                className={MENU_ROW}
              >
                <Pencil className="size-4 text-muted" aria-hidden />
                Edit post
              </Link>
              <button
                type="button"
                disabled={working}
                onClick={() => void toggleSorted()}
                className={MENU_ROW}
              >
                {closed ? (
                  <RotateCcw className="size-4 text-muted" aria-hidden />
                ) : (
                  <CircleCheck className="size-4 text-muted" aria-hidden />
                )}
                {closed ? "Put it back up" : "Mark it sorted"}
              </button>
              <button
                type="button"
                disabled={working}
                onClick={() => {
                  setError(null);
                  setStep("confirmDelete");
                }}
                className={cn(MENU_ROW, "text-danger hover:bg-danger/10")}
              >
                <Trash2 className="size-4" aria-hidden />
                Delete post
              </button>
            </div>
          ) : (
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep("report");
                }}
                className={cn(MENU_ROW, "text-danger hover:bg-danger/10")}
              >
                <Flag className="size-4" aria-hidden />
                Report post
              </button>
            </div>
          )}

          {error ? (
            <p role="alert" className="px-3 pb-2 pt-1 text-xs font-medium text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
