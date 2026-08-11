import Feather from "@expo/vector-icons/Feather";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PinnedNote } from "@/components/illustrations";
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  SkeletonRow,
} from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import {
  BoardError,
  CATEGORIES,
  categoryInfo,
  fetchBoard,
  isMine,
  isStale,
  priceLabel,
  rideLabel,
  type BoardCategory,
  type BoardPost,
} from "@/lib/board";
import { useAuth } from "@/providers/auth-provider";

/* The campus board — everything the room is offering and asking for.
 *
 * One list, filtered by a rail of chips built straight from `CATEGORIES` in
 * `@/lib/board`, so a category that gets added there shows up here with its
 * own icon and label and nothing to edit on this screen.
 *
 * Two things sink rather than disappear, and the difference matters:
 *
 *   closed — the author marked it sorted. It stays readable at the bottom
 *            with a fern "Sorted" chip, because a ride that filled still
 *            tells you who drives to LA on Fridays.
 *   stale  — nobody's judgement but the list's: a ride whose day has gone, or
 *            anything a month old. It keeps its place in the open run but
 *            settles under the fresh posts. See `isStale`.
 *
 * The filter is a real query, not a client-side slice — each board gets its
 * own hundred rows that way, so a busy "for sale" run can't push a quiet
 * "lost" post out of the fetch. The cost is a load between chips, which is
 * why the skeletons are honest about the row shape.
 */

/** The rail's leading chip. `null` filter means all seven boards. */
type Filter = BoardCategory | null;

/**
 * What each board says when it's empty. The all-boards empty recruits — an
 * empty board is a board nobody has tried yet. A single quiet category is
 * usually just quiet, so those reassure first and invite second.
 */
const EMPTIES: Record<BoardCategory, { title: string; body: string }> = {
  ride: {
    title: "No rides up yet",
    body: "Nobody's posted a drive home. If you're going, say where and when — the seats fill fast.",
  },
  lost: {
    title: "Nothing lost",
    body: "Nobody's missing anything right now. That's the good kind of empty.",
  },
  found: {
    title: "Nothing found",
    body: "When something turns up on the quad, this is where it finds its way home.",
  },
  free: {
    title: "Nothing going free",
    body: "Free stuff moves fast, especially around move-out. Worth another look next week.",
  },
  sale: {
    title: "Nothing for sale",
    body: "No desks, bikes, or last quarter's textbooks up at the moment.",
  },
  ask: {
    title: "Nobody's asking",
    body: "No one needs a hand this minute. Ask when you do — people around here answer.",
  },
  offer: {
    title: "No offers up",
    body: "Nobody's put their hours up yet. If you're good at something, say so.",
  },
};

/** "Just now", "5m ago", "3h ago", "2d ago", then "Aug 2". Pure. */
function timeAgo(iso: string, now: Date): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString([], { month: "short", day: "numeric" });
}

/* -------------------------------- the row ------------------------------- */

/**
 * One post as it reads at arm's length: what kind of thing it is, what it
 * costs or when it leaves, the headline, the first line of the details, and
 * who put it up.
 *
 * A closed post keeps every one of those and just steps back — dimmed, with a
 * fern "Sorted" chip in front of the category. Nothing is hidden; the card is
 * as tappable as any other.
 */
function BoardRow({
  post,
  index,
  now,
  mine,
  onOpen,
}: {
  post: BoardPost;
  /** Position in the list, for the staggered arrival. */
  index: number;
  now: Date;
  mine: boolean;
  onOpen: () => void;
}) {
  const info = categoryInfo(post.category);
  const closed = post.closed_at !== null;
  const stale = isStale(post, now);
  const price = priceLabel(post.price_cents);
  const ride = rideLabel(post.happens_on, now);
  const author = mine ? "You" : (post.author?.display_name ?? "Someone on campus");

  return (
    <Card padded={false} entrance={index} style={{ marginBottom: 10 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${info.label}. ${post.title}${
          closed ? ". Sorted." : ""
        }`}
        onPress={onOpen}
        style={({ pressed }) => ({
          gap: 8,
          padding: 14,
          minHeight: 68,
          /* The step-back for a sorted post lives on the contents, not on the
             card: the card's own opacity belongs to its arrival. */
          opacity: (closed ? 0.7 : 1) * (pressed ? 0.7 : 1),
        })}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 6,
          }}
        >
          {closed ? (
            <Chip label="Sorted" tone="accent" icon="check" />
          ) : null}
          <Chip label={info.label} icon={info.icon} tone="brand" />
          {price ? <Chip label={price} /> : null}
          {/* A ride still ahead is a plan; one that's been and gone is just
              metadata, so it drops back to a neutral pill. */}
          {ride ? <Chip label={ride} tone={stale ? "neutral" : "accent"} /> : null}
        </View>

        <AppText variant="bodySemi" numberOfLines={2}>
          {post.title}
        </AppText>

        {post.body ? (
          <AppText muted numberOfLines={2}>
            {post.body}
          </AppText>
        ) : null}

        <AppText variant="caption" muted numberOfLines={1}>
          {author} · {timeAgo(post.created_at, now)}
        </AppText>
      </Pressable>
    </Card>
  );
}

/* ------------------------------- the screen ------------------------------ */

export default function CampusBoardScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const myId = session?.user.id ?? null;

  const [filter, setFilter] = useState<Filter>(null);
  const [posts, setPosts] = useState<BoardPost[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Every relative label on the screen reads off one moment, refreshed each
  // time the list is — so two cards can't disagree about what "today" means.
  const [now, setNow] = useState(() => new Date());

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  }, []);

  const load = useCallback(async () => {
    try {
      // Closed posts are asked for on purpose: they belong at the bottom of
      // the board, not off it. They do eat into the hundred-row cap.
      const rows = await fetchBoard({ category: filter, includeClosed: true });
      setPosts(rows);
      setNow(new Date());
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof BoardError
          ? caught.message
          : "We couldn't load the board. Check your connection and give it another go."
      );
    }
  }, [filter]);

  // The only loader: it runs on first focus, again whenever the filter
  // changes `load`'s identity, and again on every return to the screen — so a
  // post you just put up is already there when you step back.
  useFocusEffect(
    useCallback(() => {
      void load().finally(() => setLoading(false));
    }, [load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  const pickFilter = useCallback(
    (next: Filter) => {
      if (next === filter) return;
      // A different board is a different query — say so with the skeletons
      // rather than leaving the last board's rows sitting under a new chip.
      // Dropping them also means a failed switch can't show the old category's
      // posts under an error about the new one.
      setPosts(null);
      setLoading(true);
      setFilter(next);
    },
    [filter]
  );

  const openComposer = useCallback((category: Filter) => {
    router.push({
      pathname: "/board/new",
      params: category ? { category } : {},
    });
  }, []);

  /* Open posts first, then the ones that have quietly gone past — then the
     ones the author closed. `sort` is stable, so each tier keeps the
     newest-first order the query gave it. */
  const rows = useMemo(() => {
    if (!posts) return [];
    const rank = (post: BoardPost): number =>
      post.closed_at !== null ? 2 : isStale(post, now) ? 1 : 0;
    return [...posts].sort((a, b) => rank(a) - rank(b));
  }, [posts, now]);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<BoardPost>) => (
      <BoardRow
        post={item}
        index={index}
        now={now}
        mine={isMine(item, myId)}
        onOpen={() => router.push(`/board/${item.id}`)}
      />
    ),
    [now, myId]
  );

  // A deep link can land here signed out — send them to a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  const emptyState =
    filter === null ? (
      <EmptyState
        illustration={PinnedNote}
        title="The board is up, and it's bare"
        body="Rides home, couches that need an apartment, the water bottle somebody left in Olson — this is where campus posts them. Whatever goes up first is what everybody reads."
        action={{ label: "Post something", onPress: () => openComposer(null) }}
      />
    ) : (
      <EmptyState
        icon={categoryInfo(filter).icon}
        title={EMPTIES[filter].title}
        body={EMPTIES[filter].body}
        action={{ label: "Put one up", onPress: () => openComposer(filter) }}
      />
    );

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + 8,
      }}
    >
      <View
        style={{
          paddingHorizontal: 20,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
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
        <View style={{ flex: 1 }} />
        <Button
          label="Post something"
          size="sm"
          icon={<Feather name="plus" size={15} color={theme.brandFg} />}
          onPress={() => openComposer(filter)}
        />
      </View>

      <View style={{ paddingHorizontal: 20 }}>
        <AppText variant="display" style={{ marginTop: 2 }}>
          Campus board
        </AppText>
        <AppText variant="caption" muted style={{ marginTop: 4 }}>
          Rides home, lost water bottles, couches that need a new apartment.
        </AppText>
      </View>

      {/* The rail bleeds into both gutters so a long list of boards runs off
          the edge instead of stopping short of it. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, marginTop: 14, marginBottom: 14 }}
        contentContainerStyle={{
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 20,
          paddingVertical: 2,
        }}
      >
        <Chip
          label="All"
          tone="brand"
          size="md"
          selected={filter === null}
          onPress={() => pickFilter(null)}
          accessibilityLabel="Everything on the board"
        />
        {CATEGORIES.map((entry) => (
          <Chip
            key={entry.key}
            label={entry.label}
            icon={entry.icon}
            tone="brand"
            size="md"
            selected={filter === entry.key}
            onPress={() => pickFilter(entry.key)}
          />
        ))}
      </ScrollView>

      {loading ? (
        <View style={{ paddingHorizontal: 20 }}>
          {[0, 1, 2].map((index) => (
            <SkeletonRow key={index} avatar={false} lines={2} />
          ))}
        </View>
      ) : error !== null && posts === null ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            paddingHorizontal: 28,
            paddingBottom: 80,
          }}
        >
          <Feather name="cloud-off" size={28} color={theme.muted} />
          <AppText variant="bodySemi">Something went sideways</AppText>
          <AppText
            variant="caption"
            muted
            style={{ textAlign: "center", maxWidth: 280 }}
          >
            {error}
          </AppText>
          <Button
            label="Try again"
            variant="soft"
            size="sm"
            onPress={() => {
              setLoading(true);
              void load().finally(() => setLoading(false));
            }}
          />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: insets.bottom + 32,
          }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            error !== null ? (
              <AppText
                variant="caption"
                style={{ color: theme.danger, marginBottom: 10 }}
              >
                {error}
              </AppText>
            ) : null
          }
          ListEmptyComponent={emptyState}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.brand}
              colors={[theme.brand]}
            />
          }
        />
      )}
    </View>
  );
}
