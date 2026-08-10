import Feather from "@expo/vector-icons/Feather";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Doorway,
  Mug,
  Pennant,
  type IllustrationProps,
} from "@/components/illustrations";
import {
  AppText,
  Button,
  Card,
  Chip,
  SkeletonRow,
  useReducedMotion,
} from "@/components/ui";
import { motion, radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  FirstRunError,
  fetchStarterState,
  markWelcomeSeen,
  starterProgress,
  starterSteps,
  type StarterState,
  type StarterStep,
} from "@/lib/first-run";
import { tapSuccess } from "@/lib/haptics";
import { useAuth } from "@/providers/auth-provider";

/* The first thing a new student sees after their profile is saved.
 *
 * Three panels they swipe through — what classes do, what a syllabus turns
 * into, who is on the other side of a message — and then the checklist,
 * which is the only page that touches the network. The panels are the
 * promise; the checklist is the first hour of keeping it.
 *
 * One horizontal paged ScrollView holds all four pages, so the swipe never
 * changes character halfway through and the dots can count the whole thing.
 * The checklist re-reads its state every time this screen regains focus,
 * which is what makes "add a course, come back, see it ticked" work.
 *
 * Leaving is always one tap: "Skip" top-right on every page, "Take me in"
 * in the footer on the last. Both stamp the welcome as seen — the tour is a
 * one-time thing whether you read it or not.
 */

/** The three tour panels, in order. Copy lives here, not in the render. */
const PANELS: {
  key: string;
  illustration: ComponentType<IllustrationProps>;
  title: string;
  body: string;
}[] = [
  {
    key: "classes",
    illustration: Doorway,
    title: "Your classes, your call",
    body: "You add the courses you're taking, and each one opens a chat with the rest of your section. Drop a class and it leaves your shelf the same day.",
  },
  {
    key: "quarter",
    illustration: Mug,
    title: "The whole quarter, in one place",
    body: "Paste a syllabus and the readings, midterms, and due dates land on a calendar the whole class shares. What's yours this week shows up in your plan.",
  },
  {
    key: "campus",
    illustration: Pennant,
    title: "Campus, not the internet",
    body: "Every account here is a verified school email, so you're talking to classmates. Blocking and reporting are one long-press away, and they're never told.",
  },
];

/** Three panels plus the checklist. */
const PAGE_COUNT = PANELS.length + 1;

const CHECKLIST_INDEX = PANELS.length;

/** Shown if a failure ever reaches us without the library's own copy. */
const FALLBACK_ERROR =
  "We couldn't check how your setup is going. Give it another go.";

/* -------------------------------- pieces -------------------------------- */

/**
 * One dot in the pager's counter. The scale-and-brighten reports an
 * arrival — you just landed on this panel — and lands in zero milliseconds
 * under reduce motion.
 */
function Dot({ active }: { active: boolean }) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: active ? 1 : 0,
      duration: reduceMotion ? motion.instant : motion.quick,
      // Reversible: swiping back retraces the same curve.
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [active, progress, reduceMotion]);

  return (
    <Animated.View
      style={{
        width: 8,
        height: 8,
        borderRadius: radius.full,
        backgroundColor: active ? theme.brand : theme.surface3,
        opacity: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0.7, 1],
        }),
        transform: [
          {
            scale: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 1.3],
            }),
          },
        ],
      }}
    />
  );
}

/** A tour panel: one mark, one title, two lines. */
function Panel({
  width,
  active,
  illustration: Illustration,
  title,
  body,
}: {
  width: number;
  active: boolean;
  illustration: ComponentType<IllustrationProps>;
  title: string;
  body: string;
}) {
  const theme = useTheme();
  return (
    <View
      // Off-screen panels stay out of the screen reader's path, so swiping
      // with VoiceOver on doesn't wander into a panel nobody can see.
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      style={{
        width,
        paddingHorizontal: 20,
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
      }}
    >
      <Illustration
        size={132}
        color={theme.brand}
        softColor={theme.brandSoft}
      />
      <AppText
        variant="display"
        style={{ textAlign: "center", marginTop: 14 }}
      >
        {title}
      </AppText>
      <AppText
        variant="body"
        muted
        style={{ textAlign: "center", maxWidth: 320 }}
      >
        {body}
      </AppText>
    </View>
  );
}

/**
 * One checklist row. Tapping goes wherever the step goes — done or not,
 * because "add a photo" is still where you go to change the photo.
 */
function StepRow({ step, onPress }: { step: StarterStep; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${step.title}. ${step.done ? "Done." : "Not done yet."}`}
      accessibilityHint={step.body}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
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
          marginBottom: 10,
        }}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: radius.full,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: step.done ? theme.accent : theme.surface2,
            borderWidth: step.done ? 0 : 1,
            borderColor: theme.border,
          }}
        >
          {step.done ? (
            <Feather name="check" size={16} color={theme.onSolid} />
          ) : null}
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <AppText
            variant="bodySemi"
            style={
              step.done
                ? { color: theme.accent, textDecorationLine: "line-through" }
                : undefined
            }
          >
            {step.title}
          </AppText>
          <AppText variant="caption" muted>
            {step.body}
          </AppText>
        </View>

        <Feather name="chevron-right" size={18} color={theme.muted} />
      </Card>
    </Pressable>
  );
}

/* -------------------------------- screen -------------------------------- */

export default function WelcomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const { session, ready } = useAuth();
  const userId = session?.user.id ?? null;

  const pager = useRef<ScrollView | null>(null);
  const [page, setPage] = useState(0);

  const [starter, setStarter] = useState<StarterState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "refresh") setRefreshing(true);
    try {
      setStarter(await fetchStarterState());
      setError(null);
    } catch (err) {
      setError(err instanceof FirstRunError ? err.message : FALLBACK_ERROR);
    } finally {
      setLoading(false);
      if (mode === "refresh") setRefreshing(false);
    }
  }, []);

  // Re-read on every focus, quietly: coming back from adding a course should
  // show the course step ticked, without the rows blinking through a skeleton.
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      void load("initial");
    }, [userId, load])
  );

  const leave = useCallback((celebrate: boolean) => {
    if (celebrate) tapSuccess();
    // Fire-and-forget: the library never throws and never blocks the exit.
    void markWelcomeSeen();
    router.replace("/(tabs)/home");
  }, []);

  const goTo = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, PAGE_COUNT - 1));
      setPage(clamped);
      pager.current?.scrollTo({
        x: clamped * width,
        animated: !reduceMotion,
      });
    },
    [width, reduceMotion]
  );

  const trackPage = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(
        event.nativeEvent.contentOffset.x / Math.max(1, width)
      );
      const clamped = Math.max(0, Math.min(next, PAGE_COUNT - 1));
      setPage((current) => (current === clamped ? current : clamped));
    },
    [width]
  );

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

  const onChecklist = page === CHECKLIST_INDEX;
  const steps = starter ? starterSteps(starter) : [];
  const progress = starter ? starterProgress(starter) : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Skip sits top-right on every page — the way out is never more than
          one tap away, including from the checklist. */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
          alignItems: "flex-end",
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip the welcome"
          onPress={() => leave(false)}
          hitSlop={8}
          style={({ pressed }) => ({
            height: 44,
            minWidth: 44,
            paddingHorizontal: 6,
            marginRight: -6,
            alignItems: "flex-end",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <AppText variant="label" style={{ color: theme.brand }}>
            Skip
          </AppText>
        </Pressable>
      </View>

      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={trackPage}
        onMomentumScrollEnd={trackPage}
        style={{ flex: 1 }}
      >
        {PANELS.map((panel, index) => (
          <Panel
            key={panel.key}
            width={width}
            active={page === index}
            illustration={panel.illustration}
            title={panel.title}
            body={panel.body}
          />
        ))}

        {/* The checklist page. Its own vertical scroll, so a long list and a
            large type scale both still reach the bottom row. */}
        <View
          key="checklist"
          accessibilityElementsHidden={!onChecklist}
          importantForAccessibility={onChecklist ? "auto" : "no-hide-descendants"}
          style={{ width }}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}
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
            <AppText variant="display">A few things to set up</AppText>
            <AppText variant="body" muted style={{ marginTop: 6 }}>
              None of it takes long, and you can come back to any of it from
              your account.
            </AppText>

            {progress ? (
              <Chip
                label={`${progress.done} of ${progress.total} done`}
                tone={progress.done === progress.total ? "accent" : "neutral"}
                size="md"
                icon={
                  progress.done === progress.total ? "check-circle" : undefined
                }
                style={{ marginTop: 12, marginBottom: 16 }}
              />
            ) : (
              <View style={{ height: 16 }} />
            )}

            {loading && starter === null ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : error && starter === null ? (
              <Card
                style={{ alignItems: "center", gap: 8, paddingVertical: 24 }}
              >
                <Feather name="cloud-off" size={26} color={theme.muted} />
                <AppText variant="bodySemi">Something went sideways</AppText>
                <AppText
                  variant="caption"
                  muted
                  style={{ textAlign: "center", maxWidth: 260 }}
                >
                  {error}
                </AppText>
                <Button
                  label="Try again"
                  variant="soft"
                  size="sm"
                  onPress={() => void load("initial")}
                />
              </Card>
            ) : (
              <>
                {error ? (
                  <AppText
                    variant="caption"
                    style={{ color: theme.danger, marginBottom: 10 }}
                  >
                    {error}
                  </AppText>
                ) : null}
                {steps.map((step) => (
                  <StepRow
                    key={step.key}
                    step={step}
                    onPress={() => router.push(step.route)}
                  />
                ))}
              </>
            )}
          </ScrollView>
        </View>
      </ScrollView>

      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: insets.bottom + 20,
          gap: 16,
        }}
      >
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={`Step ${page + 1} of ${PAGE_COUNT}`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {Array.from({ length: PAGE_COUNT }, (_, index) => (
            <Dot key={index} active={page === index} />
          ))}
        </View>

        <Button
          label={onChecklist ? "Take me in" : "Next"}
          size="lg"
          onPress={() => (onChecklist ? leave(true) : goTo(page + 1))}
        />
      </View>
    </View>
  );
}
