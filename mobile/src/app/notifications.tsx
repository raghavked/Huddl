import Feather from "@expo/vector-icons/Feather";
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AppText,
  Button,
  Card,
  EmptyState,
  SkeletonRow,
} from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { routeForLink } from "@/lib/notification-links";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* ---- local row types (mirror the web notification list's shape) ---- */

type AppNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

/** AppNotification shaped for the realtime payload's Record constraint. */
type AppNotificationRow = AppNotification & Record<string, unknown>;

const PAGE_SIZE = 50;

/** One Feather glyph per notification kind; anything unknown gets the bell. */
const KIND_ICONS: Partial<Record<string, keyof typeof Feather.glyphMap>> = {
  dm: "message-circle",
  thread_reply: "corner-down-right",
  event: "calendar",
  channel: "hash",
  course_calendar: "book-open",
  thanks: "heart",
  system: "bell",
};

/* ---- small local helpers ---- */

/** "Just now", "5m ago", "3h ago", "2d ago", then "Aug 2". */
function timeAgo(iso: string): string {
  const then = new Date(iso);
  const minutes = Math.floor((Date.now() - then.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString([], { month: "short", day: "numeric" });
}

/* ---- row ---- */

function NotificationItem({
  item,
  onPress,
}: {
  item: AppNotification;
  onPress: (item: AppNotification) => void;
}) {
  const theme = useTheme();
  const unread = !item.read_at;
  const icon = KIND_ICONS[item.kind] ?? "bell";
  // Read rows with nowhere to go are inert — nothing left to do with them.
  const inert = !unread && routeForLink(item.link) === null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread ? `${item.title}, unread` : item.title}
      disabled={inert}
      onPress={() => onPress(item)}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
        marginBottom: 10,
      })}
    >
      <Card
        padded={false}
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          minHeight: 68,
        }}
      >
        {/* Kind tile: clay + ember while unread, quiet once read. */}
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.control,
            backgroundColor: unread ? theme.brandSoft : theme.surface2,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather
            name={icon}
            size={18}
            color={unread ? theme.brand : theme.muted}
          />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodySemi" numberOfLines={2}>
            {item.title}
          </AppText>
          {item.body ? (
            <AppText variant="caption" muted numberOfLines={2}>
              {item.body}
            </AppText>
          ) : null}
          <AppText variant="caption" muted>
            {timeAgo(item.created_at)}
          </AppText>
        </View>
        {unread ? (
          <View
            accessibilityElementsHidden
            style={{
              width: 8,
              height: 8,
              borderRadius: radius.full,
              backgroundColor: theme.brand,
              marginTop: 6,
            }}
          />
        ) : null}
      </Card>
    </Pressable>
  );
}

/* ---- screen ---- */

export default function NotificationsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [markAllError, setMarkAllError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  }, []);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!userId) return;
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      const { data, error: queryError } = await supabase
        .from("notifications")
        .select("id, kind, title, body, link, read_at, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (mode === "initial") setLoading(false);
      else setRefreshing(false);
      if (queryError) {
        setError("We couldn't load your notifications right now.");
        return;
      }
      setError(null);
      setItems((data ?? []) as AppNotification[]);
    },
    [userId]
  );

  useEffect(() => {
    if (!userId) return;
    void load("initial");
  }, [userId, load]);

  // Realtime INSERTs prepend live. The handler lives in a ref so the
  // channel subscribes once per user.
  const handleIncoming = useCallback((row: AppNotification) => {
    setItems((prev) =>
      prev === null || prev.some((n) => n.id === row.id) ? prev : [row, ...prev]
    );
  }, []);
  const incomingRef = useRef(handleIncoming);
  incomingRef.current = handleIncoming;

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-inbox:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload: RealtimePostgresInsertPayload<AppNotificationRow>) => {
          incomingRef.current(payload.new as AppNotification);
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  /** Tap: mark read optimistically, then follow the link if it maps here. */
  const handlePress = useCallback((item: AppNotification) => {
    if (!item.read_at) {
      const readAt = new Date().toISOString();
      setItems((prev) =>
        prev === null
          ? prev
          : prev.map((n) => (n.id === item.id ? { ...n, read_at: readAt } : n))
      );
      void supabase
        .from("notifications")
        .update({ read_at: readAt })
        .eq("id", item.id);
    }
    const route = routeForLink(item.link);
    if (route) router.push(route);
  }, []);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    setMarkAllError(null);
    setMarkingAll(true);
    const readAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("notifications")
      .update({ read_at: readAt })
      .eq("user_id", userId)
      .is("read_at", null);
    setMarkingAll(false);
    if (updateError) {
      setMarkAllError("Couldn't mark everything read — give it another try.");
      return;
    }
    setItems((prev) =>
      prev === null
        ? prev
        : prev.map((n) => (n.read_at ? n : { ...n, read_at: readAt }))
    );
  }, [userId]);

  const unreadCount = items?.filter((n) => !n.read_at).length ?? 0;
  const canMarkAll = unreadCount > 0 && !markingAll;

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<AppNotification>) => (
      <NotificationItem item={item} onPress={handlePress} />
    ),
    [handlePress]
  );

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + 8,
        paddingHorizontal: 20,
      }}
    >
      {/* Back + the one header action, on the same 44px line. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={goBack}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            marginLeft: -10,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="chevron-left" size={26} color={theme.foreground} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mark all notifications read"
          disabled={!canMarkAll}
          onPress={() => void markAllRead()}
          hitSlop={8}
          style={({ pressed }) => ({
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 4,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          {markingAll ? (
            <ActivityIndicator size="small" color={theme.brand} />
          ) : (
            <Feather
              name="check-circle"
              size={14}
              color={canMarkAll ? theme.brand : theme.muted}
            />
          )}
          <AppText
            variant="bodySemi"
            style={{ color: canMarkAll ? theme.brand : theme.muted }}
          >
            Mark all read
          </AppText>
        </Pressable>
      </View>

      <AppText variant="display" style={{ marginTop: 2 }}>
        Notifications
      </AppText>
      <AppText
        variant="caption"
        muted
        style={{ minHeight: 16, marginTop: 4, marginBottom: 12 }}
      >
        {items === null
          ? ""
          : unreadCount > 0
            ? `${unreadCount} unread`
            : "You're all caught up"}
      </AppText>
      {markAllError ? (
        <AppText
          variant="caption"
          style={{ color: theme.danger, marginBottom: 10 }}
        >
          {markAllError}
        </AppText>
      ) : null}

      {loading ? (
        // Every row is the same shape — a ghost list beats a spinner here.
        <View style={{ flex: 1 }}>
          {[0, 1, 2, 3].map((index) => (
            <SkeletonRow key={index} />
          ))}
        </View>
      ) : error && items === null ? (
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
            onPress={() => void load("initial")}
          />
        </View>
      ) : (
        <FlatList
          data={items ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingBottom: insets.bottom + 32,
            flexGrow: 1,
          }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            error ? (
              <AppText
                variant="caption"
                style={{ color: theme.danger, marginBottom: 10 }}
              >
                We couldn't refresh just now — pull down to try again.
              </AppText>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="bell"
              title="All quiet — you're caught up."
              body="New messages, thread replies, event updates, class calendar changes and thanks for your notes will land here."
            />
          }
          ListFooterComponent={
            (items?.length ?? 0) >= PAGE_SIZE ? (
              <AppText
                variant="caption"
                muted
                style={{ textAlign: "center", marginTop: 4 }}
              >
                Showing your {PAGE_SIZE} most recent notifications.
              </AppText>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load("refresh")}
              tintColor={theme.brand}
              colors={[theme.brand]}
            />
          }
        />
      )}
    </View>
  );
}
