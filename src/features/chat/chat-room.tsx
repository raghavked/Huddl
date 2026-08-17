"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  AlertCircle,
  BarChart3,
  ImagePlus,
  Loader2,
  SendHorizontal,
  X,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { RoomTile } from "@/components/room-tile";
import { Badge, Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useMessageStream } from "@/lib/hooks/use-message-stream";
import { typingLabel, useTyping } from "@/lib/hooks/use-typing";
import type {
  Channel,
  ChannelMember,
  Message,
  MessageWithAuthor,
  Profile,
} from "@/lib/types";
import {
  MAX_ATTACHMENT_BYTES,
  uploadChatImage,
} from "@/features/chat/attachments";
import { useBlockedIds } from "@/features/chat/blocks";
import {
  IMAGE_ACCEPT_ATTR,
  isAcceptedImageType,
} from "@/lib/image-types";
import {
  filterMentionCandidates,
  insertMention,
  mentionQuery,
  type MentionCandidate,
} from "@/features/chat/mentions";
import { MessageItem, useReactions } from "@/features/chat/message-item";
import { roomTitle } from "@/lib/room-identity";
import { PinnedBar } from "@/features/chat/pinned-bar";
import { ThreadPanel } from "@/features/chat/thread-panel";
import { PollComposer } from "@/features/polls/poll-composer";
import { cn } from "@/lib/utils";

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const PAGE_SIZE = 50;

/** The message row plus its joined author: one select shape everywhere. */
const MESSAGE_WITH_AUTHOR_SELECT =
  "*, author:profiles(id, handle, display_name, avatar_url, verified_at, major, grad_year, is_public, university_id)";

const COMPOSER_ICON_BUTTON =
  "flex size-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50";

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

  // The room's spoken name: never the slug, never hash-prefixed.
  const title = roomTitle(channel.name, channel.slug);

  const [messages, setMessages] = useState<MessageWithAuthor[]>(initialMessages);
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const [pinned, setPinned] = useState<MessageWithAuthor[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Saved messages: my private bookmarks among the loaded rows, so the
  // toolbar can tell "Save message" from "Remove from saved".
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const { reactionsByMessage, loadReactions, toggleReaction } =
    useReactions(userId);
  const { blockedIds } = useBlockedIds(userId);

  // Mention autocomplete: track the caret, load the member roster lazily on
  // the first `@`, and surface up to five matches above the composer.
  const [caret, setCaret] = useState(0);
  const [mentionMembers, setMentionMembers] = useState<
    MentionCandidate[] | null
  >(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const mentionPartial = mentionQuery(draft.slice(0, caret));

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nearBottomRef = useRef(true);
  const pendingScrollRef = useRef<ScrollBehavior | null>("auto");
  const countedRepliesRef = useRef(new Set<string>());
  const pinnedIdsRef = useRef<Set<string>>(new Set());

  const markRead = useCallback(() => {
    const supabase = createClient();
    void supabase
      .from("channel_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("channel_id", channel.id)
      .eq("user_id", userId)
      .then(() => undefined);
  }, [channel.id, userId]);

  /** The channel's pinned list, newest pin first (small by construction). */
  const refreshPinned = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("messages")
      .select(MESSAGE_WITH_AUTHOR_SELECT)
      .eq("channel_id", channel.id)
      .not("pinned_at", "is", null)
      .is("deleted_at", null)
      .order("pinned_at", { ascending: false });
    if (data) setPinned(data as unknown as MessageWithAuthor[]);
  }, [channel.id]);

  useEffect(() => {
    pinnedIdsRef.current = new Set(pinned.map((p) => p.id));
  }, [pinned]);

  /** Which of these messages I've saved. One query per loaded page keeps
   *  the toolbar label truthful. */
  const loadSaved = useCallback(
    async (messageIds: string[]) => {
      if (messageIds.length === 0) return;
      const supabase = createClient();
      const { data } = await supabase
        .from("message_bookmarks")
        .select("message_id")
        .eq("user_id", userId)
        .in("message_id", messageIds);
      if (!data) return;
      setSavedIds((prev) => {
        const next = new Set(prev);
        for (const row of data as { message_id: string }[]) {
          next.add(row.message_id);
        }
        return next;
      });
    },
    [userId]
  );

  // Mount: advance the read cursor, batch-load reactions + reply counts.
  useEffect(() => {
    markRead();
    void refreshPinned();
    const ids = initialMessages.map((m) => m.id);
    void loadReactions(ids);
    void loadSaved(ids);
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
    // Initial data only: runs once per channel mount.
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

  useMessageStream<MessageRow>(`room:${channel.id}`, {
    onInsert: (row) => {
      markRead();
      if (row.parent_id) {
        // Thread replies never join the main list, so just bump the badge.
        bumpReplyCount(row.parent_id, row.id);
        return;
      }
      if (row.author_id === userId) return; // own echo; optimistic path has it
      const supabase = createClient();
      void supabase
        .from("messages")
        .select(MESSAGE_WITH_AUTHOR_SELECT)
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
    },
    // Others' edits and soft-deletes: patch the matching row in place. The
    // broadcast record carries only the row's own columns, so we merge just
    // the mutable fields and keep the joined author. Temp optimistic rows use
    // `temp-*` ids and never match a real id; idempotent replace-by-id means
    // our own echoed edits collapse to a no-op.
    onUpdate: (row) => {
      setMessages((prev) => {
        let changed = false;
        const next = prev.map((m) => {
          if (m.id !== row.id) return m;
          if (
            m.content === row.content &&
            m.edited_at === row.edited_at &&
            m.deleted_at === row.deleted_at &&
            m.pinned_at === row.pinned_at &&
            m.pinned_by === row.pinned_by
          ) {
            return m;
          }
          changed = true;
          return {
            ...m,
            content: row.content,
            edited_at: row.edited_at,
            deleted_at: row.deleted_at,
            pinned_at: row.pinned_at,
            pinned_by: row.pinned_by,
          };
        });
        return changed ? next : prev;
      });
      // Pinned-strip upkeep: pins can flip on rows outside the loaded window,
      // and deleting a pinned message unlists it, so refetch when state differs.
      const isPinnedNow = Boolean(row.pinned_at) && !row.deleted_at;
      if (pinnedIdsRef.current.has(row.id) !== isPinnedNow) {
        void refreshPinned();
      }
    },
  });

  // Autosize the composer with its content.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  // Lazy-load the mention roster the first time an `@` token appears.
  const mentionActive = mentionPartial !== null;
  useEffect(() => {
    if (!mentionActive || mentionMembers !== null) return;
    const supabase = createClient();
    void supabase
      .from("channel_members")
      .select("profile:profiles(id, handle, display_name, avatar_url)")
      .eq("channel_id", channel.id)
      .limit(400)
      .then(({ data }) => {
        const rows = (data ?? []) as unknown as {
          profile: MentionCandidate | null;
        }[];
        setMentionMembers(
          rows
            .map((r) => r.profile)
            .filter((p): p is MentionCandidate => Boolean(p))
        );
      });
  }, [mentionActive, mentionMembers, channel.id]);

  // A fresh token resets the highlight and clears any Escape dismissal.
  useEffect(() => {
    setMentionIndex(0);
    setMentionDismissed(false);
  }, [mentionPartial]);

  const mentionSuggestions = useMemo(() => {
    if (mentionPartial === null || mentionDismissed || !mentionMembers) {
      return [];
    }
    return filterMentionCandidates(mentionMembers, mentionPartial, userId);
  }, [mentionPartial, mentionDismissed, mentionMembers, userId]);

  function applyMention(candidate: MentionCandidate) {
    const { next, caret: nextCaret } = insertMention(
      draft,
      caret,
      candidate.handle
    );
    setDraft(next);
    setCaret(nextCaret);
    const el = textareaRef.current;
    if (el) {
      el.focus();
      requestAnimationFrame(() => el.setSelectionRange(nextCaret, nextCaret));
    }
  }

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
        poll_id: null,
        pinned_at: null,
        pinned_by: null,
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
      .select(MESSAGE_WITH_AUTHOR_SELECT)
      .single();
    setSending(false);
    if (insertError || !data) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setDraft(content);
      setError("Couldn't send your message. Check your connection and try again.");
      return;
    }
    // Reconcile: swap the temp row for the real one (the realtime echo may
    // have landed first, so dedupe by id either way).
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

  /** Pick → upload to the student's own chat-uploads folder → send. Any
   *  typed draft rides along as the caption; otherwise content is "Photo". */
  async function handleAttachmentPick(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    event.target.value = ""; // picking the same file twice should still fire
    if (!file) return;
    if (!isAcceptedImageType(file.type)) {
      setError("Photos only here. Pick an image file.");
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError("That image is over 10 MB. Try a smaller one.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const path = await uploadChatImage(file, userId);
      const content = draft.trim() || "Photo";
      const supabase = createClient();
      const { data, error: insertError } = await supabase
        .from("messages")
        .insert({
          channel_id: channel.id,
          author_id: userId,
          content,
          attachment_path: path,
        })
        .select(MESSAGE_WITH_AUTHOR_SELECT)
        .single();
      if (insertError || !data) throw insertError ?? new Error("send failed");
      setDraft("");
      appendMessage(data as unknown as MessageWithAuthor, "smooth");
      markRead();
    } catch {
      setError("Couldn't send your photo. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  /** Any member can pin or unpin; the RPC enforces membership server-side. */
  async function handleTogglePin(id: string, pin: boolean) {
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_message_pinned", {
      p_message_id: id,
      p_pinned: pin,
    });
    if (rpcError) {
      setError(
        pin
          ? "Couldn't pin the message. Try again."
          : "Couldn't unpin the message. Try again."
      );
      return;
    }
    const pinnedAt = pin ? new Date().toISOString() : null;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id
          ? { ...m, pinned_at: pinnedAt, pinned_by: pin ? userId : null }
          : m
      )
    );
    void refreshPinned();
  }

  /** Optimistic save/remove in message_bookmarks: a private keep-it-handy
   *  flag. A double-click race (23505) already means saved, so it stands. */
  const handleToggleSaved = useCallback(
    async (messageId: string, save: boolean) => {
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (save) next.add(messageId);
        else next.delete(messageId);
        return next;
      });
      const supabase = createClient();
      const { error: savedError } = save
        ? await supabase
            .from("message_bookmarks")
            .insert({ user_id: userId, message_id: messageId })
        : await supabase
            .from("message_bookmarks")
            .delete()
            .eq("user_id", userId)
            .eq("message_id", messageId);
      if (savedError && !(save && savedError.code === "23505")) {
        setSavedIds((prev) => {
          const next = new Set(prev);
          if (save) next.delete(messageId);
          else next.add(messageId);
          return next;
        });
        setError(
          save
            ? "Couldn't save that. Give it another try."
            : "Couldn't remove that from saved. Give it another try."
        );
      }
    },
    [userId]
  );

  // The poll RPC writes the poll + carrying message atomically and hands back
  // the message id. Our own realtime echoes are skipped, so append it here.
  const handlePollCreated = useCallback(
    (messageId: string) => {
      setPollOpen(false);
      const supabase = createClient();
      void supabase
        .from("messages")
        .select(MESSAGE_WITH_AUTHOR_SELECT)
        .eq("id", messageId)
        .single()
        .then(({ data }) => {
          if (data) {
            appendMessage(data as unknown as MessageWithAuthor, "smooth");
          }
        });
      markRead();
    },
    [appendMessage, markRead]
  );

  const openThread = useCallback(
    (id: string) => {
      router.push(`${pathname}?thread=${id}`, { scroll: false });
    },
    [router, pathname]
  );

  const closeThread = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  // Live typing layer, kept after all existing hooks so hook order is stable.
  const { typers, noteTyping } = useTyping(channel.id, {
    id: userId,
    name: profile.display_name,
  });

  // Blocked students' messages never render. Filtering happens at the edge
  // so realtime, optimistic, and initial rows all pass through one gate.
  const visibleMessages = useMemo(
    () => messages.filter((m) => !blockedIds.has(m.author_id)),
    [messages, blockedIds]
  );
  const visiblePinned = useMemo(
    () => pinned.filter((m) => !blockedIds.has(m.author_id)),
    [pinned, blockedIds]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PinnedBar
        pinned={visiblePinned}
        onUnpin={(id) => void handleTogglePin(id, false)}
      />
      <div
        ref={listRef}
        onScroll={handleScroll}
        role="log"
        aria-label={`Messages in ${title}`}
        className="flex-1 overflow-y-auto pb-2 pt-4"
      >
        {visibleMessages.length < PAGE_SIZE ? (
          <div className="px-2 pb-2">
            <RoomTile
              kind={channel.kind}
              name={channel.name}
              slug={channel.slug}
              size="md"
            />
            <p className="mt-2 font-bold tracking-tight">
              Welcome to {title}
            </p>
            <p className="text-sm text-muted">
              {visibleMessages.length === 0
                ? "Nobody's said anything yet. Be the first to say hi."
                : "This is the very beginning of the channel."}
            </p>
          </div>
        ) : null}

        {visibleMessages.map((m, i) => {
          const prev = visibleMessages[i - 1];
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
                  <span className="h-px flex-1 bg-brand/40" aria-hidden />
                  <Badge
                    tone="brand"
                    className="px-2 py-0.5 text-[10px] uppercase tracking-widest"
                  >
                    New
                  </Badge>
                </div>
              ) : null}
              <MessageItem
                message={m}
                userId={userId}
                grouped={grouped}
                reactions={reactionsByMessage[m.id]}
                replyCount={replyCounts[m.id] ?? 0}
                saved={savedIds.has(m.id)}
                onToggleReaction={toggleReaction}
                onOpenThread={openThread}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onTogglePin={(id, pin) => void handleTogglePin(id, pin)}
                onToggleSaved={(id, save) => void handleToggleSaved(id, save)}
              />
            </Fragment>
          );
        })}
      </div>

      <p aria-live="polite" className="min-h-4 shrink-0 px-2 text-xs text-muted">
        {typingLabel(typers)}
      </p>

      {error ? (
        <p
          role="alert"
          className="mb-2 flex items-center gap-2 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger"
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
        aria-label="Send a message"
        className="relative shrink-0 pb-3 pt-1"
      >
        {mentionSuggestions.length > 0 ? (
          <div
            role="listbox"
            aria-label="Mention a channel member"
            className="absolute bottom-full left-0 z-30 mb-1 w-full max-w-xs animate-scale-in rounded-card border border-border bg-surface p-1.5 shadow-lift"
          >
            {mentionSuggestions.map((candidate, index) => (
              <button
                key={candidate.id}
                type="button"
                role="option"
                aria-selected={index === mentionIndex}
                onMouseEnter={() => setMentionIndex(index)}
                onClick={() => applyMention(candidate)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
                  index === mentionIndex ? "bg-surface-2" : "hover:bg-surface-2/60"
                )}
              >
                <Avatar
                  name={candidate.display_name}
                  src={candidate.avatar_url}
                  size="xs"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {candidate.display_name}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    @{candidate.handle}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-1 rounded-2xl border border-border bg-surface px-2 py-2 shadow-soft transition-colors focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand/15">
          <input
            ref={fileInputRef}
            type="file"
            accept={IMAGE_ACCEPT_ATTR}
            tabIndex={-1}
            onChange={(e) => void handleAttachmentPick(e)}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || sending}
            aria-label="Send a photo"
            className={COMPOSER_ICON_BUTTON}
          >
            {uploading ? (
              <Loader2 className="size-4.5 animate-spin" aria-hidden />
            ) : (
              <ImagePlus className="size-4.5" aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={() => setPollOpen(true)}
            aria-label="Start a poll"
            className={COMPOSER_ICON_BUTTON}
          >
            <BarChart3 className="size-4.5" aria-hidden />
          </button>
          <label htmlFor="chat-composer" className="sr-only">
            Message {title}
          </label>
          <textarea
            id="chat-composer"
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
              noteTyping();
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={(e) => {
              if (mentionSuggestions.length > 0) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const delta = e.key === "ArrowDown" ? 1 : -1;
                  setMentionIndex(
                    (i) =>
                      (i + delta + mentionSuggestions.length) %
                      mentionSuggestions.length
                  );
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  applyMention(
                    mentionSuggestions[
                      Math.min(mentionIndex, mentionSuggestions.length - 1)
                    ]
                  );
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMentionDismissed(true);
                  return;
                }
              }
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
            placeholder={`Message ${title}`}
            className="max-h-40 flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending || uploading}
            aria-label="Send message"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg shadow-soft transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
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

      {pollOpen ? (
        <PollComposer
          channelId={channel.id}
          onClose={() => setPollOpen(false)}
          onCreated={handlePollCreated}
        />
      ) : null}

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
 * Submit button for the server-action join form on the channel page.
 * Client-side so it can show a pending spinner via useFormStatus.
 */
export function JoinChannelButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {pending ? "Joining…" : "Join room"}
    </Button>
  );
}
