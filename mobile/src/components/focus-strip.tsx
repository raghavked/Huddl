import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { Avatar } from "@/components/avatar";
import { AppText, Card } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  fetchMyOpenSession,
  fetchStudyingNow,
  formatDuration,
  remainingMinutes,
  subscribeStudyingNow,
  type FocusSession,
  type StudyingNow,
} from "@/lib/focus";
import { useAuth } from "@/providers/auth-provider";

/* A one-line "you're not the only one up" for any screen that wants it.
   Self-contained: it does its own fetch, its own realtime, and its own
   disappearing act. Drop it in and forget it. */

/** Faces before the cluster gives up and counts the rest. */
const CLUSTER_MAX = 4;
/** Drawn avatar diameter, small enough to sit inside a single row. */
const AVATAR = 28;
/** How far each face tucks behind the one before it. */
const OVERLAP = 9;
/** The ring that separates one overlapping face from the next. */
const RING = 2;

/** How often the countdown on your own session redraws. */
const TICK_MS = 30_000;

/** "Ada Lovelace" → "Ada". Falls back to the whole string if there's no space. */
function firstName(name: string): string {
  const trimmed = name.trim();
  const cut = trimmed.indexOf(" ");
  return cut > 0 ? trimmed.slice(0, cut) : trimmed;
}

/** Your own open session, plus the course code the campus list had for it. */
type MySitting = { session: FocusSession; courseCode: string | null };

export type FocusStripProps = {
  /**
   * Narrow to one course: pass a `courses.id` and the strip only counts
   * people whose open session is tied to that class (sessions with no course
   * are left out). Omit it for the whole campus, which is what a Home or
   * dashboard placement wants.
   */
  courseId?: string | null;
  /**
   * Where tapping the strip goes. Defaults to the focus screen; override only
   * if the host screen wants to keep the student where they are.
   */
  onPress?: () => void;
  /** Layout only. Margins from the host screen, colors from the theme. */
  style?: StyleProp<ViewStyle>;
};

/**
 * "3 studying now", a warm little proof that somebody else is heads-down
 * too, with their faces stacked next to it. Tapping opens `/focus`.
 *
 * **It renders `null` far more often than it renders anything**, and that is
 * the point: no row while it's loading, none if the query fails, and none
 * when nobody is studying and you aren't either. An empty campus should look
 * like nothing happened, not like a broken widget, so the host screen needs
 * no `loading` branch and no empty state of its own. Drop it into a stack
 * with a gap.
 *
 * You are never one of the faces: the cluster is about *other people*, and
 * "1 studying now" over your own photo would be a lonely thing to read. But
 * your own open session is not nothing (it is the one thing on the screen
 * that is still running), so when you're sitting down the strip says so and
 * counts your time left, whether or not anybody else is up. Without that, the
 * student who is the only one studying gets no row at all, and this strip is
 * the only way back to `/focus` from Home.
 *
 * It keeps itself current over realtime (`subscribeStudyingNow`), refetching
 * on every change so the faces stay real rather than nameless: the payloads
 * are bare rows with no profile attached.
 *
 * ```tsx
 * <FocusStrip courseId={course.id} style={{ marginBottom: 12 }} />
 * ```
 */
export function FocusStrip({ courseId, onPress, style }: FocusStripProps) {
  const theme = useTheme();
  const { session } = useAuth();
  const meId = session?.user.id ?? null;

  const [people, setPeople] = useState<StudyingNow[]>([]);
  const [mine, setMine] = useState<MySitting | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    // Two independent truths: who else is up, and whether I'm sitting down.
    // Either can fail on its own without taking the other with it. A strip
    // that can't load is a strip that isn't there, one half at a time.
    const [campus, session] = await Promise.all([
      fetchStudyingNow(courseId ? [courseId] : undefined).catch(
        (): StudyingNow[] => []
      ),
      fetchMyOpenSession().catch((): FocusSession | null => null),
    ]);
    if (!alive.current) return;
    setPeople(campus.filter((row) => row.user_id !== meId));
    // A course-scoped strip only speaks for that class, so a session on some
    // other course stays out of it. The campus list already carries my course
    // code when it has my row; the session alone doesn't.
    const inScope =
      session !== null && (!courseId || session.course_id === courseId);
    setMine(
      session && inScope
        ? {
            session,
            courseCode:
              campus.find((row) => row.user_id === meId)?.course_code ?? null,
          }
        : null
    );
  }, [courseId, meId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime payloads carry no profile, so every change is a refetch.
  useEffect(() => subscribeStudyingNow(() => void load()), [load]);

  /* The countdown only redraws while there is one. Half a minute is as
     precise as "22m left" needs to be, and nothing here animates. */
  const sitting = mine !== null;
  useEffect(() => {
    if (!sitting) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, [sitting]);

  if (people.length === 0 && !mine) return null;

  const left = mine ? remainingMinutes(mine.session, now) : 0;
  // Past the goal the number would sit at "0m left" and stay there, which
  // reads as broken rather than as finished.
  const myLine = mine
    ? left > 0
      ? `${formatDuration(left)} left`
      : "You're past your goal"
    : null;
  const myWhere = mine
    ? (mine.courseCode ?? mine.session.note ?? "Focus session")
    : null;

  const shown = people.slice(0, CLUSTER_MAX);
  const overflow = people.length - shown.length;
  const lead = shown[0];

  /* The mark the row leads with: other people's faces when there are any,
     and otherwise the same-sized tile standing in for my own session. */
  const leadMark =
    people.length === 0 ? (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: AVATAR + RING * 2,
          height: AVATAR + RING * 2,
          borderRadius: radius.full,
          backgroundColor: theme.brandSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name="clock" size={15} color={theme.brand} />
      </View>
    ) : (
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {shown.map((row, index) => (
          <View
            key={row.id}
            style={{
              borderRadius: radius.full,
              borderWidth: RING,
              borderColor: theme.surface,
              backgroundColor: theme.surface,
              marginLeft: index === 0 ? 0 : -OVERLAP,
            }}
          >
            <Avatar
              url={row.person.avatar_url}
              name={row.person.display_name}
              size={AVATAR}
            />
          </View>
        ))}
        {overflow > 0 ? (
          <View
            style={{
              width: AVATAR + RING * 2,
              height: AVATAR + RING * 2,
              borderRadius: radius.full,
              borderWidth: RING,
              borderColor: theme.surface,
              backgroundColor: theme.surface2,
              alignItems: "center",
              justifyContent: "center",
              marginLeft: -OVERLAP,
            }}
          >
            <AppText
              variant="label"
              muted
              style={{ fontSize: 11, lineHeight: 14 }}
            >
              +{overflow}
            </AppText>
          </View>
        ) : null}
      </View>
    );
  const label =
    people.length === 0
      ? (myLine ?? "")
      : people.length === 1 && lead
        ? `${firstName(lead.person.display_name)} is studying right now`
        : `${people.length} studying now`;
  // Under the headline: where I am if I'm sitting, otherwise the crowd's.
  const caption =
    people.length === 0
      ? myWhere
      : mine && myLine
        ? `You're in. ${myLine}`
        : courseId
          ? "In this class"
          : "Around campus";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        people.length === 0 ? "Your focus session" : null,
        label,
        caption,
        "Open focus.",
      ]
        .filter(Boolean)
        .join(", ")}
      onPress={onPress ?? (() => router.push("/focus"))}
      style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }, style]}
    >
      <Card
        padded={false}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 14,
          paddingVertical: 11,
          minHeight: 56,
        }}
      >
        {leadMark}

        <View style={{ flex: 1, gap: 1 }}>
          <AppText variant="bodySemi" numberOfLines={1}>
            {label}
          </AppText>
          {caption ? (
            <AppText variant="caption" muted numberOfLines={1}>
              {caption}
            </AppText>
          ) : null}
        </View>

        <Feather name="chevron-right" size={18} color={theme.muted} />
      </Card>
    </Pressable>
  );
}
