import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
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
  type ChipTone,
} from "@/components/ui";
import {
  courseTintsFor,
  radius,
  type CourseTintColors,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { colorForCourse, type CourseTint } from "@/lib/course-color";
import { tapLight, tapSuccess } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import {
  buildPlan,
  computeDayStreak,
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
  | { type: "group"; key: string; label: PlanGroupLabel }
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
  onToggle,
}: {
  entry: PlanEntry;
  tint: CourseTintColors;
  now: Date;
  onToggle: () => void;
}) {
  const theme = useTheme();
  const overdue = entry.dueAt.getTime() < now.getTime();
  const dueLine = `${overdue ? "Was due" : "Due"} ${formatDayTime(entry.dueAt)}`;
  return (
    <Card
      padded={false}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        paddingLeft: 4,
        paddingRight: 14,
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
      <View style={{ flex: 1, gap: 4 }}>
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
      </View>
    </Card>
  );
}

/** A derived study suggestion — plain text, nothing to check off. */
function BlockRow({ block }: { block: StudyBlock }) {
  const theme = useTheme();
  return (
    <View
      style={{
        marginLeft: 28,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: theme.surface2,
        borderRadius: radius.control,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <Feather name="calendar" size={15} color={theme.accent} />
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
    for (const row of enrollments) {
      if (row.course === null) continue;
      tintByCode.set(row.course.code, colorForCourse(row.color, row.course.code));
    }
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
        setData(await fetchPlan());
        setError(null);
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

  const rows = useMemo<ListRow[]>(() => {
    if (!plan) return [];
    const out: ListRow[] = [];
    for (const group of plan.groups) {
      out.push({ type: "group", key: `group-${group.label}`, label: group.label });
      for (const entry of group.entries) {
        out.push({ type: "entry", key: `item-${entry.id}`, entry });
        for (const block of entry.studyBlocks ?? []) {
          out.push({ type: "block", key: block.key, block });
        }
      }
    }
    return out;
  }, [plan]);

  /** A code we somehow have no enrolment for still gets a stable tint from
      the hash rather than falling back to a flat brand pill. */
  const tintFor = useCallback(
    (courseCode: string): CourseTintColors =>
      tints[data?.tintByCode.get(courseCode) ?? colorForCourse(null, courseCode)],
    [tints, data]
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ListRow>) => {
      switch (item.type) {
        case "group":
          return <SectionLabel text={item.label} first={index === 0} />;
        case "entry":
          return (
            <View style={{ marginBottom: 8 }}>
              <EntryRow
                entry={item.entry}
                tint={tintFor(item.entry.courseCode)}
                now={data?.loadedAt ?? new Date()}
                onToggle={() => void toggle(item.entry)}
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
    [data, tintFor, toggle]
  );

  const empty = useMemo(() => emptyPlanCopy(data), [data]);

  const stats = plan?.stats ?? null;
  const allDone = stats !== null && stats.total > 0 && stats.handled === stats.total;
  const pct =
    stats && stats.total > 0
      ? Math.round((stats.handled / stats.total) * 100)
      : 0;

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
        <AppText variant="display" style={{ marginTop: 2, marginBottom: 16 }}>
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
                  <Card style={{ gap: 10 }}>
                    <AppText variant="title">
                      {allDone
                        ? "All caught up. Go touch grass."
                        : `You're on top of it — ${stats.handled} of ${stats.total} handled`}
                    </AppText>
                    <View
                      style={{
                        height: 6,
                        borderRadius: radius.full,
                        backgroundColor: theme.surface3,
                        overflow: "hidden",
                      }}
                    >
                      <View
                        style={{
                          height: "100%",
                          width: `${pct}%`,
                          borderRadius: radius.full,
                          backgroundColor: allDone ? theme.success : theme.brand,
                        }}
                      />
                    </View>
                    {allDone ? (
                      <AppText variant="caption" muted>
                        {stats.handled} of {stats.total} handled
                      </AppText>
                    ) : stats.nextUp ? (
                      <AppText variant="caption" muted numberOfLines={1}>
                        Next up: {stats.nextUp.courseCode} {stats.nextUp.title}
                      </AppText>
                    ) : null}
                    {/* The streak stays quiet: nothing at 0 or 1 — no guilt UI. */}
                    {streak >= 2 ? (
                      <Chip
                        label={`${streak}-day streak`}
                        tone="accent"
                        icon="zap"
                      />
                    ) : null}
                  </Card>
                ) : null}
                {error ? (
                  <AppText variant="caption" style={{ color: theme.danger }}>
                    We couldn't refresh just now — pull down to try again.
                  </AppText>
                ) : null}
                {actionError ? (
                  <AppText variant="caption" style={{ color: theme.danger }}>
                    {actionError}
                  </AppText>
                ) : null}
              </View>
            }
            ListEmptyComponent={
              <EmptyState
                icon="calendar"
                title={empty.title}
                body={empty.body}
                action={{
                  label: empty.actionLabel,
                  onPress: () => router.push(empty.href),
                }}
              />
            }
          />
        )}
      </View>
    </View>
  );
}
