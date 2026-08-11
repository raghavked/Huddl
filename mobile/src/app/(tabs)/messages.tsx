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
import { Avatar } from "@/components/avatar";
import { PaperPlane } from "@/components/illustrations";
import { Screen } from "@/components/screen";
import { AppText, Button, Card, EmptyState } from "@/components/ui";
import { fonts, radius } from "@/constants/theme";
import { useBlockedIds } from "@/hooks/use-blocked";
import { useTheme } from "@/hooks/use-theme";
import { threadDisplay } from "@/lib/group-dm";
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
  thread: {
    created_at: string;
    is_group: boolean;
    title: string | null;
  } | null;
};

type ParticipantRow = {
  thread_id: string;
  user_id: string;
  profile: ProfileLite | null;
};

type ThreadItem = {
  threadId: string;
  isGroup: boolean;
  /** The group's name, or the other person's — one naming rule for both. */
  name: string;
  /** "6 people" on a group; null on a 1:1. */
  subtitle: string | null;
  /** Everyone but me, for the avatar cluster. */
  others: ProfileLite[];
  /** The other person on a 1:1, and null on a group — drives block filtering. */
  otherId: string | null;
  latest: DmMessage | null;
  latestIsMine: boolean;
  /** Who sent the latest message in a group ("Maya: see you at 6"). */
  latestAuthorName: string | null;
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

/** "Maya Ortiz" -> "Maya", for the "Maya: see you at 6" preview. */
function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** One line of preview text, whichever shape the thread is. */
function previewOf(item: ThreadItem): string {
  if (!item.latest) {
    return item.isGroup
      ? "No messages yet — get it started."
      : "No messages yet — say hi!";
  }
  if (item.latest.deleted_at) return "Message deleted";
  const body = item.latest.content.replace(/\s+/g, " ");
  const who = item.latestIsMine
    ? "You"
    : item.isGroup
      ? (item.latestAuthorName ?? "Someone")
      : null;
  return who ? `${who}: ${body}` : body;
}

/* ---- pieces ---- */

/**
 * A group's face: two of its members overlapped in a small cluster, falling
 * back to a single avatar or the plain group glyph when there's nobody left
 * to draw. Purely decorative — the row's own label carries the meaning.
 */
function GroupCluster({ people }: { people: ProfileLite[] }) {
  const theme = useTheme();
  const first = people[0];
  const second = people[1];

  if (!first) {
    return (
      <View
        accessibilityElementsHidden
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.full,
          backgroundColor: theme.brandSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name="users" size={18} color={theme.brandInk} />
      </View>
    );
  }

  if (!second) {
    return (
      <View
        accessibilityElementsHidden
        style={{
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Avatar url={first.avatar_url} name={first.display_name} size={40} />
      </View>
    );
  }

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 44, height: 44 }}
    >
      <View style={{ position: "absolute", top: 0, left: 0 }}>
        <Avatar url={first.avatar_url} name={first.display_name} size={28} />
      </View>
      <View
        style={{
          position: "absolute",
          bottom: 0,
          right: 0,
          padding: 2,
          borderRadius: radius.full,
          backgroundColor: theme.surface,
        }}
      >
        <Avatar url={second.avatar_url} name={second.display_name} size={28} />
      </View>
    </View>
  );
}

function ThreadRow({ item }: { item: ThreadItem }) {
  const theme = useTheme();
  const preview = previewOf(item);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        item.isGroup
          ? `Group chat ${item.name}${item.subtitle ? `, ${item.subtitle}` : ""}`
          : `Conversation with ${item.name}`
      }
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
        {item.isGroup ? (
          <GroupCluster people={item.others} />
        ) : (
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
            <AppText
              variant="title"
              style={{ color: theme.brandInk, fontSize: 16 }}
            >
              {initialsOf(item.name) || "?"}
            </AppText>
          </View>
        )}
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
              {item.name}
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
  return (
    <EmptyState
      illustration={PaperPlane}
      title="No conversations yet"
      body="Message a classmate to trade notes, plan study sessions, or just say hi — or pick a few and get everyone in one place."
      action={{
        label: "Start a conversation",
        onPress: () => router.push("/dm/new"),
      }}
    />
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
      .select(
        "thread_id, last_read_at, thread:dm_threads(created_at, is_group, title)"
      )
      .eq("user_id", userId);
    if (mineError) throw mineError;
    const mine = (mineData ?? []) as unknown as MyParticipantRow[];
    const threadIds = mine.map((row) => row.thread_id);
    if (threadIds.length === 0) return [];

    // Everyone in each thread (me included, so a group's headcount is
    // honest) + the latest message per thread, all in parallel.
    const [peopleRes, latestResults] = await Promise.all([
      supabase
        .from("dm_participants")
        .select(
          "thread_id, user_id, profile:profiles(id, handle, display_name, avatar_url)"
        )
        .in("thread_id", threadIds),
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
    if (peopleRes.error) throw peopleRes.error;

    const peopleByThread = new Map<string, ProfileLite[]>();
    for (const row of (peopleRes.data ?? []) as unknown as ParticipantRow[]) {
      if (!row.profile) continue;
      const seated = peopleByThread.get(row.thread_id);
      if (seated) seated.push(row.profile);
      else peopleByThread.set(row.thread_id, [row.profile]);
    }
    const latestByThread = new Map<string, DmMessage>();
    threadIds.forEach((id, i) => {
      const latest = latestResults[i]?.data as DmMessage | null;
      if (latest) latestByThread.set(id, latest);
    });

    return mine
      .map((row) => {
        const isGroup = row.thread?.is_group === true;
        const everyone = peopleByThread.get(row.thread_id) ?? [];
        const others = everyone.filter((person) => person.id !== userId);
        const other = isGroup ? null : (others[0] ?? null);
        // A 1:1 whose other account is gone has nothing left to show; a
        // group stands on its own name.
        if (!isGroup && !other) return null;
        const latest = latestByThread.get(row.thread_id) ?? null;
        const author = latest
          ? (everyone.find((person) => person.id === latest.author_id) ?? null)
          : null;
        // One naming rule for both shapes, straight from the data layer.
        const named = threadDisplay(
          { is_group: isGroup, title: row.thread?.title ?? null },
          everyone,
          userId
        );
        return {
          threadId: row.thread_id,
          isGroup,
          name: named.title,
          subtitle: named.subtitle,
          others,
          otherId: other?.id ?? null,
          latest,
          latestIsMine: latest?.author_id === userId,
          latestAuthorName: author ? firstNameOf(author.display_name) : null,
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

  // A blocked classmate's 1:1 stays hidden. A group doesn't — it can hold
  // someone you blocked, and the thread itself belongs to everyone in it.
  const visibleThreads = (threads ?? []).filter(
    (t) => t.isGroup || t.otherId === null || !blocked.has(t.otherId)
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ThreadItem>) => <ThreadRow item={item} />,
    []
  );

  return (
    <Screen
      title="Messages"
      scroll={false}
      action={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New message"
          onPress={() => router.push("/dm/new")}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: radius.full,
            backgroundColor: theme.brandSoft,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Feather name="user-plus" size={20} color={theme.brandInk} />
        </Pressable>
      }
    >
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
