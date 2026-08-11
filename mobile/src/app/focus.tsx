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
import { radius } from "@/constants/theme";
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

/* Focus — sit down with a goal, and see who else is heads-down.
 *
 * Two states in one screen. Idle is an invitation: pick a length, maybe a
 * class, maybe a line about what you're doing, and start. Running is a
 * timer that takes over, with the "studying now" list still breathing
 * underneath so the room never feels empty.
 *
 * All the time math lives in `@/lib/focus` and takes a `now` — this screen
 * only decides how often to hand it one (once a second, while a session is
 * running and the screen is actually in front of you). */

/** How far back the streak query looks — long enough for any real run. */
const STREAK_WINDOW_DAYS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A course you can attach a session to. */
type CourseOption = { id: string; code: string };

type EnrollmentJoin = { course: CourseOption | null };

/** What "Done" leaves on the screen — the one number worth saying out loud. */
type Finished = { minutes: number };

/* ------------------------------ queries ------------------------------ */

/**
 * Your live classes, for the course chips. Archived enrolments are shelved
 * courses — they shouldn't clutter a picker you use at 11pm.
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
 * so that's all we pull — a few hundred timestamps at most.
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

/** The quiet uppercase heading inside a card — SectionLabel's voice, without
    its screen-level margins. */
function FormLabel({ text }: { text: string }) {
  return (
    <AppText
      variant="label"
      muted
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
  now,
}: {
  row: StudyingNow;
  now: Date;
}) {
  const theme = useTheme();
  const minutes = elapsedMinutes(row, now);
  const detail = row.note ?? `${formatDuration(row.goal_minutes)} goal`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.person.display_name}, ${sinceLabel(minutes)}. Open profile.`}
      onPress={() => router.push(`/u/${row.person.handle}`)}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, marginBottom: 10 })}
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
        }}
      >
        <Avatar
          url={row.person.avatar_url}
          name={row.person.display_name}
          size={40}
        />
        <View style={{ flex: 1, gap: 4 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
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

/** The slim bar under the readout: brand fill on surface2, no animation. */
function ProgressBar({ value }: { value: number }) {
  const theme = useTheme();
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <View
      accessibilityRole="progressbar"
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

  /* The idle form's draft. */
  const [goal, setGoal] = useState<number>(FOCUS_GOAL_DEFAULT);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [note, setNote] = useState("");

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
      // Keep the last good list — a dropped refresh isn't worth a banner.
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
        // Secondary data — a failure here shouldn't cost the whole screen.
        void loadCourses(userId)
          .then(setCourses)
          .catch(() => undefined);
        void refreshStreak();
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
    [userId, refreshStreak]
  );

  useEffect(() => {
    // No session yet (or signed out): drop the spinner rather than hang on
    // it — the idle form is honest, and starting one says "sign in again".
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
     Nothing here animates per frame — the bar just redraws each tick. */
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
      const created = await startFocus({ courseId, goalMinutes: goal, note });
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
  }, [starting, userId, courseId, goal, note, refreshStudying]);

  /**
   * Stand up. Optimistic: the timer stops the moment you tap, and the
   * session comes back (with a warm note) only if the write fails.
   * `mode` decides the ceremony — "done" earns a haptic and a line,
   * "quit" just quietly puts things away.
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

  const timer = useMemo(() => {
    if (!mine) return null;
    const left = remainingMinutes(mine, now);
    const done = elapsedMinutes(mine, now);
    const past = left === 0;
    const goalText = formatDuration(mine.goal_minutes);
    return {
      readout: past ? formatDuration(done) : formatDuration(left),
      caption: past
        ? `${goalText} goal reached — stand up whenever you like`
        : `left of your ${goalText} goal`,
      value: progress(mine, now),
      courseCode:
        courses.find((course) => course.id === mine.course_id)?.code ?? null,
    };
  }, [mine, now, courses]);

  /* ------------------------------ render ----------------------------- */

  const header = (
    <View style={{ paddingHorizontal: 12 }}>
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
    </View>
  );

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + 8,
        }}
      >
        {header}
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            paddingBottom: 80,
          }}
        >
          <ActivityIndicator size="large" color={theme.brand} />
          <AppText variant="caption" muted>
            Finding a quiet corner…
          </AppText>
        </View>
      </View>
    );
  }

  if (error && !mine && studying.length === 0) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + 8,
        }}
      >
        {header}
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            paddingHorizontal: 20,
            paddingBottom: 80,
          }}
        >
          <Feather name="cloud-off" size={28} color={theme.muted} />
          <AppText variant="bodySemi">Something went sideways</AppText>
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
        paddingTop: insets.top + 8,
      }}
    >
      {header}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
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
            gap: 10,
            marginTop: 2,
          }}
        >
          <AppText variant="display">Focus</AppText>
          {/* Quiet below 2 — a streak is a gift, never a debt. */}
          {streak >= 2 ? (
            <Chip label={`${streak}-day streak`} tone="accent" icon="zap" />
          ) : null}
        </View>

        {error ? (
          <AppText
            variant="caption"
            style={{ color: theme.danger, marginTop: 8 }}
          >
            We couldn't refresh just now — pull down to try again.
          </AppText>
        ) : null}

        {mine && timer ? (
          /* ------------------------- running ------------------------- */
          <Card style={{ marginTop: 16, gap: 14, alignItems: "center" }}>
            <AppText
              variant="display"
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{
                fontSize: Math.round(54 * textScale),
                lineHeight: Math.round(62 * textScale),
                marginTop: 4,
              }}
            >
              {timer.readout}
            </AppText>
            <AppText variant="caption" muted style={{ textAlign: "center" }}>
              {timer.caption}
            </AppText>

            <ProgressBar value={timer.value} />

            {timer.courseCode || mine.note ? (
              <View style={{ alignItems: "center", gap: 8 }}>
                {timer.courseCode ? (
                  <Chip label={timer.courseCode} tone="brand" />
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
                style={{ color: theme.danger, textAlign: "center" }}
              >
                {endError}
              </AppText>
            ) : null}

            <Button
              label="Done"
              size="lg"
              pending={ending}
              style={{ alignSelf: "stretch", marginTop: 2 }}
              onPress={() => void finish("done")}
            />
            <Button
              label="Give up on this one"
              variant="ghost"
              size="sm"
              disabled={ending}
              onPress={() => void finish("quit")}
            />
          </Card>
        ) : finished ? (
          /* ------------------------ just finished -------------------- */
          <Card style={{ marginTop: 16, gap: 10, alignItems: "center" }}>
            <View
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
            <AppText variant="title" style={{ textAlign: "center" }}>
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
              style={{ marginTop: 4 }}
              onPress={() => setFinished(null)}
            />
          </Card>
        ) : (
          /* -------------------------- idle --------------------------- */
          <>
            <AppText variant="caption" muted style={{ marginTop: 4 }}>
              Pick a length, sit down, and see who else is heads-down.
            </AppText>

            <Card style={{ marginTop: 16, gap: 18 }}>
              <View style={{ gap: 10 }}>
                <FormLabel text="How long" />
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
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

              <View style={{ gap: 10 }}>
                <FormLabel text="On what" />
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                >
                  <Chip
                    label="Just studying"
                    size="md"
                    tone="brand"
                    selected={courseId === null}
                    onPress={() => setCourseId(null)}
                  />
                  {courses.map((course) => (
                    <Chip
                      key={course.id}
                      label={course.code}
                      size="md"
                      tone="brand"
                      selected={courseId === course.id}
                      onPress={() => setCourseId(course.id)}
                    />
                  ))}
                </View>
              </View>

              <Field
                label="What are you working on?"
                placeholder="Optional — problem set 4"
                value={note}
                onChangeText={setNote}
                maxLength={FOCUS_NOTE_MAX}
                returnKeyType="done"
                autoCapitalize="sentences"
              />

              {formError ? (
                <AppText variant="caption" style={{ color: theme.danger }}>
                  {formError}
                </AppText>
              ) : null}

              <View style={{ gap: 8 }}>
                <Button
                  label="Start"
                  size="lg"
                  pending={starting}
                  style={{ alignSelf: "stretch" }}
                  onPress={() => void start()}
                />
                <AppText
                  variant="caption"
                  muted
                  style={{ textAlign: "center" }}
                >
                  Your name shows up below while you're sitting. That's the
                  whole trick.
                </AppText>
              </View>
            </Card>
          </>
        )}

        <SectionLabel text="Studying now" />

        {studying.length === 0 ? (
          <EmptyState
            illustration={Lantern}
            title="Nobody's heads-down right now"
            body="Be the first. Start a session and the next person to open this sees they're not alone."
          />
        ) : (
          studying.map((row) => (
            <StudyingRow key={row.id} row={row} now={listNow} />
          ))
        )}
      </ScrollView>
    </View>
  );
}
