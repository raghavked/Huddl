import Feather from "@expo/vector-icons/Feather";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { Screen } from "@/components/screen";
import { AppText, Button, Card } from "@/components/ui";
import { fonts, radius } from "@/constants/theme";
import { useBlockedIds } from "@/hooks/use-blocked";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* ---- local row types (mirror the web /messages page's query shapes) ---- */

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

/** My side of each thread, with the thread's created_at as an activity floor. */
type MyParticipantRow = {
  thread_id: string;
  last_read_at: string;
  thread: { created_at: string } | null;
};

type OtherParticipantRow = {
  thread_id: string;
  profile: ProfileLite | null;
};

type ThreadItem = {
  threadId: string;
  other: ProfileLite;
  latest: DmMessage | null;
  latestIsMine: boolean;
  unread: boolean;
  activityAt: string;
};

/* ---- small local helpers (ported from the web's utils) ---- */

function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const weekAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  if (d > weekAgo) {
    return d.toLocaleDateString([], { weekday: "short" });
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

/* ---- pieces ---- */

function ThreadRow({ item }: { item: ThreadItem }) {
  const theme = useTheme();
  const preview = item.latest
    ? item.latest.deleted_at
      ? "Message deleted"
      : `${item.latestIsMine ? "You: " : ""}${item.latest.content.replace(/\s+/g, " ")}`
    : "No messages yet — say hi!";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Conversation with ${item.other.display_name}`}
      onPress={() => router.push(`/dm/${item.threadId}`)}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, marginBottom: 10 })}
    >
      <Card
        padded={false}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          minHeight: 68,
        }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: radius.full,
            backgroundColor: theme.brandSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AppText variant="title" style={{ color: theme.brandInk, fontSize: 16 }}>
            {initialsOf(item.other.display_name) || "?"}
          </AppText>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <AppText
              variant="bodySemi"
              numberOfLines={1}
              style={[
                { flexShrink: 1 },
                item.unread ? { fontFamily: fonts.bodyBold } : null,
              ]}
            >
              {item.other.display_name}
            </AppText>
            {item.latest ? (
              <AppText
                variant="caption"
                muted={!item.unread}
                style={
                  item.unread
                    ? { color: theme.brand, fontFamily: fonts.bodySemi }
                    : undefined
                }
              >
                {formatMessageTime(item.latest.created_at)}
              </AppText>
            ) : null}
          </View>
          <AppText
            variant="caption"
            muted={!item.unread}
            numberOfLines={1}
            style={item.unread ? { fontFamily: fonts.bodyMedium } : undefined}
          >
            {preview}
          </AppText>
        </View>
        {item.unread ? (
          <View
            accessibilityLabel="Unread messages"
            style={{
              width: 10,
              height: 10,
              borderRadius: radius.full,
              backgroundColor: theme.brand,
            }}
          />
        ) : null}
      </Card>
    </Pressable>
  );
}

function EmptyThreads() {
  const theme = useTheme();
  return (
    <Card
      style={{
        alignItems: "center",
        gap: 6,
        paddingVertical: 28,
        borderStyle: "dashed",
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.full,
          backgroundColor: theme.brandSoft,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 2,
        }}
      >
        <Feather name="message-circle" size={20} color={theme.brand} />
      </View>
      <AppText variant="bodySemi">No conversations yet</AppText>
      <AppText
        variant="caption"
        muted
        style={{ textAlign: "center", maxWidth: 280 }}
      >
        DM classmates to trade notes, plan study sessions, or just say hi. Find
        people in your course channels to get started.
      </AppText>
    </Card>
  );
}

/* ---- screen ---- */

export default function MessagesScreen() {
  const theme = useTheme();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [threads, setThreads] = useState<ThreadItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Blocked classmates' threads stay hidden; refreshed on focus so a block
  // made from a profile takes hold the moment you come back here.
  const { blocked, refresh: refreshBlocked } = useBlockedIds();

  const fetchThreads = useCallback(async (): Promise<ThreadItem[]> => {
    if (!userId) throw new Error("Not signed in");

    const { data: mineData, error: mineError } = await supabase
      .from("dm_participants")
      .select("thread_id, last_read_at, thread:dm_threads(created_at)")
      .eq("user_id", userId);
    if (mineError) throw mineError;
    const mine = (mineData ?? []) as unknown as MyParticipantRow[];
    const threadIds = mine.map((row) => row.thread_id);
    if (threadIds.length === 0) return [];

    // Other participants + the latest message per thread, all in parallel —
    // the same shape as the web /messages page.
    const [othersRes, latestResults] = await Promise.all([
      supabase
        .from("dm_participants")
        .select("thread_id, profile:profiles(id, handle, display_name, avatar_url)")
        .in("thread_id", threadIds)
        .neq("user_id", userId),
      Promise.all(
        threadIds.map((id) =>
          supabase
            .from("dm_messages")
            .select("*")
            .eq("thread_id", id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        )
      ),
    ]);
    if (othersRes.error) throw othersRes.error;

    const otherByThread = new Map<string, ProfileLite>();
    for (const row of (othersRes.data ?? []) as unknown as OtherParticipantRow[]) {
      if (row.profile) otherByThread.set(row.thread_id, row.profile);
    }
    const latestByThread = new Map<string, DmMessage>();
    threadIds.forEach((id, i) => {
      const latest = latestResults[i]?.data as DmMessage | null;
      if (latest) latestByThread.set(id, latest);
    });

    return mine
      .map((row) => {
        // No other participant (e.g. a deleted account) — nothing to show.
        const other = otherByThread.get(row.thread_id);
        if (!other) return null;
        const latest = latestByThread.get(row.thread_id) ?? null;
        return {
          threadId: row.thread_id,
          other,
          latest,
          latestIsMine: latest?.author_id === userId,
          unread: Boolean(
            latest &&
              latest.author_id !== userId &&
              new Date(latest.created_at).getTime() >
                new Date(row.last_read_at).getTime()
          ),
          activityAt: latest?.created_at ?? row.thread?.created_at ?? "",
        };
      })
      .filter((t): t is ThreadItem => t !== null)
      .sort(
        (a, b) =>
          new Date(b.activityAt).getTime() - new Date(a.activityAt).getTime()
      );
  }, [userId]);

  const run = useCallback(
    async (mode: "initial" | "refresh" | "silent") => {
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      try {
        setThreads(await fetchThreads());
        setError(null);
      } catch {
        setError("We couldn't load your messages right now.");
      } finally {
        if (mode === "initial") setLoading(false);
        if (mode === "refresh") setRefreshing(false);
      }
    },
    [fetchThreads]
  );

  // First focus loads with a spinner; later focuses (e.g. coming back from a
  // thread) refetch quietly so read/unread state stays honest.
  const loadedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      void refreshBlocked();
      if (loadedRef.current) {
        void run("silent");
      } else {
        loadedRef.current = true;
        void run("initial");
      }
    }, [userId, run, refreshBlocked])
  );

  const visibleThreads = (threads ?? []).filter(
    (t) => !blocked.has(t.other.id)
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ThreadItem>) => <ThreadRow item={item} />,
    []
  );

  return (
    <Screen title="Messages" scroll={false}>
      {loading ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            paddingBottom: 80,
          }}
        >
          <ActivityIndicator size="large" color={theme.brand} />
          <AppText variant="caption" muted>
            Fetching your conversations…
          </AppText>
        </View>
      ) : error && threads === null ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            paddingBottom: 80,
          }}
        >
          <Feather name="cloud-off" size={28} color={theme.muted} />
          <AppText variant="bodySemi">Something went sideways</AppText>
          <AppText
            variant="caption"
            muted
            style={{ textAlign: "center", maxWidth: 260 }}
          >
            {error} Check your connection and give it another go.
          </AppText>
          <Button
            label="Try again"
            variant="soft"
            size="sm"
            onPress={() => void run("initial")}
          />
        </View>
      ) : (
        <FlatList
          data={visibleThreads}
          keyExtractor={(item) => item.threadId}
          renderItem={renderItem}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={{ gap: 6, marginBottom: 12 }}>
              <AppText muted>
                Trade notes, plan study sessions, or just say hi.
              </AppText>
              {error ? (
                <AppText variant="caption" style={{ color: theme.danger }}>
                  We couldn't refresh just now — pull down to try again.
                </AppText>
              ) : null}
            </View>
          }
          ListEmptyComponent={<EmptyThreads />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void run("refresh")}
              tintColor={theme.brand}
              colors={[theme.brand]}
            />
          }
        />
      )}
    </Screen>
  );
}
