import Feather from "@expo/vector-icons/Feather";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Minimal local row shapes — the web app's types live outside this tsconfig. */

type EnrollmentSource = "canvas" | "schedule_image" | "manual";

type CourseJoin = {
  id: string;
  code: string;
  title: string;
  term: { name: string } | null;
};

type RawEnrollment = {
  id: string;
  source: EnrollmentSource;
  catalog_course_id: string | null;
  course: CourseJoin | null;
};

type EnrollmentRow = RawEnrollment & { course: CourseJoin };

/** Catalog-matched and Canvas-synced enrollments earn the verified check. */
function pillFor(enrollment: EnrollmentRow): {
  verified: boolean;
  label: string;
} {
  if (enrollment.catalog_course_id !== null) {
    return { verified: true, label: "Catalog verified" };
  }
  if (enrollment.source === "canvas") {
    return { verified: true, label: "Canvas synced" };
  }
  return { verified: false, label: "Unverified" };
}

function SourcePill({ verified, label }: { verified: boolean; label: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: radius.full,
        backgroundColor: verified ? theme.accentSoft : theme.surface2,
        alignSelf: "flex-start",
      }}
    >
      {verified ? (
        <Feather name="check-circle" size={11} color={theme.accent} />
      ) : null}
      <AppText
        variant="label"
        style={{
          color: verified ? theme.accent : theme.muted,
          fontSize: 11,
          lineHeight: 14,
        }}
      >
        {label}
      </AppText>
    </View>
  );
}

function CourseRow({
  enrollment,
  dropping,
  onOverflow,
}: {
  enrollment: EnrollmentRow;
  dropping: boolean;
  onOverflow: () => void;
}) {
  const theme = useTheme();
  const pill = pillFor(enrollment);
  const { course } = enrollment;
  return (
    <Card
      padded={false}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingLeft: 14,
        paddingRight: 4,
        paddingVertical: 12,
        minHeight: 72,
      }}
    >
      <View style={{ flex: 1, gap: 3 }}>
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
          <SourcePill verified={pill.verified} label={pill.label} />
        </View>
        <AppText variant="caption" muted numberOfLines={1}>
          {course.title}
        </AppText>
        {course.term ? (
          <AppText variant="caption" muted>
            {course.term.name}
          </AppText>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Options for ${course.code}`}
        onPress={onOverflow}
        disabled={dropping}
        hitSlop={4}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        {dropping ? (
          <ActivityIndicator size="small" color={theme.muted} />
        ) : (
          <Feather name="more-vertical" size={18} color={theme.muted} />
        )}
      </Pressable>
    </Card>
  );
}

export default function MyCoursesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [rows, setRows] = useState<EnrollmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [droppingId, setDroppingId] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error: queryError } = await supabase
      .from("enrollments")
      .select(
        "id, source, catalog_course_id, course:courses(id, code, title, term:terms(name))"
      )
      .eq("user_id", userId);
    if (queryError) {
      setError("We couldn't load your courses.");
      return;
    }
    const cleaned = ((data ?? []) as unknown as RawEnrollment[])
      .filter((row): row is EnrollmentRow => row.course !== null)
      .sort((a, b) => a.course.code.localeCompare(b.course.code));
    setError(null);
    setRows(cleaned);
  }, [userId]);

  // Refetch on every focus so a fresh add shows up the moment you come back.
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      void load().finally(() => setLoading(false));
    }, [userId, load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setDropError(null);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  const drop = useCallback(
    async (enrollment: EnrollmentRow) => {
      if (!userId) return;
      setDropError(null);
      setDroppingId(enrollment.id);
      try {
        const { error: deleteError } = await supabase
          .from("enrollments")
          .delete()
          .eq("id", enrollment.id)
          .eq("user_id", userId);
        if (deleteError) throw deleteError;
        // Leave the course chat too: drop our channel_members row for this
        // course's channel (the enrollment trigger also clears it — this
        // makes the leave explicit and immediate either way).
        const { data: channel } = await supabase
          .from("channels")
          .select("id")
          .eq("course_id", enrollment.course.id)
          .maybeSingle();
        const channelId = (channel as { id: string } | null)?.id;
        if (channelId) {
          await supabase
            .from("channel_members")
            .delete()
            .eq("channel_id", channelId)
            .eq("user_id", userId);
        }
        setRows((prev) => prev.filter((row) => row.id !== enrollment.id));
      } catch {
        setDropError(
          `We couldn't drop ${enrollment.course.code}. Give it another try.`
        );
      } finally {
        setDroppingId(null);
      }
    },
    [userId]
  );

  const confirmDrop = useCallback(
    (enrollment: EnrollmentRow) => {
      Alert.alert(
        `Drop ${enrollment.course.code}?`,
        "You'll leave its chat too — you can add it back anytime.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Drop course",
            style: "destructive",
            onPress: () => void drop(enrollment),
          },
        ]
      );
    },
    [drop]
  );

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
              Rounding up your classes…
            </AppText>
          </View>
        ) : error && rows.length === 0 ? (
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
              {error} Check your connection and give it another go.
            </AppText>
            <Button
              label="Try again"
              variant="soft"
              size="sm"
              onPress={() => {
                setLoading(true);
                void load().finally(() => setLoading(false));
              }}
            />
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(row) => row.id}
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingBottom: insets.bottom + 32,
              flexGrow: 1,
            }}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View style={{ gap: 6, marginBottom: 12 }}>
                <AppText variant="caption" muted>
                  Courses with the check were matched to your campus catalog or
                  synced from Canvas.
                </AppText>
                {error ? (
                  <AppText variant="caption" style={{ color: theme.danger }}>
                    We couldn't refresh just now — pull down to try again.
                  </AppText>
                ) : null}
                {dropError ? (
                  <AppText variant="caption" style={{ color: theme.danger }}>
                    {dropError}
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
                  <Feather name="book-open" size={18} color={theme.brand} />
                </View>
                <AppText variant="bodySemi">No courses yet</AppText>
                <AppText
                  variant="caption"
                  muted
                  style={{ textAlign: "center", maxWidth: 260 }}
                >
                  Add your classes and each one comes with a chat full of your
                  classmates.
                </AppText>
                <Button
                  label="Add your courses"
                  variant="soft"
                  size="sm"
                  style={{ marginTop: 6 }}
                  onPress={() => router.push("/courses/add")}
                />
              </Card>
            }
            renderItem={({ item }) => (
              <View style={{ marginBottom: 10 }}>
                <CourseRow
                  enrollment={item}
                  dropping={droppingId === item.id}
                  onOverflow={() => confirmDrop(item)}
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
    </View>
  );
}
