import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  SectionLabel,
  Sheet,
  useReducedMotion,
  type ChipTone,
} from "@/components/ui";
import {
  courseTintsFor,
  motion,
  radius,
  type CourseTintColors,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { colorForCourse, type CourseTint } from "@/lib/course-color";
import { tapLight, tapSuccess } from "@/lib/haptics";
import {
  LEAD_CHOICES,
  LEAD_MIN_MINUTES,
  ReminderError,
  clearReminder,
  describeLead,
  fetchReminders,
  reminderFiresAt,
  setReminder,
  type LeadChoice,
  type Reminder,
} from "@/lib/reminders";
import { supabase } from "@/lib/supabase";
import {
  PLAN_GROUP_ORDER,
  buildPlan,
  computeDayStreak,
  groupLabelFor,
  toPlanKind,
  type PlanEntry,
  type PlanGroupLabel,
  type PlanItem,
  type PlanKind,
  type StudyBlock,
} from "@/lib/study-plan";
import { useAuth } from "@/providers/auth-provider";
import { useResolvedScheme } from "@/providers/display-provider";

const DAY_MS = 24 * 60 * 60 * 1000;

/* Minimal local row shapes — the web app's types live outside this tsconfig. */

type EnrollmentJoin = {
  /** The student's own tint for this course; null means "let the app choose". */
  color: string | null;
  course: { id: string; code: string } | null;
};

/** Which course's rows the list is narrowed to; null is all of them. */
type CourseFilter = string | null;

type CalendarItemRow = {
  id: string;
  course_id: string;
  kind: string;
  title: string;
  due_at: string;
};

type CheckoffRow = { item_id: string; done_at: string };

type PlanData = {
  items: PlanItem[];
  /** item_id → done_at ISO — membership drives the plan, times drive the streak. */
  checkoffs: Map<string, string>;
  /**
   * Course code → the tint that course wears for this student. Keyed by code
   * rather than id because that is all a {@link PlanEntry} carries by the
   * time it reaches a row, and a student can't be in two courses with the
   * same code.
   */
  tintByCode: ReadonlyMap<string, CourseTint>;
  /**
   * Course code → `courses.id`, so a row can open the class it belongs to.
   * Same keying as {@link tintByCode}: a code is all a {@link PlanEntry}
   * carries, and a student can't be in two courses with the same code.
   */
  idByCode: ReadonlyMap<string, string>;
  /** Active course codes, in the order the chips should read. */
  courseCodes: string[];
  /** Any ACTIVE enrolments — what the plan is actually built from. */
  hasCourses: boolean;
  /**
   * Any SHELVED enrolments, counted only when there are no active ones. It
   * separates "hasn't added a class yet" from "between quarters", which want
   * different sentences and different destinations.
   */
  hasArchivedCourses: boolean;
  loadedAt: Date;
};

type ListRow =
  | {
      type: "group";
      key: string;
      label: PlanGroupLabel;
      /** The "Later" group's show/hide, absent on every other heading. */
      action?: { label: string; onPress: () => void };
    }
  | { type: "entry"; key: string; entry: PlanEntry }
  | { type: "block"; key: string; block: StudyBlock };

/* ------------------------------ helpers ------------------------------ */

function formatDayTime(d: Date): string {
  const day = d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

function kindLabel(kind: PlanKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/* The same two sentences the course calendar writes about a reminder. Kept
   in step with it deliberately: one deadline, two screens, one wording. */

/** A ladder label dropped into the middle of a sentence: "the night before". */
function leadPhrase(minutes: number): string {
  const label = describeLead(minutes);
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** The quiet extra line on a row that has a reminder on it. A stamped
    reminder already did its job, so it says so rather than sounding armed. */
function reminderCaption(reminder: Reminder): string {
  const phrase = leadPhrase(reminder.lead_minutes);
  return reminder.sent_at === null
    ? `Reminder: ${phrase}`
    : `Reminded you ${phrase}`;
}

/** True while the nearest lead on the ladder could still reach you — the
    hourly sweep only sends before a deadline, so past this point a bell would
    be a promise we can't keep. */
function remindable(dueAt: Date, now: Date): boolean {
  return !reminderFiresAt(dueAt, LEAD_MIN_MINUTES, now).past;
}

/** Exams and quizzes pop in the accent green; everything else stays quiet. */
function kindTone(kind: PlanKind): ChipTone {
  return kind === "exam" || kind === "quiz" ? "accent" : "neutral";
}

/**
 * There are three ways to have an empty plan, and they want three different
 * sentences: classes but no calendar items, everything shelved between
 * quarters, and a genuinely new student. Only the last one should be told to
 * add courses — the one in the gap between terms already has them.
 */
function emptyPlanCopy(data: PlanData | null): {
  title: string;
  body: string;
  actionLabel: string;
  href: "/courses" | "/courses/add";
} {
  if (data?.hasCourses) {
    return {
      title: "Nothing on your plan yet",
      body: "Import a syllabus from a course home — assignments and exams land here, ready to check off.",
      actionLabel: "Open your courses",
      href: "/courses",
    };
  }
  if (data?.hasArchivedCourses) {
    return {
      title: "You're between quarters",
      body: "Every class you've added is on the shelf. Bring one back from your courses when the term starts and its due dates come with it.",
      actionLabel: "Open your shelf",
      href: "/courses",
    };
  }
  return {
    title: "No courses yet",
    body: "Add your classes first — then import a syllabus and your whole term plans itself.",
    actionLabel: "Add your courses",
    href: "/courses/add",
  };
}

/* ---------------------------- row pieces ---------------------------- */

/**
 * The course code, wearing that course's colour.
 *
 * Hand-drawn rather than a `Chip`, because `Chip` takes a `tone` — four fixed
 * meanings — and a course tint is a sixth of a personal palette, not a
 * meaning. The metrics are `Chip`'s static `sm` numbers exactly, so this is a
 * colour change and nothing else. If a third screen needs it, `Chip` should
 * grow a way to be handed a soft/ink pair instead of a third copy of this.
 */
function CourseChip({ code, tint }: { code: string; tint: CourseTintColors }) {
  return (
    <View
      // The row's summary already names the course; this is the colour of it.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: radius.full,
        backgroundColor: tint.soft,
      }}
    >
      <AppText
        variant="label"
        numberOfLines={1}
        style={{ color: tint.ink, fontSize: 11, lineHeight: 14 }}
      >
        {code}
      </AppText>
    </View>
  );
}

function EntryRow({
  entry,
  tint,
  now,
  index,
  reminder,
  canOpenCourse,
  onToggle,
  onOpenCourse,
  onBell,
}: {
  entry: PlanEntry;
  tint: CourseTintColors;
  now: Date;
  index: number;
  /** This item's reminder, or undefined for "not set". */
  reminder: Reminder | undefined;
  /** False when we have no course id for the code — the row stays inert. */
  canOpenCourse: boolean;
  onToggle: () => void;
  onOpenCourse: () => void;
  onBell: () => void;
}) {
  const theme = useTheme();
  const overdue = entry.dueAt.getTime() < now.getTime();
  const dueLine = `${overdue ? "Was due" : "Due"} ${formatDayTime(entry.dueAt)}`;
  // Nothing to arm once even the closest lead is behind the deadline.
  const showBell = reminder !== undefined || remindable(entry.dueAt, now);
  /* Two chips, a title and a due line are one thought about one assignment.
     The strike-through and the danger-red due line are drawing alone, so
     "done" and the overdue wording carry them into the words. */
  const summary = [
    entry.courseCode,
    kindLabel(entry.kind),
    entry.title,
    dueLine,
    entry.done ? "done" : null,
    reminder ? reminderCaption(reminder) : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Card
      padded={false}
      entrance={index}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        paddingLeft: 4,
        paddingRight: showBell ? 2 : 14,
        paddingVertical: 12,
        minHeight: 68,
      }}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: entry.done }}
        accessibilityLabel={`${entry.done ? "Mark not done" : "Mark done"} — ${
          entry.courseCode
        } ${entry.title}`}
        onPress={onToggle}
        hitSlop={4}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        {entry.done ? (
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: radius.full,
              backgroundColor: theme.brand,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather name="check" size={14} color={theme.brandFg} />
          </View>
        ) : (
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: radius.full,
              borderWidth: 2,
              borderColor: overdue ? theme.brand : theme.border,
            }}
          />
        )}
      </Pressable>
      {/* The body is the way into the class. "PHY 9B Midterm 1 — was due
          Tuesday" was a dead end before: the one screen that knows you're
          behind couldn't take you to the course you're behind in. */}
      <Pressable
        accessible
        accessibilityRole={canOpenCourse ? "button" : undefined}
        accessibilityLabel={summary}
        accessibilityHint={
          canOpenCourse ? `Opens ${entry.courseCode}` : undefined
        }
        // No `disabled`: a row we have no course id for is simply not a
        // button, and marking it disabled would announce it as dimmed.
        onPress={canOpenCourse ? onOpenCourse : undefined}
        style={({ pressed }) => ({
          flex: 1,
          gap: 4,
          opacity: pressed && canOpenCourse ? 0.7 : 1,
        })}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <CourseChip code={entry.courseCode} tint={tint} />
          <Chip label={kindLabel(entry.kind)} tone={kindTone(entry.kind)} />
        </View>
        <AppText
          variant="bodySemi"
          numberOfLines={2}
          muted={entry.done}
          style={entry.done ? { textDecorationLine: "line-through" } : undefined}
        >
          {entry.title}
        </AppText>
        <AppText
          variant="caption"
          muted={!overdue || entry.done}
          style={overdue && !entry.done ? { color: theme.danger } : undefined}
        >
          {dueLine}
        </AppText>
        {reminder ? (
          <AppText variant="caption" muted numberOfLines={1}>
            {reminderCaption(reminder)}
          </AppText>
        ) : null}
      </Pressable>
      {/* Its own 44px button on the trailing edge, well clear of the
          check-off circle, so the two never trade taps. Empty outline until a
          reminder is set, then a soft ember tile. */}
      {showBell ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            reminder
              ? `Change the reminder for ${entry.title}, currently ${leadPhrase(
                  reminder.lead_minutes
                )}`
              : `Remind me about ${entry.title}`
          }
          onPress={onBell}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: radius.full,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: reminder ? theme.brandSoft : "transparent",
            }}
          >
            <Feather
              name="bell"
              size={17}
              color={reminder ? theme.brand : theme.muted}
            />
          </View>
        </Pressable>
      ) : null}
    </Card>
  );
}

/**
 * A derived study suggestion — plain text, nothing to check off.
 *
 * It is filed by the night you should sit down, which is rarely the week its
 * exam falls in, so it no longer hangs indented off a parent row: it stands
 * square with the deadlines around it and names the exam itself. The soft
 * fill and the smaller type are what say "suggestion, not deadline".
 */
function BlockRow({ block }: { block: StudyBlock }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${block.label}, ${formatDayTime(block.at)}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: theme.surface2,
        borderRadius: radius.control,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <Feather
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        name="calendar"
        size={15}
        color={theme.accent}
      />
      <View style={{ flex: 1, gap: 1 }}>
        <AppText variant="label" numberOfLines={2}>
          {block.label}
        </AppText>
        <AppText variant="caption" muted>
          {formatDayTime(block.at)}
        </AppText>
      </View>
    </View>
  );
}

/**
 * The one card at the top of the plan that changes while you stand there:
 * check something off and the count, the bar and the next-up line all move.
 * So it is a single live element — the bar slides to its new length on the
 * arrival curve, and the reader hears the new count rather than the old one
 * going quietly stale.
 *
 * `handled` and `total` are **this week's** — Overdue through This week, the
 * same window the home card prints. Scoring the whole term instead turned a
 * good week into "6 of 74 handled" over a bar at 8%, which is a true division
 * and a false sentence.
 */
function PlanProgress({
  handled,
  total,
  allDone,
  nextUp,
  streak,
}: {
  handled: number;
  total: number;
  allDone: boolean;
  nextUp: PlanEntry | undefined;
  streak: number;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const pct = total > 0 ? Math.round((handled / total) * 100) : 0;
  const fill = useRef(new Animated.Value(pct)).current;

  useEffect(() => {
    const animation = Animated.timing(fill, {
      toValue: pct,
      duration: reduceMotion ? motion.instant : motion.base,
      easing: motion.easing.enter,
      // Width is a layout property; this one can't ride the native driver.
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [pct, reduceMotion, fill]);

  // Nothing this week, but the term goes on — say that rather than dividing
  // by zero into "All caught up" over an empty bar.
  const quietWeek = total === 0;
  const headline = quietWeek
    ? "Nothing due this week"
    : allDone
      ? "All caught up. Go touch grass."
      : `You're on top of it — ${handled} of ${total} handled this week`;

  const label = [
    headline,
    !allDone && nextUp ? `next up ${nextUp.courseCode} ${nextUp.title}` : null,
    streak >= 2 ? `${streak}-day streak` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Card
      accessible
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      style={{ gap: 10 }}
    >
      <AppText variant="title">{headline}</AppText>
      {quietWeek ? null : (
        <View
          style={{
            height: 6,
            borderRadius: radius.full,
            backgroundColor: theme.surface3,
            overflow: "hidden",
          }}
        >
          <Animated.View
            style={{
              height: "100%",
              width: fill.interpolate({
                inputRange: [0, 100],
                outputRange: ["0%", "100%"],
              }),
              borderRadius: radius.full,
              backgroundColor: allDone ? theme.success : theme.brand,
            }}
          />
        </View>
      )}
      {allDone && !quietWeek ? (
        <AppText variant="caption" muted>
          {handled} of {total} handled this week
        </AppText>
      ) : nextUp ? (
        <AppText variant="caption" muted numberOfLines={1}>
          Next up: {nextUp.courseCode} {nextUp.title}
        </AppText>
      ) : null}
      {/* The streak stays quiet: nothing at 0 or 1 — no guilt UI. */}
      {streak >= 2 ? (
        <Chip label={`${streak}-day streak`} tone="accent" icon="zap" />
      ) : null}
    </Card>
  );
}

/* ------------------------------ screen ------------------------------ */

export default function PlanScreen() {
  const theme = useTheme();
  const tints = courseTintsFor(useResolvedScheme());
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [data, setData] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Your own reminders, keyed by item — absent from the map IS "no reminder". */
  const [reminders, setReminders] = useState<Map<string, Reminder>>(new Map());
  const [remindersError, setRemindersError] = useState<string | null>(null);
  /** The item whose lead-time sheet is open, and when it opened. */
  const [sheet, setSheet] = useState<{
    entry: PlanEntry;
    openedAt: Date;
  } | null>(null);
  /** A lead the student tapped that can no longer reach them. */
  const [pastChoice, setPastChoice] = useState<number | null>(null);
  const [courseFilter, setCourseFilter] = useState<CourseFilter>(null);
  /** The rest of the term stays folded until it's asked for. */
  const [laterOpen, setLaterOpen] = useState(false);

  const fetchPlan = useCallback(async (): Promise<PlanData> => {
    if (!userId) throw new Error("Not signed in");
    const now = new Date();

    // Active classes only — a shelved course keeps its history, but last
    // quarter's due dates have no business crowding this quarter's plan.
    const enrollRes = await supabase
      .from("enrollments")
      .select("color, course:courses(id, code)")
      .eq("user_id", userId)
      .is("archived_at", null);
    if (enrollRes.error) throw enrollRes.error;

    const enrollments = (enrollRes.data ?? []) as unknown as EnrollmentJoin[];
    const courses = enrollments
      .map((row) => row.course)
      .filter((c): c is { id: string; code: string } => c !== null);
    // Resolved once here, so a row only ever looks a colour up by code.
    const tintByCode = new Map<string, CourseTint>();
    const idByCode = new Map<string, string>();
    for (const row of enrollments) {
      if (row.course === null) continue;
      tintByCode.set(row.course.code, colorForCourse(row.color, row.course.code));
      idByCode.set(row.course.code, row.course.id);
    }
    const courseCodes = [...idByCode.keys()].sort((a, b) => a.localeCompare(b));
    if (courses.length === 0) {
      // Nothing active. Before saying "no courses yet", check the shelf —
      // a student between quarters has added plenty, they're just all
      // archived, and telling them to add courses would be wrong. One
      // head-only count, and only on the empty path.
      const shelvedRes = await supabase
        .from("enrollments")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .not("archived_at", "is", null);
      return {
        items: [],
        checkoffs: new Map(),
        tintByCode,
        idByCode,
        courseCodes,
        hasCourses: false,
        hasArchivedCourses: (shelvedRes.count ?? 0) > 0,
        loadedAt: now,
      };
    }

    const codeById = new Map(courses.map((c) => [c.id, c.code]));
    // The plan window opens a week back so a missed deadline still nags,
    // and runs forward without limit — buildPlan buckets the far stuff
    // under "Later".
    const since = new Date(now.getTime() - 7 * DAY_MS).toISOString();
    const [itemsRes, checkoffsRes] = await Promise.all([
      supabase
        .from("course_calendar_items")
        .select("id, course_id, kind, title, due_at")
        .in("course_id", [...codeById.keys()])
        .gte("due_at", since)
        .order("due_at", { ascending: true }),
      supabase
        .from("study_checkoffs")
        .select("item_id, done_at")
        .eq("user_id", userId),
    ]);
    if (itemsRes.error) throw itemsRes.error;
    if (checkoffsRes.error) throw checkoffsRes.error;

    const items = ((itemsRes.data ?? []) as unknown as CalendarItemRow[]).map(
      (row): PlanItem => ({
        id: row.id,
        courseCode: codeById.get(row.course_id) ?? "Course",
        kind: toPlanKind(row.kind),
        title: row.title,
        dueAt: new Date(row.due_at),
      })
    );
    const checkoffs = new Map(
      ((checkoffsRes.data ?? []) as unknown as CheckoffRow[]).map(
        (row) => [row.item_id, row.done_at] as const
      )
    );
    return {
      items,
      checkoffs,
      tintByCode,
      idByCode,
      courseCodes,
      hasCourses: true,
      hasArchivedCourses: false,
      loadedAt: now,
    };
  }, [userId]);

  const run = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      try {
        const next = await fetchPlan();
        setData(next);
        setError(null);
        // Every visible deadline's reminder in one batched lookup, once the
        // ids are in hand. A reminder that didn't load dims the bells and
        // says so; it is no reason to fail the plan.
        try {
          setReminders(await fetchReminders(next.items.map((item) => item.id)));
          setRemindersError(null);
        } catch (err) {
          setReminders(new Map());
          setRemindersError(
            err instanceof ReminderError
              ? err.message
              : "We couldn't load your reminders. Give it another go."
          );
        }
      } catch {
        setError("We couldn't load your plan right now.");
      } finally {
        if (mode === "initial") setLoading(false);
        else setRefreshing(false);
      }
    },
    [fetchPlan]
  );

  useEffect(() => {
    if (!userId) return;
    void run("initial");
  }, [userId, run]);

  /** Optimistic check-off: flip locally, persist, roll back if it fails. */
  const toggle = useCallback(
    async (entry: PlanEntry) => {
      if (!userId) return;
      const marking = !entry.done;
      setActionError(null);
      const flip = (add: boolean) =>
        setData((prev) => {
          if (!prev) return prev;
          const next = new Map(prev.checkoffs);
          if (add) next.set(entry.id, new Date().toISOString());
          else next.delete(entry.id);
          return { ...prev, checkoffs: next };
        });
      flip(marking);
      if (marking) tapSuccess();
      else tapLight();
      const res = marking
        ? await supabase
            .from("study_checkoffs")
            .upsert(
              { user_id: userId, item_id: entry.id },
              { onConflict: "user_id,item_id", ignoreDuplicates: true }
            )
        : await supabase
            .from("study_checkoffs")
            .delete()
            .eq("user_id", userId)
            .eq("item_id", entry.id);
      if (res.error) {
        flip(!marking); // roll back
        setActionError("That check-off didn't save — give it another tap.");
      }
    },
    [userId]
  );

  /* ---------------------------- reminders ---------------------------- */

  const openReminders = useCallback((entry: PlanEntry) => {
    setPastChoice(null);
    setSheet({ entry, openedAt: new Date() });
  }, []);

  const closeReminders = useCallback(() => {
    setSheet(null);
    setPastChoice(null);
  }, []);

  /** Arm or re-aim a reminder. The bell fills now; the row syncs behind it. */
  const armReminder = useCallback(
    async (entry: PlanEntry, minutes: number) => {
      const previous = reminders.get(entry.id) ?? null;
      setActionError(null);
      setReminders((prev) =>
        new Map(prev).set(entry.id, {
          item_id: entry.id,
          lead_minutes: minutes,
          // Picking a new lead re-arms a reminder that already went out.
          sent_at: null,
        })
      );
      tapLight();
      try {
        const saved = await setReminder(entry.id, minutes);
        setReminders((prev) => new Map(prev).set(entry.id, saved));
      } catch (err) {
        setReminders((prev) => {
          const next = new Map(prev);
          if (previous) next.set(entry.id, previous);
          else next.delete(entry.id);
          return next;
        });
        setActionError(
          err instanceof ReminderError
            ? err.message
            : "We couldn't set that reminder just now. Give it another go."
        );
      }
    },
    [reminders]
  );

  /** Take the reminder off, with the bell emptying first. */
  const disarmReminder = useCallback(
    async (entry: PlanEntry) => {
      const previous = reminders.get(entry.id);
      if (!previous) return;
      setActionError(null);
      setReminders((prev) => {
        const next = new Map(prev);
        next.delete(entry.id);
        return next;
      });
      tapLight();
      try {
        await clearReminder(entry.id);
      } catch (err) {
        setReminders((prev) => new Map(prev).set(entry.id, previous));
        setActionError(
          err instanceof ReminderError
            ? err.message
            : "We couldn't turn that reminder off just now. Give it another tap."
        );
      }
    },
    [reminders]
  );

  const pickLead = useCallback(
    (choice: LeadChoice) => {
      if (sheet === null) return;
      const { entry, openedAt } = sheet;
      // A lead longer than the time left is a nudge the hourly sweep would
      // skip, so say so where they tapped instead of arming nothing.
      if (reminderFiresAt(entry.dueAt, choice.minutes, openedAt).past) {
        setPastChoice(choice.minutes);
        return;
      }
      closeReminders();
      void armReminder(entry, choice.minutes);
    },
    [sheet, closeReminders, armReminder]
  );

  const dropLead = useCallback(() => {
    if (sheet === null) return;
    const { entry } = sheet;
    closeReminders();
    void disarmReminder(entry);
  }, [sheet, closeReminders, disarmReminder]);

  /* ------------------------------ the list ---------------------------- */

  const plan = useMemo(
    () =>
      data
        ? buildPlan(data.items, new Set(data.checkoffs.keys()), data.loadedAt)
        : null,
    [data]
  );

  const streak = useMemo(
    () => (data ? computeDayStreak(data.checkoffs.values(), data.loadedAt) : 0),
    [data]
  );

  /**
   * The flat list, with two things the plain walk over `plan.groups` got
   * wrong.
   *
   * A **study block is filed by when to sit down**, not by when the exam is.
   * Hanging it off its parent put "study block 1 of 3" for tomorrow night
   * under "Later" with the midterm it prepares for — the one row designed to
   * answer "what do I do tonight", filed under not yet.
   *
   * And **"Later" arrives folded**. Four classes of expanded weekly lectures
   * is a hundred rows under one heading, and scrolling past the whole term to
   * reach nothing is the reason the good half of this screen goes unseen.
   */
  const rows = useMemo<ListRow[]>(() => {
    if (!plan || !data) return [];
    const now = data.loadedAt;
    type Slot =
      | { at: Date; kind: "entry"; entry: PlanEntry }
      | { at: Date; kind: "block"; block: StudyBlock };

    const buckets = new Map<PlanGroupLabel, Slot[]>();
    const add = (label: PlanGroupLabel, slot: Slot) => {
      const bucket = buckets.get(label);
      if (bucket) bucket.push(slot);
      else buckets.set(label, [slot]);
    };

    for (const group of plan.groups) {
      for (const entry of group.entries) {
        if (courseFilter !== null && entry.courseCode !== courseFilter) continue;
        add(group.label, { at: entry.dueAt, kind: "entry", entry });
        for (const block of entry.studyBlocks ?? []) {
          add(groupLabelFor(block.at, now), {
            at: block.at,
            kind: "block",
            block,
          });
        }
      }
    }

    // Walked in time order rather than over plan.groups, because a block can
    // land in a bucket that has no deadlines of its own — a study block this
    // week for an exam that's still "Later" — and that heading has to appear
    // in its place, not at the end.
    const out: ListRow[] = [];
    for (const label of PLAN_GROUP_ORDER) {
      const slots = buckets.get(label);
      if (!slots || slots.length === 0) continue;
      slots.sort((a, b) => a.at.getTime() - b.at.getTime());
      const folded = label === "Later" && !laterOpen;
      out.push({
        type: "group",
        key: `group-${label}`,
        label,
        ...(label === "Later"
          ? {
              action: {
                label: folded ? `Show ${slots.length}` : "Hide",
                onPress: () => setLaterOpen((open) => !open),
              },
            }
          : null),
      });
      if (folded) continue;
      for (const slot of slots) {
        if (slot.kind === "entry") {
          out.push({
            type: "entry",
            key: `item-${slot.entry.id}`,
            entry: slot.entry,
          });
        } else {
          out.push({ type: "block", key: slot.block.key, block: slot.block });
        }
      }
    }
    return out;
  }, [plan, data, courseFilter, laterOpen]);

  /** A code we somehow have no enrolment for still gets a stable tint from
      the hash rather than falling back to a flat brand pill. */
  const tintFor = useCallback(
    (courseCode: string): CourseTintColors =>
      tints[data?.tintByCode.get(courseCode) ?? colorForCourse(null, courseCode)],
    [tints, data]
  );

  const openCourse = useCallback(
    (courseCode: string) => {
      const id = data?.idByCode.get(courseCode);
      if (!id) return;
      router.push(`/course/${id}`);
    },
    [data]
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ListRow>) => {
      switch (item.type) {
        case "group":
          return (
            <SectionLabel
              text={item.label}
              first={index === 0}
              action={item.action}
            />
          );
        case "entry":
          return (
            <View style={{ marginBottom: 8 }}>
              <EntryRow
                entry={item.entry}
                tint={tintFor(item.entry.courseCode)}
                now={data?.loadedAt ?? new Date()}
                index={index}
                reminder={reminders.get(item.entry.id)}
                canOpenCourse={
                  data?.idByCode.get(item.entry.courseCode) !== undefined
                }
                onToggle={() => void toggle(item.entry)}
                onOpenCourse={() => openCourse(item.entry.courseCode)}
                onBell={() => openReminders(item.entry)}
              />
            </View>
          );
        case "block":
          return (
            <View style={{ marginBottom: 8 }}>
              <BlockRow block={item.block} />
            </View>
          );
      }
    },
    [data, tintFor, toggle, reminders, openCourse, openReminders]
  );

  const empty = useMemo(() => emptyPlanCopy(data), [data]);

  const stats = plan?.stats ?? null;
  const allDone =
    stats !== null &&
    stats.weekTotal > 0 &&
    stats.weekHandled === stats.weekTotal;

  /* One chip per class over the list. Filtering is local — every row is
     already in hand, so narrowing to one course costs no query. */
  const courseCodes = data?.courseCodes ?? [];
  const filterRow =
    courseCodes.length > 1 ? (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
      >
        <Chip
          label="All"
          tone="brand"
          size="md"
          selected={courseFilter === null}
          accessibilityLabel="Show every class"
          onPress={() => setCourseFilter(null)}
        />
        {courseCodes.map((code) => (
          <Chip
            key={code}
            label={code}
            tone="brand"
            size="md"
            selected={courseFilter === code}
            accessibilityLabel={`Show only ${code}`}
            onPress={() =>
              setCourseFilter((current) => (current === code ? null : code))
            }
          />
        ))}
      </ScrollView>
    ) : null;

  /* ------------------------- the lead-time sheet ---------------------- */

  const sheetReminder = sheet ? reminders.get(sheet.entry.id) : undefined;
  // Even the closest rung is behind us — there is no honest choice left to
  // offer, so the sheet explains instead of listing seven dead ones.
  const sheetTooLate =
    sheet !== null && !remindable(sheet.entry.dueAt, sheet.openedAt);

  const reminderSheet = (
    <Sheet
      visible={sheet !== null}
      onClose={closeReminders}
      title={sheet?.entry.title ?? "Reminder"}
    >
      {sheet ? (
        <AppText variant="caption" muted style={{ marginBottom: 6 }}>
          {/* Loose on purpose: the sweep ticks hourly, so a nudge lands near
              the moment they picked, not on the minute. */}
          {`Due ${formatDayTime(sheet.entry.dueAt)}.${
            sheetTooLate ? "" : " One nudge, around the time you pick."
          }`}
        </AppText>
      ) : null}
      {sheetTooLate ? (
        <AppText
          variant="caption"
          style={{ color: theme.warning, marginBottom: 6 }}
        >
          This one's due too soon — even the closest reminder would land after
          the deadline.
        </AppText>
      ) : (
        <ScrollView
          style={{ flexShrink: 1 }}
          contentContainerStyle={{ gap: 4 }}
          showsVerticalScrollIndicator={false}
        >
          {sheet
            ? LEAD_CHOICES.map((choice) => {
                const past = reminderFiresAt(
                  sheet.entry.dueAt,
                  choice.minutes,
                  sheet.openedAt
                ).past;
                return (
                  <View key={choice.minutes}>
                    {/* Faded when that moment is already behind them —
                        tapping it says why rather than arming a nudge that
                        can't arrive. */}
                    <View style={{ opacity: past ? 0.5 : 1 }}>
                      <Sheet.Row
                        icon="clock"
                        label={choice.label}
                        selected={
                          sheetReminder?.lead_minutes === choice.minutes
                        }
                        onPress={() => pickLead(choice)}
                      />
                    </View>
                    {pastChoice === choice.minutes ? (
                      <AppText
                        variant="caption"
                        style={{
                          color: theme.warning,
                          marginLeft: 46,
                          marginBottom: 4,
                        }}
                      >
                        That moment has passed — pick something closer in.
                      </AppText>
                    ) : null}
                  </View>
                );
              })
            : null}
        </ScrollView>
      )}
      {sheetReminder ? (
        <>
          <View
            style={{
              height: 1,
              backgroundColor: theme.border,
              marginTop: 6,
              marginBottom: 8,
            }}
          />
          <Sheet.Row
            icon="bell-off"
            label="Don't remind me"
            danger
            onPress={dropLead}
          />
        </>
      ) : null}
    </Sheet>
  );

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + 8,
      }}
    >
      <View style={{ paddingHorizontal: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)/home");
          }}
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

      <View style={{ flex: 1, paddingHorizontal: 20 }}>
        <AppText
          variant="display"
          accessibilityRole="header"
          style={{ marginTop: 2, marginBottom: 16 }}
        >
          Your plan
        </AppText>

        {loading ? (
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
              Lining up your week…
            </AppText>
          </View>
        ) : error && !data ? (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
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
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(row) => row.key}
            renderItem={renderItem}
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingBottom: insets.bottom + 32,
              flexGrow: 1,
            }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void run("refresh")}
                tintColor={theme.brand}
                colors={[theme.brand]}
              />
            }
            ListHeaderComponent={
              <View style={{ gap: 10, marginBottom: 6 }}>
                {stats && stats.total > 0 ? (
                  <PlanProgress
                    handled={stats.weekHandled}
                    total={stats.weekTotal}
                    allDone={allDone}
                    nextUp={stats.nextUp}
                    streak={streak}
                  />
                ) : null}
                {filterRow}
                {error ? (
                  <AppText
                    variant="caption"
                    accessibilityLiveRegion="polite"
                    style={{ color: theme.danger }}
                  >
                    We couldn't refresh just now — pull down to try again.
                  </AppText>
                ) : null}
                {actionError ? (
                  <AppText
                    variant="caption"
                    accessibilityLiveRegion="polite"
                    style={{ color: theme.danger }}
                  >
                    {actionError}
                  </AppText>
                ) : null}
                {remindersError ? (
                  <AppText
                    variant="caption"
                    accessibilityLiveRegion="polite"
                    style={{ color: theme.danger }}
                  >
                    {remindersError}
                  </AppText>
                ) : null}
              </View>
            }
            ListEmptyComponent={
              courseFilter !== null ? (
                <EmptyState
                  icon="calendar"
                  title={`Nothing on the plan for ${courseFilter}`}
                  body="No deadlines from this class in the window. Its syllabus may not be imported yet."
                  action={{
                    label: "Show every class",
                    onPress: () => setCourseFilter(null),
                  }}
                />
              ) : (
                <EmptyState
                  icon="calendar"
                  title={empty.title}
                  body={empty.body}
                  action={{
                    label: empty.actionLabel,
                    onPress: () => router.push(empty.href),
                  }}
                />
              )
            }
          />
        )}
      </View>
      {reminderSheet}
    </View>
  );
}
