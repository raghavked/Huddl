import Feather from "@expo/vector-icons/Feather";
import type {
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
} from "@supabase/supabase-js";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card } from "@/components/ui";
import { fonts, palettes, radius } from "@/constants/theme";
import { MentionText, useMentionSuggestions } from "@/features/mentions";
import { PollBubble } from "@/features/polls";
import { useBlockedIds } from "@/hooks/use-blocked";
import { useTheme } from "@/hooks/use-theme";
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
};

type Status = "loading" | "error" | "ready";

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const MESSAGE_SELECT =
  "id, channel_id, author_id, parent_id, content, attachment_path, poll_id, edited_at, deleted_at, created_at, author:profiles(id, handle, display_name, avatar_url)";

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

/** Tiny avatar stand-in: two initials on a warm circle, tinted by name hash. */
function Initials({ name, size = 28 }: { name: string; size?: number }) {
  const theme = useTheme();
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const pair =
    hash % 2 === 0
      ? { bg: theme.brandSoft, fg: theme.brandInk }
      : { bg: theme.accentSoft, fg: theme.accent };
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1] ?? "" : "";
  const initials =
    `${first.charAt(0)}${last ? last.charAt(0) : first.charAt(1)}`.toUpperCase() ||
    "?";
  return (
    <View
      accessibilityElementsHidden
      style={{
        width: size,
        height: size,
        borderRadius: radius.full,
        backgroundColor: pair.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <AppText
        variant="label"
        style={{ color: pair.fg, fontSize: size * 0.36, lineHeight: size * 0.5 }}
      >
        {initials}
      </AppText>
    </View>
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
        borderRadius: 12,
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
  const { blocked } = useBlockedIds();

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
    const [parentRes, repliesRes] = await Promise.all([
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
    ]);
    if (parentRes.error || repliesRes.error) {
      setStatus("error");
      return;
    }
    setParent((parentRes.data as unknown as MessageRow | null) ?? null);
    // Deleted replies stay in the stream as tombstones, matching the web.
    setReplies((repliesRes.data ?? []) as unknown as MessageRow[]);
    setStatus("ready");
  }, [userId, channelId, messageId]);

  useEffect(() => {
    void load();
  }, [load]);

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
                author: (data as unknown as Author | null) ?? null,
              });
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
  }, [isReady, channelId, messageId, userId, appendReply, patchMessage]);

  // Composer @-autocomplete, fed from the channel's member roster.
  const mentions = useMentionSuggestions(isReady ? channelId : null);

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending || !channelId || !messageId || !userId) return;
    setSendError(null);
    setDraft("");
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
      author: null,
    };
    appendReply(optimistic);
    setSending(true);
    const { data, error: insertError } = await supabase
      .from("messages")
      .insert({
        channel_id: channelId,
        author_id: userId,
        content,
        parent_id: messageId,
      })
      .select(MESSAGE_SELECT)
      .single();
    setSending(false);
    if (insertError || !data) {
      setReplies((prev) => prev.filter((m) => m.id !== tempId));
      setDraft(content);
      setSendError("Couldn't send that — check your connection and try again.");
      return;
    }
    // Reconcile: swap the temp row for the real one (dedupe by id in case the
    // realtime echo ever lands first).
    const real = data as unknown as MessageRow;
    setReplies((prev) => [
      ...prev.filter((m) => m.id !== tempId && m.id !== real.id),
      real,
    ]);
    pendingScrollRef.current = true;
  }, [draft, sending, channelId, messageId, userId, appendReply, mentions]);

  /* -------------------- edit / delete own messages -------------------- */

  const startEdit = useCallback(
    (target: MessageRow) => {
      draftBeforeEditRef.current = draft;
      setEditing(target);
      setDraft(target.content);
      mentions.reset();
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [draft, mentions]
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
            gap: 8,
            marginTop: grouped ? 2 : 10,
          }}
        >
          {!isOwn ? (
            grouped ? (
              <View style={{ width: 28 }} />
            ) : (
              <Initials name={authorName} size={28} />
            )
          ) : null}
          <View
            style={{
              maxWidth: "80%",
              alignItems: isOwn ? "flex-end" : "flex-start",
            }}
          >
            {!isOwn && !grouped ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "baseline",
                  gap: 6,
                  paddingHorizontal: 4,
                  marginBottom: 2,
                }}
              >
                <AppText variant="label" numberOfLines={1}>
                  {authorName}
                </AppText>
                <AppText variant="caption" muted>
                  {timeLabel(item.created_at)}
                </AppText>
              </View>
            ) : null}
            <Pressable
              accessibilityHint={
                isOwn && !deleted ? "Long press to edit or delete" : undefined
              }
              onLongPress={() => {
                if (isOwn && !deleted && !item.id.startsWith("temp-")) {
                  setActionsFor(item);
                }
              }}
              delayLongPress={300}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              {deleted ? (
                <View style={{ paddingHorizontal: 4, paddingVertical: 6 }}>
                  <AppText muted style={{ fontStyle: "italic" }}>
                    Message deleted
                  </AppText>
                </View>
              ) : item.poll_id ? (
                <PollBubble pollId={item.poll_id} />
              ) : (
                <Card
                  padded={false}
                  style={{
                    backgroundColor: isOwn ? theme.brandSoft : theme.surface2,
                    borderRadius: 16,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    gap: 6,
                  }}
                >
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
                </Card>
              )}
            </Pressable>
            {isOwn && !grouped ? (
              <AppText
                variant="caption"
                muted
                style={{ marginTop: 2, paddingHorizontal: 4 }}
              >
                {timeLabel(item.created_at)}
              </AppText>
            ) : null}
          </View>
        </View>
      );
    },
    [visibleReplies, userId, theme, resolveAttachmentUrl]
  );

  const parentName =
    parentVisible && parent ? parent.author?.display_name ?? "A classmate" : "A classmate";
  const replyCountLabel =
    visibleReplies.length === 1 ? "1 reply" : `${visibleReplies.length} replies`;
  const canSend = draft.trim().length > 0 && !sending;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingBottom: 10,
          paddingHorizontal: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
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
            {status === "ready" ? replyCountLabel : "Loading…"}
          </AppText>
        </View>
      </View>

      {status !== "ready" ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            padding: 28,
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
      ) : !parent && replies.length === 0 ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            padding: 28,
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
              paddingHorizontal: 16,
              paddingBottom: 12,
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
              <View style={{ paddingTop: 12 }}>
                <Pressable
                  accessibilityHint={
                    parentVisible &&
                    parent &&
                    parent.author_id === userId &&
                    !parent.deleted_at
                      ? "Long press to edit or delete"
                      : undefined
                  }
                  onLongPress={() => {
                    if (
                      parentVisible &&
                      parent &&
                      parent.author_id === userId &&
                      !parent.deleted_at
                    ) {
                      setActionsFor(parent);
                    }
                  }}
                  delayLongPress={300}
                >
                  <Card style={{ padding: 12, gap: 8 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <Initials name={parentName} size={28} />
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
                    </View>
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
                    gap: 10,
                    marginTop: 16,
                    marginBottom: 2,
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
              <View style={{ paddingVertical: 24, alignItems: "center" }}>
                <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
                  No replies yet — start the thread.
                </AppText>
              </View>
            }
          />

          {sendError ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                marginHorizontal: 16,
                marginBottom: 6,
                paddingHorizontal: 12,
                paddingVertical: 8,
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
                marginHorizontal: 16,
                marginBottom: 6,
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
                    gap: 8,
                    paddingHorizontal: 12,
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
                gap: 8,
                marginHorizontal: 16,
                marginBottom: 6,
                paddingHorizontal: 12,
                paddingVertical: 4,
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
              gap: 10,
              paddingHorizontal: 16,
              paddingTop: 8,
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
          style={{ flex: 1, backgroundColor: "#000" }}
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

      {actionsFor ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            justifyContent: "flex-end",
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close message actions"
            onPress={() => setActionsFor(null)}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              // The scrim stays candle-dark in both appearances.
              backgroundColor: palettes.dark.background,
              opacity: 0.55,
            }}
          />
          <Card
            style={{
              marginHorizontal: 12,
              marginBottom: Math.max(insets.bottom, 12),
              padding: 14,
              gap: 8,
            }}
          >
            <AppText variant="caption" muted numberOfLines={2}>
              {actionsFor.content}
            </AppText>
            <View style={{ height: 1, backgroundColor: theme.border }} />
            {!actionsFor.poll_id ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit message"
                onPress={() => {
                  const target = actionsFor;
                  setActionsFor(null);
                  startEdit(target);
                }}
                style={({ pressed }) => ({
                  minHeight: 44,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
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
                  <Feather name="edit-2" size={16} color={theme.brand} />
                </View>
                <AppText variant="bodyMedium">Edit</AppText>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete message"
              onPress={() => {
                const target = actionsFor;
                setActionsFor(null);
                void handleDelete(target);
              }}
              style={({ pressed }) => ({
                minHeight: 44,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: radius.control,
                  backgroundColor: theme.surface2,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Feather name="trash-2" size={16} color={theme.danger} />
              </View>
              <AppText variant="bodyMedium" style={{ color: theme.danger }}>
                Delete
              </AppText>
            </Pressable>
          </Card>
        </View>
      ) : null}
    </View>
  );
}
