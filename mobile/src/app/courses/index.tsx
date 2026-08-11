import Feather from "@expo/vector-icons/Feather";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Pressable,
  RefreshControl,
  View,
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
  SkeletonRow,
  useReducedMotion,
} from "@/components/ui";
import {
  courseTintsFor,
  motion,
  radius,
  type CourseTintColors,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  archiveCourse,
  CourseArchiveError,
  fetchMyCourses,
  groupByTerm,
  unarchiveCourse,
  type MyCourse,
  type MyCourses,
} from "@/lib/course-archive";
import {
  asCourseTint,
  colorForCourse,
  COURSE_TINT_KEYS,
  COURSE_TINT_LABELS,
  type CourseTint,
} from "@/lib/course-color";
import { tapLight } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";
import { useResolvedScheme } from "@/providers/display-provider";

/* My courses — two shelves.
 *
 * Active classes are the list students actually live in. Shelving moves a
 * finished class off that list without dropping it: the enrollment survives,
 * the chat and notes stay reachable, and it reappears under "Archived" grouped
 * by term. Dropping is the destructive one and still lives here, behind the
 * same menu with a confirm.
 *
 * Reads and writes come from `@/lib/course-archive`; this file draws them. */

const NO_IDS: ReadonlySet<string> = new Set<string>();

const LOAD_FAILED =
  "We couldn't load your classes. Check your connection and give it another go.";
const SHELVE_FAILED =
  "We couldn't shelve that class just now. Give it another go.";
const UNSHELVE_FAILED =
  "We couldn't bring that class back just now. Give it another go.";
const COLOR_FAILED =
  "We couldn't save that colour just now. Give it another go.";

/** Which list the reader was looking at when a write failed, so the apology
    lands next to the row that snapped back rather than off-screen. */
type ActionError = { message: string; shelf: "active" | "archived" };

/** The archive module writes its own warm copy; anything else gets ours. */
function warmMessage(cause: unknown, fallback: string): string {
  return cause instanceof CourseArchiveError ? cause.message : fallback;
}

/** Same ordering the archive module reads with, so an optimistic row lands
    exactly where the next refresh would have put it. */
function byCode(a: MyCourse, b: MyCourse): number {
  return (
    a.code.localeCompare(b.code, undefined, {
      numeric: true,
      sensitivity: "base",
    }) ||
    a.title.localeCompare(b.title) ||
    a.enrollment_id.localeCompare(b.enrollment_id)
  );
}

/**
 * Move one course to the shelf its `archived_at` names, both sides left
 * code-sorted. Pure, and its own inverse — rolling a failed write back is the
 * same call with the value the row had before.
 */
function place(
  shelves: MyCourses,
  course: MyCourse,
  archivedAt: string | null
): MyCourses {
  const id = course.enrollment_id;
  const match = (row: MyCourse) => row.enrollment_id !== id;
  // Prefer the copy already on screen — a refresh may have landed since the
  // menu opened, and that copy is the fresher one.
  const current =
    shelves.active.find((row) => row.enrollment_id === id) ??
    shelves.archived.find((row) => row.enrollment_id === id) ??
    course;
  const moved: MyCourse = { ...current, archived_at: archivedAt };

  const active = shelves.active.filter(match);
  const archived = shelves.archived.filter(match);
  if (archivedAt === null) active.push(moved);
  else archived.push(moved);

  return { active: active.sort(byCode), archived: archived.sort(byCode) };
}

/** Take the timestamp the database actually stored, without moving anything. */
function restamp(
  shelves: MyCourses,
  enrollmentId: string,
  archivedAt: string | null
): MyCourses {
  const stamp = (list: MyCourse[]) =>
    list.map((row) =>
      row.enrollment_id === enrollmentId
        ? { ...row, archived_at: archivedAt }
        : row
    );
  return { active: stamp(shelves.active), archived: stamp(shelves.archived) };
}

/**
 * The two things the enrollment row knows that a {@link MyCourse} doesn't:
 * whether the catalog filled its details in, and which tint the student hung
 * on it. Neither belongs in the archive module — one is a note about where
 * the details came from, the other is a private, per-student pick — so they
 * ride along together in one cheap read.
 */
type EnrollmentMarks = {
  /** Enrollment ids whose details came from the course catalog. */
  catalogIds: ReadonlySet<string>;
  /** Enrollment id → the tint the student chose, when they chose one. */
  colors: ReadonlyMap<string, CourseTint>;
};

const NO_MARKS: EnrollmentMarks = {
  catalogIds: NO_IDS,
  colors: new Map<string, CourseTint>(),
};

/**
 * Read both marks for one student's enrollments. If it fails the catalog
 * notes simply don't draw and every course falls back to its hashed tint —
 * neither is ever worth an error message on top of a list that loaded fine.
 */
async function fetchEnrollmentMarks(userId: string): Promise<EnrollmentMarks> {
  const { data, error } = await supabase
    .from("enrollments")
    .select("id, catalog_course_id, color")
    .eq("user_id", userId);
  if (error || !Array.isArray(data)) return NO_MARKS;

  const catalogIds = new Set<string>();
  const colors = new Map<string, CourseTint>();
  for (const row of data as unknown as {
    id?: unknown;
    catalog_course_id?: unknown;
    color?: unknown;
  }[]) {
    if (typeof row.id !== "string" || row.id.length === 0) continue;
    if (typeof row.catalog_course_id === "string") catalogIds.add(row.id);
    // Anything the palette doesn't recognise is left unset, so the course
    // keeps its hashed tint instead of going grey.
    const picked = asCourseTint(
      typeof row.color === "string" ? row.color : null
    );
    if (picked) colors.set(row.id, picked);
  }
  return { catalogIds, colors };
}

/* --------------------------------- rows --------------------------------- */

/** A class this quarter. Tap the "…" or long-press the row for the menu. */
function CourseRow({
  course,
  tint,
  fromCatalog,
  busy,
  onMenu,
}: {
  course: MyCourse;
  tint: CourseTintColors;
  fromCatalog: boolean;
  busy: boolean;
  onMenu: () => void;
}) {
  const theme = useTheme();
  return (
    // Not accessible itself: long-press is the sighted shortcut, and the "…"
    // button below stays individually reachable for a screen reader.
    <Pressable accessible={false} onLongPress={busy ? undefined : onMenu}>
      <Card
        padded={false}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingLeft: 8,
          paddingRight: 4,
          paddingVertical: 12,
          minHeight: 72,
        }}
      >
        {/* The course's colour, as a spine down the left of the card.
            The ink rather than the wash: a 4px bar in a soft fill would
            disappear against the paper, and the ink clears 6:1 on `surface`.
            A flow child that stretches, not an absolute one — it sits inside
            the card's padding of its own accord, and clipping the Card to
            reach its rounded corner would take the warm shadow with it.
            Decorative: the code is right beside it. */}
        <View
          style={{
            width: 4,
            alignSelf: "stretch",
            borderRadius: radius.full,
            backgroundColor: tint.ink,
          }}
        />
        <View style={{ flex: 1, gap: 3, marginLeft: 2 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <AppText variant="bodySemi" style={{ flexShrink: 1 }}>
              {course.code}
            </AppText>
            {/* Catalog-matched classes get a quiet note; hand-added ones stand
                on their own — every class here counts the same. */}
            {fromCatalog ? (
              <Chip label="From catalog" icon="book" tone="neutral" />
            ) : null}
          </View>
          {course.title ? (
            <AppText variant="caption" muted numberOfLines={1}>
              {course.title}
            </AppText>
          ) : null}
          {course.term ? (
            <AppText variant="caption" muted>
              {course.term}
            </AppText>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Options for ${course.code}`}
          onPress={onMenu}
          disabled={busy}
          hitSlop={4}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          {busy ? (
            <ActivityIndicator size="small" color={theme.muted} />
          ) : (
            <Feather name="more-vertical" size={18} color={theme.muted} />
          )}
        </Pressable>
      </Card>
    </Pressable>
  );
}

/**
 * The one line on this screen that isn't about a single class: the term
 * across all of them. It sits under the intro rather than over the list,
 * because "how is this quarter going" is the question you ask after you've
 * seen what's in it — and it stays a quiet row, since the number on the other
 * side is scratch math from a private gradebook, not a result.
 */
function SemesterLink() {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="This semester"
      onPress={() => router.push("/semester")}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Card
        padded={false}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
          minHeight: 56,
        }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: radius.control,
            backgroundColor: theme.accentSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather name="trending-up" size={15} color={theme.accent} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodySemi">This semester</AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            Every class's estimate, and one number across them.
          </AppText>
        </View>
        <Feather name="chevron-right" size={18} color={theme.muted} />
      </Card>
    </Pressable>
  );
}

/** A shelved class: quieter than the cards above, one hairline between rows. */
function ArchivedRow({
  course,
  last,
  onMenu,
}: {
  course: MyCourse;
  last: boolean;
  onMenu: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable accessible={false} onLongPress={onMenu}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingLeft: 14,
          paddingRight: 4,
          paddingVertical: 8,
          minHeight: 56,
          borderBottomWidth: last ? 0 : 1,
          borderBottomColor: theme.border,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodyMedium" muted numberOfLines={1}>
            {course.code}
          </AppText>
          {course.title ? (
            <AppText variant="caption" muted numberOfLines={1}>
              {course.title}
            </AppText>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Options for ${course.code}, shelved`}
          onPress={onMenu}
          hitSlop={4}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="more-vertical" size={16} color={theme.muted} />
        </Pressable>
      </View>
    </Pressable>
  );
}

/* --------------------------- the colour picker --------------------------- */

/**
 * One tint as a swatch: the wash it paints, ringed in its own ink when it's
 * the colour this course is already wearing, and named underneath — so the
 * six are never told apart by colour alone.
 */
function ColorSwatch({
  tint,
  colors,
  selected,
  onPress,
}: {
  tint: CourseTint;
  colors: CourseTintColors;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const name = COURSE_TINT_LABELS[tint];
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={name}
      onPress={onPress}
      style={({ pressed }) => ({
        width: "33.333%",
        alignItems: "center",
        gap: 6,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.full,
          backgroundColor: colors.soft,
          // The ring is always drawn so the swatches never shift when the
          // pick moves — it just goes quiet on the five that aren't chosen.
          borderWidth: 2,
          borderColor: selected ? colors.ink : theme.border,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected ? (
          <Feather name="check" size={18} color={colors.ink} />
        ) : null}
      </View>
      <AppText
        variant={selected ? "label" : "caption"}
        numberOfLines={1}
        muted={!selected}
        style={selected ? { color: colors.ink } : undefined}
      >
        {name}
      </AppText>
    </Pressable>
  );
}

/* ------------------------------ the shelf ------------------------------- */

/** The collapsed "Archived (5)" row and, once opened, the term groups. */
function ArchivedShelf({
  courses,
  open,
  error,
  onToggle,
  onMenu,
}: {
  courses: MyCourse[];
  open: boolean;
  error: string | null;
  onToggle: () => void;
  onMenu: (course: MyCourse) => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const openness = useRef(new Animated.Value(open ? 1 : 0)).current;

  // The chevron reports the section arriving, and travels back along the same
  // curve when it closes.
  useEffect(() => {
    Animated.timing(openness, {
      toValue: open ? 1 : 0,
      duration: reduceMotion ? motion.instant : motion.base,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, reduceMotion, openness]);

  const groups = useMemo(() => groupByTerm(courses), [courses]);
  const count = courses.length;

  return (
    <View style={{ marginTop: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Archived, ${count} ${
          count === 1 ? "class" : "classes"
        }`}
        accessibilityHint={
          open ? "Hides your shelved classes" : "Shows your shelved classes"
        }
        onPress={onToggle}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 44,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Feather name="archive" size={14} color={theme.muted} />
        <AppText variant="bodyMedium" muted style={{ flex: 1 }}>
          Archived ({count})
        </AppText>
        <Animated.View
          style={{
            transform: [
              {
                rotate: openness.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0deg", "180deg"],
                }),
              },
            ],
          }}
        >
          <Feather name="chevron-down" size={18} color={theme.muted} />
        </Animated.View>
      </Pressable>

      {error ? (
        <AppText
          variant="caption"
          style={{ color: theme.danger, marginTop: 2 }}
        >
          {error}
        </AppText>
      ) : null}

      {open ? (
        <Animated.View
          style={{
            opacity: openness,
            transform: [
              {
                translateY: openness.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-4, 0],
                }),
              },
            ],
          }}
        >
          <AppText variant="caption" muted style={{ marginTop: 4 }}>
            These keep their chats and notes — they're just out of the way.
          </AppText>
          {groups.map((group, index) => (
            <View key={group.term}>
              <SectionLabel text={group.term} first={index === 0} />
              <Card padded={false}>
                {group.courses.map((course, position) => (
                  <ArchivedRow
                    key={course.enrollment_id}
                    course={course}
                    last={position === group.courses.length - 1}
                    onMenu={() => onMenu(course)}
                  />
                ))}
              </Card>
            </View>
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
}

/* ------------------------------- the screen ------------------------------ */

export default function MyCoursesScreen() {
  const theme = useTheme();
  const tints = courseTintsFor(useResolvedScheme());
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const userId = session?.user.id ?? null;

  const [shelves, setShelves] = useState<MyCourses>({
    active: [],
    archived: [],
  });
  const [marks, setMarks] = useState<EnrollmentMarks>(NO_MARKS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MyCourse | null>(null);
  /** Which face the long-press sheet is showing. */
  const [sheetView, setSheetView] = useState<"menu" | "colour">("menu");
  const [shelfOpen, setShelfOpen] = useState(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [mine, enrollmentMarks] = await Promise.all([
        fetchMyCourses(),
        fetchEnrollmentMarks(userId),
      ]);
      setShelves(mine);
      setMarks(enrollmentMarks);
      setError(null);
    } catch (cause) {
      setError(warmMessage(cause, LOAD_FAILED));
    }
  }, [userId]);

  // Refetch on every focus so a fresh add shows up the moment you come back.
  useFocusEffect(
    useCallback(() => {
      if (!userId) {
        // Once the stored session has been read and there still isn't one,
        // stop spinning and say so.
        if (ready) {
          setError("Sign in again to see your classes.");
          setLoading(false);
        }
        return;
      }
      void load().finally(() => setLoading(false));
    }, [userId, ready, load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setActionError(null);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  const drop = useCallback(
    async (course: MyCourse) => {
      if (!userId) return;
      setActionError(null);
      setBusyId(course.enrollment_id);
      try {
        const { error: deleteError } = await supabase
          .from("enrollments")
          .delete()
          .eq("id", course.enrollment_id)
          .eq("user_id", userId);
        if (deleteError) throw deleteError;
        // Leave the course chat too: drop our channel_members row for this
        // course's channel (the enrollment trigger also clears it — this
        // makes the leave explicit and immediate either way).
        const { data: channel } = await supabase
          .from("channels")
          .select("id")
          .eq("course_id", course.course_id)
          .maybeSingle();
        const channelId = (channel as { id: string } | null)?.id;
        if (channelId) {
          await supabase
            .from("channel_members")
            .delete()
            .eq("channel_id", channelId)
            .eq("user_id", userId);
        }
        setShelves((prev) => ({
          active: prev.active.filter(
            (row) => row.enrollment_id !== course.enrollment_id
          ),
          archived: prev.archived.filter(
            (row) => row.enrollment_id !== course.enrollment_id
          ),
        }));
      } catch {
        setActionError({
          message: `We couldn't drop ${course.code}. Give it another try.`,
          shelf: course.archived_at === null ? "active" : "archived",
        });
      } finally {
        setBusyId(null);
      }
    },
    [userId]
  );

  const confirmDrop = useCallback(
    (course: MyCourse) => {
      Alert.alert(
        `Drop ${course.code}?`,
        "You'll leave its chat too — you can add it back anytime.",
        [
          { text: "Keep it", style: "cancel" },
          {
            text: "Drop course",
            style: "destructive",
            onPress: () => void drop(course),
          },
        ]
      );
    },
    [drop]
  );

  // Optimistic both ways: the row moves shelves now, and moves back with an
  // apology if the write doesn't land.
  const shelve = useCallback(async (course: MyCourse) => {
    setActionError(null);
    tapLight();
    setShelves((prev) => place(prev, course, new Date().toISOString()));
    try {
      const archivedAt = await archiveCourse(course.enrollment_id);
      setShelves((prev) => restamp(prev, course.enrollment_id, archivedAt));
    } catch (cause) {
      setShelves((prev) => place(prev, course, course.archived_at));
      setActionError({
        message: warmMessage(cause, SHELVE_FAILED),
        shelf: "active",
      });
    }
  }, []);

  const unshelve = useCallback(async (course: MyCourse) => {
    setActionError(null);
    tapLight();
    setShelves((prev) => place(prev, course, null));
    try {
      await unarchiveCourse(course.enrollment_id);
    } catch (cause) {
      setShelves((prev) => place(prev, course, course.archived_at));
      setActionError({
        message: warmMessage(cause, UNSHELVE_FAILED),
        shelf: "archived",
      });
    }
  }, []);

  /** Move one course's tint in local state; its own inverse, so a failed
      write rolls back with the value the row had before. */
  const paint = useCallback((enrollmentId: string, tint: CourseTint | null) => {
    setMarks((prev) => {
      const colors = new Map(prev.colors);
      if (tint === null) colors.delete(enrollmentId);
      else colors.set(enrollmentId, tint);
      return { catalogIds: prev.catalogIds, colors };
    });
  }, []);

  /**
   * Hang a colour on a course. Optimistic — the spine changes under the
   * sheet as it slides away, and changes back with an apology if the write
   * doesn't land.
   *
   * The colour is private: it goes on the student's own `enrollments` row,
   * scoped by `user_id` as well as `id`, and no classmate ever sees it.
   *
   * BACKEND GAP — READ BEFORE DEBUGGING A COLOUR THAT WON'T STICK.
   * Migration 0029 revoked blanket UPDATE on `enrollments` and granted it
   * back one column at a time; 0032 added `color` without extending that
   * grant. Until it does, every write here fails with a permission error and
   * the swatch snaps back with the apology below — which is the honest
   * behaviour, not a bug in this screen. The fix is one line:
   *
   *   grant update (color) on public.enrollments to authenticated;
   *
   * The row policy from 0029 ("students shelve their own enrollments")
   * already scopes UPDATE to `user_id = auth.uid()`, so nothing else is
   * needed and no classmate's tint becomes writable.
   */
  const recolor = useCallback(
    async (course: MyCourse, next: CourseTint) => {
      if (!userId) return;
      const previous = marks.colors.get(course.enrollment_id) ?? null;
      if (previous === next) return;
      setActionError(null);
      tapLight();
      paint(course.enrollment_id, next);

      const { data, error: writeError } = await supabase
        .from("enrollments")
        .update({ color: next })
        .eq("id", course.enrollment_id)
        .eq("user_id", userId)
        .select("id, color")
        .maybeSingle();
      // No row back means RLS refused the update and PostgREST reported no
      // error — the same silent no-op `@/lib/course-archive` guards against.
      if (writeError || data === null) {
        paint(course.enrollment_id, previous);
        setActionError({
          message: COLOR_FAILED,
          shelf: course.archived_at === null ? "active" : "archived",
        });
      }
    },
    [userId, marks.colors, paint]
  );

  const openMenu = useCallback((course: MyCourse) => {
    setSheetView("menu");
    setMenu(course);
  }, []);
  // The face stays as it was while the sheet slides away — resetting it here
  // would swap the picker back to the menu mid-dismissal. `openMenu` is what
  // puts the next sheet back on its first face.
  const closeMenu = useCallback(() => setMenu(null), []);

  // Hold onto the course while the sheet slides away, so its rows don't swap
  // to the other shelf's menu mid-dismissal.
  const lastMenu = useRef<MyCourse | null>(null);
  if (menu !== null) lastMenu.current = menu;
  const sheetCourse = menu ?? lastMenu.current;

  /** Close the sheet first, then act — the row is about to move under it. */
  const runFromMenu = useCallback(
    (action: (course: MyCourse) => void) => () => {
      const course = menu;
      setMenu(null);
      if (course) action(course);
    },
    [menu]
  );

  /** Close the sheet, then paint — the row is about to change under it. */
  const pickColor = useCallback(
    (tint: CourseTint) => {
      const course = menu;
      setMenu(null);
      if (course) void recolor(course, tint);
    },
    [menu, recolor]
  );

  /** The colours this course wears right now — the student's pick, or the
      tint hashed from its code when they never made one. */
  const tintFor = useCallback(
    (course: MyCourse): CourseTintColors =>
      tints[colorForCourse(marks.colors.get(course.enrollment_id), course.code)],
    [tints, marks.colors]
  );

  const { active, archived } = shelves;
  const hasShelf = archived.length > 0;
  const topError = actionError?.shelf === "active" ? actionError.message : null;
  const shelfError =
    actionError?.shelf === "archived" ? actionError.message : null;

  const intro = (
    <AppText variant="caption" muted>
      All yours to manage — the catalog note just means the details filled
      themselves in.
    </AppText>
  );

  const shelf = hasShelf ? (
    <ArchivedShelf
      courses={archived}
      open={shelfOpen}
      error={shelfError}
      onToggle={() => setShelfOpen((current) => !current)}
      onMenu={openMenu}
    />
  ) : null;

  return (
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
          justifyContent: "space-between",
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add courses"
          onPress={() => router.push("/courses/add")}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="plus" size={24} color={theme.foreground} />
        </Pressable>
      </View>

      <View style={{ flex: 1, paddingHorizontal: 20 }}>
        <AppText variant="display" style={{ marginTop: 2, marginBottom: 16 }}>
          My courses
        </AppText>

        {loading ? (
          <View>
            <View style={{ marginBottom: 12 }}>{intro}</View>
            {[0, 1, 2, 3].map((index) => (
              <SkeletonRow key={index} avatar={false} lines={2} />
            ))}
          </View>
        ) : error && active.length === 0 && archived.length === 0 ? (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              paddingBottom: 80,
            }}
          >
            <Feather name="wifi-off" size={28} color={theme.muted} />
            <AppText variant="bodySemi">Something hiccuped</AppText>
            <AppText
              variant="caption"
              muted
              style={{ textAlign: "center", maxWidth: 260 }}
            >
              {error}
            </AppText>
            {/* Nothing to retry when there's no session — the copy above is
                already the next move. */}
            {userId ? (
              <Button
                label="Try again"
                variant="soft"
                size="sm"
                onPress={() => {
                  setLoading(true);
                  void load().finally(() => setLoading(false));
                }}
              />
            ) : null}
          </View>
        ) : (
          <FlatList
            data={active}
            keyExtractor={(course) => course.enrollment_id}
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingBottom: insets.bottom + 32,
              flexGrow: 1,
            }}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View>
                {/* With classes on the list the semester row below brings its
                    own air; with none, the empty state needs it here. */}
                <View
                  style={{ gap: 6, marginBottom: active.length > 0 ? 0 : 12 }}
                >
                  {intro}
                  {error ? (
                    <AppText variant="caption" style={{ color: theme.danger }}>
                      We couldn't refresh just now — pull down to try again.
                    </AppText>
                  ) : null}
                  {topError ? (
                    <AppText variant="caption" style={{ color: theme.danger }}>
                      {topError}
                    </AppText>
                  ) : null}
                </View>
                {/* Only worth offering once there's a class to average — the
                    term overview of nothing is just its own empty state. */}
                {active.length > 0 ? (
                  <View
                    style={{
                      marginTop: 12,
                      marginBottom: hasShelf ? 0 : 12,
                    }}
                  >
                    <SemesterLink />
                  </View>
                ) : null}
                {hasShelf && active.length > 0 ? (
                  <SectionLabel text="This quarter" />
                ) : null}
              </View>
            }
            ListEmptyComponent={
              <EmptyState
                icon="book-open"
                title={
                  hasShelf ? "Nothing on this quarter's list" : "No courses yet"
                }
                body={
                  hasShelf
                    ? "Your shelved classes are still down below. Add this quarter's whenever you're ready."
                    : "Add your classes and each one comes with a chat full of your classmates."
                }
                action={{
                  label: "Add your courses",
                  onPress: () => router.push("/courses/add"),
                }}
              />
            }
            ListFooterComponent={shelf}
            renderItem={({ item }) => (
              <View style={{ marginBottom: 10 }}>
                <CourseRow
                  course={item}
                  tint={tintFor(item)}
                  fromCatalog={marks.catalogIds.has(item.enrollment_id)}
                  busy={busyId === item.enrollment_id}
                  onMenu={() => openMenu(item)}
                />
              </View>
            )}
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

      {/* One sheet, two faces. The picker swaps in behind the same card
          rather than opening a second Modal on top of this one — stacked
          native modals fight each other on the way in and out, and the
          colour a course wears is a follow-up to the menu, not a new
          decision somewhere else. */}
      <Sheet
        visible={menu !== null}
        onClose={closeMenu}
        title={
          sheetView === "colour"
            ? `Colour for ${sheetCourse?.code ?? "this course"}`
            : sheetCourse?.code ?? "Course"
        }
      >
        {sheetView === "colour" && sheetCourse !== null ? (
          <View style={{ gap: 12, paddingTop: 4 }}>
            <View
              accessibilityRole="radiogroup"
              style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 14 }}
            >
              {COURSE_TINT_KEYS.map((key) => (
                <ColorSwatch
                  key={key}
                  tint={key}
                  colors={tints[key]}
                  selected={
                    key ===
                    colorForCourse(
                      marks.colors.get(sheetCourse.enrollment_id),
                      sheetCourse.code
                    )
                  }
                  onPress={() => pickColor(key)}
                />
              ))}
            </View>
            <AppText variant="caption" muted>
              Colours are yours — your classmates each pick their own.
            </AppText>
          </View>
        ) : sheetCourse !== null && sheetCourse.archived_at === null ? (
          <>
            <Sheet.Row
              icon="droplet"
              label="Change colour"
              onPress={() => setSheetView("colour")}
            />
            <Sheet.Row
              icon="archive"
              label="Archive course"
              onPress={runFromMenu((course) => void shelve(course))}
            />
            <AppText
              variant="caption"
              muted
              style={{ marginLeft: 46, marginBottom: 6 }}
            >
              Its chat and notes stay put — it just moves off this list.
            </AppText>
            <Sheet.Row
              icon="trash-2"
              label="Drop course"
              danger
              onPress={runFromMenu(confirmDrop)}
            />
          </>
        ) : (
          <Sheet.Row
            icon="rotate-ccw"
            label="Bring it back"
            onPress={runFromMenu((course) => void unshelve(course))}
          />
        )}
      </Sheet>
    </View>
  );
}
