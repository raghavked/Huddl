import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SectionList,
  View,
  type SectionListData,
  type SectionListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card, Field } from "@/components/ui";
import { radius, type Palette } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { tapLight, tapSuccess } from "@/lib/haptics";
import { CALENDAR_KINDS, kindLabel, type CalendarKind } from "@/lib/syllabus";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Minimal local row shape for course_calendar_items. */
type CalendarItemRow = {
  id: string;
  course_id: string;
  created_by: string | null;
  kind: CalendarKind;
  title: string;
  due_at: string;
  source: "manual" | "syllabus";
};

type Section = { key: string; title: string; data: CalendarItemRow[] };

type Status = "loading" | "error" | "ready";

const ITEM_SELECT = "id, course_id, created_by, kind, title, due_at, source";

/** Quiet chip palette: exams glow ember-clay, quizzes/projects lean sage,
    the rest stay neutral. Mirrored in course/syllabus.tsx. */
function kindColors(kind: CalendarKind, theme: Palette): { bg: string; fg: string } {
  switch (kind) {
    case "exam":
      return { bg: theme.brandSoft, fg: theme.brandInk };
    case "quiz":
    case "project":
      return { bg: theme.accentSoft, fg: theme.accent };
    default:
      return { bg: theme.surface2, fg: theme.muted };
  }
}

function KindChip({ kind }: { kind: CalendarKind }) {
  const theme = useTheme();
  const colors = kindColors(kind, theme);
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: radius.full,
        backgroundColor: colors.bg,
        alignSelf: "flex-start",
      }}
    >
      <AppText variant="label" style={{ color: colors.fg, fontSize: 11, lineHeight: 14 }}>
        {kindLabel(kind)}
      </AppText>
    </View>
  );
}

/** "Fri, Oct 14" */
function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "today", "tomorrow", "in 6 days", "3 weeks ago" — calendar-day distance. */
function relativeDay(iso: string): string {
  const now = new Date();
  const target = new Date(iso);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startTarget = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate()
  );
  const diff = Math.round(
    (startTarget.getTime() - startToday.getTime()) / 86_400_000
  );
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 1 && diff < 15) return `in ${diff} days`;
  if (diff >= 15) return `in ${Math.round(diff / 7)} weeks`;
  if (diff > -15) return `${-diff} days ago`;
  return `${Math.round(-diff / 7)} weeks ago`;
}

/** A due time only shows when someone set one — 11:59 PM is the quiet default. */
function timeSuffix(iso: string): string {
  const d = new Date(iso);
  if (d.getHours() === 23 && d.getMinutes() === 59) return "";
  return ` · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** Group date-sorted items into month sections ("October 2026"). */
function groupByMonth(items: CalendarItemRow[]): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const item of items) {
    const d = new Date(item.due_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (current === null || current.key !== key) {
      current = {
        key,
        title: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
        data: [],
      };
      sections.push(current);
    }
    current.data.push(item);
  }
  return sections;
}

function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

export default function ClassCalendarScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { courseId, courseCode } = useLocalSearchParams<{
    courseId?: string;
    courseCode?: string;
  }>();

  const [status, setStatus] = useState<Status>("loading");
  const [items, setItems] = useState<CalendarItemRow[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // The inline "Add a date" form — no datepicker dependency, just honest text.
  const [formOpen, setFormOpen] = useState(false);
  const [formKind, setFormKind] = useState<CalendarKind>("assignment");
  const [formTitle, setFormTitle] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formTime, setFormTime] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formPending, setFormPending] = useState(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else if (courseId) {
      router.replace({ pathname: "/course/[id]", params: { id: courseId } });
    } else router.replace("/(tabs)/home");
  }, [router, courseId]);

  const load = useCallback(async () => {
    if (!userId || !courseId) {
      setStatus("error");
      return;
    }
    const { data, error } = await supabase
      .from("course_calendar_items")
      .select(ITEM_SELECT)
      .eq("course_id", courseId)
      .order("due_at", { ascending: true });
    if (error) {
      setStatus("error");
      return;
    }
    const rows = (data ?? []) as unknown as CalendarItemRow[];
    setItems(rows);
    // Your own check-offs — private, one query, keyed by item.
    if (rows.length > 0) {
      const { data: checks } = await supabase
        .from("study_checkoffs")
        .select("item_id")
        .eq("user_id", userId)
        .in(
          "item_id",
          rows.map((row) => row.id)
        );
      setChecked(
        new Set(
          ((checks ?? []) as { item_id: string }[]).map((row) => row.item_id)
        )
      );
    } else {
      setChecked(new Set());
    }
    setStatus("ready");
  }, [userId, courseId]);

  // Reload on every focus, so a fresh syllabus import shows up on return.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setActionError(null);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  /* --------------------------- check-offs ---------------------------- */

  const toggleCheck = useCallback(
    async (item: CalendarItemRow) => {
      if (!userId) return;
      const wasChecked = checked.has(item.id);
      setActionError(null);
      // Optimistic: the circle flips now, the row syncs behind it.
      setChecked((prev) => {
        const next = new Set(prev);
        if (wasChecked) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      if (wasChecked) tapLight();
      else tapSuccess();
      const { error } = wasChecked
        ? await supabase
            .from("study_checkoffs")
            .delete()
            .eq("user_id", userId)
            .eq("item_id", item.id)
        : await supabase
            .from("study_checkoffs")
            .upsert(
              { user_id: userId, item_id: item.id },
              { onConflict: "user_id,item_id", ignoreDuplicates: true }
            );
      if (error) {
        // Roll the circle back and say so, warmly.
        setChecked((prev) => {
          const next = new Set(prev);
          if (wasChecked) next.add(item.id);
          else next.delete(item.id);
          return next;
        });
        setActionError("That check-off didn't save — give it another tap.");
      }
    },
    [userId, checked]
  );

  /* ------------------------ creator delete --------------------------- */

  const deleteItem = useCallback(
    async (item: CalendarItemRow) => {
      setActionError(null);
      const before = items;
      setItems((prev) => prev.filter((row) => row.id !== item.id));
      const { error } = await supabase
        .from("course_calendar_items")
        .delete()
        .eq("id", item.id);
      if (error) {
        setItems(before);
        setActionError("We couldn't remove that date. Give it another try.");
      }
    },
    [items]
  );

  const confirmDelete = useCallback(
    (item: CalendarItemRow) => {
      if (item.created_by !== userId) return; // only your own items
      Alert.alert(
        `Remove “${item.title}”?`,
        "It comes off the calendar for the whole class.",
        [
          { text: "Keep it", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => void deleteItem(item),
          },
        ]
      );
    },
    [userId, deleteItem]
  );

  /* --------------------------- add a date ---------------------------- */

  const resetForm = useCallback(() => {
    setFormOpen(false);
    setFormKind("assignment");
    setFormTitle("");
    setFormDate("");
    setFormTime("");
    setFormError(null);
  }, []);

  const handleAdd = useCallback(async () => {
    if (!userId || !courseId || formPending) return;
    const title = formTitle.trim();
    if (title === "") {
      setFormError("Give it a title — “Midterm 2”, “HW 4”, that kind of thing.");
      return;
    }
    const dateMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(formDate.trim());
    if (!dateMatch) {
      setFormError("Dates look like YYYY-MM-DD — try 2026-10-14.");
      return;
    }
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(month, year)) {
      setFormError("That day doesn't exist — double-check the month and day.");
      return;
    }
    let hours = 23;
    let minutes = 59;
    const time = formTime.trim();
    if (time !== "") {
      const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time);
      const h = timeMatch ? Number(timeMatch[1]) : NaN;
      const m = timeMatch ? Number(timeMatch[2]) : NaN;
      if (!timeMatch || h > 23 || m > 59) {
        setFormError("Times look like HH:MM — try 14:30, or leave it blank.");
        return;
      }
      hours = h;
      minutes = m;
    }
    setFormError(null);
    setFormPending(true);
    const dueAt = new Date(year, month - 1, day, hours, minutes, 0, 0);
    const { data, error } = await supabase
      .from("course_calendar_items")
      .insert({
        course_id: courseId,
        created_by: userId,
        kind: formKind,
        title,
        due_at: dueAt.toISOString(),
        source: "manual",
      })
      .select(ITEM_SELECT)
      .single();
    setFormPending(false);
    if (error || !data) {
      setFormError(
        "We couldn't add that date — check you're still in this course and try again."
      );
      return;
    }
    const row = data as unknown as CalendarItemRow;
    setItems((prev) =>
      [...prev, row].sort(
        (a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
      )
    );
    resetForm();
  }, [userId, courseId, formPending, formTitle, formDate, formTime, formKind, resetForm]);

  const openSyllabus = useCallback(() => {
    if (!courseId) return;
    router.push({
      pathname: "/course/syllabus",
      params: courseCode ? { courseId, courseCode } : { courseId },
    });
  }, [router, courseId, courseCode]);

  /* ------------------------------ rows -------------------------------- */

  const renderItem = ({
    item,
  }: SectionListRenderItemInfo<CalendarItemRow, Section>) => {
    const done = checked.has(item.id);
    const mine = item.created_by === userId;
    return (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={`${done ? "Mark not done" : "Mark done"} — ${
          item.title
        }, ${shortDay(item.due_at)}${mine ? ". Long press to remove" : ""}`}
        onPress={() => void toggleCheck(item)}
        onLongPress={mine ? () => confirmDelete(item) : undefined}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <Card
          padded={false}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            padding: 12,
            minHeight: 64,
            marginBottom: 10,
          }}
        >
          <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <KindChip kind={item.kind} />
              <AppText
                variant="bodySemi"
                numberOfLines={1}
                style={{
                  flexShrink: 1,
                  ...(done
                    ? { color: theme.muted, textDecorationLine: "line-through" }
                    : null),
                }}
              >
                {item.title}
              </AppText>
            </View>
            <AppText variant="caption" muted numberOfLines={1}>
              {shortDay(item.due_at)} · {relativeDay(item.due_at)}
              {timeSuffix(item.due_at)}
            </AppText>
          </View>
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: radius.full,
              borderWidth: done ? 0 : 2,
              borderColor: theme.border,
              backgroundColor: done ? theme.success : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {done ? (
              <Feather name="check" size={16} color={theme.onSolid} />
            ) : null}
          </View>
        </Card>
      </Pressable>
    );
  };

  const renderSectionHeader = ({
    section,
  }: {
    section: SectionListData<CalendarItemRow, Section>;
  }) => (
    <AppText variant="title" style={{ marginTop: 6, marginBottom: 10 }}>
      {section.title}
    </AppText>
  );

  const addForm = formOpen ? (
    <Card style={{ gap: 12, marginBottom: 14 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <AppText variant="title">Add a date</AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close the add form"
          onPress={resetForm}
          disabled={formPending}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            marginRight: -12,
            marginVertical: -12,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="x" size={18} color={theme.muted} />
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {CALENDAR_KINDS.map((kind) => {
          const selected = kind === formKind;
          const colors = kindColors(kind, theme);
          return (
            <Pressable
              key={kind}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Kind: ${kindLabel(kind)}`}
              onPress={() => setFormKind(kind)}
              hitSlop={6}
              style={({ pressed }) => ({
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: radius.full,
                backgroundColor: selected ? colors.bg : theme.surface,
                borderWidth: 1,
                borderColor: selected ? colors.fg : theme.border,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <AppText
                variant="label"
                style={{ color: selected ? colors.fg : theme.muted, fontSize: 12 }}
              >
                {kindLabel(kind)}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      <Field
        label="Title"
        value={formTitle}
        onChangeText={setFormTitle}
        placeholder="Midterm 2"
        maxLength={200}
        editable={!formPending}
      />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Field
            label="Date"
            value={formDate}
            onChangeText={setFormDate}
            placeholder="2026-10-14"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            editable={!formPending}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Time (optional)"
            value={formTime}
            onChangeText={setFormTime}
            placeholder="14:30"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            editable={!formPending}
          />
        </View>
      </View>
      {formError ? (
        <AppText variant="caption" style={{ color: theme.danger }}>
          {formError}
        </AppText>
      ) : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Button
          label="Cancel"
          variant="ghost"
          size="sm"
          disabled={formPending}
          onPress={resetForm}
        />
        <Button
          label="Add to the calendar"
          size="sm"
          pending={formPending}
          icon={<Feather name="calendar" size={14} color={theme.brandFg} />}
          onPress={() => void handleAdd()}
        />
      </View>
    </Card>
  ) : (
    <Button
      label="Add a date"
      variant="secondary"
      icon={<Feather name="plus" size={16} color={theme.foreground} />}
      onPress={() => setFormOpen(true)}
      style={{ marginBottom: 14 }}
    />
  );

  const listHeader = (
    <View>
      {addForm}
      {actionError ? (
        <AppText
          variant="caption"
          style={{ color: theme.danger, marginBottom: 10 }}
        >
          {actionError}
        </AppText>
      ) : null}
    </View>
  );

  const emptyState = (
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
      <AppText variant="bodySemi">Nothing on the calendar yet</AppText>
      <AppText
        variant="caption"
        muted
        style={{ textAlign: "center", maxWidth: 260 }}
      >
        Paste the syllabus once and every classmate gets the whole schedule.
      </AppText>
      <Button
        label="Import syllabus"
        variant="soft"
        size="sm"
        style={{ marginTop: 6 }}
        onPress={openSyllabus}
      />
    </Card>
  );

  /* ------------------------------ screen ------------------------------ */

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ flex: 1, paddingTop: insets.top + 8 }}>
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
          <Button
            label="Import syllabus"
            variant="soft"
            size="sm"
            icon={<Feather name="file-plus" size={14} color={theme.brandInk} />}
            onPress={openSyllabus}
          />
        </View>

        <View style={{ flex: 1, paddingHorizontal: 20 }}>
          <AppText variant="display" style={{ marginTop: 2 }}>
            Class calendar
          </AppText>
          <AppText variant="caption" muted style={{ marginTop: 6, marginBottom: 14 }}>
            {courseCode ? `${courseCode} · shared` : "Shared"} with everyone in
            the class — check off what you've handled.
          </AppText>

          {status === "loading" ? (
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
                Fetching the schedule…
              </AppText>
            </View>
          ) : status === "error" ? (
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
                We couldn't load the calendar. Check your connection and give
                it another go.
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
            </View>
          ) : (
            <SectionList<CalendarItemRow, Section>
              sections={groupByMonth(items)}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              renderSectionHeader={renderSectionHeader}
              stickySectionHeadersEnabled={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingBottom: insets.bottom + 32,
                flexGrow: 1,
              }}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={theme.brand}
                  colors={[theme.brand]}
                />
              }
              ListHeaderComponent={listHeader}
              ListEmptyComponent={emptyState}
            />
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
