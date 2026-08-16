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
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  ChevronRight,
  Flag,
  ImagePlus,
  Loader2,
  SendHorizontal,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { createClient } from "@/lib/supabase/client";
import { presenceLabel } from "@/lib/friends";
import {
  REPORT_CATEGORIES,
  categoryLabel,
  type ReportCategory,
} from "@/lib/moderation";
import { reportDmMessage } from "@/features/moderation/actions";
import { useRealtimeInserts } from "@/lib/hooks/use-realtime-inserts";
import { useRealtimeUpdates } from "@/lib/hooks/use-realtime-updates";
import { usePresence } from "@/lib/hooks/use-presence";
import { typingLabel, useTyping } from "@/lib/hooks/use-typing";
import { AttachmentImage } from "@/features/chat/attachment-image";
import {
  MAX_ATTACHMENT_BYTES,
  uploadChatImage,
} from "@/features/chat/attachments";
import { useBlockedIds } from "@/features/chat/blocks";
import {
  IMAGE_ACCEPT_ATTR,
  isAcceptedImageType,
} from "@/lib/image-types";
import { GroupInfoPanel } from "@/features/dm/group-info-panel";
import { threadDisplay, type ThreadPerson } from "@/features/dm/group-dm";
import type { DmMessage } from "@/lib/types";
import { cn, formatMessageTime } from "@/lib/utils";

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const PAGE_SIZE = 50;

/** What `reports.reason` will take: 1–500 characters, per its check constraint. */
const REASON_MAX = 500;

/** How long the confirmation sits under a reported bubble before it bows out. */
const REPORT_NOTICE_MS = 6000;

/** DmMessage shaped for the realtime hook's Record constraint. */
type DmMessageRow = DmMessage & Record<string, unknown>;

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

/**
 * The bubble's save toggle: quiet until you hover the row, and always visible
 * once a message is saved so the flag never hides. Private to you either way.
 */
function SaveBubbleButton({
  saved,
  revealed,
  onClick,
}: {
  saved: boolean;
  /** True when the row has been tapped. See {@link DmRoom}'s `tappedId`. */
  revealed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={saved}
      aria-label={saved ? "Remove from saved" : "Save message"}
      className={cn(
        "flex size-7 shrink-0 items-center justify-center self-center rounded-md transition-opacity hover:bg-surface-2 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand group-hover:opacity-100 group-focus-within:opacity-100",
        revealed && "opacity-100",
        saved
          ? "text-brand"
          : "text-muted opacity-0 hover:text-foreground"
      )}
    >
      {saved ? (
        <BookmarkCheck className="size-4" aria-hidden />
      ) : (
        <Bookmark className="size-4" aria-hidden />
      )}
    </button>
  );
}

/**
 * The bubble's report control, sitting with the save toggle and just as quiet
 * until you hover the row. Reporting a direct message is promised by the
 * Community Guidelines and has always been a long-press away on native
 * (`mobile/src/app/dm/[id].tsx`); on the web it belongs with the affordance a
 * student has already found rather than behind an interaction they'd have to
 * discover.
 *
 * Only ever drawn on someone else's message. `reportDmMessage` refuses your
 * own, and a control whose only answer is "you can't report yourself" is
 * worse than no control at all.
 */
function ReportBubbleButton({
  open,
  revealed,
  panelId,
  onClick,
}: {
  open: boolean;
  /** True when the row has been tapped. See {@link DmRoom}'s `tappedId`. */
  revealed: boolean;
  panelId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Report message"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      className={cn(
        "flex size-7 shrink-0 items-center justify-center self-center rounded-md transition-opacity hover:bg-surface-2 hover:text-danger focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand group-hover:opacity-100 group-focus-within:opacity-100",
        revealed && "opacity-100",
        open ? "text-danger" : "text-muted opacity-0"
      )}
    >
      <Flag className="size-4" aria-hidden />
    </button>
  );
}

/**
 * The report form, under the bubble it's about rather than floating over it.
 *
 * A popover pinned to a 28px button would be clipped by the message list's
 * own scroller or hang off the side of a phone, depending on how long the
 * message it's anchored to happens to be. Sitting in the column costs nothing
 * and keeps the words being reported on screen while the category is picked.
 *
 * Controlled: every value lives in {@link DmRoom} so only one of these is
 * ever open, and so a report in flight isn't torn down by a realtime insert
 * re-rendering the row it sits in.
 */
function ReportPanel({
  panelId,
  category,
  onCategory,
  detail,
  onDetail,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  panelId: string;
  category: ReportCategory | null;
  onCategory: (category: ReportCategory) => void;
  detail: string;
  onDetail: (detail: string) => void;
  pending: boolean;
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const uid = useId();
  return (
    <div
      id={panelId}
      role="group"
      aria-labelledby={`${uid}-title`}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
      className="mt-1 w-full animate-scale-in rounded-xl border border-border bg-surface p-3 text-left shadow-soft"
    >
      <p id={`${uid}-title`} className="text-sm font-semibold">
        Report this message
      </p>
      <p className="mt-0.5 text-xs text-muted text-pretty">
        Reports are private. They won&apos;t know it was you. A person reads
        every one, usually within a day.
      </p>

      <p
        id={`${uid}-category`}
        className="mt-3 text-[11px] font-bold uppercase tracking-widest text-muted"
      >
        What&apos;s going on?
      </p>
      <div
        role="radiogroup"
        aria-labelledby={`${uid}-category`}
        className="mt-1.5 flex flex-wrap gap-1.5"
      >
        {REPORT_CATEGORIES.map((value) => {
          const selected = category === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onCategory(value)}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-3.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
                selected
                  ? "border-brand-ink bg-brand-soft text-brand-ink"
                  : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
              )}
            >
              {categoryLabel(value)}
            </button>
          );
        })}
      </div>

      <label
        htmlFor={`${uid}-detail`}
        className="mt-3 block text-xs font-medium text-muted"
      >
        Anything to add? Optional.
      </label>
      <textarea
        id={`${uid}-detail`}
        value={detail}
        onChange={(event) => onDetail(event.target.value)}
        rows={2}
        maxLength={REASON_MAX}
        placeholder="A sentence is plenty."
        className="mt-1 w-full resize-y rounded-lg border border-border bg-surface px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted/70 focus:border-brand focus:ring-[3px] focus:ring-brand/15"
      />

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onSubmit}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-brand px-4 text-xs font-semibold text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Flag className="size-3.5" aria-hidden />
          )}
          {pending ? "Sending…" : "Send report"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-11 items-center rounded-full px-3 text-xs font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Cancel
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The conversation surface, in either shape.
 *
 * A 1:1 is the room as it always was: header linking to the other student's
 * profile with their presence dot, day-separated bubbles (own
 * right/brand-soft, theirs left/surface), realtime inserts, optimistic
 * sends, soft-delete of own messages, and read-cursor upkeep on mount + on
 * incoming messages.
 *
 * A group (migration 0028) swaps the header for the group's name, its
 * headcount, and a way into the info panel (roster, rename, add people,
 * leave), and names whoever is talking above their first bubble in a run.
 * Everything below the header is shared.
 *
 * @param other The other student on a 1:1; null in a group.
 * @param group The group's name and everyone in it (you included); null on
 *   a 1:1.
 */
export function DmRoom({
  threadId,
  userId,
  other,
  group,
  initialMessages,
  initialLastReadAt,
}: {
  threadId: string;
  userId: string;
  other: ThreadPerson | null;
  group: { title: string | null; people: ThreadPerson[] } | null;
  initialMessages: DmMessage[];
  initialLastReadAt: string;
}) {
  const isGroup = group !== null;
  // The room owns the group's name and roster so a rename or an add lands
  // in the header the moment the panel writes it.
  const [groupTitle, setGroupTitle] = useState<string | null>(
    group?.title ?? null
  );
  const [people, setPeople] = useState<ThreadPerson[]>(group?.people ?? []);
  const [infoOpen, setInfoOpen] = useState(false);
  const [messages, setMessages] = useState<DmMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { blockedIds, unblock } = useBlockedIds(userId);
  // A group can hold someone you've blocked, so there's no banner and no
  // gate on the composer: their messages simply don't render.
  const otherBlocked = other !== null && blockedIds.has(other.id);
  // Saved messages: my private bookmarks among the loaded bubbles, so each
  // toggle can tell "Save message" from "Remove from saved".
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  /* Which row a tap has opened up. Tailwind compiles `group-hover` inside
     `@media (hover: hover)`, so on a phone, where most direct messages are
     read, hover never fires and the save and report buttons on a bubble
     would simply never appear. There is no keyboard on a phone either, so
     `group-focus-within` doesn't rescue it. The channel room solved this the
     same way; this is the same fix on the surface that needed it more. */
  const [tappedId, setTappedId] = useState<string | null>(null);

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
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  /** Which of these bubbles I've saved. One query per loaded page keeps
   *  every toggle's label truthful. */
  const loadSaved = useCallback(
    async (messageIds: string[]) => {
      if (messageIds.length === 0) return;
      const supabase = createClient();
      const { data } = await supabase
        .from("message_bookmarks")
        .select("dm_message_id")
        .eq("user_id", userId)
        .in("dm_message_id", messageIds);
      if (!data) return;
      setSavedIds((prev) => {
        const next = new Set(prev);
        for (const row of data as { dm_message_id: string }[]) {
          next.add(row.dm_message_id);
        }
        return next;
      });
    },
    [userId]
  );

  // Mount: advance the read cursor once, and learn what's already saved.
  useEffect(() => {
    markRead();
    void loadSaved(initialMessages.map((m) => m.id));
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
      if (row.author_id === userId) return; // own echo; optimistic path has it
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

  // Live layer. All new hooks sit after the existing ones so hook order is
  // stable. DmRoom isn't handed the viewer's profile, so fetch our display
  // name once for the typing broadcast ("Someone" until it lands).
  const [selfName, setSelfName] = useState<string | null>(null);
  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .single()
      .then(({ data }) => {
        const name = (data as { display_name: string } | null)?.display_name;
        if (name) setSelfName(name);
      });
  }, [userId]);
  const { typers, noteTyping } = useTyping(threadId, {
    id: userId,
    name: selfName ?? "Someone",
  });
  const online = usePresence(`dm:${threadId}`, userId);
  const otherOnline = other !== null && online.has(other.id);

  // The quiet "Active now" line under their name, 1:1 only. The server
  // erases `last_seen_at` the moment they stop sharing, but the toggle is
  // still checked here so a stale row can never leak a timestamp its owner
  // switched off. Read once on mount: presence is ambience, not a ticker.
  const [otherLastSeen, setOtherLastSeen] = useState<string | null>(null);
  useEffect(() => {
    if (!other) return;
    const supabase = createClient();
    void supabase
      .from("profiles")
      .select("last_seen_at, share_last_seen")
      .eq("id", other.id)
      .maybeSingle()
      .then(({ data }) => {
        const row = data as {
          last_seen_at: string | null;
          share_last_seen: boolean;
        } | null;
        setOtherLastSeen(
          row && row.share_last_seen === true ? row.last_seen_at : null
        );
      });
  }, [other]);
  const otherPresence = presenceLabel(otherLastSeen, new Date());

  // Reporting a message in this thread. All of it lives up here rather than
  // in the bubble: only one panel should ever be open, and a report in flight
  // has to outlive the re-render an incoming message causes underneath it.
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [reportCategory, setReportCategory] = useState<ReportCategory | null>(
    null
  );
  const [reportDetail, setReportDetail] = useState("");
  const [reportPending, setReportPending] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSentId, setReportSentId] = useState<string | null>(null);
  const reportPanelId = useId();

  // The confirmation has done its job once it's been read, and the report is
  // filed either way.
  useEffect(() => {
    if (!reportSentId) return;
    const timer = setTimeout(() => setReportSentId(null), REPORT_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [reportSentId]);

  // One naming rule for both shapes, straight from the data layer: a group
  // shows its title and "N people", a 1:1 shows the other student. A 1:1
  // carries no roster, so the other student is its whole naming input.
  const display = threadDisplay(
    { is_group: isGroup, title: groupTitle },
    isGroup ? people : other ? [other] : [],
    userId
  );
  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person] as const)),
    [people]
  );

  // While a block stands, the other student's messages stay out of view.
  // 0042 keeps them out of the read policy as well, so they don't arrive in
  // the first place; this stays because unblocking should bring them back on
  // the spot rather than after a refetch.
  const visibleMessages = useMemo(
    () => messages.filter((m) => !blockedIds.has(m.author_id)),
    [messages, blockedIds]
  );

  async function handleSend() {
    const content = draft.trim();
    if (!content || otherBlocked) return;
    setError(null);
    setDraft("");
    const tempId = `temp-${crypto.randomUUID()}`;
    appendMessage(
      {
        id: tempId,
        thread_id: threadId,
        author_id: userId,
        content,
        attachment_path: null,
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

  /** Pick → upload to the student's own chat-uploads folder → send. Any
   *  typed draft rides along as the caption; otherwise content is "Photo". */
  async function handleAttachmentPick(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    event.target.value = ""; // picking the same file twice should still fire
    if (!file || otherBlocked) return;
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
        .from("dm_messages")
        .insert({
          thread_id: threadId,
          author_id: userId,
          content,
          attachment_path: path,
        })
        .select("*")
        .single();
      if (insertError || !data) throw insertError ?? new Error("send failed");
      setDraft("");
      appendMessage(data as DmMessage, "smooth");
      markRead();
    } catch {
      setError("Couldn't send your photo. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
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
            .insert({ user_id: userId, dm_message_id: messageId })
        : await supabase
            .from("message_bookmarks")
            .delete()
            .eq("user_id", userId)
            .eq("dm_message_id", messageId);
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

  async function handleUnblock() {
    if (!other) return;
    setError(null);
    const ok = await unblock(other.id);
    if (!ok) setError("Couldn't unblock. Try again.");
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

  /* Nothing moves the panel while a report is in flight: not closing it, not
     opening another one. On a slow network the answer, sent or failed, has to
     land somewhere the reporter is still looking. */
  function openReport(messageId: string) {
    if (reportPending) return;
    if (reportFor !== messageId) {
      // A different message is a different report; the last one's category
      // and words don't belong on it.
      setReportCategory(null);
      setReportDetail("");
    }
    setReportFor(messageId);
    setReportError(null);
    setReportSentId(null);
  }

  /* Closing keeps what they picked and typed, so reopening the same message
     picks up where they left off rather than starting the report again. */
  function closeReport() {
    if (reportPending) return;
    setReportFor(null);
    setReportError(null);
  }

  async function submitReport(messageId: string) {
    if (reportPending) return;
    if (reportCategory === null) {
      setReportError("Pick the category that fits best.");
      return;
    }
    setReportPending(true);
    setReportError(null);
    /* `reports.reason` is not nullable, and a student who picked a category
       and had nothing to add has still said something, so the category's own
       words stand in rather than blocking the report on a second field. */
    const words = reportDetail.trim();
    /* A server action is an HTTP POST, so offline or a 500 REJECTS rather
       than resolving `{ error }`. Unhandled, that rejection skips
       setReportPending(false) and the panel is stuck on "Sending…" forever.
       Because closing is guarded on `pending`, Cancel, Escape and the
       trigger all stop responding too. The student is left with no error, no
       retry and no way out but a reload, on the one flow where being unable
       to finish matters most. */
    let failure: string | undefined;
    try {
      const result = await reportDmMessage(
        messageId,
        reportCategory,
        words.length > 0 ? words : categoryLabel(reportCategory)
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
    setReportFor(null);
    setReportCategory(null);
    setReportDetail("");
    setReportSentId(messageId);
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
        {isGroup ? (
          // The whole header is the way into the group's panel.
          <h1 className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setInfoOpen(true)}
              aria-label={`${display.title} group info`}
              aria-haspopup="dialog"
              className="flex w-full min-w-0 items-center gap-3 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink"
              >
                <Users className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-bold">
                  {display.title}
                </span>
                <span className="block truncate text-xs font-normal text-muted">
                  {display.subtitle ?? "Group chat"}
                </span>
              </span>
              <ChevronRight
                className="size-4 shrink-0 text-muted"
                aria-hidden
              />
            </button>
          </h1>
        ) : other ? (
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
                className="flex items-center gap-1.5 text-base font-bold"
              >
                <span className="truncate">{other.display_name}</span>
                {otherOnline ? (
                  <>
                    <span
                      className="size-2 shrink-0 rounded-full bg-success"
                      aria-hidden
                    />
                    <span className="sr-only">online</span>
                  </>
                ) : null}
              </span>
              <span className="block truncate text-xs text-muted">
                @{other.handle}
                {otherPresence ? ` · ${otherPresence}` : null}
              </span>
            </span>
          </Link>
        ) : null}
      </header>

      {infoOpen && isGroup ? (
        <GroupInfoPanel
          threadId={threadId}
          userId={userId}
          title={display.title}
          people={people}
          onTitleChange={setGroupTitle}
          onPeopleChange={setPeople}
          onClose={() => setInfoOpen(false)}
        />
      ) : null}

      <div
        ref={listRef}
        onScroll={handleScroll}
        role="log"
        aria-label={
          isGroup
            ? `Conversation in ${display.title}`
            : `Conversation with ${display.title}`
        }
        className="flex-1 overflow-y-auto pb-2 pt-4"
      >
        {visibleMessages.length < PAGE_SIZE ? (
          <div className="px-2 pb-4 pt-2 text-center">
            {isGroup ? (
              <span
                aria-hidden
                className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand-ink"
              >
                <Users className="size-6" />
              </span>
            ) : (
              <Avatar
                name={display.title}
                src={other?.avatar_url ?? null}
                size="lg"
                className="mx-auto"
              />
            )}
            <p className="mt-2 font-bold">{display.title}</p>
            <p className="mx-auto max-w-sm text-sm text-muted">
              {isGroup
                ? visibleMessages.length === 0
                  ? `This is the start of ${display.title}. Say hi to everyone.`
                  : `This is the very beginning of ${display.title}.`
                : visibleMessages.length === 0
                  ? `This is the start of your conversation with ${display.title}. Say hi!`
                  : `This is the very beginning of your conversation with ${display.title}.`}
            </p>
          </div>
        ) : null}

        {visibleMessages.map((m, i) => {
          const prev = visibleMessages[i - 1];
          const next = visibleMessages[i + 1];
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
          // In a group the roster names whoever is talking; a 1:1 only ever
          // has the one other person.
          const author = own ? null : (peopleById.get(m.author_id) ?? other);
          const authorName = author?.display_name ?? "Someone who left";
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
                  <span className="h-px flex-1 bg-brand/40" aria-hidden />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-brand">
                    New
                  </span>
                </div>
              ) : null}

              <div
                onClick={() =>
                  setTappedId((current) => (current === m.id ? null : m.id))
                }
                className={cn(
                  "group flex items-end gap-2 px-1",
                  own ? "justify-end" : "justify-start",
                  grouped ? "mt-0.5" : "mt-3"
                )}
              >
                {!own ? (
                  lastOfGroup ? (
                    <Avatar
                      name={authorName}
                      src={author?.avatar_url ?? null}
                      size="sm"
                    />
                  ) : (
                    <span className="w-8 shrink-0" aria-hidden />
                  )
                ) : null}

                {/* Own row reads [save][delete][bubble]; theirs puts the
                    save toggle after the bubble, out past the text. */}
                {own && !m.deleted_at && !isTemp ? (
                  <SaveBubbleButton
                    saved={savedIds.has(m.id)}
                    revealed={tappedId === m.id}
                    onClick={() =>
                      void handleToggleSaved(m.id, !savedIds.has(m.id))
                    }
                  />
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
                  className={cn(
                    "flex max-w-[75%] flex-col gap-1",
                    own ? "items-end" : "items-start"
                  )}
                >
                  {/* In a group, say who's talking, once per run of
                      bubbles, not once per bubble. */}
                  {isGroup && !own && !grouped ? (
                    <span className="px-1 text-[11px] font-semibold text-muted">
                      {authorName}
                    </span>
                  ) : null}
                  {!m.deleted_at && m.attachment_path ? (
                    <AttachmentImage
                      path={m.attachment_path}
                      alt={own ? "Photo you sent" : `Photo from ${authorName}`}
                      className={cn(isTemp && "opacity-70")}
                    />
                  ) : null}
                  {/* "Photo" is the placeholder content for caption-less sends. */}
                  {!m.deleted_at &&
                  m.attachment_path &&
                  m.content === "Photo" ? null : (
                    <div
                      title={formatMessageTime(m.created_at)}
                      className={cn(
                        "w-fit max-w-full whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm",
                        m.deleted_at
                          ? "border border-dashed border-border bg-surface-2/60 italic text-muted"
                          : own
                            ? "border border-brand/60 bg-brand-soft text-foreground"
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
                    </div>
                  )}
                  <span className="sr-only">
                    {own ? " (sent by you)" : ` (from ${authorName})`}
                  </span>

                  {reportSentId === m.id ? (
                    <p
                      role="status"
                      className="flex w-fit items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success"
                    >
                      <Flag className="size-3 shrink-0" aria-hidden />
                      Report sent. A person reads it, usually within a day.
                    </p>
                  ) : null}

                  {reportFor === m.id ? (
                    <ReportPanel
                      panelId={reportPanelId}
                      category={reportCategory}
                      onCategory={(value) => {
                        setReportCategory(value);
                        setReportError(null);
                      }}
                      detail={reportDetail}
                      onDetail={setReportDetail}
                      pending={reportPending}
                      error={reportError}
                      onSubmit={() => void submitReport(m.id)}
                      onCancel={closeReport}
                    />
                  ) : null}
                </div>

                {!own && !m.deleted_at && !isTemp ? (
                  <SaveBubbleButton
                    saved={savedIds.has(m.id)}
                    revealed={tappedId === m.id}
                    onClick={() =>
                      void handleToggleSaved(m.id, !savedIds.has(m.id))
                    }
                  />
                ) : null}

                {/* Their message, so it's theirs to answer for. A deleted
                    bubble has no words left to show a moderator, and a
                    still-sending one has no row to point at yet. */}
                {!own && !m.deleted_at && !isTemp ? (
                  <ReportBubbleButton
                    open={reportFor === m.id}
                    revealed={tappedId === m.id}
                    panelId={reportPanelId}
                    onClick={() =>
                      reportFor === m.id ? closeReport() : openReport(m.id)
                    }
                  />
                ) : null}
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

      <p aria-live="polite" className="min-h-4 shrink-0 px-1 text-xs text-muted">
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

      {otherBlocked && other ? (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2">
          <p className="text-xs text-muted">
            You&rsquo;ve blocked {other.display_name}. You won&rsquo;t see
            their messages, and they can&rsquo;t start new conversations with
            you.
          </p>
          <button
            type="button"
            onClick={() => void handleUnblock()}
            className="shrink-0 text-xs font-semibold text-brand hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
          >
            Unblock
          </button>
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
        aria-label="Send a message"
        className="shrink-0 pb-3 pt-1"
      >
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
            disabled={uploading || sending || otherBlocked}
            aria-label="Send a photo"
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="size-4.5 animate-spin" aria-hidden />
            ) : (
              <ImagePlus className="size-4.5" aria-hidden />
            )}
          </button>
          <label htmlFor="dm-composer" className="sr-only">
            Message {display.title}
          </label>
          <textarea
            id="dm-composer"
            ref={textareaRef}
            value={draft}
            disabled={otherBlocked}
            onChange={(e) => {
              setDraft(e.target.value);
              noteTyping();
            }}
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
            placeholder={
              otherBlocked && other
                ? `You've blocked ${other.display_name}`
                : `Message ${display.title}`
            }
            className="max-h-40 flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted/70 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending || uploading || otherBlocked}
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
    </div>
  );
}
