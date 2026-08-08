import Feather from "@expo/vector-icons/Feather";
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button } from "@/components/ui";
import { fonts, radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
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

  const markRead = useCallback(() => {
    if (!userId || !threadId) return;
    void supabase
      .from("dm_participants")
      .update({ last_read_at: new Date().toISOString() })
      .eq("thread_id", threadId)
      .eq("user_id", userId)
      .then(() => undefined);
  }, [threadId, userId]);

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
  // send path already has them. The handler lives in a ref so the channel
  // subscribes once per thread.
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
      edited_at: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [temp, ...prev]);
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
          <View
            style={[
              {
                maxWidth: "80%",
                borderRadius: 18,
                paddingHorizontal: 14,
                paddingVertical: 9,
                opacity: isTemp ? 0.7 : 1,
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
              <AppText muted>Message deleted</AppText>
            ) : (
              <AppText>{item.content}</AppText>
            )}
          </View>
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
    [userId, theme]
  );

  const canSend = draft.trim().length > 0;
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
            <TextInput
              accessibilityLabel={
                otherFirstName ? `Message ${otherFirstName}` : "Message"
              }
              multiline
              value={draft}
              onChangeText={setDraft}
              placeholder={
                otherFirstName ? `Message ${otherFirstName}` : "Message"
              }
              placeholderTextColor={theme.muted}
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
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              disabled={!canSend}
              onPress={() => void handleSend()}
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
                <Feather name="send" size={18} color={theme.brandFg} />
              )}
            </Pressable>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}
