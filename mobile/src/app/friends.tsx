import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import {
  AppText,
  Button,
  Card,
  EmptyState,
  SectionLabel,
  SkeletonRow,
} from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  acceptRequest,
  FriendsError,
  listFriendships,
  presenceLabel,
  removeEdge,
  splitFriendships,
  type FriendListItem,
  type FriendSections,
} from "@/lib/friends";
import { useAuth } from "@/providers/auth-provider";

/* The friends screen: three sections in a fixed order. "Requests" is people
   waiting on you, so it goes first; "Sent" is you waiting on them; "Friends"
   is everyone who said yes, wearing the quiet "Active now" line when they're
   sharing one. Empty pending sections simply don't render: a heading over
   nothing is a question the screen can't answer.

   Every action here is optimistic. The row moves (or goes) first, the write
   follows, and a throw puts the sections back exactly as they were with the
   error's own sentence at the top of the list. The data layer's writes are
   built for that, and `removeEdge` covers cancel, ignore and remove alike:
   the database makes no distinction, so neither do we. */

/** Empty sections, for the beat before the first load lands. */
const NO_SECTIONS: FriendSections = { requests: [], sent: [], friends: [] };

/**
 * The shared left half of every row: their face, their name, and the line
 * under it. On a friend row that line is presence when they share it and
 * their handle when they don't; pendings always show the handle, because
 * "Active now" on someone still deciding reads as surveillance.
 */
function PersonHalf({
  item,
  withPresence,
}: {
  item: FriendListItem;
  withPresence: boolean;
}) {
  const theme = useTheme();
  const activeLine = withPresence
    ? presenceLabel(item.person.last_seen_at, new Date())
    : null;
  return (
    <>
      <Avatar
        url={item.person.avatar_url}
        name={item.person.display_name}
        size={40}
      />
      <View style={{ flex: 1, gap: space.hair }}>
        <AppText variant="bodySemi" numberOfLines={1}>
          {item.person.display_name}
        </AppText>
        {activeLine ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.snug,
            }}
          >
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: radius.full,
                backgroundColor: theme.success,
              }}
            />
            <AppText variant="caption" style={{ color: theme.success }}>
              {activeLine}
            </AppText>
          </View>
        ) : (
          <AppText variant="caption" muted numberOfLines={1}>
            @{item.person.handle}
          </AppText>
        )}
      </View>
    </>
  );
}

export default function FriendsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [sections, setSections] = useState<FriendSections | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /* One inline line for a write that bounced; the sections are already back
     the way they were when it shows. */
  const [actionError, setActionError] = useState<string | null>(null);
  /* The person mid-write, so their buttons can't be tapped twice. */
  const [busyId, setBusyId] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  }, []);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!userId) return;
      if (mode === "refresh") setRefreshing(true);
      try {
        const rows = await listFriendships();
        setSections(splitFriendships(rows, userId));
        setLoadError(null);
      } catch (err) {
        setLoadError(
          err instanceof FriendsError
            ? err.message
            : "We couldn't load your friends. Check your connection and give it another go."
        );
      } finally {
        if (mode === "refresh") setRefreshing(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  /**
   * Run one optimistic move: swap the sections to `next`, try the write,
   * and put everything back if it throws. `otherId` keys the busy state.
   */
  const runMove = useCallback(
    async (
      otherId: string,
      next: FriendSections,
      move: (otherId: string) => Promise<void>
    ) => {
      if (sections === null || busyId !== null) return;
      const before = sections;
      setActionError(null);
      setBusyId(otherId);
      setSections(next);
      try {
        await move(otherId);
      } catch (err) {
        setSections(before);
        setActionError(
          err instanceof FriendsError
            ? err.message
            : "That didn't go through. Give it another go in a moment."
        );
      } finally {
        setBusyId(null);
      }
    },
    [sections, busyId]
  );

  /** Everything except this person's edge, out of one section. */
  const without = (items: FriendListItem[], otherId: string) =>
    items.filter((item) => item.person.id !== otherId);

  const handleAccept = useCallback(
    (item: FriendListItem) => {
      if (sections === null) return;
      const accepted: FriendListItem = {
        ...item,
        edge: {
          ...item.edge,
          status: "accepted",
          /* The trigger stamps the real one; this keeps the row sorted
             newest-first until the next load agrees. */
          responded_at: new Date().toISOString(),
        },
      };
      void runMove(
        item.person.id,
        {
          ...sections,
          requests: without(sections.requests, item.person.id),
          friends: [accepted, ...sections.friends],
        },
        acceptRequest
      );
    },
    [sections, runMove]
  );

  const handleIgnore = useCallback(
    (item: FriendListItem) => {
      if (sections === null) return;
      void runMove(
        item.person.id,
        { ...sections, requests: without(sections.requests, item.person.id) },
        removeEdge
      );
    },
    [sections, runMove]
  );

  const handleCancel = useCallback(
    (item: FriendListItem) => {
      if (sections === null) return;
      void runMove(
        item.person.id,
        { ...sections, sent: without(sections.sent, item.person.id) },
        removeEdge
      );
    },
    [sections, runMove]
  );

  const confirmRemove = useCallback(
    (item: FriendListItem) => {
      if (sections === null) return;
      Alert.alert(
        `Remove ${item.person.display_name} as a friend?`,
        "They won't be told, and either of you can ask again later.",
        [
          { text: "Never mind", style: "cancel" },
          {
            text: "Remove friend",
            style: "destructive",
            onPress: () =>
              void runMove(
                item.person.id,
                {
                  ...sections,
                  friends: without(sections.friends, item.person.id),
                },
                removeEdge
              ),
          },
        ]
      );
    },
    [sections, runMove]
  );

  const openProfile = useCallback((item: FriendListItem) => {
    router.push(`/u/${item.person.handle}`);
  }, []);

  /* ------------------------------- rows ------------------------------- */

  const requestRow = (item: FriendListItem, index: number) => (
    <View
      key={`${item.edge.requester_id}:${item.edge.addressee_id}`}
      style={{
        gap: space.close,
        paddingHorizontal: space.card,
        paddingVertical: space.close,
        borderTopWidth: index === 0 ? 0 : 1,
        borderTopColor: theme.border,
      }}
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${item.person.display_name}'s profile`}
        onPress={() => openProfile(item)}
        style={({ pressed }) => ({
          minHeight: 44,
          flexDirection: "row",
          alignItems: "center",
          gap: space.close,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <PersonHalf item={item} withPresence={false} />
      </Pressable>
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: space.cosy }}
      >
        <Button
          label="Accept request"
          size="sm"
          pending={busyId === item.person.id}
          accessibilityLabel={`Accept ${item.person.display_name}'s friend request`}
          accessibilityState={{
            busy: busyId === item.person.id,
            disabled: busyId !== null,
          }}
          onPress={() => handleAccept(item)}
          style={{ flex: 1 }}
        />
        {/* The quieter answer. Nothing is sent and nobody is told. */}
        <Button
          label="Ignore"
          variant="ghost"
          size="sm"
          disabled={busyId !== null}
          accessibilityLabel={`Ignore ${item.person.display_name}'s friend request`}
          onPress={() => handleIgnore(item)}
        />
      </View>
    </View>
  );

  const sentRow = (item: FriendListItem, index: number) => (
    <View
      key={`${item.edge.requester_id}:${item.edge.addressee_id}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.close,
        paddingHorizontal: space.card,
        paddingVertical: space.close,
        borderTopWidth: index === 0 ? 0 : 1,
        borderTopColor: theme.border,
      }}
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${item.person.display_name}'s profile`}
        onPress={() => openProfile(item)}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: 44,
          flexDirection: "row",
          alignItems: "center",
          gap: space.close,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <PersonHalf item={item} withPresence={false} />
      </Pressable>
      <Button
        label="Cancel request"
        variant="secondary"
        size="sm"
        pending={busyId === item.person.id}
        accessibilityLabel={`Cancel your friend request to ${item.person.display_name}`}
        accessibilityState={{
          busy: busyId === item.person.id,
          disabled: busyId !== null,
        }}
        onPress={() => handleCancel(item)}
      />
    </View>
  );

  const friendRow = (item: FriendListItem, index: number) => (
    <View
      key={`${item.edge.requester_id}:${item.edge.addressee_id}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.tight,
        paddingHorizontal: space.card,
        paddingVertical: space.close,
        borderTopWidth: index === 0 ? 0 : 1,
        borderTopColor: theme.border,
      }}
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${item.person.display_name}'s profile`}
        onPress={() => openProfile(item)}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: 44,
          flexDirection: "row",
          alignItems: "center",
          gap: space.close,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <PersonHalf item={item} withPresence />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${item.person.display_name} as a friend`}
        disabled={busyId !== null}
        onPress={() => confirmRemove(item)}
        hitSlop={4}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
          opacity: busyId !== null ? 0.5 : pressed ? 0.6 : 1,
        })}
      >
        <Feather
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          name="user-minus"
          size={18}
          color={theme.muted}
        />
      </Pressable>
    </View>
  );

  /* ------------------------------ screen ------------------------------ */

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
        style={{ marginTop: space.hair, marginBottom: space.close }}
      >
        Friends
      </AppText>

      {sections === null && loadError === null ? (
        // Every row is the same shape, so a ghost list beats a spinner here.
        <View style={{ flex: 1 }}>
          {[0, 1, 2, 3].map((index) => (
            <SkeletonRow key={index} />
          ))}
        </View>
      ) : sections === null ? (
        <EmptyState
          icon="cloud-off"
          title="Something went sideways"
          body={loadError ?? undefined}
          action={{ label: "Try again", onPress: () => void load("initial") }}
        />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: insets.bottom + space.rest }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load("refresh")}
              tintColor={theme.brand}
              colors={[theme.brand]}
            />
          }
        >
          {actionError ?? loadError ? (
            <AppText
              variant="caption"
              accessibilityLiveRegion="polite"
              style={{ color: theme.danger, marginBottom: space.room }}
            >
              {actionError ??
                "We couldn't refresh just now. Pull down to try again."}
            </AppText>
          ) : null}

          {sections.requests.length > 0 ? (
            <>
              <SectionLabel text="Requests" first />
              <Card padded={false}>{sections.requests.map(requestRow)}</Card>
            </>
          ) : null}

          {sections.sent.length > 0 ? (
            <>
              <SectionLabel
                text="Sent"
                first={sections.requests.length === 0}
              />
              <Card padded={false}>{sections.sent.map(sentRow)}</Card>
            </>
          ) : null}

          <SectionLabel
            text="Friends"
            first={
              sections.requests.length === 0 && sections.sent.length === 0
            }
          />
          {sections.friends.length === 0 ? (
            <EmptyState
              icon="heart"
              title="No friends here yet"
              body="Find your people in the directory and ask. Friends stay across every class and club."
              action={{
                label: "Open the directory",
                onPress: () => router.push("/people"),
              }}
            />
          ) : (
            <Card padded={false}>{sections.friends.map(friendRow)}</Card>
          )}
        </ScrollView>
      )}
    </View>
  );
}
