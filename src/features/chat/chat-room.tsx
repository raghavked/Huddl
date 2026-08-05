"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormStatus } from "react-dom";
import { AlertCircle, Hash, Loader2, SendHorizontal, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeInserts } from "@/lib/hooks/use-realtime-inserts";
import { useRealtimeUpdates } from "@/lib/hooks/use-realtime-updates";
import type {
  Channel,
  ChannelMember,
  Message,
  MessageWithAuthor,
  Profile,
} from "@/lib/types";
import { MessageItem, useReactions } from "@/features/chat/message-item";
import { ThreadPanel } from "@/features/chat/thread-panel";

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const PAGE_SIZE = 50;

/** Message shaped for the realtime hook's Record constraint. */
type MessageRow = Message & Record<string, unknown>;

/**
 * The live channel surface: message list (grouped bursts, reactions, thread
 * badges), realtime inserts, read-cursor upkeep, and an optimistic composer.
 * The thread slide-over rides on the ?thread=<messageId> search param.
 */
export function ChatRoom({
  channel,
  membership,
  profile,
  userId,
  initialMessages,
}: {
  channel: Channel;
  membership: ChannelMember;
  profile: Profile;
  userId: string;
  initialMessages: MessageWithAuthor[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const threadId = searchParams.get("thread");

  const [messages, setMessages] = useState<MessageWithAuthor[]>(initialMessages);
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { reactionsByMessage, loadReactions, toggleReaction } =
    useReactions(userId);

  // "New" divider: frozen from the server-rendered read cursor, so it doesn't
  // vanish the moment we advance last_read_at on mount.
  const [firstUnreadId] = useState<string | null>(() => {
    const lastRead = new Date(membership.last_read_at).getTime();
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
  const countedRepliesRef = useRef(new Set<string>());

  const markRead = useCallback(() => {
    const supabase = createClient();
    void supabase
      .from("channel_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("channel_id", channel.id)
      .eq("user_id", userId)
      .then(() => undefined);
  }, [channel.id, userId]);

  // Mount: advance the read cursor, batch-load reactions + reply counts.
  useEffect(() => {
    markRead();
    const ids = initialMessages.map((m) => m.id);
    void loadReactions(ids);
    if (ids.length > 0) {
      const supabase = createClient();
      void supabase
        .from("messages")
        .select("id, parent_id")
        .in("parent_id", ids)
        .is("deleted_at", null)
        .then(({ data }) => {
          if (!data) return;
          const counts: Record<string, number> = {};
          for (const row of data as { id: string; parent_id: string }[]) {
            countedRepliesRef.current.add(row.id);
            counts[row.parent_id] = (counts[row.parent_id] ?? 0) + 1;
          }
          setReplyCounts(counts);
        });
    }
    // Initial data only — runs once per channel mount.
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
    (row: MessageWithAuthor, scroll: ScrollBehavior | null) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === row.id)) return prev;
        return [...prev, row];
      });
      if (scroll) pendingScrollRef.current = scroll;
    },
    []
  );

  /** Count each reply exactly once, whether it arrives via realtime echo,
   *  the initial batch load, or the thread panel's post callback. */
  const bumpReplyCount = useCallback((parentId: string, replyId: string) => {
    if (countedRepliesRef.current.has(replyId)) return;
    countedRepliesRef.current.add(replyId);
    setReplyCounts((prev) => ({
      ...prev,
      [parentId]: (prev[parentId] ?? 0) + 1,
    }));
  }, []);

  useRealtimeInserts<MessageRow>(
    "messages",
    `channel_id=eq.${channel.id}`,
    (row) => {
      markRead();
      if (row.parent_id) {
        // Thread replies never join the main list — just bump the badge.
        bumpReplyCount(row.parent_id, row.id);
        return;
      }
      if (row.author_id === userId) return; // own echo — optimistic path has it
      const supabase = createClient();
      void supabase
        .from("messages")
        .select(
          "*, author:profiles(id, handle, display_name, avatar_url, phone_verified_at, major, grad_year, is_public, university_id)"
        )
        .eq("id", row.id)
        .single()
        .then(({ data }) => {
          if (data) {
            appendMessage(
              data as unknown as MessageWithAuthor,
              nearBottomRef.current ? "smooth" : null
            );
          }
        });
    }
  );

  // Others' edits and soft-deletes: patch the matching row in place. Realtime
  // UPDATE payloads carry only the row's own columns, so we merge just the
  // mutable fields and keep the joined author. Temp optimistic rows use
  // `temp-*` ids and never match a real id; idempotent replace-by-id means our
  // own echoed edits collapse to a no-op.
  useRealtimeUpdates<MessageRow>(
    "messages",
    `channel_id=eq.${channel.id}`,
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
        channel_id: channel.id,
        author_id: userId,
        parent_id: null,
        content,
        attachment_path: null,
        edited_at: null,
        deleted_at: null,
        created_at: new Date().toISOString(),
        author: profile,
      },
      "smooth"
    );
    setSending(true);
    const supabase = createClient();
    const { data, error: insertError } = await supabase
      .from("messages")
      .insert({ channel_id: channel.id, author_id: userId, content })
      .select(
        "*, author:profiles(id, handle, display_name, avatar_url, phone_verified_at, major, grad_year, is_public, university_id)"
      )
      .single();
    setSending(false);
    if (insertError || !data) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setDraft(content);
      setError("Couldn't send your message. Check your connection and try again.");
      return;
    }
    // Reconcile: swap the temp row for the real one (the realtime echo may
    // have landed first — dedupe by id either way).
    const real = data as unknown as MessageWithAuthor;
    setMessages((prev) => {
      const without = prev.filter((m) => m.id !== tempId && m.id !== real.id);
      return [...without, real];
    });
    markRead();
  }

  async function handleEdit(id: string, content: string) {
    const previous = messages.find((m) => m.id === id);
    if (!previous) return;
    const editedAt = new Date().toISOString();
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content, edited_at: editedAt } : m))
    );
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("messages")
      .update({ content, edited_at: editedAt })
      .eq("id", id)
      .eq("author_id", userId);
    if (updateError) {
      setMessages((prev) => prev.map((m) => (m.id === id ? previous : m)));
      setError("Couldn't save your edit. Try again.");
    }
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
      .from("messages")
      .update({ deleted_at: deletedAt })
      .eq("id", id)
      .eq("author_id", userId);
    if (updateError) {
      setMessages((prev) => prev.map((m) => (m.id === id ? previous : m)));
      setError("Couldn't delete the message. Try again.");
    }
  }

  const openThread = useCallback(
    (id: string) => {
      router.push(`${pathname}?thread=${id}`, { scroll: false });
    },
    [router, pathname]
  );

  const closeThread = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        onScroll={handleScroll}
        aria-label={`Messages in ${channel.name}`}
        className="flex-1 overflow-y-auto pb-2 pt-4"
      >
        {messages.length < PAGE_SIZE ? (
          <div className="px-2 pb-2">
            <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand-strong">
              <Hash className="size-6" aria-hidden />
            </span>
            <p className="mt-2 font-bold">Welcome to #{channel.slug}</p>
            <p className="text-sm text-muted">
              {messages.length === 0
                ? "Nobody's said anything yet — be the first to say hi."
                : "This is the very beginning of the channel."}
            </p>
          </div>
        ) : null}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const isUnreadStart = m.id === firstUnreadId;
          const grouped =
            !isUnreadStart &&
            Boolean(
              prev &&
                prev.author_id === m.author_id &&
                new Date(m.created_at).getTime() -
                  new Date(prev.created_at).getTime() <
                  GROUP_WINDOW_MS
            );
          return (
            <Fragment key={m.id}>
              {isUnreadStart ? (
                <div
                  role="separator"
                  aria-label="New messages"
                  className="mt-3 flex items-center gap-2 px-2"
                >
                  <span className="h-px flex-1 bg-danger/40" aria-hidden />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-danger">
                    New
                  </span>
                </div>
              ) : null}
              <MessageItem
                message={m}
                userId={userId}
                grouped={grouped}
                reactions={reactionsByMessage[m.id]}
                replyCount={replyCounts[m.id] ?? 0}
                onToggleReaction={toggleReaction}
                onOpenThread={openThread}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
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
          <label htmlFor="chat-composer" className="sr-only">
            Message #{channel.slug}
          </label>
          <textarea
            id="chat-composer"
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
            placeholder={`Message #${channel.slug}`}
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

      {threadId ? (
        <ThreadPanel
          key={threadId}
          channelId={channel.id}
          threadId={threadId}
          userId={userId}
          profile={profile}
          parentSeed={messages.find((m) => m.id === threadId)}
          onClose={closeThread}
          onReplyPosted={bumpReplyCount}
        />
      ) : null}
    </div>
  );
}

/**
 * Submit button for the server-action join form on the channel page —
 * client-side so it can show a pending spinner via useFormStatus.
 */
export function JoinChannelButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {pending ? "Joining…" : "Join channel"}
    </button>
  );
}
