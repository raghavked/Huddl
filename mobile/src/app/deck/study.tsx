import Feather from "@expo/vector-icons/Feather";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  LayoutAnimation,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card } from "@/components/ui";
import { fonts, radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { buildQueue, nextReview, type Grade } from "@/lib/srs";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* The study session: one card at a time, tap to flip, three honest buttons.
   Every grade saves before the next card comes up, so backing out mid-stack
   loses nothing — the queue just picks up where it left off next time. */

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
        gap: 2,
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
    setRevealed(false);
    setCounts(ZERO_COUNTS);
    setAgainIds([]);
    setSessionError(null);
    setStatus("ready");
  }, [userId, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const flip = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setRevealed((prev) => !prev);
  }, []);

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
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setRevealed(false);
      setIndex((prev) => prev + 1);
    },
    [queue, index, userId, grading, reviews]
  );

  /** Re-run just the cards graded "again" — they're due back in minutes. */
  const studyAgain = useCallback(() => {
    const rerun = new Set(againIds);
    const nextQueue = queue.filter((card) => rerun.has(card.id));
    if (nextQueue.length === 0) return;
    setQueue(nextQueue);
    setIndex(0);
    setRevealed(false);
    setCounts(ZERO_COUNTS);
    setAgainIds([]);
    setSessionError(null);
  }, [againIds, queue]);

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
        paddingTop: insets.top + 8,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 12,
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
        <View style={{ flex: 1, alignItems: "center", gap: 2 }}>
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
        gap: 10,
        padding: 28,
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
          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
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
                  paddingHorizontal: 10,
                  paddingVertical: 5,
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
          <View style={{ gap: 8, marginTop: 10, alignItems: "center" }}>
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

  return scaffold(
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: insets.bottom + 24,
      }}
      showsVerticalScrollIndicator={false}
    >
      {card ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Card back shown. Tap to flip" : "Tap to flip"}
            onPress={flip}
            style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
          >
            <Card
              style={{
                minHeight: 300,
                padding: 24,
                alignItems: "center",
                justifyContent: "center",
                gap: 18,
              }}
            >
              <AppText
                variant="title"
                style={{ fontSize: 22, lineHeight: 30, textAlign: "center" }}
              >
                {card.front}
              </AppText>
              {revealed ? (
                <>
                  <View
                    style={{
                      alignSelf: "stretch",
                      height: 1,
                      backgroundColor: theme.border,
                    }}
                  />
                  <AppText
                    style={{ fontSize: 16, lineHeight: 24, textAlign: "center" }}
                  >
                    {card.back}
                  </AppText>
                </>
              ) : (
                <AppText variant="caption" muted>
                  Tap to flip
                </AppText>
              )}
            </Card>
          </Pressable>

          {revealed ? (
            <View style={{ gap: 10, marginTop: 16 }}>
              <View style={{ flexDirection: "row", gap: 10 }}>
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
            style={{ textAlign: "center", marginTop: 16 }}
          >
            Leave anytime — every grade saves as you go.
          </AppText>
        </>
      ) : null}
    </ScrollView>
  );
}
