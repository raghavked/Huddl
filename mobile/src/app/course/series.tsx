import Feather from "@expo/vector-icons/Feather";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  SectionLabel,
} from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { tapSuccess } from "@/lib/haptics";
import {
  END_OF_DAY,
  SeriesError,
  WEEKDAYS,
  generateSeries,
  saveSeries,
  weekdayOf,
  type CalendarRowDraft,
  type TimeOfDay,
  type WeekdayIndex,
} from "@/lib/series";
import { kindLabel, type CalendarKind } from "@/lib/syllabus";

/* Add a weekly pattern — the composer for "this meets Mon and Wed at 10".
 *
 * The whole screen is a form wrapped around one pure function. Every keystroke
 * re-runs `generateSeries`, and what comes back is both the preview the student
 * reads and the exact rows the save writes: there is no second code path that
 * could disagree with the sentence above the button. Nobody puts twenty dates
 * on a shared class calendar blind.
 *
 * Nothing here loads. The only async moment is the save, so the four data
 * states collapse to two — the form, and the warm confirmation that replaces it
 * before we drop back to the calendar.
 */

/* ───────────────────────── the patterns ───────────────────────── */

/**
 * The shapes a weekly pattern actually takes, each mapped onto a real
 * `CalendarKind`.
 *
 * A class meeting has more shapes than the calendar has kinds — a section and
 * a lab are both lectures as far as the column is concerned — so a pattern
 * carries two things: the `kind` that gets stored, and the `noun` that seeds
 * the title. That keeps the calendar's vocabulary exactly as it is (no new
 * enum, no migration, every row still reads the same on the class calendar and
 * in the syllabus importer) while letting the picker say the word the student
 * would say. Where the two differ the screen says so out loud rather than
 * quietly filing a lab under "lecture".
 *
 * `problem set` is the one that isn't a meeting: it writes an `assignment` and
 * pairs with a blank time, which the calendar prints as a due date rather than
 * an appointment.
 */
const PATTERNS = [
  { id: "lecture", label: "lecture", kind: "lecture", noun: "lecture" },
  { id: "section", label: "section", kind: "lecture", noun: "discussion section" },
  { id: "lab", label: "lab", kind: "lecture", noun: "lab" },
  { id: "office-hours", label: "office hours", kind: "other", noun: "office hours" },
  { id: "problem-set", label: "problem set", kind: "assignment", noun: "problem set" },
] as const satisfies readonly {
  id: string;
  label: string;
  kind: CalendarKind;
  noun: string;
}[];

type Pattern = (typeof PATTERNS)[number];

/** Ten weeks — one quarter of instruction, near enough for a default. */
const QUARTER_DAYS = 70;

/* ───────────────────────── pure helpers ───────────────────────── */

/** "MAT 21A lecture" when we know the code, "Lecture" when we don't. */
function suggestTitle(pattern: Pattern, courseCode: string | undefined): string {
  if (courseCode && courseCode.trim() !== "") {
    return `${courseCode.trim()} ${pattern.noun}`;
  }
  return pattern.noun.charAt(0).toUpperCase() + pattern.noun.slice(1);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** A local calendar day as "2026-01-06" — never `toISOString`, which would
    hand back yesterday for anyone west of Greenwich in the evening. */
function toDateText(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Calendar-day arithmetic, so a default end date can't land an hour off
    across a daylight-saving change the way adding milliseconds would. */
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Days in a 1-based month. Same helper as course/calendar.tsx. */
function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

type Parsed<T> = { value: T } | { error: string };

/** The date field's rules and the date field's warm messages, matching the
    "Add a date" form on the calendar screen exactly. */
function parseDate(text: string): Parsed<Date> {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (!match) {
    return { error: "Dates look like YYYY-MM-DD — try 2026-10-14." };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(month, year)) {
    return { error: "That day doesn't exist — double-check the month and day." };
  }
  return { value: new Date(year, month - 1, day) };
}

/** Blank means "no particular time", which the calendar draws as 11:59 pm and
    then hides — the same bargain the "Add a date" form makes. */
function parseTime(text: string): Parsed<{ time: TimeOfDay; set: boolean }> {
  const trimmed = text.trim();
  if (trimmed === "") return { value: { time: END_OF_DAY, set: false } };
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  const hour = match ? Number(match[1]) : NaN;
  const minute = match ? Number(match[2]) : NaN;
  if (!match || hour > 23 || minute > 59) {
    return { error: "Times look like HH:MM — try 14:30, or leave it blank." };
  }
  return { value: { time: { hour, minute }, set: true } };
}

/** "10:00 AM" in the reader's own locale. */
function clockLabel(time: TimeOfDay): string {
  return new Date(2000, 0, 1, time.hour, time.minute).toLocaleTimeString(
    undefined,
    { hour: "numeric", minute: "2-digit" }
  );
}

/** "Jan 6" — the date without its weekday, for the range in a sentence. */
function monthDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** "Mon, Jan 6" — the preview rows, same shape as a calendar row's caption. */
function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * "Mondays and Wednesdays" — the days as prose.
 *
 * Deliberately not `describeWeekdays`, which gives the compact "Mon, Wed &
 * Fri" that belongs on a row subtitle where space is tight. The preview here
 * is a full sentence a student reads once before committing twenty dates to
 * everyone's calendar, and a sentence wants the spoken form.
 */
function weekdaysPhrase(weekdays: readonly WeekdayIndex[]): string {
  const chosen = new Set<number>(weekdays);
  const names = WEEKDAYS.filter((day) => chosen.has(day.index)).map(
    (day) => `${day.label}s`
  );
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

/** "18 dates", "1 date". */
function countPhrase(count: number): string {
  return `${count} ${count === 1 ? "date" : "dates"}`;
}

/* What the preview is showing right now. `blocked` covers everything from a
   half-typed date to the sixty-row cap: one warm sentence, one disabled
   button, no partial writes. */
type Preview =
  | { state: "ready"; drafts: CalendarRowDraft[] }
  | { state: "blocked"; message: string };

/* ─────────────────────────── the screen ────────────────────────── */

export default function AddSeriesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { courseId, courseCode } = useLocalSearchParams<{
    courseId?: string;
    courseCode?: string;
  }>();

  // One clock read for every default, so the start date and the pre-selected
  // weekday can't come from opposite sides of midnight.
  const [defaults] = useState(() => {
    const today = new Date();
    return {
      start: toDateText(today),
      end: toDateText(addDays(today, QUARTER_DAYS)),
      weekday: weekdayOf(today),
    };
  });

  const [pattern, setPattern] = useState<Pattern>(PATTERNS[0]);
  const [title, setTitle] = useState(() => suggestTitle(PATTERNS[0], courseCode));
  // Once they've written their own title we stop rewriting it under them.
  // Clearing the field hands the suggestion back.
  const [titleEdited, setTitleEdited] = useState(false);
  const [days, setDays] = useState<Set<WeekdayIndex>>(
    () => new Set<WeekdayIndex>([defaults.weekday])
  );
  const [timeText, setTimeText] = useState("");
  const [startText, setStartText] = useState(defaults.start);
  const [endText, setEndText] = useState(defaults.end);

  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [done, setDone] = useState<{ count: number; line: string } | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else if (courseId) {
      router.replace({
        pathname: "/course/calendar",
        params: courseCode ? { courseId, courseCode } : { courseId },
      });
    } else router.replace("/(tabs)/home");
  }, [router, courseId, courseCode]);

  // The confirmation is meant to be read, not dismissed — it sits for a beat
  // and then the calendar is where they left it, with the dates on it.
  useEffect(() => {
    if (done === null) return;
    const timer = setTimeout(goBack, 1800);
    return () => clearTimeout(timer);
  }, [done, goBack]);

  const pickPattern = useCallback(
    (next: Pattern) => {
      setPattern(next);
      setSaveError(null);
      if (!titleEdited) setTitle(suggestTitle(next, courseCode));
    },
    [titleEdited, courseCode]
  );

  const editTitle = useCallback((next: string) => {
    setTitle(next);
    setTitleEdited(next.trim() !== "");
  }, []);

  const toggleDay = useCallback((index: WeekdayIndex) => {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  /* ------------------------------ preview ------------------------------ */

  // Week order, however the chips were tapped.
  const weekdays = useMemo(
    () => WEEKDAYS.filter((day) => days.has(day.index)).map((day) => day.index),
    [days]
  );

  const parsedTime = useMemo(() => parseTime(timeText), [timeText]);

  const preview = useMemo<Preview>(() => {
    const start = parseDate(startText);
    if ("error" in start) return { state: "blocked", message: start.error };
    const end = parseDate(endText);
    if ("error" in end) return { state: "blocked", message: end.error };
    if ("error" in parsedTime) {
      return { state: "blocked", message: parsedTime.error };
    }
    try {
      // The one source of truth: what the student reads here is the array the
      // save hands to the database, generated by the same call.
      const drafts = generateSeries({
        title,
        kind: pattern.kind,
        weekdays,
        startDate: start.value,
        endDate: end.value,
        timeOfDay: parsedTime.value.time,
      });
      if (drafts.length === 0) {
        return {
          state: "blocked",
          message:
            "No dates land between those two — widen the range or pick another day of the week.",
        };
      }
      return { state: "ready", drafts };
    } catch (err) {
      return {
        state: "blocked",
        message:
          err instanceof SeriesError
            ? err.message
            : "Something in that pattern doesn't add up — check the dates and try again.",
      };
    }
  }, [title, pattern.kind, weekdays, startText, endText, parsedTime]);

  const summary = useMemo(() => {
    if (preview.state !== "ready") return null;
    const drafts = preview.drafts;
    const first = drafts[0];
    const last = drafts[drafts.length - 1];
    if (!first || !last) return null;
    const clock =
      "error" in parsedTime || !parsedTime.value.set
        ? "no set time"
        : clockLabel(parsedTime.value.time);
    if (drafts.length === 1) {
      return `${shortDay(first.due_at)}, ${clock}`;
    }
    return `${weekdaysPhrase(weekdays)}, ${clock}, ${monthDay(
      first.due_at
    )} through ${monthDay(last.due_at)}`;
  }, [preview, parsedTime, weekdays]);

  /* -------------------------------- save ------------------------------- */

  const handleAdd = useCallback(async () => {
    if (!courseId || pending || preview.state !== "ready") return;
    const drafts = preview.drafts;
    const last = drafts[drafts.length - 1];
    setPending(true);
    setSaveError(null);
    try {
      const rows = await saveSeries(courseId, drafts);
      tapSuccess();
      const saved = rows[rows.length - 1] ?? last;
      setDone({
        count: rows.length,
        line: `${title.trim()} — ${weekdaysPhrase(weekdays)}${
          saved ? `, through ${monthDay(saved.due_at)}` : ""
        }.`,
      });
    } catch (err) {
      setSaveError(
        err instanceof SeriesError
          ? err.message
          : "We couldn't add those dates just now. Give it another go."
      );
    } finally {
      setPending(false);
    }
  }, [courseId, pending, preview, title, weekdays]);

  /* ------------------------------- render ------------------------------ */

  if (!courseId) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + space.close,
          justifyContent: "center",
          paddingHorizontal: space.gutter,
        }}
      >
        <EmptyState
          icon="calendar"
          title="We're not sure which class this is"
          body="A weekly pattern goes on one course's calendar, and we lost track of which one. Open this again from that course's calendar and it'll know."
          action={{ label: "Go back", onPress: goBack }}
        />
      </View>
    );
  }

  if (done !== null) {
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
        <AppText variant="title" style={{ textAlign: "center" }}>
          {countPhrase(done.count)} on the class calendar
        </AppText>
        <AppText muted style={{ textAlign: "center", maxWidth: 300 }}>
          {done.line} Everyone in {courseCode ?? "the class"} sees them now.
        </AppText>
      </View>
    );
  }

  const kindNote =
    pattern.label === kindLabel(pattern.kind)
      ? null
      : `On the calendar they read as ${kindLabel(pattern.kind)}s.`;

  /* The two cards arrive with the screen, a beat apart — the form first, the
     preview under it. Frozen at mount, so a keystroke re-running the preview
     never replays it. */
  const previewCard =
    preview.state === "ready" ? (
      <Card entrance={1} style={{ gap: space.room }}>
        <AppText variant="title">{countPhrase(preview.drafts.length)}</AppText>
        {summary ? (
          <AppText variant="caption" muted>
            {summary}
          </AppText>
        ) : null}
        <View
          style={{
            height: 1,
            backgroundColor: theme.border,
            marginVertical: space.hair,
          }}
        />
        {sampleRows(preview.drafts).map((row) =>
          row.kind === "gap" ? (
            <AppText
              key="gap"
              variant="caption"
              muted
              style={{ marginLeft: space.card }}
            >
              + {row.hidden} more
            </AppText>
          ) : (
            <View
              key={row.iso}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.room,
              }}
            >
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: radius.full,
                  backgroundColor: theme.brand,
                }}
              />
              <AppText variant="bodyMedium">{shortDay(row.iso)}</AppText>
            </View>
          )
        )}
      </Card>
    ) : (
      <Card
        entrance={1}
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: space.room,
          borderStyle: "dashed",
        }}
      >
        <Feather
          name="alert-circle"
          size={16}
          color={theme.warning}
          style={{ marginTop: space.hair }}
        />
        <AppText variant="caption" style={{ color: theme.warning, flex: 1 }}>
          {preview.message}
        </AppText>
      </Card>
    );

  const count = preview.state === "ready" ? preview.drafts.length : 0;

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
            Add a weekly pattern
          </AppText>
          <AppText variant="caption" muted style={{ marginTop: space.snug }}>
            {courseCode ? `${courseCode} · set` : "Set"} it up once and every
            week of it lands on the class calendar.
          </AppText>

          <Card entrance={0} style={{ gap: space.card, marginTop: space.card }}>
            <View style={{ gap: space.cosy }}>
              <AppText variant="label">What is it?</AppText>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: space.room,
                }}
              >
                {PATTERNS.map((option) => (
                  <Chip
                    key={option.id}
                    label={option.label}
                    // Brand, not the calendar's `kindTone`: here the pattern is
                    // the identity of the thing being made, not metadata about
                    // a row that already exists.
                    tone="brand"
                    size="md"
                    selected={option.id === pattern.id}
                    onPress={() => pickPattern(option)}
                  />
                ))}
              </View>
              {kindNote ? (
                <AppText variant="caption" muted>
                  {kindNote}
                </AppText>
              ) : null}
            </View>

            <Field
              label="Title"
              value={title}
              onChangeText={editTitle}
              placeholder={suggestTitle(pattern, courseCode)}
              maxLength={200}
              editable={!pending}
            />

            <View style={{ gap: space.cosy }}>
              <AppText variant="label">Which days?</AppText>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: space.room,
                }}
              >
                {WEEKDAYS.map((day) => (
                  <Chip
                    key={day.index}
                    label={day.short}
                    // Fern is the app's "this is scheduled" tone, which is
                    // exactly what a chosen weekday is.
                    tone="accent"
                    size="md"
                    selected={days.has(day.index)}
                    accessibilityLabel={day.label}
                    onPress={() => toggleDay(day.index)}
                  />
                ))}
              </View>
            </View>

            <View style={{ gap: space.snug }}>
              <Field
                label="Time"
                value={timeText}
                onChangeText={setTimeText}
                placeholder="10:00"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                editable={!pending}
              />
              <AppText variant="caption" muted>
                24-hour, so 2pm is 14:00. Leave it blank for something with no
                set time, like a weekly problem set.
              </AppText>
            </View>

            <View style={{ flexDirection: "row", gap: space.room }}>
              <View style={{ flex: 1 }}>
                <Field
                  label="First date"
                  value={startText}
                  onChangeText={setStartText}
                  placeholder="2026-01-06"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="numbers-and-punctuation"
                  editable={!pending}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Last date"
                  value={endText}
                  onChangeText={setEndText}
                  placeholder="2026-03-13"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="numbers-and-punctuation"
                  editable={!pending}
                />
              </View>
            </View>
          </Card>

          <SectionLabel text="Preview" />
          {previewCard}

          {saveError ? (
            <AppText
              variant="caption"
              style={{ color: theme.danger, marginTop: space.close }}
            >
              {saveError}
            </AppText>
          ) : null}

          <Button
            label={count > 0 ? `Add ${countPhrase(count)}` : "Add these dates"}
            pending={pending}
            disabled={pending || preview.state !== "ready"}
            icon={<Feather name="calendar" size={16} color={theme.brandFg} />}
            onPress={() => void handleAdd()}
            style={{ marginTop: space.card }}
          />
          <AppText
            variant="caption"
            muted
            style={{ marginTop: space.room, textAlign: "center" }}
          >
            These go on the shared calendar — everyone in{" "}
            {courseCode ?? "the class"} sees them, and each one can be removed
            on its own later.
          </AppText>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

/* ─────────────────────── preview row selection ─────────────────────── */

type SampleRow =
  | { kind: "date"; iso: string }
  | { kind: "gap"; hidden: number };

/**
 * The first three dates and the last one, with a count of what sits between.
 *
 * Enough to check the pattern took (is it really landing on Mondays?) and that
 * it stops where it should, without scrolling a wall of twenty near-identical
 * rows. Four or fewer, and there's nothing to hide.
 */
function sampleRows(drafts: readonly CalendarRowDraft[]): SampleRow[] {
  if (drafts.length <= 4) {
    return drafts.map((draft) => ({ kind: "date", iso: draft.due_at }));
  }
  const rows: SampleRow[] = drafts
    .slice(0, 3)
    .map((draft) => ({ kind: "date", iso: draft.due_at }));
  rows.push({ kind: "gap", hidden: drafts.length - 4 });
  const last = drafts[drafts.length - 1];
  if (last) rows.push({ kind: "date", iso: last.due_at });
  return rows;
}
