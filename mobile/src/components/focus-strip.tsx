import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { Avatar } from "@/components/avatar";
import { AppText, Card } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  fetchStudyingNow,
  subscribeStudyingNow,
  type StudyingNow,
} from "@/lib/focus";
import { useAuth } from "@/providers/auth-provider";

/* A one-line "you're not the only one up" for any screen that wants it.
   Self-contained: it does its own fetch, its own realtime, and its own
   disappearing act. Drop it in and forget it. */

/** Faces before the cluster gives up and counts the rest. */
const CLUSTER_MAX = 4;
/** Drawn avatar diameter — small enough to sit inside a single row. */
const AVATAR = 28;
/** How far each face tucks behind the one before it. */
const OVERLAP = 9;
/** The ring that separates one overlapping face from the next. */
const RING = 2;

/** "Ada Lovelace" → "Ada". Falls back to the whole string if there's no space. */
function firstName(name: string): string {
  const trimmed = name.trim();
  const cut = trimmed.indexOf(" ");
  return cut > 0 ? trimmed.slice(0, cut) : trimmed;
}

export type FocusStripProps = {
  /**
   * Narrow to one course — pass a `courses.id` and the strip only counts
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
  /** Layout only — margins from the host screen. Colors come from the theme. */
  style?: StyleProp<ViewStyle>;
};

/**
 * "3 studying now" — a warm little proof that somebody else is heads-down
 * too, with their faces stacked next to it. Tapping opens `/focus`.
 *
 * **It renders `null` far more often than it renders anything**, and that is
 * the point: no row while it's loading, none if the query fails, and none
 * when nobody is studying. An empty campus should look like nothing happened,
 * not like a broken widget, so the host screen needs no `loading` branch and
 * no empty state of its own — just drop it into a stack with a gap.
 *
 * The signed-in student is always filtered out. The strip is about *other
 * people*: if you're the only one sitting down, your own timer on `/focus` is
 * already telling you that, and "1 studying now" showing your own face would
 * be a lonely thing to read.
 *
 * It keeps itself current over realtime (`subscribeStudyingNow`), refetching
 * on every change so the faces stay real rather than nameless — the payloads
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

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const rows = await fetchStudyingNow(
        courseId ? [courseId] : undefined
      );
      if (!alive.current) return;
      setPeople(rows.filter((row) => row.user_id !== meId));
    } catch {
      // A strip that can't load is a strip that isn't there. Nothing to say.
      if (alive.current) setPeople([]);
    }
  }, [courseId, meId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime payloads carry no profile, so every change is a refetch.
  useEffect(() => subscribeStudyingNow(() => void load()), [load]);

  if (people.length === 0) return null;

  const shown = people.slice(0, CLUSTER_MAX);
  const overflow = people.length - shown.length;
  const lead = shown[0];
  const label =
    people.length === 1 && lead
      ? `${firstName(lead.person.display_name)} is studying right now`
      : `${people.length} studying now`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Open focus.`}
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

        <View style={{ flex: 1, gap: 1 }}>
          <AppText variant="bodySemi" numberOfLines={1}>
            {label}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {courseId ? "In this class" : "Around campus"}
          </AppText>
        </View>

        <Feather name="chevron-right" size={18} color={theme.muted} />
      </Card>
    </Pressable>
  );
}
