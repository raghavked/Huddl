import Feather from "@expo/vector-icons/Feather";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  TextInput,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Lantern, MagnifyingGlass } from "@/components/illustrations";
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  SectionLabel,
  SkeletonRow,
} from "@/components/ui";
import { fonts, radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  CommunityError,
  fetchCommunities,
  membersLabel,
  type Community,
  type CommunityRole,
} from "@/lib/communities";
import { useAuth } from "@/providers/auth-provider";

/* Browsing the campus's communities: The Quad up top, then the ones you're
 * in, then everything else, each card a name, a line about it, and a
 * headcount.
 *
 * The Quad is the campus's own feed, the one community everybody is in
 * from the day they sign up, so it doesn't queue with the rest: it gets
 * the wide card first, wearing "Your campus" instead of "Joined", because
 * a membership nobody chose isn't news.
 *
 * There is no Join button out here on purpose. A community is a place, not
 * a subscription, and the club directory's one-tap join has taught people
 * to collect memberships they never look at. Walking in (the card opens the
 * community) and joining from inside its own doorway is the whole flow.
 *
 * Search filters the loaded list right here, by name and description. A
 * campus holds dozens of communities, not thousands, so the whole list is
 * already in hand and a server round trip would only add a spinner.
 */

/** One row of the list: the campus feed, a group heading, or a community. */
type ListRow =
  | { type: "quad"; key: string; community: Community }
  | { type: "label"; key: string; text: string }
  | { type: "community"; key: string; community: Community };

/**
 * The Quad's wide card: the same bones as a community card, drawn a size
 * up so the campus's own feed reads as the ground the list stands on
 * rather than one more doorway in it.
 */
function QuadCard({
  community,
  onOpen,
}: {
  community: Community;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const members = membersLabel(community.member_count);
  const label = [
    `Open ${community.name}`,
    "your campus's own feed",
    members,
    community.description,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Card padded={false} entrance={0} style={{ marginBottom: space.close }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onOpen}
        style={({ pressed }) => ({
          gap: space.close,
          padding: space.card,
          minHeight: 88,
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
              width: 48,
              height: 48,
              borderRadius: radius.control,
              backgroundColor: theme.brandSoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather name="home" size={22} color={theme.brand} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: space.tight }}>
            <AppText variant="title" numberOfLines={2}>
              {community.name}
            </AppText>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.cosy,
              }}
            >
              <Chip label="Your campus" tone="brand" icon="home" />
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
          </View>
        </View>
        {community.description ? (
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            variant="caption"
            muted
            numberOfLines={2}
          >
            {community.description}
          </AppText>
        ) : null}
      </Pressable>
    </Card>
  );
}

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
  const [query, setQuery] = useState("");

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
   * The Quad first, then yours, then the rest, the last two keeping the
   * alphabetical order the query gave them. With no memberships beyond the
   * campus feed there is nothing to separate, so the list stays
   * unlabelled. A search narrows the whole pool, The Quad included, before
   * any of that grouping happens.
   */
  const rows = useMemo<ListRow[]>(() => {
    if (!communities) return [];
    const needle = query.trim().toLowerCase();
    const pool =
      needle.length === 0
        ? communities
        : communities.filter(
            (c) =>
              c.name.toLowerCase().includes(needle) ||
              (c.description ?? "").toLowerCase().includes(needle)
          );
    const quad = pool.find((c) => c.is_default) ?? null;
    const others = pool.filter((c) => !c.is_default);
    const mine = others.filter((c) => roles[c.id] !== undefined);
    const rest = others.filter((c) => roles[c.id] === undefined);
    const out: ListRow[] = [];
    if (quad) {
      out.push({ type: "quad", key: quad.id, community: quad });
    }
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
  }, [communities, roles, query]);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ListRow>) => {
      if (item.type === "quad") {
        return (
          <QuadCard
            community={item.community}
            onOpen={() => router.push(`/communities/${item.community.id}`)}
          />
        );
      }
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
            (communities !== null && communities.length > 0) ||
            error !== null ? (
              <View style={{ gap: space.room, marginBottom: space.close }}>
                {communities !== null && communities.length > 0 ? (
                  /* Search sits with the list it narrows; with nothing to
                     narrow, the empty state has the floor to itself. */
                  <View style={{ justifyContent: "center" }}>
                    <Feather
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                      name="search"
                      size={16}
                      color={theme.muted}
                      style={{ position: "absolute", left: 14, zIndex: 1 }}
                    />
                    <TextInput
                      value={query}
                      onChangeText={setQuery}
                      placeholder="Search communities"
                      placeholderTextColor={theme.muted + "b3"}
                      accessibilityLabel="Search communities by name or description"
                      autoCapitalize="none"
                      autoCorrect={false}
                      cursorColor={theme.brand}
                      selectionColor={theme.brandSoft}
                      style={{
                        height: 44,
                        borderWidth: 1,
                        borderColor: theme.border,
                        borderRadius: radius.full,
                        backgroundColor: theme.surface,
                        paddingLeft: 40,
                        paddingRight: 44,
                        fontFamily: fonts.body,
                        fontSize: 15,
                        color: theme.foreground,
                      }}
                    />
                    {query.length > 0 ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Clear search"
                        onPress={() => setQuery("")}
                        style={({ pressed }) => ({
                          position: "absolute",
                          right: 0,
                          width: 44,
                          height: 44,
                          alignItems: "center",
                          justifyContent: "center",
                          opacity: pressed ? 0.6 : 1,
                        })}
                      >
                        <Feather
                          accessibilityElementsHidden
                          importantForAccessibility="no-hide-descendants"
                          name="x"
                          size={16}
                          color={theme.muted}
                        />
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
                {error !== null ? (
                  <AppText
                    variant="caption"
                    accessibilityLiveRegion="polite"
                    style={{ color: theme.danger }}
                  >
                    {error}
                  </AppText>
                ) : null}
              </View>
            ) : null
          }
          ListEmptyComponent={
            query.trim().length > 0 ? (
              <EmptyState
                illustration={MagnifyingGlass}
                title="No community by that name yet."
                body={`Nothing here answers to "${query.trim()}". Try a shorter word, or start it yourself.`}
                action={{ label: "Start a community", onPress: openNew }}
              />
            ) : (
              <EmptyState
                illustration={Lantern}
                title="No communities yet. Start the first one."
                body="A community is a feed for whatever your campus cares about: posts, votes, comments, and rooms that stem off for live talk."
                action={{ label: "Start a community", onPress: openNew }}
              />
            )
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
