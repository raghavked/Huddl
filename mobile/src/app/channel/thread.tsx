import Feather from "@expo/vector-icons/Feather";
import type {
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
} from "@supabase/supabase-js";
import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  TextInput,
  View,
  type ListRenderItemInfo,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { AppText, Button, Card, Sheet } from "@/components/ui";
import { fonts, palettes, radius, space } from "@/constants/theme";
import {
  ForwardedFrom,
  ForwardPicker,
  PendingBubble,
} from "@/features/forwarding";
import { MentionText, useMentionSuggestions } from "@/features/mentions";
import { MessageBubble } from "@/features/messages";
import { PollBubble } from "@/features/polls";
import { useBlockedIds } from "@/hooks/use-blocked";
import { useTheme } from "@/hooks/use-theme";
import { blockUser } from "@/lib/blocks";
import {
  clearDraft,
  DraftError,
  dropQueued,
  enqueue,
  flushQueue,
  isLikelyOffline,
  keyFor,
  loadDraft,
  noteConnectivity,
  peekQueue,
  saveDraft,
  type QueuedMessage,
} from "@/lib/drafts";
import { forwardLabelFor, type ForwardSource } from "@/lib/forwarding";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/** Minimal local row shapes — mirrors channel/[id].tsx, with the power
    columns so edits, deletes, polls, and attachments render honestly. */
type Author = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
};

type MessageRow = {
  id: string;
  channel_id: string;
  author_id: string;
  parent_id: string | null;
  content: string;
  attachment_path: string | null;
  poll_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  /** Where a forwarded message came from ("#mat-21a"), null on an original. */
  forwarded_from: string | null;
  /** Who wrote it first, null on an original or a deleted account. */
  forwarded_author_id: string | null;
  author: Author | null;
};

/** Raw realtime payload row — no joined author. */
type RawMessageRow = {
  id: string;
  channel_id: string;
  author_id: string;
  parent_id: string | null;
  content: string;
  attachment_path: string | null;
  poll_id: string | null;
  edited_at: string | null;
  created_at: string;
  deleted_at: string | null;
  forwarded_from: string | null;
  forwarded_author_id: string | null;
};

type Status = "loading" | "error" | "ready";

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const MESSAGE_SELECT =
  "id, channel_id, author_id, parent_id, content, attachment_path, poll_id, edited_at, deleted_at, created_at, forwarded_from, forwarded_author_id, author:profiles(id, handle, display_name, avatar_url)";

/** Quiet time in the composer before the draft is written to the device. */
const DRAFT_SAVE_MS = 500;

/** An embedded relation comes back as an object OR a one-element array
    depending on how PostgREST resolves it. Unwrap every shape. */
function embedded(raw: unknown): Record<string, unknown> | null {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

/** What the channel this thread hangs off is called — the same identity the
    room's own header shows, so a forward's provenance line matches the place
    a student remembers being in. Null when we couldn't read it. */
function channelNameFrom(raw: unknown): string | null {
  const row = embedded(raw);
  if (!row) return null;
  const kind = typeof row["kind"] === "string" ? row["kind"] : "";
  const name = typeof row["name"] === "string" ? row["name"] : "";
  const slug = typeof row["slug"] === "string" ? row["slug"] : "";
  const course = embedded(row["course"]);
  const code =
    course && typeof course["code"] === "string" ? course["code"] : "";
  if (kind === "course" && code) return code;
  if (kind === "club" && name) return name;
  if (slug) return slug;
  return name.length > 0 ? name : null;
}

/** The message-body text style — MentionText needs it spelled out. */
const BODY_TEXT = {
  fontFamily: fonts.body,
  fontSize: 15,
  lineHeight: 21,
} as const;

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Avatar and name are the way out of a message to the person who sent it.
    Falls back to a plain view when the row arrived without a handle (an
    optimistic reply, a deleted account). */
function AuthorLink({
  handle,
  name,
  style,
  children,
}: {
  handle: string | null | undefined;
  name: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const router = useRouter();
  if (!handle) return <View style={style}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${name}'s profile`}
      onPress={() => router.push(`/u/${handle}`)}
      hitSlop={10}
      style={({ pressed }) => [style, { opacity: pressed ? 0.6 : 1 }]}
    >
      {children}
    </Pressable>
  );
}

function BackChevron({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Feather name="chevron-left" size={26} color={theme.foreground} />
    </Pressable>
  );
}

/** A chat image at thumb size — resolves its signed URL through the screen's
    per-path cache, then taps open the full-screen viewer. */
function AttachmentImage({
  path,
  resolve,
  onOpen,
}: {
  path: string;
  resolve: (path: string) => Promise<string | null>;
  onOpen: (url: string) => void;
}) {
  const theme = useTheme();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void resolve(path).then((signed) => {
      if (!cancelled) setUrl(signed);
    });
    return () => {
      cancelled = true;
    };
  }, [path, resolve]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="View photo full screen"
      disabled={!url}
      onPress={() => {
        if (url) onOpen(url);
      }}
      style={({ pressed }) => ({
        width: 220,
        height: 160,
        borderRadius: radius.control,
        overflow: "hidden",
        backgroundColor: theme.surface2,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {url ? (
        <Image
          source={{ uri: url }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator size="small" color={theme.muted} />
        </View>
      )}
    </Pressable>
  );
}

export default function ThreadScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id;
  const params = useLocalSearchParams<{
    channelId: string;
    messageId: string;
  }>();
  const channelId = typeof params.channelId === "string" ? params.channelId : "";
  const messageId = typeof params.messageId === "string" ? params.messageId : "";

  const [status, setStatus] = useState<Status>("loading");
  const [parent, setParent] = useState<MessageRow | null>(null);
  // Oldest first — replies read top-down under the pinned parent.
  const [replies, setReplies] = useState<MessageRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Power layer: editing, the own-message action sheet, the photo viewer.
  const [editing, setEditing] = useState<MessageRow | null>(null);
  const draftBeforeEditRef = useRef("");
  const [actionsFor, setActionsFor] = useState<MessageRow | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const { blocked, refresh: refreshBlocked } = useBlockedIds();
  // Safety, one long-press away: the message being blocked out of.
  const [blockFor, setBlockFor] = useState<MessageRow | null>(null);
  const [blocking, setBlocking] = useState(false);

  // Drafts and the send queue. A thread is its own conversation, keyed on the
  // parent message — leaving one mid-sentence keeps its own sentence.
  const conversationKey = useMemo(() => keyFor("thread", messageId), [messageId]);
  const [pending, setPending] = useState<QueuedMessage[]>([]);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const editingRef = useRef(false);
  editingRef.current = editing !== null;
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Forwarding: the message being passed along, the sentence that says where
  // it landed, and the channel name its provenance line will carry.
  const [forwardFor, setForwardFor] = useState<MessageRow | null>(null);
  const [forwardNote, setForwardNote] = useState<string | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [channelName, setChannelName] = useState<string | null>(null);
  // Display names behind forwarded_author_id, fetched in one batch per page
  // rather than embedded — `messages` has two foreign keys into `profiles`,
  // and a mis-hinted embed would take the whole thread's query down with it.
  const [forwardedNames, setForwardedNames] = useState<Record<string, string>>(
    {}
  );
  const forwardedNamesRef = useRef(forwardedNames);
  forwardedNamesRef.current = forwardedNames;

  /** The display names behind any forwarded_author_id on this page. One
      batched query, and only for ids we haven't already resolved. */
  const loadForwardedNames = useCallback(
    async (rows: readonly { forwarded_author_id: string | null }[]) => {
      const wanted = new Set<string>();
      for (const row of rows) {
        const id = row.forwarded_author_id;
        if (id && !(id in forwardedNamesRef.current)) wanted.add(id);
      }
      if (wanted.size === 0) return;
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", [...wanted]);
      if (!data) return;
      setForwardedNames((prev) => {
        const next = { ...prev };
        for (const row of data as { id: string; display_name: string }[]) {
          next[row.id] = row.display_name;
        }
        return next;
      });
    },
    []
  );

  const listRef = useRef<FlatList<MessageRow>>(null);
  const pendingScrollRef = useRef(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else if (channelId) {
      router.replace({ pathname: "/channel/[id]", params: { id: channelId } });
    } else router.replace("/(tabs)/channels");
  }, [router, channelId]);

  /** Signed URLs for chat images, cached per path for the screen's lifetime. */
  const signedUrlsRef = useRef(new Map<string, Promise<string | null>>());
  const resolveAttachmentUrl = useCallback(
    (path: string): Promise<string | null> => {
      const cached = signedUrlsRef.current.get(path);
      if (cached) return cached;
      const promise = supabase.storage
        .from("chat-uploads")
        .createSignedUrl(path, 3600)
        .then(({ data }) => data?.signedUrl ?? null)
        .catch(() => null);
      signedUrlsRef.current.set(path, promise);
      return promise;
    },
    []
  );

  const load = useCallback(async () => {
    if (!userId) return;
    if (!channelId || !messageId) {
      setStatus("error");
      return;
    }
    const [parentRes, repliesRes, channelRes] = await Promise.all([
      supabase
        .from("messages")
        .select(MESSAGE_SELECT)
        .eq("id", messageId)
        .maybeSingle(),
      supabase
        .from("messages")
        .select(MESSAGE_SELECT)
        .eq("parent_id", messageId)
        .order("created_at", { ascending: true }),
      // Only for the forward provenance line — a failure here costs a label,
      // never the thread.
      supabase
        .from("channels")
        .select("kind, name, slug, course:courses(code)")
        .eq("id", channelId)
        .maybeSingle(),
    ]);
    if (parentRes.error || repliesRes.error) {
      setStatus("error");
      return;
    }
    const parentRow = (parentRes.data as unknown as MessageRow | null) ?? null;
    // Deleted replies stay in the stream as tombstones, matching the web.
    const replyRows = (repliesRes.data ?? []) as unknown as MessageRow[];
    setParent(parentRow);
    setReplies(replyRows);
    setChannelName(channelNameFrom(channelRes.data));
    setStatus("ready");
    void loadForwardedNames(parentRow ? [parentRow, ...replyRows] : replyRows);
  }, [userId, channelId, messageId, loadForwardedNames]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ------------------------ drafts and the queue ----------------------- */

  // Restore what was left mid-sentence, but never over something already
  // typed — a slow read must not overwrite a fast typist.
  useEffect(() => {
    let cancelled = false;
    void loadDraft(conversationKey).then((saved) => {
      if (cancelled || !saved) return;
      setDraft((current) => (current.length === 0 ? saved : current));
    });
    return () => {
      cancelled = true;
    };
  }, [conversationKey]);

  /** Debounced, not per keystroke: AsyncStorage is a round trip to native. */
  const noteDraft = useCallback(
    (text: string) => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      draftTimerRef.current = setTimeout(() => {
        draftTimerRef.current = null;
        // While editing, the composer holds someone's published words, not a
        // draft — the real draft is parked in draftBeforeEditRef.
        if (editingRef.current) return;
        void saveDraft(conversationKey, text);
      }, DRAFT_SAVE_MS);
    },
    [conversationKey]
  );

  // Leaving the thread writes the last word, debounce or no debounce.
  useEffect(() => {
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      void saveDraft(
        conversationKey,
        editingRef.current ? draftBeforeEditRef.current : draftRef.current
      );
    };
  }, [conversationKey]);

  useEffect(() => {
    return () => {
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    };
  }, []);

  const refreshPending = useCallback(async () => {
    setPending(await peekQueue(conversationKey));
  }, [conversationKey]);

  /** Pull replies the queue just landed into the thread. Our own realtime
      echoes are skipped, so nothing else would bring them in. */
  const adoptSent = useCallback(
    async (ids: readonly string[]) => {
      if (ids.length === 0) return;
      const { data } = await supabase
        .from("messages")
        .select(MESSAGE_SELECT)
        .in("id", [...ids]);
      if (!data) return;
      const rows = (data as unknown as MessageRow[]).filter(
        (row) => row.parent_id === messageId
      );
      void loadForwardedNames(rows);
      setReplies((prev) => {
        const known = new Set(prev.map((m) => m.id));
        const fresh = rows.filter((row) => !known.has(row.id));
        if (fresh.length === 0) return prev;
        return [...prev, ...fresh].sort((a, b) =>
          a.created_at.localeCompare(b.created_at)
        );
      });
      pendingScrollRef.current = true;
    },
    [messageId, loadForwardedNames]
  );

  const runFlush = useCallback(async () => {
    let landed: string[] = [];
    try {
      const result = await flushQueue();
      landed = result.sent
        .filter((message) => message.key === conversationKey)
        .map((message) => message.id);
    } catch {
      // The queue itself couldn't be read; the refresh below still tells the
      // truth about what's waiting.
    }
    // Retire the pending bubbles BEFORE the real rows arrive — the other
    // order shows both for a frame, which reads as a message sent twice.
    await refreshPending();
    await adoptSent(landed);
  }, [conversationKey, adoptSent, refreshPending]);

  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  // Arriving in the thread is when anything the queue is holding gets another
  // go — including replies queued from a previous visit.
  useFocusEffect(
    useCallback(() => {
      void runFlush();
    }, [runFlush])
  );

  /** Tap a pending bubble. A stuck one has spent its five tries, so it goes
      back in the queue fresh; anything else just needs another pass. */
  const retryQueued = useCallback(
    async (message: QueuedMessage) => {
      if (message.stuck) {
        await dropQueued(message.id);
        try {
          await enqueue({
            key: message.key,
            table: message.table,
            payload: message.payload,
          });
        } catch {
          // It couldn't be held again; the refresh shows it's gone.
        }
      }
      await refreshPending();
      await runFlush();
    },
    [refreshPending, runFlush]
  );

  const discardQueued = useCallback(
    async (id: string) => {
      await dropQueued(id);
      await refreshPending();
    },
    [refreshPending]
  );

  const showForwardNote = useCallback((message: string) => {
    setForwardNote(message);
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    noteTimerRef.current = setTimeout(() => {
      noteTimerRef.current = null;
      setForwardNote(null);
    }, 5000);
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const appendReply = useCallback((row: MessageRow) => {
    setReplies((prev) =>
      prev.some((m) => m.id === row.id) ? prev : [...prev, row]
    );
    pendingScrollRef.current = true;
  }, []);

  /** Merge an edit/delete into the parent card or the matching reply row. */
  const patchMessage = useCallback(
    (id: string, patch: Partial<MessageRow>) => {
      setParent((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
      setReplies((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...patch } : m))
      );
    },
    []
  );

  // Live replies: the postgres filter is on the channel (mirrors the room's
  // subscription shape); parent_id is checked client-side. Own echoes are
  // skipped — the optimistic path already has them. Updates (edits and soft
  // deletes) merge into the parent card or the matching reply.
  const isReady = status === "ready";
  useEffect(() => {
    if (!isReady || !channelId || !messageId || !userId) return;
    const room = supabase
      .channel(`thread:${messageId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload: RealtimePostgresInsertPayload<RawMessageRow>) => {
          const row = payload.new;
          if (row.parent_id !== messageId) return;
          if (row.author_id === userId) return;
          void supabase
            .from("profiles")
            .select("id, handle, display_name, avatar_url")
            .eq("id", row.author_id)
            .maybeSingle()
            .then(({ data }) => {
              appendReply({
                id: row.id,
                channel_id: row.channel_id,
                author_id: row.author_id,
                parent_id: row.parent_id,
                content: row.content,
                attachment_path: row.attachment_path,
                poll_id: row.poll_id,
                edited_at: row.edited_at,
                deleted_at: row.deleted_at,
                created_at: row.created_at,
                forwarded_from: row.forwarded_from,
                forwarded_author_id: row.forwarded_author_id,
                author: (data as unknown as Author | null) ?? null,
              });
              if (row.forwarded_author_id) {
                void loadForwardedNames([
                  { forwarded_author_id: row.forwarded_author_id },
                ]);
              }
            });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload: RealtimePostgresUpdatePayload<RawMessageRow>) => {
          const row = payload.new;
          if (row.id !== messageId && row.parent_id !== messageId) return;
          patchMessage(row.id, {
            content: row.content,
            edited_at: row.edited_at,
            deleted_at: row.deleted_at,
          });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(room);
    };
  }, [
    isReady,
    channelId,
    messageId,
    userId,
    appendReply,
    patchMessage,
    loadForwardedNames,
  ]);

  // Composer @-autocomplete, fed from the channel's member roster.
  const mentions = useMentionSuggestions(isReady ? channelId : null);

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending || !channelId || !messageId || !userId) return;
    setSendError(null);
    setDraft("");
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    void clearDraft(conversationKey);
    mentions.reset();
    const tempId = `temp-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    // Optimistic bubble — own messages don't render the author, so null is fine.
    const optimistic: MessageRow = {
      id: tempId,
      channel_id: channelId,
      author_id: userId,
      parent_id: messageId,
      content,
      attachment_path: null,
      poll_id: null,
      edited_at: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
      forwarded_from: null,
      forwarded_author_id: null,
      author: null,
    };
    appendReply(optimistic);
    setSending(true);
    // Queue it first, then send the queue's own row — same as the room screen.
    // The point is the id: both attempts carry the same primary key, so a
    // reply that commits but never answers is retried as a unique violation
    // the queue reads as "it already landed", rather than posting the reply
    // twice. See QueuedMessage.id in drafts.ts.
    const payload = {
      channel_id: channelId,
      author_id: userId,
      content,
      parent_id: messageId,
    };
    let queued: QueuedMessage | null = null;
    let queueError: unknown = null;
    try {
      queued = await enqueue({
        key: conversationKey,
        table: "messages",
        payload,
      });
    } catch (thrown) {
      // The device wouldn't hold it. Still worth the wire — this one reply
      // just goes out with nothing behind it if it fails.
      queueError = thrown;
    }
    const { data, error: insertError } = await supabase
      .from("messages")
      .insert(queued?.payload ?? payload)
      .select(MESSAGE_SELECT)
      .single();
    setSending(false);
    if (insertError || !data) {
      noteConnectivity(!isLikelyOffline(insertError));
      setReplies((prev) => prev.filter((m) => m.id !== tempId));
      if (!queued) {
        // Nothing is holding it — give the words back.
        setDraft(content);
        setSendError(
          queueError instanceof DraftError
            ? queueError.message
            : "Couldn't send that — check your connection and try again."
        );
        return;
      }
      // It's already queued under the id we just tried: the optimistic bubble
      // becomes a pending one, and the words stay in the thread where they
      // were typed.
      await refreshPending();
      void runFlush();
      return;
    }
    noteConnectivity(true);
    // Reconcile: swap the temp row for the real one (dedupe by id in case the
    // realtime echo ever lands first).
    const real = data as unknown as MessageRow;
    setReplies((prev) => [
      ...prev.filter((m) => m.id !== tempId && m.id !== real.id),
      real,
    ]);
    pendingScrollRef.current = true;
    // The row is in the table, so the queue's copy has done its job. If this
    // drop is the thing that fails, the next flush hits 23505 and reads it as
    // sent anyway.
    if (queued) {
      await dropQueued(queued.id);
      await refreshPending();
    }
  }, [
    draft,
    sending,
    channelId,
    messageId,
    userId,
    appendReply,
    mentions,
    conversationKey,
    refreshPending,
    runFlush,
  ]);

  /* -------------------- edit / delete own messages -------------------- */

  const startEdit = useCallback(
    (target: MessageRow) => {
      // Bank whatever was half-typed before the composer borrows itself out.
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      void saveDraft(conversationKey, draft);
      draftBeforeEditRef.current = draft;
      setEditing(target);
      setDraft(target.content);
      mentions.reset();
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [draft, mentions, conversationKey]
  );

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setDraft(draftBeforeEditRef.current);
    draftBeforeEditRef.current = "";
    mentions.reset();
  }, [mentions]);

  const handleSaveEdit = useCallback(async () => {
    if (!editing || !userId) return;
    const content = draft.trim();
    if (!content) return;
    const target = editing;
    setEditing(null);
    setDraft(draftBeforeEditRef.current);
    draftBeforeEditRef.current = "";
    mentions.reset();
    if (content === target.content) return;
    const editedAt = new Date().toISOString();
    patchMessage(target.id, { content, edited_at: editedAt });
    const { error: updateError } = await supabase
      .from("messages")
      .update({ content, edited_at: editedAt })
      .eq("id", target.id)
      .eq("author_id", userId);
    if (updateError) {
      patchMessage(target.id, {
        content: target.content,
        edited_at: target.edited_at,
      });
      setSendError("Couldn't save your edit — give it another try.");
    }
  }, [editing, userId, draft, mentions, patchMessage]);

  /** Soft delete: the row stays as a tombstone, matching the web. */
  const handleDelete = useCallback(
    async (target: MessageRow) => {
      if (!userId) return;
      const deletedAt = new Date().toISOString();
      patchMessage(target.id, { deleted_at: deletedAt });
      const { error: updateError } = await supabase
        .from("messages")
        .update({ deleted_at: deletedAt })
        .eq("id", target.id)
        .eq("author_id", userId);
      if (updateError) {
        patchMessage(target.id, { deleted_at: target.deleted_at });
        setSendError("Couldn't delete that — give it another try.");
      }
    },
    [userId, patchMessage]
  );

  /** Block the person who sent a message. One-way and private: they're never
      told, and their replies leave the thread as soon as the set refreshes. */
  const handleBlockAuthor = useCallback(
    async (target: MessageRow) => {
      if (!userId || blocking) return;
      setBlocking(true);
      try {
        await blockUser(userId, target.author_id);
        await refreshBlocked();
        setBlockFor(null);
        setActionsFor(null);
      } catch {
        setBlockFor(null);
        setActionsFor(null);
        setSendError("Couldn't block them just now — give it another try.");
      } finally {
        setBlocking(false);
      }
    },
    [userId, blocking, refreshBlocked]
  );

  // Blocked students' replies never render; a blocked parent hides the card.
  const visibleReplies = useMemo(
    () => replies.filter((m) => !blocked.has(m.author_id)),
    [replies, blocked]
  );
  const parentVisible = parent !== null && !blocked.has(parent.author_id);

  const renderReply = useCallback(
    ({ item, index }: ListRenderItemInfo<MessageRow>) => {
      // Top-down list: index - 1 is the chronologically older neighbor.
      const older = index > 0 ? visibleReplies[index - 1] ?? null : null;
      const isOwn = item.author_id === userId;
      const deleted = Boolean(item.deleted_at);
      const grouped =
        older !== null &&
        older.author_id === item.author_id &&
        new Date(item.created_at).getTime() -
          new Date(older.created_at).getTime() <
          GROUP_WINDOW_MS;
      const authorName = item.author?.display_name ?? "A classmate";
      return (
        <View
          style={{
            flexDirection: "row",
            justifyContent: isOwn ? "flex-end" : "flex-start",
            alignItems: "flex-end",
            gap: space.cosy,
            marginTop: grouped ? 2 : 10,
          }}
        >
          {!isOwn ? (
            grouped ? (
              <View style={{ width: 28 }} />
            ) : (
              <AuthorLink handle={item.author?.handle} name={authorName}>
                <Avatar
                  url={item.author?.avatar_url}
                  name={authorName}
                  size={28}
                />
              </AuthorLink>
            )
          ) : null}
          <View
            style={{
              maxWidth: "80%",
              alignItems: isOwn ? "flex-end" : "flex-start",
            }}
          >
            {!isOwn && !grouped ? (
              <AuthorLink
                handle={item.author?.handle}
                name={authorName}
                style={{
                  flexDirection: "row",
                  alignItems: "baseline",
                  gap: space.snug,
                  paddingHorizontal: space.tight,
                  marginBottom: space.hair,
                }}
              >
                <AppText variant="label" numberOfLines={1}>
                  {authorName}
                </AppText>
                <AppText variant="caption" muted>
                  {timeLabel(item.created_at)}
                </AppText>
              </AuthorLink>
            ) : null}
            <Pressable
              accessibilityHint={
                deleted ? undefined : "Long press for message actions"
              }
              onLongPress={() => {
                if (!deleted && !item.id.startsWith("temp-")) {
                  setActionsFor(item);
                }
              }}
              delayLongPress={300}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              {deleted ? (
                <MessageBubble own={isOwn} deleted>
                  <AppText muted style={{ fontStyle: "italic" }}>
                    Message deleted
                  </AppText>
                </MessageBubble>
              ) : item.poll_id ? (
                <PollBubble pollId={item.poll_id} />
              ) : (
                <MessageBubble own={isOwn}>
                  {item.forwarded_from ? (
                    <ForwardedFrom
                      from={item.forwarded_from}
                      who={
                        item.forwarded_author_id
                          ? (forwardedNames[item.forwarded_author_id] ?? null)
                          : null
                      }
                      own={isOwn}
                    />
                  ) : null}
                  {item.attachment_path ? (
                    <AttachmentImage
                      path={item.attachment_path}
                      resolve={resolveAttachmentUrl}
                      onOpen={setViewerUrl}
                    />
                  ) : null}
                  {item.attachment_path && item.content === "Photo" ? null : (
                    <MentionText
                      text={item.content}
                      baseStyle={{ ...BODY_TEXT, color: theme.foreground }}
                      highlightColor={isOwn ? theme.brandInk : theme.brand}
                    />
                  )}
                  {item.edited_at ? (
                    <AppText
                      variant="caption"
                      muted
                      style={{ fontSize: 10, lineHeight: 12 }}
                    >
                      (edited)
                    </AppText>
                  ) : null}
                </MessageBubble>
              )}
            </Pressable>
            {isOwn && !grouped ? (
              <AppText
                variant="caption"
                muted
                style={{
                  marginTop: space.hair,
                  paddingHorizontal: space.tight,
                }}
              >
                {timeLabel(item.created_at)}
              </AppText>
            ) : null}
          </View>
        </View>
      );
    },
    [visibleReplies, userId, theme, resolveAttachmentUrl, forwardedNames]
  );

  /* ----------------------------- forwarding ---------------------------- */

  /** What the picker is passing along. A forward of a forward keeps pointing
      at whoever wrote the words, not the last person to hand them on. */
  const forwardSource = useMemo<ForwardSource | null>(() => {
    if (!forwardFor) return null;
    return {
      content: forwardFor.content,
      attachmentPath: forwardFor.attachment_path,
      authorId: forwardFor.forwarded_author_id ?? forwardFor.author_id,
      fromLabel:
        forwardFor.forwarded_from ??
        forwardLabelFor({ kind: "channel", name: channelName ?? "" }),
    };
  }, [forwardFor, channelName]);

  const forwardExclude = useMemo(
    () => ({ kind: "channel" as const, id: channelId }),
    [channelId]
  );

  const parentName =
    parentVisible && parent ? parent.author?.display_name ?? "A classmate" : "A classmate";
  const replyCountLabel =
    visibleReplies.length === 1 ? "1 reply" : `${visibleReplies.length} replies`;
  const canSend = draft.trim().length > 0 && !sending;
  const blockName =
    blockFor?.author?.display_name ??
    (blockFor?.author?.handle ? `@${blockFor.author.handle}` : "this person");

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        style={{
          paddingTop: insets.top + space.close,
          paddingBottom: space.room,
          paddingHorizontal: space.close,
          flexDirection: "row",
          alignItems: "center",
          gap: space.cosy,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
          backgroundColor: theme.surface,
        }}
      >
        <BackChevron onPress={goBack} />
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.control,
            backgroundColor: theme.brandSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather name="corner-down-right" size={18} color={theme.brand} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="title" numberOfLines={1}>
            Thread
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {status === "ready" ? replyCountLabel : "Gathering replies…"}
          </AppText>
        </View>
      </View>

      {status !== "ready" ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: space.room,
            padding: space.rest,
          }}
        >
          {status === "loading" ? (
            <ActivityIndicator size="large" color={theme.brand} />
          ) : (
            <>
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 16,
                  backgroundColor: theme.brandSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Feather name="wifi-off" size={22} color={theme.brand} />
              </View>
              <AppText variant="title">Something hiccuped</AppText>
              <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
                We couldn't load this thread. Give it another try.
              </AppText>
              <Button
                label="Try again"
                variant="soft"
                size="sm"
                onPress={() => {
                  setStatus("loading");
                  void load();
                }}
              />
            </>
          )}
        </View>
      ) : !parent && replies.length === 0 && pending.length === 0 ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: space.room,
            padding: space.rest,
          }}
        >
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 16,
              backgroundColor: theme.brandSoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather name="message-circle" size={22} color={theme.brand} />
          </View>
          <AppText variant="title">Thread not available</AppText>
          <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
            This message is gone, or it lives in a channel you haven't joined.
          </AppText>
          <Button label="Go back" variant="soft" size="sm" onPress={goBack} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <FlatList
            ref={listRef}
            data={visibleReplies}
            keyExtractor={(m) => m.id}
            renderItem={renderReply}
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: space.card,
              paddingBottom: space.close,
            }}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void handleRefresh()}
                tintColor={theme.brand}
                colors={[theme.brand]}
              />
            }
            onContentSizeChange={() => {
              if (!pendingScrollRef.current) return;
              pendingScrollRef.current = false;
              listRef.current?.scrollToEnd({ animated: true });
            }}
            ListHeaderComponent={
              <View style={{ paddingTop: space.close }}>
                <Pressable
                  accessibilityHint={
                    parentVisible && parent && !parent.deleted_at
                      ? "Long press for message actions"
                      : undefined
                  }
                  onLongPress={() => {
                    if (parentVisible && parent && !parent.deleted_at) {
                      setActionsFor(parent);
                    }
                  }}
                  delayLongPress={300}
                >
                  <Card style={{ padding: space.close, gap: space.cosy }}>
                    <AuthorLink
                      handle={
                        parentVisible ? parent?.author?.handle : undefined
                      }
                      name={parentName}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.cosy,
                      }}
                    >
                      <Avatar
                        url={parentVisible ? parent?.author?.avatar_url : null}
                        name={parentName}
                        size={28}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <AppText variant="label" numberOfLines={1}>
                          {parentName}
                        </AppText>
                        {parentVisible && parent ? (
                          <AppText variant="caption" muted numberOfLines={1}>
                            {dayLabel(parent.created_at)} ·{" "}
                            {timeLabel(parent.created_at)}
                            {parent.edited_at ? " · (edited)" : ""}
                          </AppText>
                        ) : null}
                      </View>
                    </AuthorLink>
                    {!parentVisible || !parent ? (
                      <AppText muted>
                        This message is no longer available.
                      </AppText>
                    ) : parent.deleted_at ? (
                      <AppText muted style={{ fontStyle: "italic" }}>
                        Message deleted
                      </AppText>
                    ) : parent.poll_id ? (
                      <PollBubble pollId={parent.poll_id} />
                    ) : (
                      <>
                        {parent.forwarded_from ? (
                          <ForwardedFrom
                            from={parent.forwarded_from}
                            who={
                              parent.forwarded_author_id
                                ? (forwardedNames[parent.forwarded_author_id] ??
                                  null)
                                : null
                            }
                            own={false}
                          />
                        ) : null}
                        {parent.attachment_path ? (
                          <AttachmentImage
                            path={parent.attachment_path}
                            resolve={resolveAttachmentUrl}
                            onOpen={setViewerUrl}
                          />
                        ) : null}
                        {parent.attachment_path &&
                        parent.content === "Photo" ? null : (
                          <MentionText
                            text={parent.content}
                            baseStyle={{ ...BODY_TEXT, color: theme.foreground }}
                            highlightColor={theme.brand}
                          />
                        )}
                      </>
                    )}
                  </Card>
                </Pressable>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.room,
                    marginTop: space.card,
                    marginBottom: space.hair,
                  }}
                >
                  <AppText variant="label" muted>
                    Replies
                  </AppText>
                  <View
                    style={{ flex: 1, height: 1, backgroundColor: theme.border }}
                  />
                </View>
              </View>
            }
            ListEmptyComponent={
              <View
                style={{ paddingVertical: space.chapter, alignItems: "center" }}
              >
                <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
                  No replies yet — start the thread.
                </AppText>
              </View>
            }
            // Replies read top-down, so anything still waiting to send belongs
            // at the end of them — right where it was typed.
            ListFooterComponent={
              pending.length > 0 ? (
                <View>
                  {pending.map((message) => (
                    <PendingBubble
                      key={message.id}
                      message={message}
                      onRetry={() => void retryQueued(message)}
                      onDiscard={() => void discardQueued(message.id)}
                    />
                  ))}
                </View>
              ) : null
            }
          />

          {forwardNote ? (
            <View
              accessibilityLiveRegion="polite"
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.cosy,
                marginHorizontal: space.card,
                marginBottom: space.snug,
                paddingHorizontal: space.close,
                paddingVertical: space.cosy,
                borderRadius: radius.control,
                backgroundColor: theme.accentSoft,
              }}
            >
              <Feather name="corner-up-right" size={14} color={theme.accent} />
              <AppText
                variant="caption"
                style={{ color: theme.accent, flex: 1 }}
              >
                {forwardNote}
              </AppText>
            </View>
          ) : null}

          {sendError ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.cosy,
                marginHorizontal: space.card,
                marginBottom: space.snug,
                paddingHorizontal: space.close,
                paddingVertical: space.cosy,
                borderRadius: radius.control,
                backgroundColor: theme.surface2,
              }}
            >
              <Feather name="alert-circle" size={14} color={theme.danger} />
              <AppText variant="caption" style={{ color: theme.danger, flex: 1 }}>
                {sendError}
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss error"
                onPress={() => setSendError(null)}
                hitSlop={14}
                style={{
                  width: 24,
                  height: 24,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Feather name="x" size={14} color={theme.muted} />
              </Pressable>
            </View>
          ) : null}

          {mentions.active && mentions.suggestions.length > 0 ? (
            <View
              accessibilityLabel="Mention a channel member"
              style={{
                marginHorizontal: space.card,
                marginBottom: space.snug,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: radius.control,
                backgroundColor: theme.surface,
                overflow: "hidden",
              }}
            >
              {mentions.suggestions.map((s) => (
                <Pressable
                  key={s.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Mention ${s.displayName}`}
                  onPress={() =>
                    setDraft(mentions.applyMention(draft, s.handle))
                  }
                  style={({ pressed }) => ({
                    minHeight: 44,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.cosy,
                    paddingHorizontal: space.close,
                    backgroundColor: pressed ? theme.surface2 : "transparent",
                  })}
                >
                  <AppText variant="bodySemi" style={{ color: theme.brand }}>
                    @{s.handle}
                  </AppText>
                  <AppText
                    variant="caption"
                    muted
                    numberOfLines={1}
                    style={{ flex: 1 }}
                  >
                    {s.displayName}
                  </AppText>
                </Pressable>
              ))}
            </View>
          ) : null}

          {editing ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.cosy,
                marginHorizontal: space.card,
                marginBottom: space.snug,
                paddingHorizontal: space.close,
                paddingVertical: space.tight,
                borderRadius: radius.control,
                backgroundColor: theme.brandSoft,
              }}
            >
              <Feather name="edit-2" size={13} color={theme.brandInk} />
              <AppText
                variant="caption"
                style={{ color: theme.brandInk, flex: 1 }}
              >
                Editing message
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel editing"
                onPress={cancelEdit}
                hitSlop={10}
                style={{
                  width: 28,
                  height: 28,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Feather name="x" size={14} color={theme.brandInk} />
              </Pressable>
            </View>
          ) : null}

          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: space.room,
              paddingHorizontal: space.card,
              paddingTop: space.cosy,
              paddingBottom: Math.max(insets.bottom, 8),
              borderTopWidth: 1,
              borderTopColor: theme.border,
              backgroundColor: theme.surface,
            }}
          >
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={(text) => {
                setDraft(text);
                mentions.onDraftChange(text);
                noteDraft(text);
              }}
              placeholder={editing ? "Edit your message" : "Reply in thread"}
              placeholderTextColor={theme.muted}
              accessibilityLabel={
                editing ? "Edit your message" : "Reply in thread"
              }
              multiline
              maxLength={4000}
              cursorColor={theme.brand}
              selectionColor={theme.brandSoft}
              style={{
                flex: 1,
                minHeight: 44,
                maxHeight: 120,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 22,
                backgroundColor: theme.background,
                /* Field's metrics, not the ladder: 14 across, 11 top and
                   bottom, centring a 15/21 line in the 44px pill. */
                paddingHorizontal: 14,
                paddingTop: 11,
                paddingBottom: 11,
                fontFamily: fonts.body,
                fontSize: 15,
                color: theme.foreground,
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={editing ? "Save edit" : "Send reply"}
              disabled={!canSend}
              onPress={() => void (editing ? handleSaveEdit() : handleSend())}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                borderRadius: radius.full,
                backgroundColor: theme.brand,
                alignItems: "center",
                justifyContent: "center",
                opacity: !canSend ? 0.5 : pressed ? 0.85 : 1,
              })}
            >
              {sending ? (
                <ActivityIndicator size="small" color={theme.brandFg} />
              ) : (
                <Feather
                  name={editing ? "check" : "send"}
                  size={18}
                  color={theme.brandFg}
                />
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* Full-screen photo viewer — tap anywhere to close. */}
      <Modal
        visible={viewerUrl !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setViewerUrl(null)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          onPress={() => setViewerUrl(null)}
          style={{ flex: 1, backgroundColor: palettes.dark.background }}
        >
          {viewerUrl ? (
            <Image
              source={{ uri: viewerUrl }}
              style={{ flex: 1 }}
              contentFit="contain"
            />
          ) : null}
        </Pressable>
      </Modal>

      {/* The long-press menu: forwarding is for anyone's message, editing and
          deleting only for your own. Blocking asks its question inside the
          same sheet rather than opening a second one — a Modal dismissing
          while another presents is how you get a sheet that never appears. */}
      <Sheet
        visible={actionsFor !== null}
        onClose={() => {
          setBlockFor(null);
          setActionsFor(null);
        }}
        title={blockFor ? `Block ${blockName}?` : undefined}
      >
        {blockFor ? (
          <>
            <AppText muted style={{ marginBottom: space.cosy }}>
              They won't be able to DM you, their messages leave this thread,
              and you won't see their posts. They're never told.
            </AppText>
            <Sheet.Row
              icon="slash"
              label={blocking ? "Blocking…" : "Block them"}
              danger
              onPress={() => {
                const target = blockFor;
                if (target) void handleBlockAuthor(target);
              }}
            />
            <Sheet.Row
              icon="x"
              label="Keep seeing their messages"
              onPress={() => setBlockFor(null)}
            />
          </>
        ) : (
          <>
          <AppText variant="caption" muted numberOfLines={2}>
            {actionsFor?.content ?? ""}
          </AppText>
          <View style={{ height: 1, backgroundColor: theme.border }} />
          {/* A poll carrier's words are the question, and the poll itself
              doesn't travel — so there's nothing honest to forward. */}
          {actionsFor && !actionsFor.poll_id ? (
            <Sheet.Row
              icon="corner-up-right"
              label="Forward"
              onPress={() => {
                const target = actionsFor;
                setActionsFor(null);
                setForwardFor(target);
              }}
            />
          ) : null}
          {actionsFor &&
          actionsFor.author_id === userId &&
          !actionsFor.poll_id ? (
            <Sheet.Row
              icon="edit-2"
              label="Edit"
              onPress={() => {
                const target = actionsFor;
                setActionsFor(null);
                startEdit(target);
              }}
            />
          ) : null}
          {actionsFor && actionsFor.author_id === userId ? (
            <Sheet.Row
              icon="trash-2"
              label="Delete"
              danger
              onPress={() => {
                const target = actionsFor;
                setActionsFor(null);
                void handleDelete(target);
              }}
            />
          ) : null}
          {/* Reporting and blocking, one long-press away — the same two rows
              the room offers, because a thread is where a reply lands. */}
          {actionsFor && actionsFor.author_id !== userId ? (
            <>
              <View
                style={{
                  height: 1,
                  backgroundColor: theme.border,
                  marginVertical: space.tight,
                }}
              />
              <Sheet.Row
                icon="flag"
                label="Report message"
                onPress={() => {
                  const target = actionsFor;
                  setActionsFor(null);
                  router.push({
                    pathname: "/report",
                    params: {
                      messageId: target.id,
                      label: target.author?.display_name ?? "a classmate",
                      context: target.content,
                    },
                  });
                }}
              />
              <Sheet.Row
                icon="slash"
                label={`Block ${
                  actionsFor.author?.display_name ?? "this person"
                }`}
                danger
                onPress={() => setBlockFor(actionsFor)}
              />
            </>
          ) : null}
          </>
        )}
      </Sheet>

      <ForwardPicker
        visible={forwardFor !== null}
        source={forwardSource}
        exclude={forwardExclude}
        blocked={blocked}
        liftForKeyboard
        onClose={() => setForwardFor(null)}
        onFinished={showForwardNote}
      />
    </View>
  );
}
