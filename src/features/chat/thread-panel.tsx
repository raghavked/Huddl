"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CornerDownRight, Loader2, SendHorizontal, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeInserts } from "@/lib/hooks/use-realtime-inserts";
import { useRealtimeUpdates } from "@/lib/hooks/use-realtime-updates";
import type { Message, MessageWithAuthor, Profile } from "@/lib/types";
import { useBlockedIds } from "@/features/chat/blocks";
import { MessageItem, useReactions } from "@/features/chat/message-item";

const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** The message row plus its joined author — one select shape everywhere. */
const MESSAGE_WITH_AUTHOR_SELECT =
  "*, author:profiles(id, handle, display_name, avatar_url, phone_verified_at, major, grad_year, is_public, university_id)";

/** Message shaped for the realtime hook's Record constraint. */
type MessageRow = Message & Record<string, unknown>;

/**
 * Slide-over thread view, opened via `?thread=<messageId>`. Shows the parent
 * message (read-only), its replies (live), and a composer that posts with
 * parent_id set. Mount with key={threadId} so switching threads remounts.
 */
export function ThreadPanel({
  channelId,
  threadId,
  userId,
  profile,
  parentSeed,
  onClose,
  onReplyPosted,
}: {
  channelId: string;
  threadId: string;
  userId: string;
  profile: Profile;
  /** Parent message when the opener already has it — instant render. */
  parentSeed?: MessageWithAuthor;
  onClose: () => void;
  /** Lets the channel list bump its reply-count badge without a refetch. */
  onReplyPosted?: (parentId: string, replyId: string) => void;
}) {
  const [parent, setParent] = useState<MessageWithAuthor | null>(
    parentSeed ?? null
  );
  const [replies, setReplies] = useState<MessageWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { reactionsByMessage, loadReactions, toggleReaction } =
    useReactions(userId);
  const { blockedIds } = useBlockedIds(userId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingScrollRef = useRef(false);

  const scrollToEnd = useCallback((behavior: ScrollBehavior) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // Initial load: parent (if we weren't handed it) + all replies + reactions.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    void (async () => {
      if (!parentSeed) {
        const { data } = await supabase
          .from("messages")
          .select(MESSAGE_WITH_AUTHOR_SELECT)
          .eq("id", threadId)
          .maybeSingle();
        if (!cancelled && data) {
          setParent(data as unknown as MessageWithAuthor);
        }
      }
      const { data: rows } = await supabase
        .from("messages")
        .select(MESSAGE_WITH_AUTHOR_SELECT)
        .eq("parent_id", threadId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      const loaded = (rows ?? []) as unknown as MessageWithAuthor[];
      setReplies(loaded);
      setLoading(false);
      pendingScrollRef.current = true;
      void loadReactions(loaded.map((m) => m.id));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // Opening a thread reads it: clear any unread thread_reply notifications
  // that point back into this thread, so the bell badge stays accurate.
  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .like("link", `/channels/${channelId}?thread=${threadId}%`)
      .is("read_at", null)
      .then(() => undefined);
  }, [channelId, threadId]);

  // Keep the newest reply in view.
  useEffect(() => {
    if (!pendingScrollRef.current) return;
    pendingScrollRef.current = false;
    scrollToEnd("auto");
  }, [replies, scrollToEnd]);

  // Escape closes the panel (message edit boxes stop propagation themselves).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const appendReply = useCallback((row: MessageWithAuthor) => {
    setReplies((prev) => {
      if (prev.some((m) => m.id === row.id)) return prev;
      return [...prev, row];
    });
    pendingScrollRef.current = true;
  }, []);

  useRealtimeInserts<MessageRow>(
    "messages",
    `parent_id=eq.${threadId}`,
    (row) => {
      onReplyPosted?.(threadId, row.id);
      if (row.author_id === userId) return; // optimistic path covers our own
      const supabase = createClient();
      void supabase
        .from("messages")
        .select(MESSAGE_WITH_AUTHOR_SELECT)
        .eq("id", row.id)
        .single()
        .then(({ data }) => {
          if (data) appendReply(data as unknown as MessageWithAuthor);
        });
    }
  );

  // Others' edits and soft-deletes on replies: patch the matching reply in
  // place. UPDATE payloads carry only the row's own columns, so we merge just
  // the mutable fields and keep the joined author. Temp optimistic replies use
  // `temp-*` ids and never match a real id; idempotent replace-by-id means our
  // own echoed edits collapse to a no-op.
  useRealtimeUpdates<MessageRow>(
    "messages",
    `parent_id=eq.${threadId}`,
    (row) => {
      setReplies((prev) => {
        let changed = false;
        const next = prev.map((m) => {
          if (m.id !== row.id) return m;
          if (
            m.content === row.content &&
            m.edited_at === row.edited_at &&
            m.deleted_at === row.deleted_at
          ) {
            return m;
          }
          changed = true;
          return {
            ...m,
            content: row.content,
            edited_at: row.edited_at,
            deleted_at: row.deleted_at,
          };
        });
        return changed ? next : prev;
      });
    }
  );

  // Autosize the composer with its content.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft]);

  async function handleSend() {
    const content = draft.trim();
    if (!content) return;
    setError(null);
    setDraft("");
    const tempId = `temp-${crypto.randomUUID()}`;
    appendReply({
      id: tempId,
      channel_id: channelId,
      author_id: userId,
      parent_id: threadId,
      content,
      attachment_path: null,
      poll_id: null,
      pinned_at: null,
      pinned_by: null,
      edited_at: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
      author: profile,
    });
    setSending(true);
    const supabase = createClient();
    const { data, error: insertError } = await supabase
      .from("messages")
      .insert({
        channel_id: channelId,
        author_id: userId,
        content,
        parent_id: threadId,
      })
      .select(MESSAGE_WITH_AUTHOR_SELECT)
      .single();
    setSending(false);
    if (insertError || !data) {
      setReplies((prev) => prev.filter((m) => m.id !== tempId));
      setDraft(content);
      setError("Couldn't send your reply. Try again.");
      return;
    }
    const real = data as unknown as MessageWithAuthor;
    setReplies((prev) => {
      const without = prev.filter((m) => m.id !== tempId && m.id !== real.id);
      return [...without, real];
    });
    pendingScrollRef.current = true;
    onReplyPosted?.(threadId, real.id);
  }

  async function handleEdit(id: string, content: string) {
    const previous = replies.find((m) => m.id === id);
    if (!previous) return;
    const editedAt = new Date().toISOString();
    setReplies((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content, edited_at: editedAt } : m))
    );
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("messages")
      .update({ content, edited_at: editedAt })
      .eq("id", id)
      .eq("author_id", userId);
    if (updateError) {
      setReplies((prev) => prev.map((m) => (m.id === id ? previous : m)));
      setError("Couldn't save your edit. Try again.");
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this reply? This can't be undone.")) return;
    const previous = replies.find((m) => m.id === id);
    if (!previous) return;
    const deletedAt = new Date().toISOString();
    setReplies((prev) =>
      prev.map((m) => (m.id === id ? { ...m, deleted_at: deletedAt } : m))
    );
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("messages")
      .update({ deleted_at: deletedAt })
      .eq("id", id)
      .eq("author_id", userId);
    if (updateError) {
      setReplies((prev) => prev.map((m) => (m.id === id ? previous : m)));
      setError("Couldn't delete the reply. Try again.");
    }
  }

  // Blocked students' replies never render; a blocked parent shows a quiet
  // placeholder instead of its content.
  const visibleReplies = useMemo(
    () => replies.filter((m) => !blockedIds.has(m.author_id)),
    [replies, blockedIds]
  );
  const parentHidden = Boolean(parent && blockedIds.has(parent.author_id));

  return (
    <div
      className="fixed inset-0 z-50 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Thread"
    >
      <button
        type="button"
        aria-label="Close thread"
        onClick={onClose}
        tabIndex={-1}
        className="absolute inset-0 hidden cursor-default bg-black/40 sm:block"
      />
      <div className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-border bg-surface shadow-lift sm:max-w-md">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <CornerDownRight className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold tracking-tight">
                Thread
              </h2>
              <p aria-live="polite" className="truncate text-[11px] text-muted">
                {loading
                  ? "Loading…"
                  : `${visibleReplies.length} ${
                      visibleReplies.length === 1 ? "reply" : "replies"
                    }`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close thread"
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 pb-3 pt-4">
          {parentHidden ? (
            <p className="px-2 py-3 text-sm italic text-muted">
              This message is hidden.
            </p>
          ) : parent ? (
            <MessageItem message={parent} userId={userId} />
          ) : loading ? (
            <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading message…
            </div>
          ) : (
            <p className="px-2 py-3 text-sm italic text-muted">
              This message is no longer available.
            </p>
          )}

          <div
            className="my-3 flex items-center gap-2 px-2"
            role="separator"
            aria-label="Replies"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Replies
            </span>
            <span className="h-px flex-1 bg-border" aria-hidden />
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted" aria-hidden />
              <span className="sr-only">Loading replies…</span>
            </div>
          ) : visibleReplies.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted">
              No replies yet — start the thread.
            </p>
          ) : (
            visibleReplies.map((m, i) => {
              const prev = visibleReplies[i - 1];
              const grouped = Boolean(
                prev &&
                  prev.author_id === m.author_id &&
                  new Date(m.created_at).getTime() -
                    new Date(prev.created_at).getTime() <
                    GROUP_WINDOW_MS
              );
              return (
                <MessageItem
                  key={m.id}
                  message={m}
                  userId={userId}
                  grouped={grouped}
                  reactions={reactionsByMessage[m.id]}
                  onToggleReaction={toggleReaction}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              );
            })
          )}
        </div>

        {error ? (
          <p
            role="alert"
            className="mx-3 mb-2 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger"
          >
            {error}
          </p>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          aria-label="Send a reply"
          className="shrink-0 border-t border-border px-3 pb-3 pt-2"
        >
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-background px-3 py-2 transition-colors focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand/15">
            <label htmlFor="thread-composer" className="sr-only">
              Reply in thread
            </label>
            <textarea
              id="thread-composer"
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              rows={1}
              autoFocus
              placeholder="Reply in thread"
              className="max-h-32 flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-muted"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending}
              aria-label="Send reply"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg shadow-soft transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <SendHorizontal className="size-4" aria-hidden />
              )}
            </button>
          </div>
          <p className="mt-1 px-1 text-[10px] text-muted">
            Enter to send · Shift+Enter for a new line
          </p>
        </form>
      </div>
    </div>
  );
}
