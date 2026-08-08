import Feather from "@expo/vector-icons/Feather";
import type {
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
} from "@supabase/supabase-js";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { AppText, Button, Card } from "@/components/ui";
import { fonts, palettes, radius } from "@/constants/theme";
import { useBlockedIds } from "@/hooks/use-blocked";
import { useTheme } from "@/hooks/use-theme";
import { unblockUser } from "@/lib/blocks";
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
};

/** DmMessage shaped for the realtime payload's Record constraint. */
type DmMessageRow = DmMessage & Record<string, unknown>;

const PAGE_SIZE = 50;

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

/** "Ada Lovelace" -> "AL" for the avatar circle. */
function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
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

/* ---- screen ---- */

export default function DmRoomScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const params = useLocalSearchParams<{ id: string }>();
  const threadId = typeof params.id === "string" ? params.id : "";

  const [other, setOther] = useState<ProfileLite | null>(null);
  // Newest first — the FlatList is inverted so index 0 sits at the bottom.
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
  const [unblocking, setUnblocking] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const { blocked, refresh: refreshBlocked } = useBlockedIds();

  const markRead = useCallback(() => {
    if (!userId || !threadId) return;
    void supabase
      .from("dm_participants")
      .update({ last_read_at: new Date().toISOString() })
      .eq("thread_id", threadId)
      .eq("user_id", userId)
      .then(() => undefined);
  }, [threadId, userId]);

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

      const [otherRes, messagesRes] = await Promise.all([
        supabase
          .from("dm_participants")
          .select("user_id, profile:profiles(id, handle, display_name, avatar_url)")
          .eq("thread_id", threadId)
          .neq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("dm_messages")
          .select("*")
          .eq("thread_id", threadId)
          .order("created_at", { ascending: false })
          .limit(PAGE_SIZE),
      ]);
      if (otherRes.error) throw otherRes.error;
      if (messagesRes.error) throw messagesRes.error;

      const otherProfile =
        (otherRes.data as unknown as { profile: ProfileLite | null } | null)
          ?.profile ?? null;
      // The other account is gone — the thread has nothing left to show.
      if (!otherProfile) {
        setNotFound(true);
        return;
      }

      setOther(otherProfile);
      setMessages((messagesRes.data ?? []) as DmMessage[]);
      // Mount: advance the read cursor once we're actually looking.
      markRead();
    } catch {
      setError("We couldn't open this conversation right now.");
    } finally {
      setLoading(false);
    }
  }, [threadId, userId, markRead]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime INSERTs on this thread. Own rows are skipped — the optimistic
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
    };
    setMessages((prev) => [temp, ...prev]);
    tapLight(); // the send lands with the optimistic bubble, not the round-trip
    setSending(true);
    const { data, error: insertError } = await supabase
      .from("dm_messages")
      .insert({ thread_id: threadId, author_id: userId, content })
      .select("*")
      .single();
    setSending(false);
    if (insertError || !data) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setDraft(content);
      setSendError("Couldn't send that. Check your connection and try again.");
      return;
    }
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
  }, [threadId, userId, uploading, draft, markRead]);

  /* -------------------- edit / delete own messages -------------------- */

  const startEdit = useCallback(
    (target: DmMessage) => {
      draftBeforeEditRef.current = draft;
      setEditing(target);
      setDraft(target.content);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [draft]
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

  /* ----------------------------- blocking ----------------------------- */

  const otherBlocked = other !== null && blocked.has(other.id);

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

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<DmMessage>) => {
      const own = item.author_id === userId;
      const isTemp = item.id.startsWith("temp-");
      const deleted = Boolean(item.deleted_at);
      return (
        <View
          style={{
            paddingVertical: 4,
            alignItems: own ? "flex-end" : "flex-start",
          }}
        >
          <Pressable
            accessibilityHint={
              own && !deleted && !isTemp
                ? "Long press to edit or delete"
                : undefined
            }
            onLongPress={() => {
              if (own && !deleted && !isTemp) setActionsFor(item);
            }}
            delayLongPress={300}
            style={[
              {
                maxWidth: "80%",
                borderRadius: 18,
                paddingHorizontal: 14,
                paddingVertical: 9,
                opacity: isTemp ? 0.7 : 1,
                gap: 6,
              },
              deleted
                ? {
                    borderWidth: 1,
                    borderStyle: "dashed",
                    borderColor: theme.border,
                  }
                : own
                  ? {
                      backgroundColor: theme.brandSoft,
                      borderBottomRightRadius: 6,
                    }
                  : {
                      backgroundColor: theme.surface2,
                      borderBottomLeftRadius: 6,
                    },
            ]}
          >
            {deleted ? (
              <AppText muted style={{ fontStyle: "italic" }}>
                Message deleted
              </AppText>
            ) : (
              <>
                {item.attachment_path ? (
                  <AttachmentImage
                    path={item.attachment_path}
                    resolve={resolveAttachmentUrl}
                    onOpen={setViewerUrl}
                  />
                ) : null}
                {/* "Photo" is the placeholder content for caption-less sends. */}
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
          </Pressable>
          <AppText
            variant="caption"
            muted
            style={{ marginTop: 3, fontSize: 10, lineHeight: 13 }}
          >
            {isTemp ? "Sending…" : formatMessageTime(item.created_at)}
          </AppText>
        </View>
      );
    },
    [userId, theme, resolveAttachmentUrl]
  );

  const canSend = draft.trim().length > 0 && !otherBlocked;
  const otherFirstName = other
    ? other.display_name.trim().split(/\s+/)[0] || other.handle
    : null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header: back affordance + the other person's name. */}
      <View
        style={{
          paddingTop: insets.top + 4,
          paddingHorizontal: 10,
          paddingBottom: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to messages"
          onPress={() => router.back()}
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
        {other ? (
          <View
            style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}
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
              <AppText
                variant="title"
                style={{ color: theme.brandInk, fontSize: 15 }}
              >
                {initialsOf(other.display_name) || "?"}
              </AppText>
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="title" numberOfLines={1}>
                {other.display_name}
              </AppText>
              <AppText variant="caption" muted numberOfLines={1}>
                @{other.handle}
              </AppText>
            </View>
          </View>
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
            gap: 12,
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
            gap: 10,
            padding: 24,
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
            onPress={() => router.back()}
          />
        </View>
      ) : error ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            padding: 24,
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
          {messages.length === 0 ? (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: 24,
              }}
            >
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
                <AppText
                  variant="title"
                  style={{ color: theme.brandInk, fontSize: 20 }}
                >
                  {other ? initialsOf(other.display_name) || "?" : "?"}
                </AppText>
              </View>
              <AppText variant="bodySemi">
                {other?.display_name ?? "Your classmate"}
              </AppText>
              <AppText
                variant="caption"
                muted
                style={{ textAlign: "center", maxWidth: 280 }}
              >
                This is the start of your conversation
                {otherFirstName ? ` with ${otherFirstName}` : ""}. Say hi!
              </AppText>
            </View>
          ) : (
            <FlatList
              inverted
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingVertical: 12,
              }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            />
          )}

          {sendError ? (
            <View
              style={{
                marginHorizontal: 16,
                marginBottom: 6,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: radius.control,
                backgroundColor: theme.surface2,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
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
                gap: 8,
                marginHorizontal: 16,
                marginBottom: 6,
                paddingHorizontal: 12,
                paddingVertical: 8,
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

          {/* Composer: optimistic send, reconciled against the insert. */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: 8,
              paddingHorizontal: 16,
              paddingTop: 8,
              paddingBottom: insets.bottom + 12,
              borderTopWidth: 1,
              borderTopColor: theme.border,
            }}
          >
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
                  : otherFirstName
                    ? `Message ${otherFirstName}`
                    : "Message"
              }
              multiline
              editable={!otherBlocked}
              value={draft}
              onChangeText={setDraft}
              placeholder={
                editing
                  ? "Edit your message"
                  : otherFirstName
                    ? `Message ${otherFirstName}`
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
                paddingHorizontal: 16,
                paddingTop: 12,
                paddingBottom: 12,
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
    </KeyboardAvoidingView>
  );
}
