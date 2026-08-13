"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bookmark,
  BookmarkCheck,
  Flag,
  Loader2,
  MessageSquareText,
  Pencil,
  Pin,
  PinOff,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { createClient } from "@/lib/supabase/client";
import {
  REPORT_CATEGORIES,
  categoryLabel,
  type ReportCategory,
} from "@/lib/moderation";
import { reportMessage } from "@/features/moderation/actions";
import { AttachmentImage } from "@/features/chat/attachment-image";
import { splitMentions } from "@/features/chat/mentions";
import { PollBubble } from "@/features/polls/poll-bubble";
import type { MessageReaction, MessageWithAuthor } from "@/lib/types";
import { cn, formatMessageTime } from "@/lib/utils";

export const REACTION_EMOJI = ["👍", "❤️", "😂", "🔥", "📚", "✅"] as const;

/** What `reports.reason` will take: 1–500 characters, per its check constraint. */
const REASON_MAX = 500;

const TOOL_BUTTON =
  "flex size-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand";

/**
 * Reaction state shared by the main message list and the thread panel:
 * one batched fetch per list, optimistic toggles, reload-on-failure revert.
 */
export function useReactions(userId: string) {
  const [byMessage, setByMessage] = useState<Record<string, MessageReaction[]>>(
    {}
  );
  const stateRef = useRef(byMessage);
  stateRef.current = byMessage;

  const loadReactions = useCallback(async (messageIds: string[]) => {
    if (messageIds.length === 0) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("message_reactions")
      .select("*")
      .in("message_id", messageIds);
    if (!data) return;
    setByMessage((prev) => {
      const next = { ...prev };
      for (const id of messageIds) next[id] = [];
      for (const row of data as MessageReaction[]) {
        (next[row.message_id] ??= []).push(row);
      }
      return next;
    });
  }, []);

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      const mine = (stateRef.current[messageId] ?? []).some(
        (r) => r.user_id === userId && r.emoji === emoji
      );
      // Optimistic flip first, so the pill responds instantly.
      setByMessage((prev) => {
        const rows = prev[messageId] ?? [];
        return {
          ...prev,
          [messageId]: mine
            ? rows.filter(
                (r) => !(r.user_id === userId && r.emoji === emoji)
              )
            : [
                ...rows,
                {
                  message_id: messageId,
                  user_id: userId,
                  emoji,
                  created_at: new Date().toISOString(),
                },
              ],
        };
      });
      const supabase = createClient();
      const { error } = mine
        ? await supabase
            .from("message_reactions")
            .delete()
            .eq("message_id", messageId)
            .eq("user_id", userId)
            .eq("emoji", emoji)
        : await supabase
            .from("message_reactions")
            .insert({ message_id: messageId, user_id: userId, emoji });
      // 23505 = we already had it (double-tap race), so the optimistic state is
      // fine to keep. Anything else: fall back to server truth for this row.
      if (error && error.code !== "23505") {
        await loadReactions([messageId]);
      }
    },
    [userId, loadReactions]
  );

  return { reactionsByMessage: byMessage, loadReactions, toggleReaction };
}

/**
 * One chat message row, shared by the channel list and the thread panel.
 * All behavior is optional via callbacks, so the same component renders a
 * fully interactive row, a read-only parent preview, or a thread reply.
 */
export function MessageItem({
  message,
  userId,
  grouped = false,
  reactions,
  replyCount = 0,
  saved = false,
  onToggleReaction,
  onOpenThread,
  onEdit,
  onDelete,
  onTogglePin,
  onToggleSaved,
}: {
  message: MessageWithAuthor;
  userId: string;
  /** Continuation of the previous author's burst; hides avatar + header. */
  grouped?: boolean;
  reactions?: MessageReaction[];
  replyCount?: number;
  /** Whether this message is in my private saved list. Drives the label. */
  saved?: boolean;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  onOpenThread?: (messageId: string) => void;
  onEdit?: (messageId: string, content: string) => void;
  onDelete?: (messageId: string) => void;
  /** Pin/unpin from the toolbar. Any channel member can (RPC enforces). */
  onTogglePin?: (messageId: string, pinned: boolean) => void;
  /** Save/unsave privately. Nobody else ever sees this flag. */
  onToggleSaved?: (messageId: string, save: boolean) => void;
}) {
  const isOwn = message.author_id === userId;
  const isDeleted = Boolean(message.deleted_at);
  const isPending = message.id.startsWith("temp-");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  // Tap-to-reveal for touch screens, where :hover never fires.
  const [tapped, setTapped] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState<ReportCategory | null>(
    null
  );
  const [reportDetail, setReportDetail] = useState("");
  const [reportPending, setReportPending] = useState(false);
  // A failed report is answered inside the panel, never as a notice that
  // fades: the pick and the words have to still be there to send again.
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSent, setReportSent] = useState(false);
  const reportUid = useId();

  // The confirmation has done its job once it's been read; the report is on
  // the queue whether or not this is still on screen.
  useEffect(() => {
    if (!reportSent) return;
    const timer = setTimeout(() => setReportSent(false), 6000);
    return () => clearTimeout(timer);
  }, [reportSent]);

  const reactionGroups = useMemo(() => {
    const map = new Map<string, { count: number; mine: boolean }>();
    for (const emoji of REACTION_EMOJI) {
      // Seed with the canonical order so pills render predictably.
      if (reactions?.some((r) => r.emoji === emoji)) {
        map.set(emoji, { count: 0, mine: false });
      }
    }
    for (const r of reactions ?? []) {
      const group = map.get(r.emoji) ?? { count: 0, mine: false };
      group.count += 1;
      if (r.user_id === userId) group.mine = true;
      map.set(r.emoji, group);
    }
    return [...map.entries()];
  }, [reactions, userId]);

  // Others' messages are always reportable; own messages never are.
  const canReport = !isOwn;

  // Polls carry their question in the bubble itself; editing the carrier
  // message's text would only desync the two.
  const canEdit = isOwn && !message.poll_id;

  const hasToolbar =
    !isDeleted &&
    !isPending &&
    !editing &&
    Boolean(
      onToggleReaction ||
        onOpenThread ||
        onTogglePin ||
        onToggleSaved ||
        (isOwn && ((canEdit && onEdit) || onDelete)) ||
        canReport
    );

  function startEdit() {
    setEditText(message.content);
    setEditing(true);
    setTapped(false);
  }

  /**
   * Nothing closes the panel while a report is in flight. On a slow network
   * the answer, sent or failed, has to land somewhere the reporter is still
   * looking. The draft survives an ordinary close, so reopening the flag
   * picks up where they left off rather than starting the report again.
   */
  function closeReport() {
    if (reportPending) return;
    setReportOpen(false);
    setReportError(null);
  }

  async function submitReport() {
    if (reportPending) return;
    if (reportCategory === null) {
      setReportError("Pick the category that fits best.");
      return;
    }
    setReportPending(true);
    setReportError(null);
    // `reports.reason` is not nullable, and a student who picked a category
    // and had nothing to add has still said something, so send the words they
    // chose rather than making the note compulsory.
    const detail = reportDetail.trim();
    // A server action is an HTTP POST: offline or a 500 rejects rather than
    // resolving `{ error }`, and an unhandled rejection would leave this
    // stuck on "Sending…" with no error and nothing to retry.
    let failure: string | undefined;
    try {
      const result = await reportMessage(
        message.id,
        reportCategory,
        detail.length > 0 ? detail : categoryLabel(reportCategory)
      );
      failure = result.error;
    } catch {
      failure = "Couldn't send that report. Check your connection and try again.";
    } finally {
      setReportPending(false);
    }
    if (failure) {
      setReportError(failure);
      return;
    }
    setReportOpen(false);
    setReportCategory(null);
    setReportDetail("");
    setTapped(false);
    setReportSent(true);
  }

  function saveEdit() {
    const trimmed = editText.trim();
    setEditing(false);
    if (!trimmed || trimmed === message.content) return;
    onEdit?.(message.id, trimmed);
  }

  return (
    <article
      onClick={() => setTapped((v) => !v)}
      className={cn(
        "group relative flex gap-2.5 rounded-xl px-2 py-0.5 transition-colors hover:bg-surface-2/40",
        grouped ? "mt-0.5" : "mt-3",
        isPending && "opacity-60"
      )}
    >
      {grouped ? (
        <span className="w-8 shrink-0" aria-hidden />
      ) : (
        <Avatar
          name={message.author.display_name}
          src={message.author.avatar_url}
          size="sm"
          className="mt-0.5"
        />
      )}

      <div className="min-w-0 flex-1">
        {!grouped ? (
          <p className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold">
              {message.author.display_name}
            </span>
            <time
              dateTime={message.created_at}
              className="shrink-0 text-[11px] text-muted"
            >
              {formatMessageTime(message.created_at)}
            </time>
            {message.pinned_at ? (
              <span className="flex shrink-0 items-center text-brand-ink">
                <Pin className="size-3" aria-hidden />
                <span className="sr-only">Pinned</span>
              </span>
            ) : null}
          </p>
        ) : null}

        {isDeleted ? (
          <p className="text-sm italic text-muted">message deleted</p>
        ) : editing ? (
          <div className="mt-1" onClick={(e) => e.stopPropagation()}>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  saveEdit();
                }
                if (e.key === "Escape") {
                  // Don't let Escape bubble up and close the thread panel.
                  e.preventDefault();
                  e.stopPropagation();
                  setEditing(false);
                }
              }}
              rows={2}
              autoFocus
              aria-label="Edit message"
              className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-brand focus:ring-[3px] focus:ring-brand/15"
            />
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={saveEdit}
                className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-full px-3 py-1 text-xs font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                Cancel
              </button>
              <span className="text-[10px] text-muted">
                Enter to save · Esc to cancel
              </span>
            </div>
          </div>
        ) : message.poll_id ? (
          // The message is a poll carrier, so render the live poll in place of
          // the text (content duplicates the question for previews/search).
          <PollBubble
            pollId={message.poll_id}
            userId={userId}
            className={cn(!grouped && "mt-1")}
          />
        ) : (
          <>
            {message.attachment_path ? (
              <AttachmentImage
                path={message.attachment_path}
                alt={`Photo from ${message.author.display_name}`}
                className={cn(!grouped && "mt-1")}
              />
            ) : null}
            {/* "Photo" is the placeholder content for caption-less sends. */}
            {message.attachment_path && message.content === "Photo" ? null : (
              <p
                className={cn(
                  "w-fit max-w-full whitespace-pre-wrap break-words rounded-2xl bg-surface-2 px-3.5 py-2 text-sm leading-relaxed",
                  !grouped && !message.attachment_path && "mt-1 rounded-tl-sm",
                  message.attachment_path && "mt-1"
                )}
              >
                {splitMentions(message.content).map((segment, index) =>
                  segment.mention ? (
                    <span
                      key={index}
                      className="font-semibold text-brand"
                    >
                      {segment.text}
                    </span>
                  ) : (
                    <Fragment key={index}>{segment.text}</Fragment>
                  )
                )}
                {message.edited_at ? (
                  <span className="ml-1.5 align-baseline text-[10px] text-muted">
                    (edited)
                  </span>
                ) : null}
              </p>
            )}
          </>
        )}

        {!isDeleted && reactionGroups.length > 0 ? (
          <div
            className="mt-1 flex flex-wrap gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            {reactionGroups.map(([emoji, group]) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onToggleReaction?.(message.id, emoji)}
                disabled={!onToggleReaction}
                aria-pressed={group.mine}
                aria-label={`${emoji}, ${group.count} ${
                  group.count === 1 ? "reaction" : "reactions"
                }${group.mine ? ", including yours" : ""}`}
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
                  group.mine
                    ? "border-brand/30 bg-brand-soft text-brand-ink"
                    : "border-border bg-surface text-muted hover:border-brand/30 hover:text-foreground"
                )}
              >
                <span aria-hidden>{emoji}</span>
                <span className="font-medium tabular-nums">{group.count}</span>
              </button>
            ))}
          </div>
        ) : null}

        {onOpenThread && replyCount > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenThread(message.id);
            }}
            className="mt-1 flex items-center gap-1 text-xs font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
          >
            <MessageSquareText className="size-3.5" aria-hidden />
            {replyCount} {replyCount === 1 ? "reply" : "replies"}
            <span aria-hidden>→</span>
          </button>
        ) : null}

        {reportSent ? (
          <p
            role="status"
            className="mt-1 flex w-fit items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success"
          >
            <Flag className="size-3" aria-hidden />
            Report sent. A person reads it, usually within a day.
          </p>
        ) : null}
      </div>

      {hasToolbar ? (
        <div
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "absolute -top-3 right-2 z-10 flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5 shadow-soft transition-opacity",
            tapped || pickerOpen || reportOpen
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
          )}
        >
          {onToggleReaction ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                aria-label="Add reaction"
                aria-expanded={pickerOpen}
                className={TOOL_BUTTON}
              >
                <SmilePlus className="size-4" aria-hidden />
              </button>
              {pickerOpen ? (
                <>
                  <button
                    type="button"
                    aria-label="Close reaction picker"
                    onClick={() => setPickerOpen(false)}
                    className="fixed inset-0 z-10 cursor-default"
                    tabIndex={-1}
                  />
                  <div
                    role="group"
                    aria-label="Pick a reaction"
                    className="absolute bottom-full right-0 z-20 mb-1 flex animate-scale-in gap-0.5 rounded-full border border-border bg-surface p-1 shadow-lift"
                  >
                    {REACTION_EMOJI.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          setPickerOpen(false);
                          setTapped(false);
                          onToggleReaction(message.id, emoji);
                        }}
                        aria-label={`React with ${emoji}`}
                        className="rounded-full px-1.5 py-1 text-base transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          {onOpenThread ? (
            <button
              type="button"
              onClick={() => onOpenThread(message.id)}
              aria-label="Reply in thread"
              className={TOOL_BUTTON}
            >
              <MessageSquareText className="size-4" aria-hidden />
            </button>
          ) : null}
          {onToggleSaved ? (
            <button
              type="button"
              onClick={() => {
                setTapped(false);
                onToggleSaved(message.id, !saved);
              }}
              aria-pressed={saved}
              aria-label={saved ? "Remove from saved" : "Save message"}
              className={cn(TOOL_BUTTON, saved && "text-brand")}
            >
              {saved ? (
                <BookmarkCheck className="size-4" aria-hidden />
              ) : (
                <Bookmark className="size-4" aria-hidden />
              )}
            </button>
          ) : null}
          {onTogglePin ? (
            <button
              type="button"
              onClick={() => {
                setTapped(false);
                onTogglePin(message.id, !message.pinned_at);
              }}
              aria-label={message.pinned_at ? "Unpin message" : "Pin message"}
              className={TOOL_BUTTON}
            >
              {message.pinned_at ? (
                <PinOff className="size-4" aria-hidden />
              ) : (
                <Pin className="size-4" aria-hidden />
              )}
            </button>
          ) : null}
          {canEdit && onEdit ? (
            <button
              type="button"
              onClick={startEdit}
              aria-label="Edit message"
              className={TOOL_BUTTON}
            >
              <Pencil className="size-4" aria-hidden />
            </button>
          ) : null}
          {isOwn && onDelete ? (
            <button
              type="button"
              onClick={() => {
                setTapped(false);
                onDelete(message.id);
              }}
              aria-label="Delete message"
              className={cn(TOOL_BUTTON, "hover:text-danger")}
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          ) : null}
          {canReport ? (
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  reportOpen ? closeReport() : setReportOpen(true)
                }
                aria-label="Report message"
                aria-expanded={reportOpen}
                className={cn(TOOL_BUTTON, "hover:text-danger")}
              >
                <Flag className="size-4" aria-hidden />
              </button>
              {reportOpen ? (
                <>
                  <button
                    type="button"
                    aria-label="Close report options"
                    onClick={closeReport}
                    className="fixed inset-0 z-10 cursor-default"
                    tabIndex={-1}
                  />
                  <div
                    role="group"
                    aria-labelledby={`${reportUid}-title`}
                    onKeyDown={(e) => {
                      if (e.key !== "Escape") return;
                      // Don't let Escape bubble up and close the thread panel.
                      e.preventDefault();
                      e.stopPropagation();
                      closeReport();
                    }}
                    className="absolute bottom-full right-0 z-20 mb-1 max-h-[70vh] w-72 animate-scale-in overflow-y-auto rounded-xl border border-border bg-surface p-2.5 shadow-lift"
                  >
                    <p
                      id={`${reportUid}-title`}
                      className="text-xs font-semibold"
                    >
                      Report this message
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted">
                      Reports are private. They won&apos;t know it was you. A
                      person reads every one, usually within a day.
                    </p>

                    <p
                      id={`${reportUid}-category`}
                      className="mt-2.5 text-[11px] font-bold uppercase tracking-widest text-muted"
                    >
                      What&apos;s going on?
                    </p>
                    <div
                      role="radiogroup"
                      aria-labelledby={`${reportUid}-category`}
                      className="mt-1.5 flex flex-wrap gap-1"
                    >
                      {REPORT_CATEGORIES.map((category) => {
                        const selected = reportCategory === category;
                        return (
                          <button
                            key={category}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => {
                              setReportCategory(category);
                              setReportError(null);
                            }}
                            className={cn(
                              "rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
                              selected
                                ? "border-brand-ink bg-brand-soft text-brand-ink"
                                : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
                            )}
                          >
                            {categoryLabel(category)}
                          </button>
                        );
                      })}
                    </div>

                    <label
                      htmlFor={`${reportUid}-detail`}
                      className="mt-2.5 block text-[11px] font-medium text-muted"
                    >
                      Anything to add? Optional.
                    </label>
                    <textarea
                      id={`${reportUid}-detail`}
                      value={reportDetail}
                      onChange={(e) => setReportDetail(e.target.value)}
                      rows={2}
                      maxLength={REASON_MAX}
                      placeholder="A sentence is plenty."
                      className="mt-1 w-full resize-none rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none transition-colors focus:border-brand focus:ring-[3px] focus:ring-brand/15"
                    />

                    <div className="mt-1.5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void submitReport()}
                        className="flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      >
                        {reportPending ? (
                          <Loader2 className="size-3 animate-spin" aria-hidden />
                        ) : null}
                        {reportPending ? "Sending…" : "Send report"}
                      </button>
                      <button
                        type="button"
                        onClick={closeReport}
                        className="rounded-full px-2.5 py-1 text-xs font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      >
                        Cancel
                      </button>
                    </div>
                    {reportError ? (
                      <p
                        role="alert"
                        className="mt-1.5 text-[11px] font-medium text-danger"
                      >
                        {reportError}
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
