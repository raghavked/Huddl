"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Loader2,
  SendHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeInserts } from "@/lib/hooks/use-realtime-inserts";
import { useRealtimeUpdates } from "@/lib/hooks/use-realtime-updates";
import type { DmMessage, Profile } from "@/lib/types";
import { cn, formatMessageTime } from "@/lib/utils";

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const PAGE_SIZE = 50;

/** DmMessage shaped for the realtime hook's Record constraint. */
type DmMessageRow = DmMessage & Record<string, unknown>;

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

/**
 * The 1:1 conversation surface: header linking to the other student's
 * profile, day-separated bubbles (own right/brand, theirs left/surface),
 * realtime inserts, optimistic sends, soft-delete of own messages, and
 * read-cursor upkeep on mount + on incoming messages.
 */
export function DmRoom({
  threadId,
  userId,
  other,
  initialMessages,
  initialLastReadAt,
}: {
  threadId: string;
  userId: string;
  other: Profile;
  initialMessages: DmMessage[];
  initialLastReadAt: string;
}) {
  const [messages, setMessages] = useState<DmMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "New" divider: frozen from the server-rendered read cursor, so it doesn't
  // vanish the moment we advance last_read_at on mount.
  const [firstUnreadId] = useState<string | null>(() => {
    const lastRead = new Date(initialLastReadAt).getTime();
    return (
      initialMessages.find(
        (m) =>
          m.author_id !== userId &&
          new Date(m.created_at).getTime() > lastRead
      )?.id ?? null
    );
  });

  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const nearBottomRef = useRef(true);
  const pendingScrollRef = useRef<ScrollBehavior | null>("auto");

  const markRead = useCallback(() => {
    const supabase = createClient();
    void supabase
      .from("dm_participants")
      .update({ last_read_at: new Date().toISOString() })
      .eq("thread_id", threadId)
      .eq("user_id", userId)
      .then(() => undefined);
    // Clear the bell badge: mark any unread notifications pointing at this
    // thread as read, on mount and on each incoming message while open.
    void supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("link", `/messages/${threadId}`)
      .is("read_at", null)
      .then(() => undefined);
  }, [threadId, userId]);

  // Mount: advance the read cursor once.
  useEffect(() => {
    markRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll requests are queued by append/send and honored after render.
  useEffect(() => {
    const behavior = pendingScrollRef.current;
    if (!behavior) return;
    pendingScrollRef.current = null;
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, [messages]);

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    nearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  const appendMessage = useCallback(
    (row: DmMessage, scroll: ScrollBehavior | null) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === row.id)) return prev;
        return [...prev, row];
      });
      if (scroll) pendingScrollRef.current = scroll;
    },
    []
  );

  useRealtimeInserts<DmMessageRow>(
    "dm_messages",
    `thread_id=eq.${threadId}`,
    (row) => {
      if (row.author_id === userId) return; // own echo — optimistic path has it
      appendMessage(row as DmMessage, nearBottomRef.current ? "smooth" : null);
      markRead(); // we're looking at the thread, so it's read on arrival
    }
  );

  // Others' edits and soft-deletes: patch the matching bubble in place. Temp
  // optimistic rows use `temp-*` ids and never match a real id; idempotent
  // replace-by-id means our own echoed changes collapse to a no-op.
  useRealtimeUpdates<DmMessageRow>(
    "dm_messages",
    `thread_id=eq.${threadId}`,
    (row) => {
      setMessages((prev) => {
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
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  async function handleSend() {
    const content = draft.trim();
    if (!content) return;
    setError(null);
    setDraft("");
    const tempId = `temp-${crypto.randomUUID()}`;
    appendMessage(
      {
        id: tempId,
        thread_id: threadId,
        author_id: userId,
        content,
        edited_at: null,
        deleted_at: null,
        created_at: new Date().toISOString(),
      },
      "smooth"
    );
    setSending(true);
    const supabase = createClient();
    const { data, error: insertError } = await supabase
      .from("dm_messages")
      .insert({ thread_id: threadId, author_id: userId, content })
      .select("*")
      .single();
    setSending(false);
    if (insertError || !data) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setDraft(content);
      setError(
        "Couldn't send your message. Check your connection and try again."
      );
      return;
    }
    // Reconcile: swap the temp row for the real one (dedupe against a
    // realtime echo that may have landed first).
    const real = data as DmMessage;
    setMessages((prev) => {
      const without = prev.filter((m) => m.id !== tempId && m.id !== real.id);
      return [...without, real];
    });
    markRead();
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this message? This can't be undone.")) return;
    const previous = messages.find((m) => m.id === id);
    if (!previous) return;
    const deletedAt = new Date().toISOString();
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, deleted_at: deletedAt } : m))
    );
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("dm_messages")
      .update({ deleted_at: deletedAt })
      .eq("id", id)
      .eq("author_id", userId);
    if (updateError) {
      setMessages((prev) => prev.map((m) => (m.id === id ? previous : m)));
      setError("Couldn't delete the message. Try again.");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-1 border-b border-border py-3">
        <Link
          href="/messages"
          aria-label="Back to messages"
          className="-ml-2 rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <Link
          href={`/u/${other.handle}`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-0.5 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <Avatar
            name={other.display_name}
            src={other.avatar_url}
            size="md"
          />
          <span className="min-w-0">
            <span
              role="heading"
              aria-level={1}
              className="block truncate text-base font-bold"
            >
              {other.display_name}
            </span>
            <span className="block truncate text-xs text-muted">
              @{other.handle}
            </span>
          </span>
        </Link>
      </header>

      <div
        ref={listRef}
        onScroll={handleScroll}
        role="log"
        aria-label={`Conversation with ${other.display_name}`}
        className="flex-1 overflow-y-auto pb-2 pt-4"
      >
        {messages.length < PAGE_SIZE ? (
          <div className="px-2 pb-4 pt-2 text-center">
            <Avatar
              name={other.display_name}
              src={other.avatar_url}
              size="lg"
              className="mx-auto"
            />
            <p className="mt-2 font-bold">{other.display_name}</p>
            <p className="mx-auto max-w-sm text-sm text-muted">
              {messages.length === 0
                ? `This is the start of your conversation with ${other.display_name}. Say hi!`
                : `This is the very beginning of your conversation with ${other.display_name}.`}
            </p>
          </div>
        ) : null}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const own = m.author_id === userId;
          const isTemp = m.id.startsWith("temp-");
          const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
          const isUnreadStart = m.id === firstUnreadId;
          const grouped =
            !newDay &&
            !isUnreadStart &&
            Boolean(
              prev &&
                prev.author_id === m.author_id &&
                new Date(m.created_at).getTime() -
                  new Date(prev.created_at).getTime() <
                  GROUP_WINDOW_MS
            );
          const lastOfGroup =
            !next ||
            next.author_id !== m.author_id ||
            next.id === firstUnreadId ||
            dayKey(next.created_at) !== dayKey(m.created_at) ||
            new Date(next.created_at).getTime() -
              new Date(m.created_at).getTime() >=
              GROUP_WINDOW_MS;

          return (
            <Fragment key={m.id}>
              {newDay ? (
                <div
                  role="separator"
                  aria-label={new Date(m.created_at).toLocaleDateString([], {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                  className={cn(
                    "flex items-center justify-center",
                    i === 0 ? "mb-2" : "my-4"
                  )}
                >
                  <span className="rounded-full bg-surface-2 px-3 py-1 text-[11px] font-medium text-muted">
                    {formatMessageTime(m.created_at)}
                  </span>
                </div>
              ) : null}

              {isUnreadStart ? (
                <div
                  role="separator"
                  aria-label="New messages"
                  className="mt-3 flex items-center gap-2 px-1"
                >
                  <span className="h-px flex-1 bg-danger/40" aria-hidden />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-danger">
                    New
                  </span>
                </div>
              ) : null}

              <div
                className={cn(
                  "group flex items-end gap-2 px-1",
                  own ? "justify-end" : "justify-start",
                  grouped ? "mt-0.5" : "mt-3"
                )}
              >
                {!own ? (
                  lastOfGroup ? (
                    <Avatar
                      name={other.display_name}
                      src={other.avatar_url}
                      size="sm"
                    />
                  ) : (
                    <span className="w-8 shrink-0" aria-hidden />
                  )
                ) : null}

                {own && !m.deleted_at && !isTemp ? (
                  <button
                    type="button"
                    onClick={() => void handleDelete(m.id)}
                    aria-label="Delete message"
                    className="flex size-7 shrink-0 items-center justify-center self-center rounded-md text-muted opacity-0 transition-opacity hover:bg-surface-2 hover:text-danger focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand group-hover:opacity-100 group-focus-within:opacity-100"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                ) : null}

                <div
                  title={formatMessageTime(m.created_at)}
                  className={cn(
                    "max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm",
                    m.deleted_at
                      ? "border border-dashed border-border bg-surface-2/60 italic text-muted"
                      : own
                        ? "bg-brand text-brand-fg"
                        : "bg-surface-2 text-foreground",
                    lastOfGroup && !m.deleted_at
                      ? own
                        ? "rounded-br-sm"
                        : "rounded-bl-sm"
                      : null,
                    isTemp ? "opacity-70" : null
                  )}
                >
                  {m.deleted_at ? "Message deleted" : m.content}
                  <span className="sr-only">
                    {own ? " — sent by you" : ` — from ${other.display_name}`}
                  </span>
                </div>
              </div>

              {lastOfGroup ? (
                <p
                  className={cn(
                    "mt-1 text-[10px] text-muted",
                    own ? "pr-1 text-right" : "pl-11 text-left"
                  )}
                >
                  {isTemp ? "Sending…" : formatMessageTime(m.created_at)}
                </p>
              ) : null}
            </Fragment>
          );
        })}
      </div>

      {error ? (
        <p
          role="alert"
          className="mb-2 flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="rounded-full p-1 transition-colors hover:bg-danger/10"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </p>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
        className="shrink-0 pb-3 pt-1"
      >
        <div className="flex items-end gap-2 rounded-card border border-border bg-surface px-3 py-2 transition-colors focus-within:border-brand">
          <label htmlFor="dm-composer" className="sr-only">
            Message {other.display_name}
          </label>
          <textarea
            id="dm-composer"
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
            placeholder={`Message ${other.display_name}`}
            className="max-h-40 flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            aria-label="Send message"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <SendHorizontal className="size-4" aria-hidden />
            )}
          </button>
        </div>
        <p className="mt-1 hidden px-1 text-[10px] text-muted sm:block">
          Enter to send · Shift+Enter for a new line
        </p>
      </form>
    </div>
  );
}
