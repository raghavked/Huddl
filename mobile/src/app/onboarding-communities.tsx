import Feather from "@expo/vector-icons/Feather";
import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AppText,
  Button,
  Card,
  Chip,
  SkeletonRow,
} from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  CommunityError,
  fetchCommunities,
  joinCommunity,
  leaveCommunity,
  membersLabel,
  type Community,
} from "@/lib/communities";
import { tapSuccess } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Picking communities: the step between the profile and the welcome.
 *
 * The Quad comes first and cannot be put down: every student is seated in
 * it the moment their profile exists, so the card says "Joined" and offers
 * no toggle. Lying about a choice that was never theirs would be worse
 * than admitting the campus feed simply comes with the campus.
 *
 * Everything else is a toggle. The browse screen refuses to put Join on a
 * card, and for good reason: out in the app a community is a place you
 * walk into, not a subscription you collect. This screen is the one
 * sanctioned exception, because on day one there is no habit to protect
 * yet, only an empty evening to furnish. Joins land optimistically and
 * step back with a warm line when the network refuses.
 *
 * Both buttons go where onboarding always went next: the welcome. "Done"
 * and "Skip for now" differ only in whether anything was picked, and
 * neither is a gate. Nothing here can trap someone on their first launch.
 */

/** Shown when a toggle fails and the error arrives without its own copy. */
const TOGGLE_FAILED = "That didn't save just now. Give it another tap.";

/** One community the student can toggle: a tile, the facts, and the choice. */
function PickRow({
  community,
  joined,
  index,
  onToggle,
}: {
  community: Community;
  joined: boolean;
  /** Position in the list, for the staggered arrival. */
  index: number;
  onToggle: () => void;
}) {
  const theme = useTheme();
  const members = membersLabel(community.member_count);
  return (
    <Card padded={false} entrance={index} style={{ marginBottom: space.room }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.close,
          padding: space.card,
          minHeight: 68,
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
        <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
          <AppText variant="bodySemi" numberOfLines={1}>
            {community.name}
          </AppText>
          {community.description ? (
            <AppText variant="caption" muted numberOfLines={2}>
              {community.description}
            </AppText>
          ) : null}
          <AppText variant="caption" muted>
            {members}
          </AppText>
        </View>
        <Chip
          label={joined ? "Joined" : "Join"}
          tone="accent"
          size="md"
          icon={joined ? "check" : "plus"}
          selected={joined}
          onPress={onToggle}
          accessibilityLabel={
            joined ? `Leave ${community.name}` : `Join ${community.name}`
          }
        />
      </View>
    </Card>
  );
}

export default function OnboardingCommunitiesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const userId = session?.user.id ?? null;

  const [quad, setQuad] = useState<Community | null>(null);
  const [others, setOthers] = useState<Community[] | null>(null);
  const [joined, setJoined] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  // Ids with a join or leave still in flight, so a double tap can't race
  // two writes against each other. A ref: no re-render rides on it.
  const busy = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      /* The communities library carries no `is_default`, so one extra read
         asks the database which community is The Quad. Inlined here rather
         than added to the lib, which another team owns. If that read fails
         the seeded slug is the fallback answer. */
      const [{ communities, roles }, defaultRes] = await Promise.all([
        fetchCommunities(),
        supabase
          .from("communities")
          .select("id")
          .eq("is_default", true)
          .maybeSingle(),
      ]);
      const rawId = defaultRes.error
        ? null
        : ((defaultRes.data as { id?: unknown } | null)?.id ?? null);
      const defaultId = typeof rawId === "string" ? rawId : null;
      const theQuad =
        communities.find((c) => c.id === defaultId) ??
        communities.find((c) => c.slug === "quad") ??
        null;
      setQuad(theQuad);
      setOthers(communities.filter((c) => c.id !== theQuad?.id));
      const seats: Record<string, boolean> = {};
      for (const community of communities) {
        seats[community.id] = roles[community.id] !== undefined;
      }
      setJoined(seats);
    } catch (caught) {
      setLoadError(
        caught instanceof CommunityError
          ? caught.message
          : "We couldn't load the communities. Check your connection and give it another go."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    void load();
  }, [userId, load]);

  /** Move one headcount by `delta`, floored at zero. */
  const bump = useCallback((id: string, delta: number) => {
    setOthers(
      (prev) =>
        prev?.map((c) =>
          c.id === id
            ? { ...c, member_count: Math.max(c.member_count + delta, 0) }
            : c
        ) ?? prev
    );
  }, []);

  /* Optimistic both ways: the chip flips and the headcount moves before
     the network answers, and both step back on a refusal. */
  const toggle = useCallback(
    async (community: Community, isJoined: boolean) => {
      const id = community.id;
      if (busy.current.has(id)) return;
      busy.current.add(id);
      setToggleError(null);
      const delta = isJoined ? -1 : 1;
      setJoined((prev) => ({ ...prev, [id]: !isJoined }));
      bump(id, delta);
      try {
        if (isJoined) await leaveCommunity(id);
        else await joinCommunity(id);
      } catch (caught) {
        setJoined((prev) => ({ ...prev, [id]: isJoined }));
        bump(id, -delta);
        setToggleError(
          caught instanceof CommunityError ? caught.message : TOGGLE_FAILED
        );
      } finally {
        busy.current.delete(id);
      }
    },
    [bump]
  );

  // Joins already landed as they were tapped, so leaving is only leaving.
  const finish = useCallback((celebrate: boolean) => {
    if (celebrate) tapSuccess();
    router.replace("/welcome");
  }, []);

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.background,
        }}
      >
        <ActivityIndicator color={theme.brand} />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  const noOthers = others !== null && others.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: space.gutter,
          paddingTop: insets.top + space.gutter,
          paddingBottom: space.rest,
        }}
        showsVerticalScrollIndicator={false}
      >
        <AppText variant="display" style={{ marginBottom: space.snug }}>
          Pick your communities
        </AppText>
        <AppText muted style={{ marginBottom: space.card }}>
          The Quad is your campus feed. Everyone is already in it. Add
          anything else that looks like you.
        </AppText>

        {toggleError ? (
          <AppText
            variant="caption"
            accessibilityLiveRegion="polite"
            style={{ color: theme.danger, marginBottom: space.room }}
          >
            {toggleError}
          </AppText>
        ) : null}

        {loading ? (
          <>
            <SkeletonRow avatar={false} lines={2} />
            <SkeletonRow avatar={false} lines={2} />
            <SkeletonRow avatar={false} lines={2} />
          </>
        ) : loadError ? (
          <Card
            style={{
              alignItems: "center",
              gap: space.room,
              paddingVertical: space.chapter,
            }}
          >
            <Feather name="cloud-off" size={26} color={theme.muted} />
            <AppText variant="bodySemi">Something went sideways</AppText>
            <AppText
              variant="caption"
              muted
              style={{ textAlign: "center", maxWidth: 260 }}
            >
              {loadError}
            </AppText>
            <Button
              label="Try again"
              variant="soft"
              size="sm"
              onPress={() => void load()}
            />
          </Card>
        ) : (
          <>
            {quad ? (
              <Card
                padded={false}
                entrance={0}
                style={{ marginBottom: space.room }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.close,
                    padding: space.card,
                    minHeight: 68,
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
                  <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
                    <AppText variant="bodySemi" numberOfLines={1}>
                      {quad.name}
                    </AppText>
                    {quad.description ? (
                      <AppText variant="caption" muted numberOfLines={2}>
                        {quad.description}
                      </AppText>
                    ) : null}
                    <AppText variant="caption" muted>
                      {membersLabel(quad.member_count)}
                    </AppText>
                  </View>
                  {/* Static on purpose: membership in The Quad is not a
                      choice, so the chip reports rather than offers. */}
                  <Chip label="Joined" tone="accent" icon="check" size="md" />
                </View>
              </Card>
            ) : null}

            {noOthers ? (
              <AppText
                variant="caption"
                muted
                style={{ marginTop: space.snug }}
              >
                {quad
                  ? "The Quad is the whole list so far. When a classmate starts something new, it will be waiting in the Communities tab."
                  : "Nothing to pick just yet. The Communities tab is where they will turn up."}
              </AppText>
            ) : (
              (others ?? []).map((community, index) => (
                <PickRow
                  key={community.id}
                  community={community}
                  joined={joined[community.id] === true}
                  index={index + 1}
                  onToggle={() =>
                    void toggle(community, joined[community.id] === true)
                  }
                />
              ))
            )}
          </>
        )}
      </ScrollView>

      <View
        style={{
          paddingHorizontal: space.gutter,
          paddingTop: space.card,
          paddingBottom: insets.bottom + space.gutter,
          gap: space.cosy,
        }}
      >
        <Button label="Done" size="lg" onPress={() => finish(true)} />
        <Button
          label="Skip for now"
          variant="ghost"
          onPress={() => finish(false)}
        />
      </View>
    </View>
  );
}
