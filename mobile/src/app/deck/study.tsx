import Feather from "@expo/vector-icons/Feather";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card } from "@/components/ui";
import { fonts, radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { tapLight } from "@/lib/haptics";
import { buildQueue, nextReview, type Grade } from "@/lib/srs";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* The study session: one card at a time, tap to flip, three honest buttons.
   The flip is a real one — two faces on one card, turning in 3D — and every
   grade saves before the next card comes up, so backing out mid-stack loses
   nothing. The queue just picks up where it left off next time. */

/* Minimal local row shapes — the web app's types live outside this tsconfig. */
type CardRow = {
  id: string;
  deck_id: string;
  front: string;
  back: string;
  position: number;
};

type ReviewsMap = Map<string, { streak: number; dueAt: Date }>;

type Counts = { again: number; good: number; easy: number };

type Status = "loading" | "error" | "notFound" | "ready";

const ZERO_COUNTS: Counts = { again: 0, good: 0, easy: 0 };

/** The card face never renders shorter than this, so short cards feel solid. */
const MIN_CARD_HEIGHT = 300;

/** "10 min", "1 day", "30 days" — what pressing a button buys you. */
function intervalPreview(
  prev: { streak: number } | null,
  grade: Grade,
  now: Date
): string {
  const { dueAt } = nextReview(prev, grade, now);
  const minutes = Math.round((dueAt.getTime() - now.getTime()) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const days = Math.round(minutes / (60 * 24));
  return days === 1 ? "1 day" : `${days} days`;
}

function GradeButton({
  label,
  sublabel,
  tone,
  pending,
  disabled,
  onPress,
}: {
  label: string;
  sublabel: string;
  tone: "again" | "good" | "easy";
  pending: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const palette = {
    // "Again" is a soft danger — a nudge, not an alarm.
    again: {
      bg: theme.danger + "1a",
      border: theme.danger + "59",
      fg: theme.danger,
    },
    good: { bg: theme.surface, border: theme.border, fg: theme.foreground },
    easy: { bg: theme.brand, border: theme.brand, fg: theme.brandFg },
  }[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} — next look in ${sublabel}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 56,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.bg,
        alignItems: "center",
        justifyContent: "center",
        gap: space.hair,
        opacity: disabled && !pending ? 0.6 : pressed ? 0.85 : 1,
      })}
    >
      {pending ? (
        <ActivityIndicator size="small" color={palette.fg} />
      ) : (
        <>
          <AppText
            variant="bodySemi"
            style={{ color: palette.fg, fontFamily: fonts.bodySemi }}
          >
            {label}
          </AppText>
          <AppText
            variant="caption"
            style={{ color: palette.fg, opacity: 0.8, fontSize: 11 }}
          >
            {sublabel}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

export default function StudySessionScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const userId = session?.user.id ?? null;
  const { deckId } = useLocalSearchParams<{ deckId?: string }>();
  const id = deckId ?? "";

  const [status, setStatus] = useState<Status>("loading");
  const [deckTitle, setDeckTitle] = useState("");
  const [queue, setQueue] = useState<CardRow[]>([]);
  const [reviews, setReviews] = useState<ReviewsMap>(new Map());
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState<Grade | null>(null);
  const [counts, setCounts] = useState<Counts>(ZERO_COUNTS);
  const [againIds, setAgainIds] = useState<string[]>([]);
  const [sessionError, setSessionError] = useState<string | null>(null);

  /* The flip: one value, 0 (front up) to 1 (back up), driving both faces.
     Advancing snaps it back to 0 with setValue — the next card never turns. */
  const flipAnim = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  // Each face reports its natural height so the card fits the taller side.
  const [faceHeights, setFaceHeights] = useState({ front: 0, back: 0 });

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (mounted) setReduceMotion(reduced);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  // No Alert on the way out — every grade already saved, card by card.
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else if (id) router.replace(`/deck/${id}`);
    else router.replace("/(tabs)/home");
  }, [router, id]);

  const load = useCallback(async () => {
    if (!userId) return;
    if (!id) {
      setStatus("notFound");
      return;
    }
    const [deckRes, cardsRes] = await Promise.all([
      supabase.from("decks").select("id, title").eq("id", id).maybeSingle(),
      supabase
        .from("cards")
        .select("id, deck_id, front, back, position")
        .eq("deck_id", id)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);
    if (deckRes.error || cardsRes.error) {
      setStatus("error");
      return;
    }
    const deck = deckRes.data as unknown as { id: string; title: string } | null;
    if (!deck) {
      setStatus("notFound");
      return;
    }
    const cards = (cardsRes.data ?? []) as unknown as CardRow[];
    const reviewMap: ReviewsMap = new Map();
    if (cards.length > 0) {
      const reviewsRes = await supabase
        .from("card_reviews")
        .select("card_id, streak, due_at")
        .eq("user_id", userId)
        .in(
          "card_id",
          cards.map((card) => card.id)
        );
      if (reviewsRes.error) {
        setStatus("error");
        return;
      }
      for (const row of (reviewsRes.data ?? []) as {
        card_id: string;
        streak: number;
        due_at: string;
      }[]) {
        reviewMap.set(row.card_id, {
          streak: row.streak,
          dueAt: new Date(row.due_at),
        });
      }
    }
    setDeckTitle(deck.title);
    setReviews(reviewMap);
    // New cards first, then oldest-due — capped so it stays one sitting.
    setQueue(buildQueue(cards, reviewMap, new Date()));
    setIndex(0);
    flipAnim.setValue(0);
    setRevealed(false);
    setCounts(ZERO_COUNTS);
    setAgainIds([]);
    setSessionError(null);
    setStatus("ready");
  }, [userId, id, flipAnim]);

  useEffect(() => {
    void load();
  }, [load]);

  const flip = useCallback(() => {
    const toValue = revealed ? 0 : 1;
    tapLight();
    if (reduceMotion) {
      // Reduced motion asks for no turning — the other face just appears.
      flipAnim.setValue(toValue);
    } else {
      Animated.timing(flipAnim, {
        toValue,
        duration: 320,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
    setRevealed(!revealed);
  }, [revealed, reduceMotion, flipAnim]);

  const handleGrade = useCallback(
    async (grade: Grade) => {
      const card = queue[index];
      if (!card || !userId || grading) return;
      const now = new Date();
      const prevState = reviews.get(card.id) ?? null;
      const next = nextReview(
        prevState ? { streak: prevState.streak } : null,
        grade,
        now
      );
      setSessionError(null);
      setGrading(grade);
      // Save first, advance after — so leaving mid-stack never loses a grade.
      const { error } = await supabase.from("card_reviews").upsert(
        {
          user_id: userId,
          card_id: card.id,
          streak: next.streak,
          last_grade: grade,
          due_at: next.dueAt.toISOString(),
          updated_at: now.toISOString(),
        },
        { onConflict: "user_id,card_id" }
      );
      setGrading(null);
      if (error) {
        setSessionError("That grade didn't save — give the button another tap.");
        return;
      }
      setReviews((prev) =>
        new Map(prev).set(card.id, { streak: next.streak, dueAt: next.dueAt })
      );
      setCounts((prev) => ({
        again: prev.again + (grade === "again" ? 1 : 0),
        good: prev.good + (grade === "good" ? 1 : 0),
        easy: prev.easy + (grade === "easy" ? 1 : 0),
      }));
      if (grade === "again") {
        setAgainIds((prev) =>
          prev.includes(card.id) ? prev : [...prev, card.id]
        );
      }
      // Snap — never spin — back to the front for the next card.
      flipAnim.setValue(0);
      setRevealed(false);
      setIndex((prev) => prev + 1);
    },
    [queue, index, userId, grading, reviews, flipAnim]
  );

  /** Re-run just the cards graded "again" — they're due back in minutes. */
  const studyAgain = useCallback(() => {
    const rerun = new Set(againIds);
    const nextQueue = queue.filter((card) => rerun.has(card.id));
    if (nextQueue.length === 0) return;
    setQueue(nextQueue);
    setIndex(0);
    flipAnim.setValue(0);
    setRevealed(false);
    setCounts(ZERO_COUNTS);
    setAgainIds([]);
    setSessionError(null);
  }, [againIds, queue, flipAnim]);

  // Deep links land here directly — a signed-out visitor gets a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  const finished = status === "ready" && index >= queue.length;
  const card = queue[index];

  /* ------------------------------- scaffold ------------------------------ */

  const scaffold = (children: React.ReactNode) => (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + space.close,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: space.close,
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
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="chevron-left" size={26} color={theme.foreground} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center", gap: space.hair }}>
          {status === "ready" && !finished && queue.length > 0 ? (
            <>
              <AppText variant="bodySemi">
                {Math.min(index + 1, queue.length)} of {queue.length}
              </AppText>
              <AppText variant="caption" muted numberOfLines={1}>
                {deckTitle}
              </AppText>
            </>
          ) : null}
        </View>
        <View style={{ width: 44 }} />
      </View>
      {children}
    </View>
  );

  const centered = (children: React.ReactNode) => (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: space.room,
        padding: space.rest,
      }}
    >
      {children}
    </View>
  );

  if (status === "loading") {
    return scaffold(
      centered(
        <>
          <ActivityIndicator size="large" color={theme.brand} />
          <AppText variant="caption" muted>
            Shuffling your queue…
          </AppText>
        </>
      )
    );
  }

  if (status === "notFound") {
    return scaffold(
      centered(
        <>
          <Feather name="layers" size={28} color={theme.muted} />
          <AppText variant="bodySemi">Deck not available</AppText>
          <AppText
            variant="caption"
            muted
            style={{ textAlign: "center", maxWidth: 260 }}
          >
            It may have been taken down, or it belongs to a class you're not in
            yet.
          </AppText>
          <Button label="Back" variant="soft" size="sm" onPress={goBack} />
        </>
      )
    );
  }

  if (status === "error") {
    return scaffold(
      centered(
        <>
          <Feather name="wifi-off" size={28} color={theme.muted} />
          <AppText variant="bodySemi">Something hiccuped</AppText>
          <AppText
            variant="caption"
            muted
            style={{ textAlign: "center", maxWidth: 260 }}
          >
            We couldn't set up your session. Check your connection and give it
            another go.
          </AppText>
          <Button
            label="Try again"
            variant="soft"
            size="sm"
            onPress={() => {
              setStatus("loading");
              void load();
            }}
          />
        </>
      )
    );
  }

  /* ---------------------------- nothing to do ---------------------------- */

  if (queue.length === 0) {
    return scaffold(
      centered(
        <>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: radius.full,
              backgroundColor: theme.accentSoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather name="coffee" size={22} color={theme.accent} />
          </View>
          <AppText variant="title">Nothing due right now</AppText>
          <AppText
            variant="caption"
            muted
            style={{ textAlign: "center", maxWidth: 260 }}
          >
            The schedule knows what it's doing — check back tomorrow.
          </AppText>
          <Button label="Back to the deck" variant="soft" size="sm" onPress={goBack} />
        </>
      )
    );
  }

  /* ------------------------------- finished ------------------------------ */

  if (finished) {
    const handled = counts.again + counts.good + counts.easy;
    return scaffold(
      centered(
        <>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: radius.full,
              backgroundColor: theme.accentSoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather name="check" size={22} color={theme.accent} />
          </View>
          <AppText variant="title">That's the stack</AppText>
          <AppText
            variant="caption"
            muted
            style={{ textAlign: "center", maxWidth: 280 }}
          >
            {handled === 1 ? "1 card" : `${handled} cards`} handled. Come back
            when they're due.
          </AppText>
          <View
            style={{
              flexDirection: "row",
              gap: space.cosy,
              marginTop: space.tight,
            }}
          >
            {(
              [
                ["Again", counts.again, theme.danger + "1a", theme.danger],
                ["Good", counts.good, theme.surface2, theme.muted],
                ["Easy", counts.easy, theme.brandSoft, theme.brandInk],
              ] as const
            ).map(([label, count, bg, fg]) => (
              <View
                key={label}
                style={{
                  paddingHorizontal: space.room,
                  paddingVertical: space.snug,
                  borderRadius: radius.full,
                  backgroundColor: bg,
                }}
              >
                <AppText variant="label" style={{ color: fg, fontSize: 11 }}>
                  {label} {count}
                </AppText>
              </View>
            ))}
          </View>
          <View
            style={{
              gap: space.cosy,
              marginTop: space.room,
              alignItems: "center",
            }}
          >
            {againIds.length > 0 ? (
              <>
                <Button
                  label="Study again now"
                  icon={
                    <Feather
                      name="rotate-ccw"
                      size={15}
                      color={theme.brandFg}
                    />
                  }
                  onPress={studyAgain}
                />
                <AppText variant="caption" muted style={{ textAlign: "center" }}>
                  {againIds.length === 1
                    ? "The one you marked “again” is"
                    : `The ${againIds.length} you marked “again” are`}{" "}
                  ready for another lap.
                </AppText>
              </>
            ) : null}
            <Button
              label="Back to the deck"
              variant={againIds.length > 0 ? "ghost" : "soft"}
              size="sm"
              onPress={goBack}
            />
          </View>
        </>
      )
    );
  }

  /* ------------------------------- the card ------------------------------ */

  const now = new Date();
  const prevState = card ? reviews.get(card.id) ?? null : null;
  const prevStreak = prevState ? { streak: prevState.streak } : null;

  // 0 → 1 turns the front away (0° → 180°) as the back arrives (180° → 360°).
  const frontRotate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });
  const backRotate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["180deg", "360deg"],
  });
  // The card stands as tall as its taller face, so the flip never reflows.
  const shellHeight = Math.max(
    MIN_CARD_HEIGHT,
    faceHeights.front,
    faceHeights.back
  );

  const face = (side: "front" | "back", fill: boolean, row: CardRow) => (
    <Card
      style={{
        padding: space.chapter,
        alignItems: "center",
        justifyContent: "center",
        gap: space.gutter,
        ...(fill ? { flex: 1 } : { minHeight: MIN_CARD_HEIGHT }),
      }}
    >
      <AppText
        variant="title"
        style={{ fontSize: 22, lineHeight: 30, textAlign: "center" }}
      >
        {row.front}
      </AppText>
      {side === "back" ? (
        <>
          <View
            style={{
              alignSelf: "stretch",
              height: 1,
              backgroundColor: theme.border,
            }}
          />
          <AppText style={{ fontSize: 16, lineHeight: 24, textAlign: "center" }}>
            {row.back}
          </AppText>
        </>
      ) : (
        <AppText variant="caption" muted>
          Tap to flip
        </AppText>
      )}
    </Card>
  );

  return scaffold(
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        paddingHorizontal: space.gutter,
        paddingTop: space.close,
        paddingBottom: insets.bottom + space.chapter,
      }}
      showsVerticalScrollIndicator={false}
    >
      {card ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              revealed ? "Card back shown. Tap to flip" : "Tap to flip"
            }
            onPress={flip}
            style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
          >
            <View style={{ height: shellHeight }}>
              {/* Invisible sizers — they measure each face's natural height. */}
              <View
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  opacity: 0,
                }}
                onLayout={(event) => {
                  const height = event.nativeEvent.layout.height;
                  setFaceHeights((prev) =>
                    prev.front === height ? prev : { ...prev, front: height }
                  );
                }}
              >
                {face("front", false, card)}
              </View>
              <View
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  opacity: 0,
                }}
                onLayout={(event) => {
                  const height = event.nativeEvent.layout.height;
                  setFaceHeights((prev) =>
                    prev.back === height ? prev : { ...prev, back: height }
                  );
                }}
              >
                {face("back", false, card)}
              </View>

              {/* The two real faces, stacked and turning around one axis. */}
              <Animated.View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backfaceVisibility: "hidden",
                  transform: [{ perspective: 1000 }, { rotateY: frontRotate }],
                }}
              >
                {face("front", true, card)}
              </Animated.View>
              <Animated.View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backfaceVisibility: "hidden",
                  transform: [{ perspective: 1000 }, { rotateY: backRotate }],
                }}
              >
                {face("back", true, card)}
              </Animated.View>
            </View>
          </Pressable>

          {revealed ? (
            <View style={{ gap: space.room, marginTop: space.card }}>
              <View style={{ flexDirection: "row", gap: space.room }}>
                <GradeButton
                  label="Again"
                  sublabel={intervalPreview(prevStreak, "again", now)}
                  tone="again"
                  pending={grading === "again"}
                  disabled={grading !== null}
                  onPress={() => void handleGrade("again")}
                />
                <GradeButton
                  label="Good"
                  sublabel={intervalPreview(prevStreak, "good", now)}
                  tone="good"
                  pending={grading === "good"}
                  disabled={grading !== null}
                  onPress={() => void handleGrade("good")}
                />
                <GradeButton
                  label="Easy"
                  sublabel={intervalPreview(prevStreak, "easy", now)}
                  tone="easy"
                  pending={grading === "easy"}
                  disabled={grading !== null}
                  onPress={() => void handleGrade("easy")}
                />
              </View>
              {sessionError ? (
                <AppText
                  variant="caption"
                  style={{ color: theme.danger, textAlign: "center" }}
                >
                  {sessionError}
                </AppText>
              ) : null}
            </View>
          ) : null}

          <AppText
            variant="caption"
            muted
            style={{ textAlign: "center", marginTop: space.card }}
          >
            Leave anytime — every grade saves as you go.
          </AppText>
        </>
      ) : null}
    </ScrollView>
  );
}
