import Feather from "@expo/vector-icons/Feather";
import type {
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
} from "@supabase/supabase-js";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  TextInput,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { AppText, Button, Sheet } from "@/components/ui";
import { fonts, palettes, radius, space } from "@/constants/theme";
import {
  ForwardedFrom,
  ForwardPicker,
  PendingBubble,
} from "@/features/forwarding";
import { MessageBubble } from "@/features/messages";
import { useBlockedIds } from "@/hooks/use-blocked";
import { useTheme } from "@/hooks/use-theme";
import { blockUser, unblockUser } from "@/lib/blocks";
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
import { presenceLabel } from "@/lib/friends";
import {
  fetchThread,
  fetchThreadPeople,
  threadDisplay,
  type GroupThreadRow,
  type ThreadPerson,
} from "@/lib/group-dm";
import { tapLight } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* ---- local row types (mirror the web DM room's query shapes) ---- */

type ProfileLite = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
};

type DmMessage = {
  id: string;
  thread_id: string;
  author_id: string;
  content: string;
  attachment_path: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  /** Where a forwarded message came from ("#mat-21a"), null on an original. */
  forwarded_from: string | null;
  /** Who wrote it first, null on an original or a deleted account. */
  forwarded_author_id: string | null;
};

/** DmMessage shaped for the realtime payload's Record constraint. */
type DmMessageRow = DmMessage & Record<string, unknown>;

const PAGE_SIZE = 50;

/** Quiet time in the composer before the draft is written to the device. */
const DRAFT_SAVE_MS = 500;

/** Least time between two sweeps of this conversation's notifications. */
const NOTIFICATION_SWEEP_MS = 5000;

/** How long a jumped-to message keeps its ring before settling back in. */
const HIGHLIGHT_MS = 2600;

/* ---- small local helpers ---- */

function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const weekAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  if (d > weekAgo) {
    return d.toLocaleDateString([], {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** A chat image at thumb size. Resolves its signed URL through the screen's
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

/* ---- screen ---- */

export default function DmRoomScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const params = useLocalSearchParams<{
    id: string;
    messageId?: string;
    opener?: string;
  }>();
  const threadId = typeof params.id === "string" ? params.id : "";
  /* Saved messages and notification links can name a single message. The
     conversation opens at the bottom either way; this is what it jumps to. */
  const focusParam =
    typeof params.messageId === "string" && params.messageId
      ? params.messageId
      : null;
  /* Why this conversation is open. Whoever sent her here (a ride post, a
     shared class, a study-buddy card) passes the sentence along, so the
     first thing she types isn't "hi, this is about…". */
  const opener =
    typeof params.opener === "string" && params.opener.trim()
      ? params.opener.trim()
      : null;

  // The thread row carries is_group/title; `people` is everyone in it,
  // which a group needs for author names and the "N people" subtitle.
  const [thread, setThread] = useState<GroupThreadRow | null>(null);
  const [people, setPeople] = useState<ThreadPerson[]>([]);
  const [other, setOther] = useState<ProfileLite | null>(null);
  /* When the other person was last active, or null: null while they aren't
     sharing, and always null on a group. Rendered through presenceLabel(),
     so the header says "Active now" or nothing, never a timestamp. */
  const [otherSeen, setOtherSeen] = useState<string | null>(null);
  // Newest first. The FlatList is inverted so index 0 sits at the bottom.
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Power layer: attachments, editing, the own-message sheet, the viewer,
  // and the block gate on the composer.
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<DmMessage | null>(null);
  const draftBeforeEditRef = useRef("");
  const [actionsFor, setActionsFor] = useState<DmMessage | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  // Saved messages: my private bookmarks among the loaded rows, so the
  // long-press menu can tell "Save message" from "Remove from saved".
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [unblocking, setUnblocking] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const { blocked, refresh: refreshBlocked } = useBlockedIds();

  // Safety, one long-press away: the message being blocked out of.
  const [blockFor, setBlockFor] = useState<DmMessage | null>(null);
  const [blocking, setBlocking] = useState(false);

  // The opener line stays until she's read it or dismissed it.
  const [openerShown, setOpenerShown] = useState(true);

  // Jumping to one message: the list, the id still waiting for a scroll, and
  // the ring that says "this is the one you came for".
  const listRef = useRef<FlatList<DmMessage>>(null);
  const pendingFocusRef = useRef<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drafts and the send queue. One key names this conversation everywhere.
  const conversationKey = useMemo(() => keyFor("dm", threadId), [threadId]);
  const [pending, setPending] = useState<QueuedMessage[]>([]);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const editingRef = useRef(false);
  editingRef.current = editing !== null;
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Forwarding: the message being passed along, and the sentence that says
  // where it actually landed.
  const [forwardFor, setForwardFor] = useState<DmMessage | null>(null);
  const [forwardNote, setForwardNote] = useState<string | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Display names behind forwarded_author_id, fetched in one batch per page
  // rather than embedded. `dm_messages` has two foreign keys into `profiles`,
  // and a mis-hinted embed would take the whole thread's query down with it.
  const [forwardedNames, setForwardedNames] = useState<Record<string, string>>(
    {}
  );
  const forwardedNamesRef = useRef(forwardedNames);
  forwardedNamesRef.current = forwardedNames;

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/messages");
  }, []);

  /* Presence rides on its own read, off the critical path: the header can
     say the name long before it knows whether to whisper "Active now", and
     a failure here is simply a header with no whisper. `last_seen_at` is
     already null server-side while they aren't sharing; the explicit check
     keeps a stale column from leaking through anyway. */
  const otherId = other?.id ?? null;
  useEffect(() => {
    if (!otherId) {
      setOtherSeen(null);
      return;
    }
    let live = true;
    void supabase
      .from("profiles")
      .select("last_seen_at, share_last_seen")
      .eq("id", otherId)
      .maybeSingle()
      .then(({ data }) => {
        if (!live) return;
        const row = data as {
          last_seen_at: string | null;
          share_last_seen: boolean;
        } | null;
        setOtherSeen(
          row && row.share_last_seen === true ? row.last_seen_at : null
        );
      });
    return () => {
      live = false;
    };
  }, [otherId]);

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

  /* Reading the conversation has to be what makes the bell go dark. The read
     cursor only clears the dot on the Messages list, so the notifications
     this thread wrote get cleared here too. markRead runs on every arriving
     message, so the sweep is throttled to one round trip every few seconds. */
  const notifSweptAtRef = useRef(0);
  const markRead = useCallback(() => {
    if (!userId || !threadId) return;
    void supabase
      .from("dm_participants")
      .update({ last_read_at: new Date().toISOString() })
      .eq("thread_id", threadId)
      .eq("user_id", userId)
      .then(() => undefined);
    const now = Date.now();
    if (now - notifSweptAtRef.current < NOTIFICATION_SWEEP_MS) return;
    notifSweptAtRef.current = now;
    void supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("link", `/messages/${threadId}`)
      .is("read_at", null)
      .then(() => undefined);
  }, [threadId, userId]);

  /** Jump the stream to one message and ring it. The scroll itself waits for
      the list to be there to ask. */
  const focusMessage = useCallback((messageId: string) => {
    pendingFocusRef.current = messageId;
    setHighlightId(messageId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      highlightTimerRef.current = null;
      setHighlightId(null);
    }, HIGHLIGHT_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

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

  /** Which of these messages I've saved. One query per loaded page keeps
      the long-press menu label truthful. */
  const loadSaved = useCallback(
    async (messageIds: string[]) => {
      if (!userId || messageIds.length === 0) return;
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

  const load = useCallback(async () => {
    if (!userId || !threadId) return;
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      // Membership check: RLS hides threads I'm not in, so a missing row
      // covers bad ids and other people's threads alike.
      const { data: mineData, error: mineError } = await supabase
        .from("dm_participants")
        .select("thread_id, last_read_at")
        .eq("thread_id", threadId)
        .eq("user_id", userId)
        .maybeSingle();
      if (mineError) throw mineError;
      if (!mineData) {
        setNotFound(true);
        return;
      }

      const [threadRow, roster, messagesRes] = await Promise.all([
        fetchThread(threadId),
        fetchThreadPeople(threadId),
        supabase
          .from("dm_messages")
          .select("*")
          .eq("thread_id", threadId)
          .order("created_at", { ascending: false })
          .limit(PAGE_SIZE),
      ]);
      if (messagesRes.error) throw messagesRes.error;
      if (!threadRow) {
        setNotFound(true);
        return;
      }

      // A group is named after itself; a 1:1 is named after whoever isn't
      // you, and has nothing left to show once that account is gone.
      const otherProfile = threadRow.is_group
        ? null
        : (roster.find((person) => person.id !== userId) ?? null);
      if (!threadRow.is_group && !otherProfile) {
        setNotFound(true);
        return;
      }

      setThread(threadRow);
      setPeople(roster);
      setOther(otherProfile);
      const rows = (messagesRes.data ?? []) as DmMessage[];
      // The subscription is usually live before these two round trips
      // finish, so a message can land while we're still fetching, and this
      // snapshot predates it. Replacing outright would lose it for good:
      // markRead below moves the cursor past it, so the Messages list won't
      // flag it either. Keep whatever arrived and re-sort newest first.
      setMessages((prev) => {
        const fetched = new Set(rows.map((row) => row.id));
        const late = prev.filter((m) => !fetched.has(m.id));
        return late.length === 0
          ? rows
          : [...late, ...rows].sort((a, b) =>
              b.created_at.localeCompare(a.created_at)
            );
      });
      void loadSaved(rows.map((m) => m.id));
      void loadForwardedNames(rows);
      // Mount: advance the read cursor once we're actually looking.
      markRead();
    } catch {
      setError("We couldn't open this conversation right now.");
    } finally {
      setLoading(false);
    }
  }, [threadId, userId, markRead, loadSaved, loadForwardedNames]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ------------------------ drafts and the queue ----------------------- */

  // Restore what was left mid-sentence, but never over something already
  // typed: a slow read must not overwrite a fast typist.
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
        // draft. The real draft is parked in draftBeforeEditRef.
        if (editingRef.current) return;
        void saveDraft(conversationKey, text);
      }, DRAFT_SAVE_MS);
    },
    [conversationKey]
  );

  // Leaving the conversation writes the last word, debounce or no debounce.
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

  /** Pull rows the queue just landed into the stream. Our own realtime echoes
      are skipped, so nothing else would bring them in. */
  const adoptSent = useCallback(
    async (ids: readonly string[]) => {
      if (ids.length === 0) return;
      const { data } = await supabase
        .from("dm_messages")
        .select("*")
        .in("id", [...ids]);
      if (!data) return;
      const rows = data as DmMessage[];
      void loadForwardedNames(rows);
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        const fresh = rows
          .filter((row) => !known.has(row.id))
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        return fresh.length === 0 ? prev : [...fresh, ...prev];
      });
    },
    [loadForwardedNames]
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
    // Retire the pending bubbles BEFORE the real rows arrive. The other
    // order shows both for a frame, which reads as a message sent twice.
    await refreshPending();
    if (landed.length > 0) {
      await adoptSent(landed);
      markRead();
    }
  }, [conversationKey, adoptSent, markRead, refreshPending]);

  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  // Arriving in the conversation is when anything the queue is holding gets
  // another go.
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

  // Realtime INSERTs on this thread. Own rows are skipped, because the optimistic
  // send path already has them. UPDATEs (their edits and deletes, or ours
  // echoed) merge into the matching row. Handlers live in refs so the
  // channel subscribes once per thread.
  const handleIncoming = useCallback(
    (row: DmMessage) => {
      if (row.author_id === userId) return;
      setMessages((prev) =>
        prev.some((m) => m.id === row.id) ? prev : [row, ...prev]
      );
      markRead(); // we're looking at the thread, so it's read on arrival
    },
    [userId, markRead]
  );
  const incomingRef = useRef(handleIncoming);
  incomingRef.current = handleIncoming;

  const handleUpdated = useCallback((row: DmMessage) => {
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
  }, []);
  const updatedRef = useRef(handleUpdated);
  updatedRef.current = handleUpdated;

  useEffect(() => {
    if (!threadId) return;
    const channel = supabase
      .channel(`dm-room:${threadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "dm_messages",
          filter: `thread_id=eq.${threadId}`,
        },
        (payload: RealtimePostgresInsertPayload<DmMessageRow>) => {
          incomingRef.current(payload.new as DmMessage);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "dm_messages",
          filter: `thread_id=eq.${threadId}`,
        },
        (payload: RealtimePostgresUpdatePayload<DmMessageRow>) => {
          updatedRef.current(payload.new as DmMessage);
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [threadId]);

  async function handleSend() {
    const content = draft.trim();
    if (!content || !userId || !threadId) return;
    setSendError(null);
    setDraft("");
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    void clearDraft(conversationKey);
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const temp: DmMessage = {
      id: tempId,
      thread_id: threadId,
      author_id: userId,
      content,
      attachment_path: null,
      edited_at: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
      forwarded_from: null,
      forwarded_author_id: null,
    };
    setMessages((prev) => [temp, ...prev]);
    tapLight(); // the send lands with the optimistic bubble, not the round-trip
    setSending(true);
    // Queue it first, then send the queue's own row. The point is the id:
    // both attempts carry the same primary key, so a send that commits but
    // never answers is retried as a unique violation the queue reads as "it
    // already landed", rather than as a second copy of the message. See
    // QueuedMessage.id in drafts.ts.
    const payload = { thread_id: threadId, author_id: userId, content };
    let queued: QueuedMessage | null = null;
    let queueError: unknown = null;
    try {
      queued = await enqueue({
        key: conversationKey,
        table: "dm_messages",
        payload,
      });
    } catch (thrown) {
      // The device wouldn't hold it. Still worth the wire; this one send
      // just goes out with nothing behind it if it fails.
      queueError = thrown;
    }
    const { data, error: insertError } = await supabase
      .from("dm_messages")
      .insert(queued?.payload ?? payload)
      .select("*")
      .single();
    setSending(false);
    if (insertError || !data) {
      noteConnectivity(!isLikelyOffline(insertError));
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      if (!queued) {
        // Nothing is holding it, so give the words back.
        setDraft(content);
        setSendError(
          queueError instanceof DraftError
            ? queueError.message
            : "Couldn't send that. Check your connection and try again."
        );
        return;
      }
      // It's already queued under the id we just tried: the optimistic bubble
      // becomes a pending one, and the words stay in the conversation where
      // they were typed.
      await refreshPending();
      void runFlush();
      return;
    }
    noteConnectivity(true);
    // Reconcile: swap the temp row for the real one in place.
    const real = data as DmMessage;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === tempId);
      if (idx === -1) {
        return prev.some((m) => m.id === real.id) ? prev : [real, ...prev];
      }
      const next = [...prev];
      next[idx] = real;
      return next;
    });
    markRead();
    // The row is in the table, so the queue's copy has done its job. If this
    // drop is the thing that fails, the next flush hits 23505 and reads it as
    // sent anyway.
    if (queued) {
      await dropQueued(queued.id);
      await refreshPending();
    }
  }

  /** Pick a photo → upload to the student's own chat-uploads folder → send.
      Any typed draft rides along as the caption; otherwise content is "Photo". */
  const handlePickPhoto = useCallback(async () => {
    if (!threadId || !userId || uploading) return;
    setSendError(null);
    let asset: ImagePicker.ImagePickerAsset | null = null;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        quality: 0.7,
      });
      if (result.canceled) return;
      asset = result.assets[0] ?? null;
    } catch {
      setSendError("Couldn't open your photos. Give it another try.");
      return;
    }
    if (!asset) return;
    setUploading(true);
    try {
      const buffer = await (await fetch(asset.uri)).arrayBuffer();
      const contentType = asset.mimeType ?? "image/jpeg";
      const path = `${userId}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("chat-uploads")
        .upload(path, buffer, { contentType });
      if (uploadError) throw uploadError;
      const content = draft.trim() || "Photo";
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
      void clearDraft(conversationKey);
      const real = data as DmMessage;
      // Own realtime echoes are skipped, so append the row here.
      setMessages((prev) =>
        prev.some((m) => m.id === real.id) ? prev : [real, ...prev]
      );
      markRead();
    } catch {
      setSendError(
        "Couldn't send your photo. Check your connection and try again."
      );
    } finally {
      setUploading(false);
    }
  }, [threadId, userId, uploading, draft, markRead, conversationKey]);

  /* -------------------- edit / delete own messages -------------------- */

  const startEdit = useCallback(
    (target: DmMessage) => {
      // Bank whatever was half-typed before the composer borrows itself out.
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      void saveDraft(conversationKey, draft);
      draftBeforeEditRef.current = draft;
      setEditing(target);
      setDraft(target.content);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [draft, conversationKey]
  );

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setDraft(draftBeforeEditRef.current);
    draftBeforeEditRef.current = "";
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editing || !userId) return;
    const content = draft.trim();
    if (!content) return;
    const target = editing;
    setEditing(null);
    setDraft(draftBeforeEditRef.current);
    draftBeforeEditRef.current = "";
    if (content === target.content) return;
    const editedAt = new Date().toISOString();
    setMessages((prev) =>
      prev.map((m) =>
        m.id === target.id ? { ...m, content, edited_at: editedAt } : m
      )
    );
    const { error: updateError } = await supabase
      .from("dm_messages")
      .update({ content, edited_at: editedAt })
      .eq("id", target.id)
      .eq("author_id", userId);
    if (updateError) {
      setMessages((prev) => prev.map((m) => (m.id === target.id ? target : m)));
      setSendError("Couldn't save your edit. Give it another try.");
    }
  }, [editing, userId, draft]);

  /** Soft delete: the row stays as a "Message deleted" tombstone. */
  const handleDelete = useCallback(
    async (target: DmMessage) => {
      if (!userId) return;
      const deletedAt = new Date().toISOString();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === target.id ? { ...m, deleted_at: deletedAt } : m
        )
      );
      const { error: updateError } = await supabase
        .from("dm_messages")
        .update({ deleted_at: deletedAt })
        .eq("id", target.id)
        .eq("author_id", userId);
      if (updateError) {
        setMessages((prev) =>
          prev.map((m) => (m.id === target.id ? target : m))
        );
        setSendError("Couldn't delete that. Give it another try.");
      }
    },
    [userId]
  );

  /** Optimistic save/remove in message_bookmarks, a private keep-it-handy
      flag. A double-tap race (23505) already means saved, so it stands. */
  const handleToggleSaved = useCallback(
    async (messageId: string, save: boolean) => {
      if (!userId) return;
      if (save) tapLight();
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (save) next.add(messageId);
        else next.delete(messageId);
        return next;
      });
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
        setSendError(
          save
            ? "Couldn't save that. Give it another try."
            : "Couldn't remove that from saved. Give it another try."
        );
      }
    },
    [userId]
  );

  /* ------------------------- group vs. one-to-one ------------------------ */

  const isGroup = thread?.is_group === true;
  const display = thread ? threadDisplay(thread, people, userId) : null;
  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person] as const)),
    [people]
  );

  /* ----------------------------- blocking ----------------------------- */

  // A group can hold someone you've blocked, so there's no banner and no
  // gate on the composer: their messages just don't render.
  const otherBlocked = !isGroup && other !== null && blocked.has(other.id);

  // A block hides their words everywhere, and a 1:1 is no exception. This
  // used to filter groups only, so a blocked person could keep typing into an
  // existing 1:1 and be read. 0042 now drops them from the read policy too,
  // so the rows don't arrive at all; this stays because unblocking should
  // bring the conversation back on the spot rather than after a refetch.
  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (m) => m.author_id === userId || !blocked.has(m.author_id)
      ),
    [messages, userId, blocked]
  );

  const handleUnblock = useCallback(async () => {
    if (!userId || !other || unblocking) return;
    setUnblocking(true);
    try {
      await unblockUser(userId, other.id);
      await refreshBlocked();
    } catch {
      setSendError("Couldn't unblock just now. Give it another try.");
    } finally {
      setUnblocking(false);
    }
  }, [userId, other, unblocking, refreshBlocked]);

  /** Block whoever sent a message. One-way and private: they're never told.
      In a group their messages leave the thread; in a 1:1 the composer
      closes and the banner above it says so. */
  const handleBlockAuthor = useCallback(
    async (target: DmMessage) => {
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
        setSendError("Couldn't block them just now. Give it another try.");
      } finally {
        setBlocking(false);
      }
    },
    [userId, blocking, refreshBlocked]
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<DmMessage>) => {
      const own = item.author_id === userId;
      const isTemp = item.id.startsWith("temp-");
      const deleted = Boolean(item.deleted_at);
      // In a group, say who's talking, once per run rather than once per bubble.
      // The list is inverted, so the bubble drawn above this one is next.
      const author = own ? null : (peopleById.get(item.author_id) ?? null);
      const authorName = author?.display_name ?? "Someone who left";
      const showAuthor =
        isGroup &&
        !own &&
        visibleMessages[index + 1]?.author_id !== item.author_id;
      // Arrived here from saved messages or a notification.
      const highlighted = item.id === highlightId;
      return (
        <View
          style={{
            paddingVertical: space.tight,
            alignItems: own ? "flex-end" : "flex-start",
          }}
        >
          {showAuthor ? (
            // In a group, the name over a bubble is the route to the person,
            // and from there to reporting and blocking.
            <Pressable
              accessibilityRole={author ? "link" : "none"}
              accessibilityLabel={author ? `${authorName}'s profile` : undefined}
              disabled={!author}
              onPress={() => {
                if (author) router.push(`/u/${author.handle}`);
              }}
              // The strip draws at the avatar's 20px, so it takes 12 above and
              // below to give a thumb the full 44 to land on.
              hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: space.snug,
                marginBottom: space.tight,
                marginLeft: space.hair,
                maxWidth: "80%",
                opacity: pressed && author ? 0.6 : 1,
              })}
            >
              <Avatar
                url={author?.avatar_url ?? null}
                name={authorName}
                size={20}
              />
              <AppText variant="label" muted numberOfLines={1}>
                {authorName}
              </AppText>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityHint={
              deleted || isTemp
                ? undefined
                : own
                  ? "Long press to save, edit, or delete"
                  : "Long press to save, report, or block"
            }
            onLongPress={() => {
              if (!deleted && !isTemp) setActionsFor(item);
            }}
            delayLongPress={300}
            style={{ maxWidth: "80%", opacity: isTemp ? 0.7 : 1 }}
          >
            <MessageBubble
              own={own}
              deleted={deleted}
              highlighted={highlighted}
            >
              {deleted ? (
                <AppText muted style={{ fontStyle: "italic" }}>
                  Message deleted
                </AppText>
              ) : (
                <>
                  {item.forwarded_from ? (
                    <ForwardedFrom
                      from={item.forwarded_from}
                      who={
                        item.forwarded_author_id
                          ? (forwardedNames[item.forwarded_author_id] ?? null)
                          : null
                      }
                      own={own}
                    />
                  ) : null}
                  {item.attachment_path ? (
                    <AttachmentImage
                      path={item.attachment_path}
                      resolve={resolveAttachmentUrl}
                      onOpen={setViewerUrl}
                    />
                  ) : null}
                  {/* "Photo" is the placeholder content for caption-less
                      sends. */}
                  {item.attachment_path && item.content === "Photo" ? null : (
                    <AppText>{item.content}</AppText>
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
                </>
              )}
            </MessageBubble>
          </Pressable>
          <AppText
            variant="caption"
            muted
            /* Optical: 3 tucks the stamp under the bubble without
               reading as a gap between two separate things. */
            style={{ marginTop: 3, fontSize: 10, lineHeight: 13 }}
          >
            {isTemp ? "Sending…" : formatMessageTime(item.created_at)}
          </AppText>
        </View>
      );
    },
    [
      userId,
      resolveAttachmentUrl,
      isGroup,
      peopleById,
      visibleMessages,
      forwardedNames,
      highlightId,
    ]
  );

  /** Scroll to whatever `focusMessage` parked, once the list can be asked. */
  const drainFocus = useCallback(() => {
    const wanted = pendingFocusRef.current;
    if (!wanted) return;
    const index = visibleMessages.findIndex((m) => m.id === wanted);
    if (index < 0) return;
    pendingFocusRef.current = null;
    listRef.current?.scrollToIndex({
      index,
      animated: true,
      viewPosition: 0.5,
    });
  }, [visibleMessages]);

  // A messageId in the route (saved messages, a deep link) is a request to
  // open at that message rather than at the bottom. Once per arrival.
  const focusHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusParam || loading) return;
    if (focusHandledRef.current === focusParam) return;
    if (!visibleMessages.some((m) => m.id === focusParam)) return;
    focusHandledRef.current = focusParam;
    focusMessage(focusParam);
  }, [focusParam, loading, visibleMessages, focusMessage]);

  /* ----------------------------- forwarding ---------------------------- */

  /** What the picker is passing along. A forward of a forward keeps pointing
      at whoever wrote the words, not the last person to hand them on. A DM
      never names the person or the group it came out of. The receiving room
      is entitled to know the words were private, not who you were talking to. */
  const forwardSource = useMemo<ForwardSource | null>(() => {
    if (!forwardFor) return null;
    return {
      content: forwardFor.content,
      attachmentPath: forwardFor.attachment_path,
      authorId: forwardFor.forwarded_author_id ?? forwardFor.author_id,
      fromLabel: forwardFor.forwarded_from ?? forwardLabelFor({ kind: "dm" }),
    };
  }, [forwardFor]);

  const forwardExclude = useMemo(
    () => ({ kind: "dm" as const, id: threadId }),
    [threadId]
  );

  const canSend = draft.trim().length > 0 && !otherBlocked;
  const blockName = blockFor
    ? (peopleById.get(blockFor.author_id)?.display_name ?? "this person")
    : "this person";
  const otherFirstName = other
    ? other.display_name.trim().split(/\s+/)[0] || other.handle
    : null;
  // What the composer says it's talking to.
  const composerTarget = isGroup
    ? "the group"
    : otherFirstName
      ? otherFirstName
      : null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header: back affordance + the other person's name. */}
      <View
        style={{
          paddingTop: insets.top + space.tight,
          paddingHorizontal: space.room,
          paddingBottom: space.cosy,
          flexDirection: "row",
          alignItems: "center",
          gap: space.tight,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to messages"
          onPress={goBack}
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
        {isGroup && display ? (
          // The whole header is the way into the group's page.
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${display.title} group info`}
            accessibilityHint="Opens who's in the group and its settings"
            onPress={() =>
              router.push(`/dm/info?threadId=${encodeURIComponent(threadId)}`)
            }
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 44,
              flexDirection: "row",
              alignItems: "center",
              gap: space.room,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: radius.full,
                backgroundColor: theme.brandSoft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Feather name="users" size={17} color={theme.brandInk} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="title" numberOfLines={1}>
                {display.title}
              </AppText>
              <AppText variant="caption" muted numberOfLines={1}>
                {display.subtitle ?? "Group chat"}
              </AppText>
            </View>
            <Feather name="chevron-right" size={18} color={theme.muted} />
          </Pressable>
        ) : other ? (
          // The whole header is the way to the person, the same gesture the
          // group header uses for its info page, and the route that puts
          // reporting and blocking one tap from the conversation.
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`${other.display_name}'s profile`}
            accessibilityHint="Opens their profile, where you can report or block them"
            onPress={() => router.push(`/u/${other.handle}`)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 44,
              flexDirection: "row",
              alignItems: "center",
              gap: space.room,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Avatar url={other.avatar_url} name={other.display_name} size={38} />
            <View style={{ flex: 1 }}>
              <AppText variant="title" numberOfLines={1}>
                {other.display_name}
              </AppText>
              {/* The line under the name: their handle, and the presence
                  phrase beside it while they're sharing one. Never while
                  you've blocked them: a conversation you've closed the
                  door on shouldn't whisper "Active now" through it. */}
              {(() => {
                const activeLine = otherBlocked
                  ? null
                  : presenceLabel(otherSeen, new Date());
                return (
                  <AppText variant="caption" muted numberOfLines={1}>
                    @{other.handle}
                    {activeLine ? ` · ${activeLine}` : ""}
                  </AppText>
                );
              })()}
            </View>
            <Feather name="chevron-right" size={18} color={theme.muted} />
          </Pressable>
        ) : (
          <View style={{ flex: 1 }} />
        )}
      </View>

      {loading ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: space.close,
          }}
        >
          <ActivityIndicator size="large" color={theme.brand} />
          <AppText variant="caption" muted>
            Opening the conversation…
          </AppText>
        </View>
      ) : notFound ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: space.room,
            padding: space.chapter,
          }}
        >
          <Feather name="message-circle" size={28} color={theme.muted} />
          <AppText variant="bodySemi">We couldn't find that conversation</AppText>
          <AppText
            variant="caption"
            muted
            style={{ textAlign: "center", maxWidth: 280 }}
          >
            It may have been removed, or the link didn't point anywhere. Head
            back and pick a chat from your list.
          </AppText>
          <Button
            label="Back to messages"
            variant="soft"
            size="sm"
            onPress={goBack}
          />
        </View>
      ) : error ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: space.room,
            padding: space.chapter,
          }}
        >
          <Feather name="cloud-off" size={28} color={theme.muted} />
          <AppText variant="bodySemi">Something went sideways</AppText>
          <AppText
            variant="caption"
            muted
            style={{ textAlign: "center", maxWidth: 280 }}
          >
            {error} Check your connection and give it another go.
          </AppText>
          <Button
            label="Try again"
            variant="soft"
            size="sm"
            onPress={() => void load()}
          />
        </View>
      ) : (
        <>
          {/* A room emptied by a block isn't a fresh one. There's no
              composer to say hi with, so the banner below explains the
              quiet instead of inviting her to break it. */}
          {visibleMessages.length === 0 &&
          pending.length === 0 &&
          !otherBlocked ? (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                gap: space.cosy,
                padding: space.chapter,
              }}
            >
              {isGroup || !other ? (
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: radius.full,
                    backgroundColor: theme.brandSoft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Feather name="users" size={22} color={theme.brandInk} />
                </View>
              ) : (
                <Avatar
                  url={other.avatar_url}
                  name={other.display_name}
                  size={56}
                />
              )}
              <AppText variant="bodySemi">
                {isGroup
                  ? (display?.title ?? "Group chat")
                  : (other?.display_name ?? "Your classmate")}
              </AppText>
              <AppText
                variant="caption"
                muted
                style={{ textAlign: "center", maxWidth: 280 }}
              >
                {isGroup
                  ? "This is the start of the group. Say hi to everyone."
                  : `This is the start of your conversation${
                      otherFirstName ? ` with ${otherFirstName}` : ""
                    }. Say hi.`}
              </AppText>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              inverted
              data={visibleMessages}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingHorizontal: space.card,
                paddingVertical: space.close,
              }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onLayout={drainFocus}
              onContentSizeChange={drainFocus}
              // Bubbles are variable height, so an offscreen target can miss
              // on the first pass, so settle where we can and try once more.
              onScrollToIndexFailed={({ index, averageItemLength }) => {
                listRef.current?.scrollToOffset({
                  offset: index * Math.max(averageItemLength, 1),
                  animated: true,
                });
                setTimeout(() => {
                  listRef.current?.scrollToIndex({
                    index,
                    animated: true,
                    viewPosition: 0.5,
                  });
                }, 120);
              }}
              // In an inverted list the header sits at the visual bottom,
              // the right home for messages that haven't gone out yet, oldest
              // of them first, right where they were typed.
              ListHeaderComponent={
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
          )}

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
                marginHorizontal: space.card,
                marginBottom: space.snug,
                paddingHorizontal: space.close,
                paddingVertical: space.cosy,
                borderRadius: radius.control,
                backgroundColor: theme.surface2,
                flexDirection: "row",
                alignItems: "center",
                gap: space.cosy,
              }}
            >
              <Feather name="alert-circle" size={14} color={theme.danger} />
              <AppText
                variant="caption"
                style={{ color: theme.danger, flex: 1 }}
              >
                {sendError}
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss error"
                onPress={() => setSendError(null)}
                hitSlop={16}
              >
                <Feather name="x" size={14} color={theme.muted} />
              </Pressable>
            </View>
          ) : null}

          {otherBlocked ? (
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
              <Feather name="slash" size={14} color={theme.muted} />
              <AppText variant="caption" muted style={{ flex: 1 }}>
                You've blocked this person
              </AppText>
              <Button
                label="Unblock"
                variant="soft"
                size="sm"
                pending={unblocking}
                onPress={() => void handleUnblock()}
              />
            </View>
          ) : null}

          {/* Why this conversation is open, carried over from wherever she
              tapped Message. It sits above the composer until she's used it
              or waved it away, never in the box, which is hers. */}
          {opener && openerShown && !editing ? (
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
                backgroundColor: theme.brandSoft,
              }}
            >
              <Feather name="corner-up-right" size={14} color={theme.brandInk} />
              <AppText
                variant="caption"
                style={{ color: theme.brandInk, flex: 1 }}
                numberOfLines={2}
              >
                {opener}
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Hide this note"
                onPress={() => setOpenerShown(false)}
                hitSlop={14}
                style={{
                  width: 24,
                  height: 24,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Feather name="x" size={14} color={theme.brandInk} />
              </Pressable>
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

          {/* Composer: optimistic send, reconciled against the insert. */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: space.cosy,
              paddingHorizontal: space.card,
              paddingTop: space.cosy,
              paddingBottom: insets.bottom + space.close,
              borderTopWidth: 1,
              borderTopColor: theme.border,
            }}
          >
            {/* A channel's composer hides photo, poll, and "when can everyone
                meet?" behind one plus. Here there is exactly one thing to
                add (polls and availability are channel-scoped), and a plus
                that opens a sheet holding a single row is a tap tax, so the
                photo stays a direct button. */}
            {!editing ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send a photo"
                disabled={uploading || otherBlocked}
                onPress={() => void handlePickPhoto()}
                style={({ pressed }) => ({
                  width: 44,
                  height: 44,
                  borderRadius: radius.full,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.surface,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: uploading || otherBlocked ? 0.5 : pressed ? 0.7 : 1,
                })}
              >
                {uploading ? (
                  <ActivityIndicator size="small" color={theme.brand} />
                ) : (
                  <Feather name="image" size={19} color={theme.brand} />
                )}
              </Pressable>
            ) : null}
            <TextInput
              ref={inputRef}
              accessibilityLabel={
                editing
                  ? "Edit your message"
                  : composerTarget
                    ? `Message ${composerTarget}`
                    : "Message"
              }
              multiline
              editable={!otherBlocked}
              value={draft}
              onChangeText={(text) => {
                setDraft(text);
                noteDraft(text);
              }}
              placeholder={
                editing
                  ? "Edit your message"
                  : composerTarget
                    ? `Message ${composerTarget}`
                    : "Message"
              }
              placeholderTextColor={theme.muted}
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
                backgroundColor: theme.surface,
                paddingHorizontal: space.card,
                paddingTop: space.close,
                paddingBottom: space.close,
                fontFamily: fonts.body,
                fontSize: 15,
                color: theme.foreground,
                opacity: otherBlocked ? 0.5 : 1,
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={editing ? "Save edit" : "Send message"}
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
        </>
      )}

      {/* Full-screen photo viewer. Tap anywhere to close. */}
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

      {/* The long-press menu on a message: saving is for anyone's, editing
          and deleting only for your own. Blocking asks its question inside
          the same sheet rather than opening a second one, because a Modal
          dismissing while another presents is how you get a sheet that
          never appears. */}
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
              {isGroup
                ? "They won't be able to DM you, their messages leave this group, and you won't see their posts. They're never told."
                : "They won't be able to message you, and you won't see their posts. This conversation stays where it is. They're never told."}
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
              label="Keep things as they are"
              onPress={() => setBlockFor(null)}
            />
          </>
        ) : (
          <>
          <AppText variant="caption" muted numberOfLines={2}>
            {actionsFor?.content ?? ""}
          </AppText>
          <View style={{ height: 1, backgroundColor: theme.border }} />
          <Sheet.Row
            icon="corner-up-right"
            label="Forward"
            onPress={() => {
              const target = actionsFor;
              setActionsFor(null);
              if (target) setForwardFor(target);
            }}
          />
          <Sheet.Row
            icon="bookmark"
            label={
              actionsFor && savedIds.has(actionsFor.id)
                ? "Remove from saved"
                : "Save message"
            }
            onPress={() => {
              const id = actionsFor?.id;
              if (!id) return;
              const save = !savedIds.has(id);
              setActionsFor(null);
              void handleToggleSaved(id, save);
            }}
          />
          {actionsFor && actionsFor.author_id === userId ? (
            <>
              <Sheet.Row
                icon="edit-2"
                label="Edit"
                onPress={() => {
                  const target = actionsFor;
                  setActionsFor(null);
                  startEdit(target);
                }}
              />
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
            </>
          ) : null}
          {/* Reporting and blocking, one long-press away. A DM can't be
              attached to a report (reports.message_id points at channel
              messages), so the report names the sender and quotes the words
              back on the report screen, which says so plainly. */}
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
                      userId: target.author_id,
                      label:
                        peopleById.get(target.author_id)?.display_name ??
                        "a classmate",
                      context: target.content,
                    },
                  });
                }}
              />
              {!blocked.has(actionsFor.author_id) ? (
                <Sheet.Row
                  icon="slash"
                  label={`Block ${
                    peopleById.get(actionsFor.author_id)?.display_name ??
                    "this person"
                  }`}
                  danger
                  onPress={() => setBlockFor(actionsFor)}
                />
              ) : null}
            </>
          ) : null}
          </>
        )}
      </Sheet>

      {/* The picker draws itself, not through a Modal. See ForwardPicker.
          `liftForKeyboard` is false because this screen's root already is a
          KeyboardAvoidingView, and the overlay sits inside its padding box. */}
      <ForwardPicker
        visible={forwardFor !== null}
        source={forwardSource}
        exclude={forwardExclude}
        blocked={blocked}
        liftForKeyboard={false}
        onClose={() => setForwardFor(null)}
        onFinished={showForwardNote}
      />
    </KeyboardAvoidingView>
  );
}
