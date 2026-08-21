import Feather from "@expo/vector-icons/Feather";
import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PaperPlane } from "@/components/illustrations";
import { AppText, Button, Card, Chip, EmptyState } from "@/components/ui";
import { fonts, space } from "@/constants/theme";
import { MentionText } from "@/features/mentions";
import { useTheme } from "@/hooks/use-theme";
import { tapLight } from "@/lib/haptics";
import { roomTitle } from "@/lib/room-identity";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Saved messages: the private shelf behind every long-press "Save".
   One table, three kinds of subject (channel messages, DM messages, and
   community posts since 0071), so the three halves are fetched side by
   side and merged here, newest save first, with a filter row to read one
   kind at a time.

   Reading a bookmark's subject still goes through that subject's own RLS:
   leave a room and its saves quietly return a null embed instead of a row.
   Those rows are dropped on the floor rather than rendered as blanks, and
   a post that was taken down leaves the shelf the same way. */

/** Both queries are capped here, and so is the merged list. */
const SAVED_LIMIT = 100;

/** The message-body text style. MentionText needs it spelled out. */
const BODY_TEXT = {
  fontFamily: fonts.body,
  fontSize: 15,
  lineHeight: 21,
} as const;

const CHANNEL_SELECT =
  "created_at, message_id, message:messages(id, content, attachment_path, created_at, deleted_at, channel_id, author:profiles!messages_author_id_fkey(display_name), channel:channels(name, slug))";

const DM_SELECT =
  "created_at, dm_message_id, message:dm_messages(id, content, attachment_path, created_at, deleted_at, thread_id, author:profiles!dm_messages_author_id_fkey(display_name))";

const POST_SELECT =
  "created_at, community_post_id, post:community_posts(id, community_id, title, score, created_at, deleted_at, community:communities(name))";

/** Which slice of the shelf is showing. "All" is the default and the merge. */
type KindFilter = "all" | "messages" | "posts";

/** One row on the shelf, flattened out of any side of the union. */
type SavedItem = {
  /** List key: the subject id, namespaced because the subjects differ. */
  key: string;
  kind: "channel" | "dm" | "post";
  /** messages.id, dm_messages.id, or community_posts.id: the subject. */
  messageId: string;
  /** Where tapping lands: the channel, the DM thread, or the community. */
  roomId: string;
  /** message_bookmarks.created_at: the sort key for the whole list. */
  savedAt: string;
  /** When the subject itself was written, which is what the caption shows. */
  sentAt: string;
  authorName: string;
  /** "Study hall" for a room, "DM" for a direct message, the community's
      name for a post. */
  context: string;
  /** The message's words, or the post's title. */
  content: string;
  /** A caption-less photo send: the body is a placeholder, not real text. */
  attachmentOnly: boolean;
  /** The post's score at fetch time. Null on the message kinds. */
  score: number | null;
};

/* ------------------------- defensive narrowing -------------------------- */

/**
 * PostgREST hands an embedded row back as an object or as a one-element
 * array depending on how it resolves the relationship, and the client here
 * is untyped, so accept both shapes and treat anything else as absent.
 */
function embedded(value: unknown): Record<string, unknown> | null {
  const one: unknown = Array.isArray(value) ? value[0] : value;
  return typeof one === "object" && one !== null
    ? (one as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A row is only renderable once its message survived RLS and isn't a
    tombstone; anything short of that leaves quietly. */
function flatten(row: unknown, kind: SavedItem["kind"]): SavedItem | null {
  if (typeof row !== "object" || row === null) return null;
  const record = row as Record<string, unknown>;
  const savedAt = asString(record["created_at"]);
  const message = embedded(record["message"]);
  if (savedAt === null || message === null) return null;
  if (asString(message["deleted_at"]) !== null) return null;

  const messageId = asString(message["id"]);
  const sentAt = asString(message["created_at"]);
  const roomId = asString(
    kind === "channel" ? message["channel_id"] : message["thread_id"]
  );
  if (messageId === null || sentAt === null || roomId === null) return null;

  const content = asString(message["content"]) ?? "";
  const channel = embedded(message["channel"]);
  const channelContext = channel
    ? roomTitle(asString(channel["name"]), asString(channel["slug"]) ?? "")
    : "a room";

  return {
    key: `${kind === "channel" ? "c" : "d"}:${messageId}`,
    kind,
    messageId,
    roomId,
    savedAt,
    sentAt,
    authorName:
      asString(embedded(message["author"])?.["display_name"]) ?? "A classmate",
    context: kind === "channel" ? channelContext : "DM",
    content,
    attachmentOnly:
      asString(message["attachment_path"]) !== null && content === "Photo",
    score: null,
  };
}

/** The post half of the shelf, same bargain: a post that RLS won't show or
    that came down renders nothing rather than a blank card. */
function flattenPost(row: unknown): SavedItem | null {
  if (typeof row !== "object" || row === null) return null;
  const record = row as Record<string, unknown>;
  const savedAt = asString(record["created_at"]);
  const post = embedded(record["post"]);
  if (savedAt === null || post === null) return null;
  if (asString(post["deleted_at"]) !== null) return null;

  const postId = asString(post["id"]);
  const communityId = asString(post["community_id"]);
  const title = asString(post["title"]);
  const sentAt = asString(post["created_at"]);
  if (
    postId === null ||
    communityId === null ||
    title === null ||
    sentAt === null
  ) {
    return null;
  }
  const rawScore = post["score"];

  return {
    key: `p:${postId}`,
    kind: "post",
    messageId: postId,
    roomId: communityId,
    savedAt,
    sentAt,
    authorName: title,
    context:
      asString(embedded(post["community"])?.["name"]) ?? "a community",
    content: title,
    attachmentOnly: false,
    score: typeof rawScore === "number" ? Math.trunc(rawScore) : 0,
  };
}

/* ---------------------------- small helpers ----------------------------- */

/** "{n} points" with the singular handled, for a saved post's caption. */
function scoreLabel(score: number): string {
  return score === 1 ? "1 point" : `${score} points`;
}

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

/* --------------------------------- row ---------------------------------- */

/**
 * The whole shelf row in one sentence: who wrote it, where it's from, what
 * it says, and when. The ember-or-fern chip is the only thing on screen
 * saying which side of the app it came from, so the word goes in here.
 */
function savedLabel(item: SavedItem): string {
  if (item.kind === "post") {
    return [
      `Open the post ${item.content} in ${item.context}`,
      scoreLabel(item.score ?? 0),
      timeAgo(item.sentAt),
    ].join(", ");
  }
  return [
    `Open ${item.authorName}'s message in ${
      item.kind === "channel" ? item.context : "your DMs"
    }`,
    item.attachmentOnly ? "a photo" : item.content,
    timeAgo(item.sentAt),
  ]
    .filter(Boolean)
    .join(", ");
}

function SavedRow({
  item,
  index,
  removing,
  onOpen,
  onRemove,
}: {
  item: SavedItem;
  /** Position on the shelf, for the staggered arrival. */
  index: number;
  removing: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();

  return (
    <Card
      padded={false}
      entrance={index}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        marginBottom: space.room,
        opacity: removing ? 0.6 : 1,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={savedLabel(item)}
        onPress={onOpen}
        style={({ pressed }) => ({
          flex: 1,
          gap: space.snug,
          paddingLeft: space.card,
          paddingRight: space.tight,
          paddingVertical: space.card,
          minHeight: 68,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        {item.kind === "post" ? (
          /* A post leads with its title; the community's name is the chip,
             and the score rides in the caption where a message keeps its
             clock. */
          <>
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: space.cosy,
              }}
            >
              <AppText
                variant="bodySemi"
                numberOfLines={2}
                style={{ flex: 1, minWidth: 0 }}
              >
                {item.content}
              </AppText>
              <Chip
                label={item.context}
                tone="brand"
                style={{ maxWidth: 160 }}
              />
            </View>
            <AppText variant="caption" muted>
              {scoreLabel(item.score ?? 0)} · {timeAgo(item.sentAt)}
            </AppText>
          </>
        ) : (
          <>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.cosy,
              }}
            >
              <AppText
                variant="bodySemi"
                numberOfLines={1}
                style={{ flexShrink: 1 }}
              >
                {item.authorName}
              </AppText>
              {/* Rooms wear ember, DMs wear fern, so one glance tells you
                  where it's from. */}
              <Chip
                label={item.context}
                tone={item.kind === "channel" ? "brand" : "accent"}
                style={{ maxWidth: 160 }}
              />
            </View>

            {item.attachmentOnly ? (
              <AppText muted style={{ fontStyle: "italic" }}>
                Photo
              </AppText>
            ) : (
              <MentionText
                text={item.content}
                baseStyle={{ ...BODY_TEXT, color: theme.foreground }}
                highlightColor={theme.brand}
                numberOfLines={4}
              />
            )}

            <AppText variant="caption" muted>
              {timeAgo(item.sentAt)}
            </AppText>
          </>
        )}
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          item.kind === "post"
            ? `Remove the post ${item.content} from saved`
            : `Remove ${item.authorName}'s message from saved`
        }
        accessibilityState={{ disabled: removing, busy: removing }}
        disabled={removing}
        onPress={onRemove}
        hitSlop={4}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          marginRight: space.tight,
          marginTop: space.room,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        {removing ? (
          <ActivityIndicator size="small" color={theme.muted} />
        ) : (
          <Feather
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            name="x"
            size={18}
            color={theme.muted}
          />
        )}
      </Pressable>
    </Card>
  );
}

/* -------------------------------- screen -------------------------------- */

export default function SavedMessagesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const userId = session?.user.id ?? null;

  const [items, setItems] = useState<SavedItem[] | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  }, []);

  /** All three halves of the shelf at once, merged on the bookmark's clock. */
  const fetchSaved = useCallback(async (): Promise<SavedItem[]> => {
    if (!userId) throw new Error("Not signed in");
    const [channelRes, dmRes, postRes] = await Promise.all([
      supabase
        .from("message_bookmarks")
        .select(CHANNEL_SELECT)
        .eq("user_id", userId)
        .not("message_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(SAVED_LIMIT),
      supabase
        .from("message_bookmarks")
        .select(DM_SELECT)
        .eq("user_id", userId)
        .not("dm_message_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(SAVED_LIMIT),
      supabase
        .from("message_bookmarks")
        .select(POST_SELECT)
        .eq("user_id", userId)
        .not("community_post_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(SAVED_LIMIT),
    ]);
    if (channelRes.error) throw channelRes.error;
    if (dmRes.error) throw dmRes.error;
    if (postRes.error) throw postRes.error;

    const merged: SavedItem[] = [];
    for (const row of Array.isArray(channelRes.data) ? channelRes.data : []) {
      const item = flatten(row, "channel");
      if (item) merged.push(item);
    }
    for (const row of Array.isArray(dmRes.data) ? dmRes.data : []) {
      const item = flatten(row, "dm");
      if (item) merged.push(item);
    }
    for (const row of Array.isArray(postRes.data) ? postRes.data : []) {
      const item = flattenPost(row);
      if (item) merged.push(item);
    }
    merged.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return merged.slice(0, SAVED_LIMIT);
  }, [userId]);

  const run = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!userId) return;
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      try {
        setItems(await fetchSaved());
        setError(null);
      } catch {
        setError("We couldn't load your saved messages right now.");
      } finally {
        if (mode === "initial") setLoading(false);
        else setRefreshing(false);
      }
    },
    [userId, fetchSaved]
  );

  useEffect(() => {
    if (!userId) return;
    void run("initial");
  }, [userId, run]);

  /** The shelf points at a subject, not a room, so the subject id rides
      along and the destination lands on it rather than at the bottom. A
      post opens its own screen, thread and all. */
  const handleOpen = useCallback((item: SavedItem) => {
    if (item.kind === "post") {
      router.push({
        pathname: "/communities/post",
        params: { communityId: item.roomId, postId: item.messageId },
      });
      return;
    }
    router.push({
      pathname: item.kind === "channel" ? "/channel/[id]" : "/dm/[id]",
      params: { id: item.roomId, messageId: item.messageId },
    });
  }, []);

  /** Unsaving is optimistic: the row leaves at once and comes back, with a
      gentle note, only if the delete didn't land. */
  const handleRemove = useCallback(
    async (item: SavedItem) => {
      if (!userId || removingKey) return;
      setRowError(null);
      setRemovingKey(item.key);
      tapLight();
      const previous = items ?? [];
      setItems(previous.filter((row) => row.key !== item.key));
      const { error: deleteError } =
        item.kind === "channel"
          ? await supabase
              .from("message_bookmarks")
              .delete()
              .eq("user_id", userId)
              .eq("message_id", item.messageId)
          : item.kind === "dm"
            ? await supabase
                .from("message_bookmarks")
                .delete()
                .eq("user_id", userId)
                .eq("dm_message_id", item.messageId)
            : await supabase
                .from("message_bookmarks")
                .delete()
                .eq("user_id", userId)
                .eq("community_post_id", item.messageId);
      setRemovingKey(null);
      if (deleteError) {
        setItems(previous);
        setRowError("Couldn't remove that from saved. Give it another try.");
      }
    },
    [userId, removingKey, items]
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<SavedItem>) => (
      <SavedRow
        item={item}
        index={index}
        removing={removingKey === item.key}
        onOpen={() => handleOpen(item)}
        onRemove={() => void handleRemove(item)}
      />
    ),
    [removingKey, handleOpen, handleRemove]
  );

  /** The slice the filter row picked. "Messages" is both message kinds. */
  const visibleItems = useMemo(() => {
    const rows = items ?? [];
    if (kindFilter === "posts") return rows.filter((r) => r.kind === "post");
    if (kindFilter === "messages") {
      return rows.filter((r) => r.kind !== "post");
    }
    return rows;
  }, [items, kindFilter]);

  // Deep links land here directly, so a signed-out visitor gets a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  const count = items?.length ?? 0;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + space.close,
        paddingHorizontal: space.gutter,
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
        <Feather
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          name="chevron-left"
          size={26}
          color={theme.foreground}
        />
      </Pressable>

      <AppText
        variant="display"
        accessibilityRole="header"
        style={{ marginTop: space.hair }}
      >
        Saved messages
      </AppText>
      {/* The count drops by one every time a row is unsaved, so it says so. */}
      <AppText
        variant="caption"
        muted
        accessibilityLiveRegion="polite"
        style={{ marginTop: space.tight, marginBottom: space.card }}
      >
        {count === 0
          ? "Your private shelf. Only you can see what's here."
          : `${count} kept, newest save first. Only you can see this.`}
      </AppText>

      {/* The filter row appears once there's a shelf worth slicing. */}
      {!loading && items !== null && count > 0 ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.cosy,
            marginBottom: space.close,
          }}
        >
          <Chip
            label="All"
            tone="brand"
            size="md"
            selected={kindFilter === "all"}
            onPress={() => setKindFilter("all")}
            accessibilityLabel="Show everything saved"
          />
          <Chip
            label="Messages"
            tone="brand"
            size="md"
            selected={kindFilter === "messages"}
            onPress={() => setKindFilter("messages")}
            accessibilityLabel="Show saved messages"
          />
          <Chip
            label="Posts"
            tone="brand"
            size="md"
            selected={kindFilter === "posts"}
            onPress={() => setKindFilter("posts")}
            accessibilityLabel="Show saved posts"
          />
        </View>
      ) : null}

      {loading ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: space.close,
            paddingBottom: 80,
          }}
        >
          <ActivityIndicator
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            size="large"
            color={theme.brand}
          />
          <AppText variant="caption" muted accessibilityLiveRegion="polite">
            Pulling things off the shelf…
          </AppText>
        </View>
      ) : error && items === null ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: space.room,
            paddingBottom: 80,
          }}
        >
          <Feather
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            name="cloud-off"
            size={28}
            color={theme.muted}
          />
          <AppText variant="bodySemi" accessibilityRole="header">
            Something went sideways
          </AppText>
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
          data={visibleItems}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingBottom: insets.bottom + space.rest,
            flexGrow: 1,
          }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            rowError || error ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={{ color: theme.danger, marginBottom: space.room }}
              >
                {rowError ??
                  "We couldn't refresh just now. Pull down to try again."}
              </AppText>
            ) : null
          }
          ListEmptyComponent={
            count > 0 ? (
              /* The shelf has things; this slice of it is bare. */
              <EmptyState
                compact
                icon="bookmark"
                title={
                  kindFilter === "posts"
                    ? "No posts saved yet."
                    : "No messages saved yet."
                }
                body={
                  kindFilter === "posts"
                    ? "Save post lives in any post's overflow menu."
                    : "Long-press any message to keep it handy."
                }
              />
            ) : (
              <EmptyState
                illustration={PaperPlane}
                title="Nothing saved yet."
                body="Long-press any message, or save a post from its menu, to keep it handy."
              />
            )
          }
          ListFooterComponent={
            count >= SAVED_LIMIT ? (
              <AppText
                variant="caption"
                muted
                style={{ textAlign: "center", marginTop: space.tight }}
              >
                Showing your {SAVED_LIMIT} most recent saves.
              </AppText>
            ) : null
          }
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
    </View>
  );
}
