import Feather from "@expo/vector-icons/Feather";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card, Field } from "@/components/ui";
import { fonts, radius, space, type Palette } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  CALENDAR_KINDS,
  kindLabel,
  listSyllabusImports,
  parseSyllabus,
  toCalendarRows,
  type CalendarKind,
  type ParsedItem,
} from "@/lib/syllabus";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* A parsed row the student can still shape before it ships to the class. */
type EditableRow = {
  key: string;
  kind: CalendarKind;
  title: string;
  dueAt: Date;
  confidence: "high" | "low";
};

/** Quiet chip palette: exams glow ember-clay, quizzes/projects lean sage,
    the rest stay neutral. Mirrored in course/calendar.tsx. */
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

function KindChip({
  kind,
  onPress,
}: {
  kind: CalendarKind;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const colors = kindColors(kind, theme);
  const chip = (
    <View
      style={{
        paddingHorizontal: space.room,
        paddingVertical: space.tight,
        borderRadius: radius.full,
        backgroundColor: colors.bg,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      <AppText variant="label" style={{ color: colors.fg, fontSize: 11, lineHeight: 14 }}>
        {kindLabel(kind)}
      </AppText>
    </View>
  );
  if (!onPress) return chip;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Kind: ${kindLabel(kind)}. Tap to change`}
      onPress={onPress}
      hitSlop={12}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {chip}
    </Pressable>
  );
}

function shortDay(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function SyllabusImportScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { courseId, courseCode } = useLocalSearchParams<{
    courseId?: string;
    courseCode?: string;
  }>();

  const [text, setText] = useState("");
  const [rows, setRows] = useState<EditableRow[] | null>(null); // null = not parsed yet
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);
  // Whether a classmate already pasted a syllabus here. Worth saying before
  // the paste, never worth blocking it: endorsements sort out which version
  // the class sees.
  const [hasExistingImport, setHasExistingImport] = useState(false);

  useEffect(() => {
    if (!courseId) return;
    let cancelled = false;
    listSyllabusImports(courseId)
      .then((imports) => {
        if (!cancelled) setHasExistingImport(imports.length > 0);
      })
      .catch(() => {
        // The note is a courtesy; a hiccup here shouldn't touch the paste.
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else if (courseId) {
      router.replace({ pathname: "/course/[id]", params: { id: courseId } });
    } else router.replace("/(tabs)/home");
  }, [router, courseId]);

  // Warm confirmation lingers a beat, then the calendar is one step back.
  useEffect(() => {
    if (doneCount === null) return;
    const timer = setTimeout(goBack, 1600);
    return () => clearTimeout(timer);
  }, [doneCount, goBack]);

  const handleParse = useCallback(() => {
    setAddError(null);
    const items: ParsedItem[] = parseSyllabus(text, {
      defaultYear: new Date().getFullYear(),
    });
    // Preview reads like the calendar will: soonest first.
    items.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    setRows(
      items.map((item, i) => ({
        key: `row-${i}-${item.dueAt.getTime()}`,
        kind: item.kind,
        title: item.title,
        dueAt: item.dueAt,
        confidence: item.confidence,
      }))
    );
  }, [text]);

  const cycleKind = useCallback((key: string) => {
    setRows((prev) =>
      prev === null
        ? prev
        : prev.map((row) => {
            if (row.key !== key) return row;
            const next =
              CALENDAR_KINDS[
                (CALENDAR_KINDS.indexOf(row.kind) + 1) % CALENDAR_KINDS.length
              ] ?? "other";
            return { ...row, kind: next };
          })
    );
  }, []);

  const retitle = useCallback((key: string, title: string) => {
    setRows((prev) =>
      prev === null
        ? prev
        : prev.map((row) => (row.key === key ? { ...row, title } : row))
    );
  }, []);

  const removeRow = useCallback((key: string) => {
    setRows((prev) =>
      prev === null ? prev : prev.filter((row) => row.key !== key)
    );
  }, []);

  const handleAdd = useCallback(async () => {
    if (!userId || !courseId || rows === null || rows.length === 0) return;
    if (rows.some((row) => row.title.trim() === "")) {
      setAddError("Every date needs a title. Fill in the blank ones first.");
      return;
    }
    setAdding(true);
    setAddError(null);
    // The import row goes in FIRST so its id can stamp every date: that is
    // how the calendar knows which version each item belongs to, and the
    // self-endorse trigger counts the paste as your own confirmation.
    const { data: importRow, error: importError } = await supabase
      .from("syllabus_imports")
      .insert({
        course_id: courseId,
        user_id: userId,
        item_count: rows.length,
      })
      .select("id")
      .single();
    const importId =
      importRow && typeof importRow.id === "string" ? importRow.id : null;
    if (importError || importId === null) {
      setAdding(false);
      setAddError(
        "We couldn't add those dates. Check you're still in this course and give it another try."
      );
      return;
    }
    // RLS wants created_by to be the caller, so stamp it onto each row,
    // along with the import the row belongs to.
    const inserts = toCalendarRows(
      rows.map((row) => ({
        kind: row.kind,
        title: row.title.trim(),
        dueAt: row.dueAt,
        confidence: row.confidence,
      })),
      courseId
    ).map((row) => ({ ...row, created_by: userId, import_id: importId }));
    const { error } = await supabase
      .from("course_calendar_items")
      .insert(inserts);
    if (error) {
      // No dates means no import: take the bookkeeping row back out so an
      // empty version can never sit on the class's ballot.
      await supabase.from("syllabus_imports").delete().eq("id", importId);
      setAdding(false);
      setAddError(
        "We couldn't add those dates. Check you're still in this course and give it another try."
      );
      return;
    }
    setAdding(false);
    setDoneCount(inserts.length);
  }, [userId, courseId, rows]);

  /* ------------------------------ render ------------------------------ */

  if (!courseId) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + space.close,
          alignItems: "center",
          justifyContent: "center",
          gap: space.room,
          padding: space.rest,
        }}
      >
        <AppText variant="title">Course not available</AppText>
        <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
          We lost track of which course this syllabus belongs to.
        </AppText>
        <Button label="Go back" variant="soft" size="sm" onPress={goBack} />
      </View>
    );
  }

  if (doneCount !== null) {
    const noun = doneCount === 1 ? "date" : "dates";
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          alignItems: "center",
          justifyContent: "center",
          gap: space.close,
          padding: space.rest,
        }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.full,
            backgroundColor: theme.brandSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather name="check" size={26} color={theme.brandInk} />
        </View>
        <AppText variant="title">
          {doneCount} {noun} on the class calendar
        </AppText>
        <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
          Everyone in {courseCode ?? "the class"} sees them now. Nice one.
        </AppText>
      </View>
    );
  }

  const parsedEmpty = rows !== null && rows.length === 0;
  const count = rows?.length ?? 0;
  const countNoun = count === 1 ? "date" : "dates";

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ flex: 1, paddingTop: insets.top + space.close }}>
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
            <Feather name="chevron-left" size={26} color={theme.foreground} />
          </Pressable>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: space.gutter,
            paddingBottom: insets.bottom + space.rest,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <AppText variant="display" style={{ marginTop: space.hair }}>
            Import syllabus
          </AppText>
          <AppText variant="caption" muted style={{ marginTop: space.snug }}>
            {courseCode ? `${courseCode} · parsed` : "Parsed"} right here on
            your phone. The syllabus itself never leaves it.
          </AppText>

          {hasExistingImport ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: space.cosy,
                marginTop: space.close,
              }}
            >
              <Feather
                name="info"
                size={14}
                color={theme.muted}
                style={{ marginTop: 1 }}
              />
              <AppText variant="caption" muted style={{ flex: 1 }}>
                This class already has a syllabus calendar. Import yours
                anyway and Hearth shows whichever version more classmates
                confirm.
              </AppText>
            </View>
          ) : null}

          <View style={{ marginTop: space.card }}>
            <Field
              label="Paste your syllabus (the schedule section works best)"
              value={text}
              onChangeText={setText}
              placeholder={
                "Week 3\nMon 10/14  Lecture: limits\nHW 3 due 10/16\nOct 24  Midterm exam"
              }
              multiline
              editable={!adding}
              style={{ minHeight: 150, textAlignVertical: "top" }}
            />
          </View>

          <Button
            label="Find the dates"
            variant="secondary"
            icon={<Feather name="search" size={16} color={theme.foreground} />}
            disabled={text.trim() === "" || adding}
            onPress={handleParse}
            style={{ marginTop: space.close }}
          />

          {parsedEmpty ? (
            <Card
              style={{
                marginTop: space.card,
                alignItems: "center",
                gap: space.snug,
                paddingVertical: space.chapter,
                borderStyle: "dashed",
              }}
            >
              <Feather name="calendar" size={20} color={theme.muted} />
              <AppText variant="bodySemi">No dates found</AppText>
              <AppText
                variant="caption"
                muted
                style={{ textAlign: "center", maxWidth: 260 }}
              >
                Paste the part of the syllabus with the schedule table: the
                lines that pair a date with an assignment or exam.
              </AppText>
            </Card>
          ) : null}

          {rows !== null && rows.length > 0 ? (
            <View style={{ marginTop: space.card, gap: space.room }}>
              <AppText variant="caption" muted>
                Found {count} {countNoun}. Tap a chip to change what it is,
                fix any titles, and drop anything that doesn't belong.
              </AppText>

              {rows.map((row) => {
                const low = row.confidence === "low";
                return (
                  <Card
                    key={row.key}
                    style={{
                      gap: space.cosy,
                      padding: space.close,
                      ...(low
                        ? {
                            backgroundColor: theme.brandSoft,
                            borderColor: theme.brand2,
                          }
                        : null),
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.cosy,
                      }}
                    >
                      <KindChip
                        kind={row.kind}
                        onPress={() => cycleKind(row.key)}
                      />
                      <AppText
                        variant="caption"
                        muted={!low}
                        style={{
                          flex: 1,
                          textAlign: "right",
                          ...(low ? { color: theme.brandInk } : null),
                        }}
                      >
                        {shortDay(row.dueAt)}
                      </AppText>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${row.title || "this date"}`}
                        onPress={() => removeRow(row.key)}
                        hitSlop={8}
                        style={({ pressed }) => ({
                          width: 32,
                          height: 32,
                          marginVertical: -6,
                          marginRight: -6,
                          alignItems: "center",
                          justifyContent: "center",
                          opacity: pressed ? 0.6 : 1,
                        })}
                      >
                        <Feather
                          name="x"
                          size={16}
                          color={low ? theme.brand : theme.muted}
                        />
                      </Pressable>
                    </View>
                    <TextInput
                      accessibilityLabel="Title"
                      value={row.title}
                      onChangeText={(value) => retitle(row.key, value)}
                      placeholder="What's due?"
                      placeholderTextColor={theme.muted + "b3"}
                      cursorColor={theme.brand}
                      maxLength={120}
                      editable={!adding}
                      style={{
                        borderWidth: 1,
                        borderColor: theme.border,
                        borderRadius: radius.control,
                        backgroundColor: theme.surface,
                        paddingHorizontal: space.close,
                        paddingVertical: space.cosy,
                        fontFamily: fonts.body,
                        fontSize: 14,
                        color: theme.foreground,
                      }}
                    />
                    {low ? (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: space.snug,
                        }}
                      >
                        <Feather
                          name="alert-circle"
                          size={13}
                          color={theme.brandInk}
                        />
                        <AppText
                          variant="caption"
                          style={{ color: theme.brandInk }}
                        >
                          check this one
                        </AppText>
                      </View>
                    ) : null}
                  </Card>
                );
              })}

              {addError ? (
                <AppText variant="caption" style={{ color: theme.danger }}>
                  {addError}
                </AppText>
              ) : null}

              <Button
                label={`Add ${count} ${countNoun} to the class calendar`}
                pending={adding}
                disabled={adding || !userId}
                icon={
                  <Feather name="calendar" size={16} color={theme.brandFg} />
                }
                onPress={() => void handleAdd()}
                style={{ marginTop: space.hair }}
              />
            </View>
          ) : null}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
