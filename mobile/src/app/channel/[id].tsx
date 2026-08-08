import Feather from "@expo/vector-icons/Feather";
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState, type ComponentProps } from "react";
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
import { AppText, Button, Card } from "@/components/ui";
import { fonts, radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

type FeatherName = ComponentProps<typeof Feather>["name"];

type ChannelKind = "campus" | "course" | "topic" | "club";

/** Minimal local row shapes — the web app's types live outside this tsconfig. */
type ChannelRow = {
  id: string;
  kind: ChannelKind;
  name: string;
  slug: string;
  description: string | null;
  course: { id: string; code: string; title: string } | null;
};

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
  created_at: string;
  deleted_at: string | null;
};

type Status = "loading" | "error" | "notFound" | "notMember" | "ready";

const PAGE_SIZE = 50;
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const MESSAGE_SELECT =
  "id, channel_id, author_id, parent_id, content, created_at, author:profiles(id, handle, display_name, avatar_url)";

const KIND_ICONS: Record<ChannelKind, FeatherName> = {
  campus: "volume-2",
  course: "book-open",
  topic: "hash",
  club: "users",
};

function channelTitle(channel: ChannelRow): string {
  if (channel.kind === "course") return channel.course?.code ?? channel.name;
  if (channel.kind === "club") return channel.name;
  return `#${channel.slug}`;
}

function channelSubtitle(channel: ChannelRow): string | null {
  if (channel.kind === "course") {
    return channel.course?.title ?? channel.description;
  }
  return channel.description;
}

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
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

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
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

function DaySeparator({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="none"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginTop: 18,
        marginBottom: 4,
      }}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
      <AppText variant="label" muted>
        {label}
      </AppText>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
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

export default function ChannelRoomScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id;
  const { id } = useLocalSearchParams<{ id: string }>();
  const channelId = id ?? "";

  const [status, setStatus] = useState<Status>("loading");
  const [channel, setChannel] = useState<ChannelRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/channels");
  }, [router]);

  const markRead = useCallback(() => {
    if (!channelId || !userId) return;
    // PostgrestBuilder only runs once awaited/then'd — fire and forget.
    void supabase
      .from("channel_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("channel_id", channelId)
      .eq("user_id", userId)
      .then(() => undefined);
  }, [channelId, userId]);

  const load = useCallback(async () => {
    if (!userId) return;
    if (!channelId) {
      setStatus("notFound");
      return;
    }
    const [channelRes, memberRes, messagesRes] = await Promise.all([
      supabase
        .from("channels")
        .select("id, kind, name, slug, description, course:courses(id, code, title)")
        .eq("id", channelId)
        .maybeSingle(),
      supabase
        .from("channel_members")
        .select("channel_id, last_read_at")
        .eq("channel_id", channelId)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("messages")
        .select(MESSAGE_SELECT)
        .eq("channel_id", channelId)
        .is("parent_id", null)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE),
    ]);
    if (channelRes.error) {
      setStatus("error");
      return;
    }
    const channelRow = channelRes.data as unknown as ChannelRow | null;
    // RLS hides other campuses' channels, so "not found" covers both cases.
    if (!channelRow) {
      setStatus("notFound");
      return;
    }
    setChannel(channelRow);
    if (!memberRes.data) {
      setStatus("notMember");
      return;
    }
    if (messagesRes.error) {
      setStatus("error");
      return;
    }
    // Newest first — exactly what an inverted FlatList wants.
    setMessages((messagesRes.data ?? []) as unknown as MessageRow[]);
    setStatus("ready");
    markRead();
  }, [channelId, userId, markRead]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live inserts: skip own echoes (the optimistic path already has them) and
  // thread replies (threads aren't in mobile v1), hydrate the author, prepend.
  const isReady = status === "ready";
  useEffect(() => {
    if (!isReady || !channelId || !userId) return;
    const room = supabase
      .channel(`room:${channelId}`)
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
          if (row.author_id === userId) return;
          if (row.parent_id) return;
          markRead();
          void supabase
            .from("profiles")
            .select("id, handle, display_name, avatar_url")
            .eq("id", row.author_id)
            .maybeSingle()
            .then(({ data }) => {
              const incoming: MessageRow = {
                id: row.id,
                channel_id: row.channel_id,
                author_id: row.author_id,
                parent_id: row.parent_id,
                content: row.content,
                created_at: row.created_at,
                author: (data as unknown as Author | null) ?? null,
              };
              setMessages((prev) =>
                prev.some((m) => m.id === incoming.id)
                  ? prev
                  : [incoming, ...prev]
              );
            });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(room);
    };
  }, [isReady, channelId, userId, markRead]);

  const handleJoin = useCallback(async () => {
    if (!channelId || !userId) return;
    setJoinError(null);
    setJoining(true);
    const { error: insertError } = await supabase
      .from("channel_members")
      .insert({ channel_id: channelId, user_id: userId });
    setJoining(false);
    if (insertError) {
      setJoinError("Couldn't join just now. Give it another try.");
      return;
    }
    setStatus("loading");
    void load();
  }, [channelId, userId, load]);

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending || !channelId || !userId) return;
    setSendError(null);
    setDraft("");
    const tempId = `temp-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    // Optimistic bubble — own messages don't render the author, so null is fine.
    const optimistic: MessageRow = {
      id: tempId,
      channel_id: channelId,
      author_id: userId,
      parent_id: null,
      content,
      created_at: new Date().toISOString(),
      author: null,
    };
    setMessages((prev) => [optimistic, ...prev]);
    setSending(true);
    const { data, error: insertError } = await supabase
      .from("messages")
      .insert({ channel_id: channelId, author_id: userId, content })
      .select(MESSAGE_SELECT)
      .single();
    setSending(false);
    if (insertError || !data) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setDraft(content);
      setSendError("Couldn't send that — check your connection and try again.");
      return;
    }
    // Reconcile: swap the temp row for the real one (dedupe by id in case the
    // realtime echo ever lands first).
    const real = data as unknown as MessageRow;
    setMessages((prev) => [
      real,
      ...prev.filter((m) => m.id !== tempId && m.id !== real.id),
    ]);
    markRead();
  }, [draft, sending, channelId, userId, markRead]);

  const renderMessage = useCallback(
    ({ item, index }: ListRenderItemInfo<MessageRow>) => {
      // Inverted list: index + 1 is the chronologically older neighbor.
      const older = messages[index + 1] ?? null;
      const isOwn = item.author_id === userId;
      const newDay = !older || dayKey(older.created_at) !== dayKey(item.created_at);
      const grouped =
        !newDay &&
        older !== null &&
        older.author_id === item.author_id &&
        new Date(item.created_at).getTime() -
          new Date(older.created_at).getTime() <
          GROUP_WINDOW_MS;
      const authorName = item.author?.display_name ?? "A classmate";
      return (
        <View>
          {newDay ? <DaySeparator label={dayLabel(item.created_at)} /> : null}
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
              <Card
                padded={false}
                style={{
                  backgroundColor: isOwn ? theme.brandSoft : theme.surface2,
                  borderRadius: 16,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                }}
              >
                <AppText>{item.content}</AppText>
              </Card>
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
        </View>
      );
    },
    [messages, userId, theme]
  );

  const title = channel ? channelTitle(channel) : "";

  /* ------------------------- pre-chat states ------------------------- */

  if (status !== "ready" || !channel) {
    const kind = channel?.kind;
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + 8,
        }}
      >
        <View style={{ paddingHorizontal: 12 }}>
          <BackChevron onPress={goBack} />
        </View>
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
          ) : status === "error" ? (
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
                We couldn't load this channel. Give it another try.
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
          ) : status === "notFound" ? (
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
                <Feather name="lock" size={22} color={theme.brand} />
              </View>
              <AppText variant="title">Channel not available</AppText>
              <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
                This channel doesn't exist, or it belongs to another campus.
              </AppText>
              <Button
                label="Back to your channels"
                variant="soft"
                size="sm"
                onPress={goBack}
              />
            </>
          ) : kind === "campus" || kind === "topic" ? (
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
                <Feather
                  name={kind ? KIND_ICONS[kind] : "hash"}
                  size={22}
                  color={theme.brand}
                />
              </View>
              <AppText variant="title">{title}</AppText>
              {channel?.description ? (
                <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
                  {channel.description}
                </AppText>
              ) : null}
              <AppText
                variant="caption"
                muted
                style={{ textAlign: "center", maxWidth: 280 }}
              >
                {kind === "campus" ? "Campus channel" : "Topic channel"} — open
                to everyone at your school.
              </AppText>
              <Button
                label="Join channel"
                pending={joining}
                onPress={() => void handleJoin()}
              />
              {joinError ? (
                <AppText variant="caption" style={{ color: theme.danger }}>
                  {joinError}
                </AppText>
              ) : null}
            </>
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
                <Feather
                  name={kind ? KIND_ICONS[kind] : "hash"}
                  size={22}
                  color={theme.brand}
                />
              </View>
              <AppText variant="title">
                {kind === "course"
                  ? "This is a course channel"
                  : "This is a club channel"}
              </AppText>
              <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
                {kind === "course"
                  ? "Course channels are joined automatically from your schedule. Add this course and you're in."
                  : "Join the club and its channel comes with it."}
              </AppText>
              <Button
                label="Back to your channels"
                variant="soft"
                size="sm"
                onPress={goBack}
              />
            </>
          )}
        </View>
      </View>
    );
  }

  /* ----------------------------- the room ---------------------------- */

  const subtitle = channelSubtitle(channel);
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
          <Feather name={KIND_ICONS[channel.kind]} size={18} color={theme.brand} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="title" numberOfLines={1}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" muted numberOfLines={1}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {messages.length === 0 ? (
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
            <AppText variant="title">It's quiet in here</AppText>
            <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
              Nobody's said anything yet — be the first to say hi.
            </AppText>
          </View>
        ) : (
          <FlatList
            data={messages}
            inverted
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingVertical: 12,
            }}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            // In an inverted list the footer sits at the visual top — the
            // right home for a "beginning of the channel" note.
            ListFooterComponent={
              messages.length < PAGE_SIZE ? (
                <View style={{ paddingVertical: 16, gap: 2 }}>
                  <AppText variant="title">Welcome to {title}</AppText>
                  <AppText variant="caption" muted>
                    This is the very beginning of the channel.
                  </AppText>
                </View>
              ) : null
            }
          />
        )}

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
            value={draft}
            onChangeText={setDraft}
            placeholder={`Message ${title}`}
            placeholderTextColor={theme.muted}
            accessibilityLabel={`Message ${title}`}
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
      </KeyboardAvoidingView>
    </View>
  );
}
