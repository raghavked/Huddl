import Feather from "@expo/vector-icons/Feather";
import { router, useFocusEffect } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { Lantern } from "@/components/illustrations";
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  SectionLabel,
} from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useBlockedIds } from "@/hooks/use-blocked";
import { useTheme } from "@/hooks/use-theme";
import {
  computeFocusStreak,
  elapsedMinutes,
  endFocus,
  fetchMyOpenSession,
  fetchStudyingNow,
  FOCUS_GOAL_DEFAULT,
  FOCUS_GOAL_PRESETS,
  FOCUS_NOTE_MAX,
  FocusError,
  formatDuration,
  progress,
  remainingMinutes,
  startFocus,
  subscribeStudyingNow,
  type FocusSession,
  type StudyingNow,
} from "@/lib/focus";
import { tapLight, tapSuccess } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";
import { clampTextScale, useDisplay } from "@/providers/display-provider";

/* Focus: sit down with a goal, and see who else is heads-down.
 *
 * Two states in one screen. Idle is an invitation: pick a length, maybe a
 * class, maybe a line about what you're doing, and start. Running is a
 * timer that takes over, with the "studying now" list still breathing
 * underneath so the room never feels empty.
 *
 * The audience is the fourth thing you pick, and it is a real choice rather
 * than a warning. Being on the list is the point of the feature, but the
 * only way to want the timer without the audience used to be to not use the
 * feature at all, which also cost you the streak. "Just me" (0040's
 * `is_private`) is the same session with the row kept to yourself.
 *
 * All the time math lives in `@/lib/focus` and takes a `now`. This screen
 * only decides how often to hand it one (once a second, while a session is
 * running and the screen is actually in front of you). */

/** How far back the streak query looks: long enough for any real run. */
const STREAK_WINDOW_DAYS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A course you can attach a session to. */
type CourseOption = { id: string; code: string };

type EnrollmentJoin = { course: CourseOption | null };

/** What "Done" leaves on the screen: the one number worth saying out loud. */
type Finished = { minutes: number };

/* ------------------------------ queries ------------------------------ */

/**
 * Your live classes, for the course chips. Archived enrolments are shelved
 * courses, and they shouldn't clutter a picker you use at 11pm.
 */
async function loadCourses(userId: string): Promise<CourseOption[]> {
  const { data, error } = await supabase
    .from("enrollments")
    .select("course:courses(id, code)")
    .eq("user_id", userId)
    .is("archived_at", null);
  if (error) throw error;
  return ((data ?? []) as unknown as EnrollmentJoin[])
    .map((row) => row.course)
    .filter((course): course is CourseOption => course !== null)
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Your focus streak, in days. `computeFocusStreak` only needs `ended_at`,
 * so that's all we pull: a few hundred timestamps at most.
 */
async function loadStreak(userId: string): Promise<number> {
  const since = new Date(Date.now() - STREAK_WINDOW_DAYS * DAY_MS).toISOString();
  const { data, error } = await supabase
    .from("focus_sessions")
    .select("ended_at")
    .eq("user_id", userId)
    .not("ended_at", "is", null)
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(400);
  if (error) throw error;
  const rows = (data ?? []) as unknown as { ended_at: string | null }[];
  return computeFocusStreak(rows, new Date());
}

/* ------------------------------- copy -------------------------------- */

/** The one line a finished session earns. Warm, never a scoreboard. */
function completionLine(minutes: number): string {
  if (minutes < 1) return "Short one. It still counts.";
  if (minutes === 1) return "A minute down. That counts.";
  if (minutes < 60) return `${minutes} minutes down. That counts.`;
  return `${formatDuration(minutes)} down. That counts.`;
}

/** "23m in", or something kinder for someone who just sat down. */
function sinceLabel(minutes: number): string {
  return minutes < 1 ? "Just sat down" : `${formatDuration(minutes)} in`;
}

/* ------------------------------- pieces ------------------------------ */

/** The quiet uppercase heading inside a card: SectionLabel's voice, without
    its screen-level margins. */
function FormLabel({ text }: { text: string }) {
  return (
    <AppText
      variant="label"
      muted
      accessibilityRole="header"
      style={{ textTransform: "uppercase", letterSpacing: 1.2 }}
    >
      {text}
    </AppText>
  );
}

/**
 * One classmate, heads-down. Tapping opens their profile.
 *
 * Memoized on purpose: while a session runs the screen re-renders once a
 * second, and these rows only ever speak in whole minutes. Paired with the
 * minute-truncated `now` the screen hands them, that's one list render a
 * minute instead of sixty.
 */
const StudyingRow = memo(function StudyingRow({
  row,
  index,
  now,
}: {
  row: StudyingNow;
  /** Position in the list, for the arrival of someone sitting down. */
  index: number;
  now: Date;
}) {
  const theme = useTheme();
  const minutes = elapsedMinutes(row, now);
  const detail = row.note ?? `${formatDuration(row.goal_minutes)} goal`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        `Open ${row.person.display_name}'s profile`,
        row.course_code,
        sinceLabel(minutes),
        detail,
      ]
        .filter(Boolean)
        .join(", ")}
      onPress={() => router.push(`/u/${row.person.handle}`)}
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
        marginBottom: space.room,
      })}
    >
      <Card
        padded={false}
        entrance={index}
        // A face, a name, a course chip and a line of time are one person.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.close,
          paddingHorizontal: space.card,
          paddingVertical: space.close,
          minHeight: 68,
        }}
      >
        <Avatar
          url={row.person.avatar_url}
          name={row.person.display_name}
          size={40}
        />
        <View style={{ flex: 1, gap: space.tight }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.snug,
            }}
          >
            <AppText variant="bodySemi" numberOfLines={1} style={{ flexShrink: 1 }}>
              {row.person.display_name}
            </AppText>
            {row.course_code ? (
              <Chip label={row.course_code} tone="brand" />
            ) : null}
          </View>
          <AppText variant="caption" muted numberOfLines={1}>
            {sinceLabel(minutes)} · {detail}
          </AppText>
        </View>
        <Feather name="chevron-right" size={16} color={theme.muted} />
      </Card>
    </Pressable>
  );
});

/* The slim bar under the readout: brand fill on surface2, and deliberately
   still. It creeps forward by a third of a percent a second, so animating it
   would be a loop reporting nothing. The readout above is what a student
   watches, and the bar is the shape of it. */
function ProgressBar({ value }: { value: number }) {
  const theme = useTheme();
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Progress towards your goal"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={{
        height: 8,
        width: "100%",
        borderRadius: radius.full,
        backgroundColor: theme.surface2,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          height: "100%",
          width: `${pct}%`,
          borderRadius: radius.full,
          backgroundColor: theme.brand,
        }}
      />
    </View>
  );
}

/* ------------------------------- screen ------------------------------ */

export default function FocusScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const textScale = clampTextScale(useDisplay().textScale);
  /* Someone you've blocked writes a free-text line into this list like
     everyone else, so the block list has to reach it. */
  const { blocked, refresh: refreshBlocked } = useBlockedIds();

  const [mine, setMine] = useState<FocusSession | null>(null);
  const [studying, setStudying] = useState<StudyingNow[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [streak, setStreak] = useState(0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);

  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [finished, setFinished] = useState<Finished | null>(null);

  /* The idle form's draft. `isPrivate` starts false: the column default,
     and what every session did before it was a choice. It deliberately
     survives a finished session, so somebody who is having a private week
     doesn't have to remember the switch each time they sit back down. It
     does not survive leaving the screen: there is nowhere to keep it that
     isn't a new column, and a remembered "private" that quietly wasn't would
     be worse than asking again. */
  const [goal, setGoal] = useState<number>(FOCUS_GOAL_DEFAULT);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);

  /* The clock the whole screen reads from. Only ticks while a session is
     running and this screen is in front of the student. */
  const [now, setNow] = useState<Date>(() => new Date());

  /* ----------------------------- loading ----------------------------- */

  const refreshStudying = useCallback(async () => {
    if (!userId) return;
    try {
      const rows = await fetchStudyingNow();
      // You're the timer at the top of the screen, not a row in the list.
      setStudying(rows.filter((row) => row.user_id !== userId));
      // Idle screens don't tick, so a realtime change is also when their
      // "23m in" labels get to be honest again.
      setNow(new Date());
    } catch {
      // Keep the last good list. A dropped refresh isn't worth a banner.
    }
  }, [userId]);

  const refreshStreak = useCallback(async () => {
    if (!userId) return;
    try {
      setStreak(await loadStreak(userId));
    } catch {
      // The streak is a garnish; it never blocks the screen.
    }
  }, [userId]);

  const run = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!userId) return;
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      try {
        const [open, rows] = await Promise.all([
          fetchMyOpenSession(),
          fetchStudyingNow(),
        ]);
        setMine(open);
        setStudying(rows.filter((row) => row.user_id !== userId));
        setNow(new Date());
        setError(null);
        // Secondary data. A failure here shouldn't cost the whole screen.
        void loadCourses(userId)
          .then(setCourses)
          .catch(() => undefined);
        void refreshStreak();
        // A block made since this screen mounted should take effect here too.
        void refreshBlocked();
      } catch (err) {
        setError(
          err instanceof FocusError
            ? err.message
            : "We couldn't open focus just now."
        );
      } finally {
        if (mode === "initial") setLoading(false);
        else setRefreshing(false);
      }
    },
    [userId, refreshStreak, refreshBlocked]
  );

  useEffect(() => {
    // No session yet (or signed out): drop the spinner rather than hang on
    // it. The idle form is honest, and starting one says "sign in again".
    if (!userId) {
      setLoading(false);
      return;
    }
    void run("initial");
  }, [userId, run]);

  /* The list breathes while you sit: realtime payloads are bare rows with
     no profile attached, so every change is a refetch. */
  useEffect(() => {
    if (!userId) return;
    return subscribeStudyingNow(() => void refreshStudying());
  }, [userId, refreshStudying]);

  /* One 1s interval, only while running, cleared on blur and on unmount.
     Nothing here animates per frame; the bar redraws each tick. */
  const running = mine !== null;
  useFocusEffect(
    useCallback(() => {
      if (!running) return;
      setNow(new Date());
      const id = setInterval(() => setNow(new Date()), 1000);
      return () => clearInterval(id);
    }, [running])
  );

  /* ----------------------------- actions ----------------------------- */

  const start = useCallback(async () => {
    if (starting || !userId) return;
    setFormError(null);
    setStarting(true);
    try {
      const created = await startFocus({
        courseId,
        goalMinutes: goal,
        note,
        isPrivate,
      });
      tapLight();
      setFinished(null);
      setMine(created);
      setNow(new Date());
      setNote("");
      void refreshStudying();
    } catch (err) {
      setFormError(
        err instanceof FocusError
          ? err.message
          : "We couldn't start that session. Give it another go."
      );
    } finally {
      setStarting(false);
    }
  }, [starting, userId, courseId, goal, note, isPrivate, refreshStudying]);

  /**
   * Stand up. Optimistic: the timer stops the moment you tap, and the
   * session comes back (with a warm note) only if the write fails.
   * `mode` decides the ceremony: "done" earns a haptic and a line,
   * "quit" quietly puts things away.
   */
  const finish = useCallback(
    async (mode: "done" | "quit") => {
      const current = mine;
      if (!current || ending) return;
      setEndError(null);
      setEnding(true);
      const minutes = elapsedMinutes(current, new Date());
      setMine(null);
      if (mode === "done") {
        tapSuccess();
        setFinished({ minutes });
      } else {
        setFinished(null);
      }
      try {
        await endFocus(current.id);
        void refreshStudying();
        void refreshStreak();
      } catch (err) {
        setMine(current);
        setFinished(null);
        setEndError(
          err instanceof FocusError
            ? err.message
            : "We couldn't close that session. Give it another go."
        );
      } finally {
        setEnding(false);
      }
    },
    [mine, ending, refreshStudying, refreshStreak]
  );

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  }, []);

  /* ----------------------------- derived ----------------------------- */

  /* The list's clock, rounded down to the minute. Elapsed labels are whole
     minutes anyway, so this keeps the memoized rows still between ticks
     while the timer above them counts in real time. */
  const minuteMark = Math.floor(now.getTime() / 60_000);
  const listNow = useMemo(() => new Date(minuteMark * 60_000), [minuteMark]);

  /* Filtered here rather than in the fetch so the block list can change
     without re-subscribing the realtime channel. Someone you've blocked
     doesn't reach you through the note on their study session. */
  const visible = useMemo(
    () => studying.filter((row) => !blocked.has(row.user_id)),
    [studying, blocked]
  );

  const timer = useMemo(() => {
    if (!mine) return null;
    const left = remainingMinutes(mine, now);
    const done = elapsedMinutes(mine, now);
    const past = left === 0;
    const goalText = formatDuration(mine.goal_minutes);
    return {
      readout: past ? formatDuration(done) : formatDuration(left),
      caption: past
        ? `${goalText} goal reached. Stand up whenever you like`
        : `left of your ${goalText} goal`,
      /* The readout on its own is a number with no noun. This is the same
         two lines as one sentence, for the reader. It is deliberately not a
         live region: it changes every second, and a clock that interrupts
         you once a second is the opposite of a focus screen. */
      spoken: past
        ? `${formatDuration(done)} in. ${goalText} goal reached. Stand up whenever you like.`
        : `${formatDuration(left)} left of your ${goalText} goal.`,
      value: progress(mine, now),
      courseCode:
        courses.find((course) => course.id === mine.course_id)?.code ?? null,
    };
  }, [mine, now, courses]);

  /* ------------------------------ render ----------------------------- */

  const header = (
    <View style={{ paddingHorizontal: space.close }}>
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
        <Feather
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          name="chevron-left"
          size={26}
          color={theme.foreground}
        />
      </Pressable>
    </View>
  );

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + space.close,
        }}
      >
        {header}
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
            Finding a quiet corner…
          </AppText>
        </View>
      </View>
    );
  }

  if (error && !mine && visible.length === 0) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + space.close,
        }}
      >
        {header}
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: space.room,
            paddingHorizontal: space.gutter,
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
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + space.close,
      }}
    >
      {header}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingBottom: insets.bottom + 40,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void run("refresh")}
            tintColor={theme.brand}
            colors={[theme.brand]}
          />
        }
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space.room,
            marginTop: space.hair,
          }}
        >
          <AppText variant="display" accessibilityRole="header">
            Focus
          </AppText>
          {/* Quiet below 2: a streak is a gift, never a debt. */}
          {streak >= 2 ? (
            <Chip label={`${streak}-day streak`} tone="accent" icon="zap" />
          ) : null}
        </View>

        {error ? (
          <AppText
            variant="caption"
            accessibilityLiveRegion="polite"
            style={{ color: theme.danger, marginTop: space.cosy }}
          >
            We couldn't refresh just now. Pull down to try again.
          </AppText>
        ) : null}

        {mine && timer ? (
          /* ------------------------- running ------------------------- */
          /* `entrance` is this card's own arrival: it lands when you press
             Start, which is exactly the moment worth reporting. */
          <Card
            entrance={0}
            style={{
              marginTop: space.card,
              gap: space.card,
              alignItems: "center",
            }}
          >
            <AppText
              variant="display"
              numberOfLines={1}
              adjustsFontSizeToFit
              accessibilityLabel={timer.spoken}
              style={{
                fontSize: Math.round(54 * textScale),
                lineHeight: Math.round(62 * textScale),
                marginTop: space.tight,
              }}
            >
              {timer.readout}
            </AppText>
            {/* Said already, as part of the readout above. */}
            <AppText
              variant="caption"
              muted
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{ textAlign: "center" }}
            >
              {timer.caption}
            </AppText>

            <ProgressBar value={timer.value} />

            {timer.courseCode || mine.note || mine.is_private ? (
              <View style={{ alignItems: "center", gap: space.cosy }}>
                {timer.courseCode || mine.is_private ? (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.cosy,
                    }}
                  >
                    {timer.courseCode ? (
                      <Chip label={timer.courseCode} tone="brand" />
                    ) : null}
                    {/* The one thing a student can't check from the screen:
                        their own row never appears in the list below, so
                        without this the private session and the public one
                        look identical from where they're sitting. */}
                    {mine.is_private ? (
                      <Chip label="Just you" tone="neutral" icon="eye-off" />
                    ) : null}
                  </View>
                ) : null}
                {mine.note ? (
                  <AppText
                    variant="bodyMedium"
                    style={{ textAlign: "center" }}
                    numberOfLines={2}
                  >
                    {mine.note}
                  </AppText>
                ) : null}
              </View>
            ) : null}

            {endError ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={{ color: theme.danger, textAlign: "center" }}
              >
                {endError}
              </AppText>
            ) : null}

            <Button
              label="Done"
              size="lg"
              pending={ending}
              accessibilityLabel="Done, end this session"
              accessibilityState={{ busy: ending, disabled: ending }}
              style={{ alignSelf: "stretch", marginTop: space.hair }}
              onPress={() => void finish("done")}
            />
            <Button
              label="Give up on this one"
              variant="ghost"
              size="sm"
              disabled={ending}
              accessibilityState={{ disabled: ending }}
              onPress={() => void finish("quit")}
            />
          </Card>
        ) : finished ? (
          /* ------------------------ just finished -------------------- */
          /* Completion, so it both arrives and says itself: the card that
             replaces the timer is the whole report of what just happened. */
          <Card
            entrance={0}
            accessibilityLiveRegion="polite"
            style={{
              marginTop: space.card,
              gap: space.room,
              alignItems: "center",
            }}
          >
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                width: 44,
                height: 44,
                borderRadius: radius.full,
                backgroundColor: theme.accentSoft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Feather name="check" size={20} color={theme.accent} />
            </View>
            <AppText
              variant="title"
              accessibilityRole="header"
              style={{ textAlign: "center" }}
            >
              {completionLine(finished.minutes)}
            </AppText>
            <AppText
              variant="caption"
              muted
              style={{ textAlign: "center", maxWidth: 280 }}
            >
              Stretch, get water, come back when you're ready.
            </AppText>
            <Button
              label="Sit down again"
              variant="soft"
              size="sm"
              style={{ marginTop: space.tight }}
              onPress={() => setFinished(null)}
            />
          </Card>
        ) : (
          /* -------------------------- idle --------------------------- */
          <>
            <AppText variant="caption" muted style={{ marginTop: space.tight }}>
              Pick a length, sit down, and see who else is heads-down.
            </AppText>

            <Card style={{ marginTop: space.card, gap: space.gutter }}>
              <View style={{ gap: space.room }}>
                <FormLabel text="How long" />
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: space.cosy,
                  }}
                >
                  {FOCUS_GOAL_PRESETS.map((minutes) => (
                    <Chip
                      key={minutes}
                      label={formatDuration(minutes)}
                      size="md"
                      tone="brand"
                      selected={goal === minutes}
                      accessibilityLabel={`${formatDuration(minutes)} goal`}
                      onPress={() => setGoal(minutes)}
                    />
                  ))}
                </View>
              </View>

              <View style={{ gap: space.room }}>
                <FormLabel text="On what" />
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: space.cosy,
                  }}
                >
                  <Chip
                    label="Just studying"
                    size="md"
                    tone="brand"
                    selected={courseId === null}
                    accessibilityLabel="Just studying, no class"
                    onPress={() => setCourseId(null)}
                  />
                  {courses.map((course) => (
                    <Chip
                      key={course.id}
                      label={course.code}
                      size="md"
                      tone="brand"
                      selected={courseId === course.id}
                      accessibilityLabel={`Studying ${course.code}`}
                      onPress={() => setCourseId(course.id)}
                    />
                  ))}
                </View>
              </View>

              <Field
                label="What are you working on?"
                placeholder="Optional: problem set 4"
                value={note}
                onChangeText={setNote}
                maxLength={FOCUS_NOTE_MAX}
                returnKeyType="done"
                autoCapitalize="sentences"
              />

              {/* Last thing in the form, because it is the answer to what is
                  above it: the class you picked and the line you just typed
                  are exactly what this decides the audience for. */}
              <View style={{ gap: space.room }}>
                <FormLabel text="Who sees it" />
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: space.cosy,
                  }}
                >
                  <Chip
                    label="Everyone on campus"
                    size="md"
                    tone="brand"
                    icon="users"
                    selected={!isPrivate}
                    accessibilityLabel="Everyone on campus sees this session"
                    onPress={() => setIsPrivate(false)}
                  />
                  <Chip
                    label="Just me"
                    size="md"
                    tone="brand"
                    icon="eye-off"
                    selected={isPrivate}
                    accessibilityLabel="Just me, this session stays off the list"
                    onPress={() => setIsPrivate(true)}
                  />
                </View>
              </View>

              {formError ? (
                <AppText
                  variant="caption"
                  accessibilityLiveRegion="polite"
                  style={{ color: theme.danger }}
                >
                  {formError}
                </AppText>
              ) : null}

              <View style={{ gap: space.cosy }}>
                <Button
                  label="Start"
                  size="lg"
                  pending={starting}
                  /* The audience is half of what this button commits to, so
                     it is said here rather than left to the chip above. */
                  accessibilityLabel={
                    isPrivate
                      ? `Start a ${formatDuration(goal)} session, just for you`
                      : `Start a ${formatDuration(goal)} session, visible to campus`
                  }
                  accessibilityState={{ busy: starting, disabled: starting }}
                  style={{ alignSelf: "stretch" }}
                  onPress={() => void start()}
                />
                {/* The note used to be the unmentioned half of this: the row
                    below draws the course chip and this free text next to
                    the person, campus-wide. Name it, or the box and the
                    audience disagree. (A private profile shows its handle
                    here rather than a name; see `toFocusPerson`.)

                    The private version has to be as specific about what it
                    keeps as about what it hides, because the fear it answers
                    is "does opting out cost me the streak?". It doesn't:
                    0040 hides the row from other people's reads and changes
                    nothing else about it. */}
                <AppText
                  variant="caption"
                  muted
                  accessibilityLiveRegion="polite"
                  style={{ textAlign: "center" }}
                >
                  {isPrivate
                    ? "Nothing goes on the list below. You get the timer, the session still counts toward your streak, and nobody sees you sat down."
                    : "Your name, your class and this line show up below while you're sitting, where everyone at your university can see. That's the whole trick."}
                </AppText>
              </View>
            </Card>
          </>
        )}

        <SectionLabel text="Studying now" />

        {visible.length === 0 ? (
          <EmptyState
            illustration={Lantern}
            title="Nobody's heads-down right now"
            body="Be the first. Start a session and the next person to open this sees they're not alone."
          />
        ) : (
          visible.map((row, index) => (
            <StudyingRow key={row.id} row={row} index={index} now={listNow} />
          ))
        )}
      </ScrollView>
    </View>
  );
}
