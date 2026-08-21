import Feather from "@expo/vector-icons/Feather";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Lantern } from "@/components/illustrations";
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  SectionLabel,
  SkeletonRow,
} from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  CommunityError,
  fetchCommunities,
  membersLabel,
  type Community,
  type CommunityRole,
} from "@/lib/communities";
import { useAuth } from "@/providers/auth-provider";

/* Browsing the campus's communities: the ones you're in first, then
 * everything else, each card a name, a line about it, and a headcount.
 *
 * There is no Join button out here on purpose. A community is a place, not
 * a subscription, and the club directory's one-tap join has taught people
 * to collect memberships they never look at. Walking in (the card opens the
 * community) and joining from inside its own doorway is the whole flow.
 */

/** One row of the list: a group heading, or a community. */
type ListRow =
  | { type: "label"; key: string; text: string }
  | { type: "community"; key: string; community: Community };

function CommunityCard({
  community,
  role,
  index,
  onOpen,
}: {
  community: Community;
  role: CommunityRole | null;
  /** Position in the list, for the staggered arrival. */
  index: number;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const members = membersLabel(community.member_count);
  /* The tile, the name, the pill, the headcount and the blurb are one
     community, and the card says all of it in one go. */
  const label = [
    `Open ${community.name}`,
    role === "steward" ? "you're its steward" : role ? "you've joined" : null,
    members,
    community.description,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Card padded={false} entrance={index} style={{ marginBottom: space.room }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onOpen}
        style={({ pressed }) => ({
          gap: space.room,
          padding: space.card,
          minHeight: 68,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.close,
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: radius.control,
              backgroundColor: theme.brandSoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather name="globe" size={18} color={theme.brand} />
          </View>
          <AppText
            variant="bodySemi"
            numberOfLines={2}
            style={{ flex: 1, minWidth: 0 }}
          >
            {community.name}
          </AppText>
          {role === "steward" ? (
            <Chip label="Steward" tone="brand" icon="feather" />
          ) : role ? (
            <Chip label="Joined" tone="accent" icon="check" />
          ) : null}
        </View>

        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ gap: space.room }}
        >
          {community.description ? (
            <AppText variant="caption" muted numberOfLines={2}>
              {community.description}
            </AppText>
          ) : null}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.tight,
            }}
          >
            <Feather name="user" size={12} color={theme.muted} />
            <AppText variant="caption" muted>
              {members}
            </AppText>
          </View>
        </View>
      </Pressable>
    </Card>
  );
}

export default function CommunitiesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const userId = session?.user.id ?? null;

  const [communities, setCommunities] = useState<Community[] | null>(null);
  const [roles, setRoles] = useState<Record<string, CommunityRole>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  }, []);

  const load = useCallback(async () => {
    try {
      const result = await fetchCommunities();
      setCommunities(result.communities);
      setRoles(result.roles);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof CommunityError
          ? caught.message
          : "We couldn't load the communities. Check your connection and give it another go."
      );
    }
  }, []);

  /* First focus loads with skeletons; every focus after refetches quietly,
     so a community started on the next screen is here when you step back. */
  const loadedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      if (loadedRef.current) {
        void load();
      } else {
        loadedRef.current = true;
        void load().finally(() => setLoading(false));
      }
    }, [userId, load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  const openNew = useCallback(() => {
    router.push("/communities/new");
  }, []);

  /**
   * Yours first, then the rest, both keeping the alphabetical order the
   * query gave them. With no memberships there is nothing to separate, so
   * the list stays unlabelled.
   */
  const rows = useMemo<ListRow[]>(() => {
    if (!communities) return [];
    const mine = communities.filter((c) => roles[c.id] !== undefined);
    const rest = communities.filter((c) => roles[c.id] === undefined);
    const out: ListRow[] = [];
    if (mine.length === 0) {
      for (const community of rest) {
        out.push({ type: "community", key: community.id, community });
      }
      return out;
    }
    out.push({ type: "label", key: "label-mine", text: "Your communities" });
    for (const community of mine) {
      out.push({ type: "community", key: community.id, community });
    }
    if (rest.length > 0) {
      out.push({ type: "label", key: "label-rest", text: "More on campus" });
      for (const community of rest) {
        out.push({ type: "community", key: community.id, community });
      }
    }
    return out;
  }, [communities, roles]);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ListRow>) => {
      if (item.type === "label") {
        return <SectionLabel text={item.text} first={index === 0} />;
      }
      return (
        <CommunityCard
          community={item.community}
          role={roles[item.community.id] ?? null}
          index={index}
          onOpen={() => router.push(`/communities/${item.community.id}`)}
        />
      );
    },
    [roles]
  );

  // A deep link can land here signed out. Send them to a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + space.close,
      }}
    >
      <View
        style={{
          paddingHorizontal: space.gutter,
          flexDirection: "row",
          alignItems: "center",
          gap: space.close,
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
          label="Start a community"
          size="sm"
          icon={<Feather name="plus" size={15} color={theme.brandFg} />}
          onPress={openNew}
        />
      </View>

      <View style={{ paddingHorizontal: space.gutter }}>
        <AppText variant="display" style={{ marginTop: space.hair }}>
          Communities
        </AppText>
        <AppText
          variant="caption"
          muted
          style={{ marginTop: space.tight, marginBottom: space.close }}
        >
          Interest spaces anyone can start: a feed, the votes, and rooms for
          live talk.
        </AppText>
      </View>

      {loading ? (
        <View style={{ paddingHorizontal: space.gutter }}>
          {[0, 1, 2].map((index) => (
            <SkeletonRow key={index} avatar={false} lines={2} />
          ))}
        </View>
      ) : error !== null && communities === null ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: space.room,
            paddingHorizontal: space.rest,
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
          keyExtractor={(row) => row.key}
          renderItem={renderItem}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: space.gutter,
            paddingBottom: insets.bottom + space.rest,
            flexGrow: 1,
          }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            error !== null ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={{ color: theme.danger, marginBottom: space.room }}
              >
                {error}
              </AppText>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              illustration={Lantern}
              title="No communities yet. Start the first one."
              body="A community is a feed for whatever your campus cares about: posts, votes, comments, and rooms that stem off for live talk."
              action={{ label: "Start a community", onPress: openNew }}
            />
          }
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
