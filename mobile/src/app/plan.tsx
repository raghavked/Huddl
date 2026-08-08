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
import { AppText, Button, Card } from "@/components/ui";
import { radius, type Palette } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { tapLight, tapSuccess } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import {
  buildPlan,
  toPlanKind,
  type PlanEntry,
  type PlanGroupLabel,
  type PlanItem,
  type PlanKind,
  type StudyBlock,
} from "@/lib/study-plan";
import { useAuth } from "@/providers/auth-provider";

const DAY_MS = 24 * 60 * 60 * 1000;

/* Minimal local row shapes — the web app's types live outside this tsconfig. */

type EnrollmentJoin = { course: { id: string; code: string } | null };

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
  hasCourses: boolean;
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

/** Local calendar-day key — streaks live in the student's timezone. */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * The study streak: consecutive local calendar days ending today-or-yesterday
 * with at least one check-off. Yesterday still counts as alive so an unmarked
 * morning doesn't zero out last night's run. Pure — feed it done_at ISO
 * strings and a "now" and it hands back the day count.
 */
function computeStreak(doneAts: Iterable<string>, now: Date): number {
  const days = new Set<string>();
  for (const iso of doneAts) {
    days.add(localDayKey(new Date(iso)));
  }
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(localDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Exams and quizzes pop in the accent green; everything else stays quiet. */
function kindChipColors(kind: PlanKind, theme: Palette): { bg: string; fg: string } {
  if (kind === "exam" || kind === "quiz") {
    return { bg: theme.accentSoft, fg: theme.accent };
  }
  return { bg: theme.surface2, fg: theme.muted };
}

function Chip({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: radius.full,
        backgroundColor: bg,
      }}
    >
      <AppText variant="label" style={{ color: fg, fontSize: 11, lineHeight: 14 }}>
        {text}
      </AppText>
    </View>
  );
}

/* ---------------------------- row pieces ---------------------------- */

function GroupLabel({ label, first }: { label: PlanGroupLabel; first: boolean }) {
  return (
    <AppText
      variant="label"
      muted
      style={{
        textTransform: "uppercase",
        letterSpacing: 1.2,
        marginTop: first ? 4 : 18,
        marginBottom: 10,
      }}
    >
      {label}
    </AppText>
  );
}

function EntryRow({
  entry,
  now,
  onToggle,
}: {
  entry: PlanEntry;
  now: Date;
  onToggle: () => void;
}) {
  const theme = useTheme();
  const overdue = entry.dueAt.getTime() < now.getTime();
  const kindColors = kindChipColors(entry.kind, theme);
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
          <Chip text={entry.courseCode} bg={theme.brandSoft} fg={theme.brandInk} />
          <Chip text={kindLabel(entry.kind)} bg={kindColors.bg} fg={kindColors.fg} />
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

    const enrollRes = await supabase
      .from("enrollments")
      .select("course:courses(id, code)")
      .eq("user_id", userId);
    if (enrollRes.error) throw enrollRes.error;

    const courses = ((enrollRes.data ?? []) as unknown as EnrollmentJoin[])
      .map((row) => row.course)
      .filter((c): c is { id: string; code: string } => c !== null);
    if (courses.length === 0) {
      return { items: [], checkoffs: new Map(), hasCourses: false, loadedAt: now };
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
    return { items, checkoffs, hasCourses: true, loadedAt: now };
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
    () => (data ? computeStreak(data.checkoffs.values(), data.loadedAt) : 0),
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

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ListRow>) => {
      switch (item.type) {
        case "group":
          return <GroupLabel label={item.label} first={index === 0} />;
        case "entry":
          return (
            <View style={{ marginBottom: 8 }}>
              <EntryRow
                entry={item.entry}
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
    [data, toggle]
  );

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
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 5,
                          alignSelf: "flex-start",
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                          borderRadius: radius.full,
                          backgroundColor: theme.accentSoft,
                        }}
                      >
                        <Feather name="zap" size={11} color={theme.accent} />
                        <AppText
                          variant="label"
                          style={{
                            color: theme.accent,
                            fontSize: 11,
                            lineHeight: 14,
                          }}
                        >
                          {streak}-day streak
                        </AppText>
                      </View>
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
              <Card
                style={{
                  alignItems: "center",
                  gap: 6,
                  paddingVertical: 28,
                  borderStyle: "dashed",
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: radius.full,
                    backgroundColor: theme.brandSoft,
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 2,
                  }}
                >
                  <Feather name="calendar" size={18} color={theme.brand} />
                </View>
                <AppText variant="bodySemi">
                  {data?.hasCourses ? "Nothing on your plan yet" : "No courses yet"}
                </AppText>
                <AppText
                  variant="caption"
                  muted
                  style={{ textAlign: "center", maxWidth: 270 }}
                >
                  {data?.hasCourses
                    ? "Import a syllabus from a course home — assignments and exams land here, ready to check off."
                    : "Add your classes first — then import a syllabus and your whole term plans itself."}
                </AppText>
                <Button
                  label={data?.hasCourses ? "Open your courses" : "Add your courses"}
                  variant="soft"
                  size="sm"
                  style={{ marginTop: 6 }}
                  onPress={() =>
                    router.push(data?.hasCourses ? "/courses" : "/courses/add")
                  }
                />
              </Card>
            }
          />
        )}
      </View>
    </View>
  );
}
