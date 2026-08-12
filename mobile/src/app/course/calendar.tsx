import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  View,
  type SectionListData,
  type SectionListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  Sheet,
  useReducedMotion,
  type ChipTone,
} from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
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
function kindTone(kind: CalendarKind): ChipTone {
  switch (kind) {
    case "exam":
      return "brand";
    case "quiz":
    case "project":
      return "accent";
    default:
      return "neutral";
  }
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

/** A ladder label dropped into the middle of a sentence: "the night before". */
function leadPhrase(minutes: number): string {
  const label = describeLead(minutes);
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** The quiet second caption on a row that has a reminder on it. A stamped
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
function remindable(dueAt: string, now: Date): boolean {
  return !reminderFiresAt(new Date(dueAt), LEAD_MIN_MINUTES, now).past;
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

/** Midnight this morning, as a timestamp — the line between behind and ahead. */
function startOfDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * Where today sits in the month sections: the first item due today or later,
 * and how many dates are stacked behind it.
 *
 * A term's worth of syllabus imports opens on week one, and in week seven
 * that is forty rows above the thing you came to look at. This is what the
 * list scrolls to on arrival and what the "Jump to today" pill aims at.
 *
 * Null when every date is behind you — then the bottom of the list already
 * is the interesting end, and there is nothing to jump to.
 */
function findToday(
  sections: Section[],
  dayStart: number
): { sectionIndex: number; itemIndex: number; behind: number } | null {
  let behind = 0;
  for (let s = 0; s < sections.length; s += 1) {
    const data = sections[s]?.data ?? [];
    for (let i = 0; i < data.length; i += 1) {
      const row = data[i];
      if (row && new Date(row.due_at).getTime() >= dayStart) {
        return { sectionIndex: s, itemIndex: i, behind };
      }
      behind += 1;
    }
  }
  return null;
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

  // Your own reminders, keyed by item — absent from the map IS "no reminder".
  const [reminders, setReminders] = useState<Map<string, Reminder>>(new Map());
  const [remindersError, setRemindersError] = useState<string | null>(null);
  // The lead-time sheet. `openedAt` is the clock read once on open, so every
  // row in the ladder measures against the same moment while it's up.
  const [sheet, setSheet] = useState<{
    item: CalendarItemRow;
    openedAt: Date;
  } | null>(null);
  // The lead someone picked whose moment is already behind them, so the sheet
  // can say why nothing happened, right under the row they tapped.
  const [pastChoice, setPastChoice] = useState<number | null>(null);

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
      const ids = rows.map((row) => row.id);
      // Every visible item's reminder in one lookup, in flight beside the
      // check-offs so the bells and the circles land together. A reminder
      // outage is not a calendar outage: it says so and the month still draws.
      const remindersInFlight = fetchReminders(ids).then(
        (map) => ({ map, failure: null as string | null }),
        (err: unknown) => ({
          map: new Map<string, Reminder>(),
          failure:
            err instanceof ReminderError
              ? err.message
              : "We couldn't load your reminders. Give it another go.",
        })
      );
      const { data: checks } = await supabase
        .from("study_checkoffs")
        .select("item_id")
        .eq("user_id", userId)
        .in("item_id", ids);
      setChecked(
        new Set(
          ((checks ?? []) as { item_id: string }[]).map((row) => row.item_id)
        )
      );
      const { map, failure } = await remindersInFlight;
      setReminders(map);
      setRemindersError(failure);
    } else {
      setChecked(new Set());
      setReminders(new Map());
      setRemindersError(null);
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

  /* ---------------------------- reminders ---------------------------- */

  const openReminders = useCallback((item: CalendarItemRow) => {
    setPastChoice(null);
    setSheet({ item, openedAt: new Date() });
  }, []);

  const closeReminders = useCallback(() => {
    setSheet(null);
    setPastChoice(null);
  }, []);

  /** Arm or re-aim a reminder. The bell fills now; the row syncs behind it. */
  const armReminder = useCallback(
    async (item: CalendarItemRow, minutes: number) => {
      const previous = reminders.get(item.id) ?? null;
      setActionError(null);
      setReminders((prev) => {
        const next = new Map(prev);
        next.set(item.id, {
          item_id: item.id,
          lead_minutes: minutes,
          // Picking a new lead re-arms a reminder that already went out.
          sent_at: null,
        });
        return next;
      });
      tapLight();
      try {
        const saved = await setReminder(item.id, minutes);
        setReminders((prev) => new Map(prev).set(item.id, saved));
      } catch (err) {
        setReminders((prev) => {
          const next = new Map(prev);
          if (previous) next.set(item.id, previous);
          else next.delete(item.id);
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
    async (item: CalendarItemRow) => {
      const previous = reminders.get(item.id);
      if (!previous) return;
      setActionError(null);
      setReminders((prev) => {
        const next = new Map(prev);
        next.delete(item.id);
        return next;
      });
      tapLight();
      try {
        await clearReminder(item.id);
      } catch (err) {
        setReminders((prev) => new Map(prev).set(item.id, previous));
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
      const { item, openedAt } = sheet;
      const timing = reminderFiresAt(
        new Date(item.due_at),
        choice.minutes,
        openedAt
      );
      // A lead longer than the time left is a nudge the sweep would skip, so
      // say so where they tapped instead of arming nothing.
      if (timing.past) {
        setPastChoice(choice.minutes);
        return;
      }
      closeReminders();
      void armReminder(item, choice.minutes);
    },
    [sheet, closeReminders, armReminder]
  );

  const dropLead = useCallback(() => {
    if (sheet === null) return;
    const { item } = sheet;
    closeReminders();
    void disarmReminder(item);
  }, [sheet, closeReminders, disarmReminder]);

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

  /* --------------------------- landing on today ----------------------- */

  const listRef = useRef<SectionList<CalendarItemRow, Section>>(null);
  const reduceMotion = useReducedMotion();
  /** One automatic landing per visit — a return from the syllabus importer
      shouldn't yank the list out from under a reader who scrolled. */
  const landedRef = useRef(false);
  /** Scroll retries after an unmeasured row, capped so this can't spin. */
  const retriesRef = useRef(0);

  const sections = useMemo(() => groupByMonth(items), [items]);
  // A day stamp rather than a clock read, so the memo below settles.
  const dayStart = startOfDay(new Date());
  const todayAt = useMemo(
    () => findToday(sections, dayStart),
    [sections, dayStart]
  );

  const scrollToToday = useCallback(
    (animated: boolean) => {
      const target = todayAt;
      if (target === null) return;
      listRef.current?.scrollToLocation({
        sectionIndex: target.sectionIndex,
        // Within a section, index 0 is the month heading and the first date
        // under it is 1. Landing on the heading when today opens a month
        // keeps "November 2026" on screen above the row.
        itemIndex: target.itemIndex === 0 ? 0 : target.itemIndex + 1,
        viewPosition: 0,
        animated,
      });
    },
    [todayAt]
  );

  /** The row isn't measured yet — let the window fill and try once more. */
  const handleScrollFailed = useCallback(() => {
    if (retriesRef.current >= 2) return;
    retriesRef.current += 1;
    setTimeout(() => scrollToToday(false), 160);
  }, [scrollToToday]);

  const jumpToToday = useCallback(() => {
    retriesRef.current = 0;
    scrollToToday(!reduceMotion);
  }, [scrollToToday, reduceMotion]);

  // Open where the class actually is. Nothing to do when today is already
  // the first row — then the list starts in the right place on its own.
  useEffect(() => {
    if (landedRef.current) return;
    if (status !== "ready" || todayAt === null || todayAt.behind === 0) return;
    landedRef.current = true;
    retriesRef.current = 0;
    const timer = setTimeout(() => scrollToToday(false), 50);
    return () => clearTimeout(timer);
  }, [status, todayAt, scrollToToday]);

  /* ------------------------------ rows -------------------------------- */

  // One clock read per pass, so every bell on screen judges "could a nudge
  // still land?" against the same moment.
  const now = new Date();

  const renderItem = ({
    item,
  }: SectionListRenderItemInfo<CalendarItemRow, Section>) => {
    const done = checked.has(item.id);
    const mine = item.created_by === userId;
    const reminder = reminders.get(item.id);
    // The bell stays out of the way once a nudge could no longer arrive —
    // unless there's already one here to read and turn off.
    const showBell = reminder !== undefined || remindable(item.due_at, now);
    const checkLabel = `${done ? "Mark not done" : "Mark done"} — ${
      item.title
    }, ${shortDay(item.due_at)}${mine ? ". Long press to remove" : ""}`;
    return (
      <Pressable
        // Not accessible itself: the whole card stays the check-off target for
        // a thumb, and the two buttons inside stay reachable one at a time for
        // a screen reader. Same scaffold as the course rows in courses/index.
        accessible={false}
        onPress={() => void toggleCheck(item)}
        onLongPress={mine ? () => confirmDelete(item) : undefined}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <Card
          padded={false}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.cosy,
            padding: space.close,
            minHeight: 64,
            marginBottom: space.room,
          }}
        >
          <View style={{ flex: 1, minWidth: 0, gap: space.snug }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.cosy,
                flexWrap: "wrap",
              }}
            >
              <Chip label={kindLabel(item.kind)} tone={kindTone(item.kind)} />
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
            {reminder ? (
              <AppText variant="caption" muted numberOfLines={1}>
                {reminderCaption(reminder)}
              </AppText>
            ) : null}
          </View>
          {/* The bell sits inboard of the check-off circle, its own 44px
              button with ~30px of clear space before the circle, so the two
              never trade taps. Empty outline until a reminder is set, then a
              soft ember tile — the same icon-tile language as Sheet.Row. */}
          {showBell ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                reminder
                  ? `Change the reminder for ${item.title}, currently ${leadPhrase(
                      reminder.lead_minutes
                    )}`
                  : `Remind me about ${item.title}`
              }
              onPress={() => openReminders(item)}
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
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: done }}
            accessibilityLabel={checkLabel}
            onPress={() => void toggleCheck(item)}
            onLongPress={mine ? () => confirmDelete(item) : undefined}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              // The drawn circle keeps the trailing edge it has always had;
              // only its hit area grew around it.
              marginRight: -6,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
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
          </Pressable>
        </Card>
      </Pressable>
    );
  };

  const renderSectionHeader = ({
    section,
  }: {
    section: SectionListData<CalendarItemRow, Section>;
  }) => (
    <AppText
      variant="title"
      style={{ marginTop: space.snug, marginBottom: space.room }}
    >
      {section.title}
    </AppText>
  );

  const addForm = formOpen ? (
    <Card style={{ gap: space.close, marginBottom: space.card }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.cosy,
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
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.cosy }}>
        {CALENDAR_KINDS.map((kind) => (
          <Chip
            key={kind}
            label={kindLabel(kind)}
            tone={kindTone(kind)}
            size="md"
            selected={kind === formKind}
            accessibilityLabel={`Kind: ${kindLabel(kind)}`}
            onPress={() => setFormKind(kind)}
          />
        ))}
      </View>
      <Field
        label="Title"
        value={formTitle}
        onChangeText={setFormTitle}
        placeholder="Midterm 2"
        maxLength={200}
        editable={!formPending}
      />
      <View style={{ flexDirection: "row", gap: space.room }}>
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
      <View
        style={{
          flexDirection: "row",
          justifyContent: "flex-end",
          gap: space.cosy,
        }}
      >
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
      style={{ marginBottom: space.card }}
    />
  );

  const listHeader = (
    <View>
      {addForm}
      {actionError ? (
        <AppText
          variant="caption"
          style={{ color: theme.danger, marginBottom: space.room }}
        >
          {actionError}
        </AppText>
      ) : null}
      {remindersError ? (
        <AppText
          variant="caption"
          style={{ color: theme.danger, marginBottom: space.room }}
        >
          {remindersError}
        </AppText>
      ) : null}
    </View>
  );

  /* ------------------------- the lead-time sheet ---------------------- */

  const sheetReminder = sheet ? reminders.get(sheet.item.id) : undefined;
  const sheetDue = sheet ? new Date(sheet.item.due_at) : null;
  // Even the closest rung is behind us — there is no honest choice left to
  // offer, so the sheet explains instead of listing seven dead ones.
  const sheetTooLate =
    sheet !== null && sheetDue !== null
      ? reminderFiresAt(sheetDue, LEAD_MIN_MINUTES, sheet.openedAt).past
      : false;

  const leadLadder =
    sheet === null || sheetDue === null
      ? null
      : LEAD_CHOICES.map((choice) => {
          const chosen = sheetReminder?.lead_minutes === choice.minutes;
          const past = reminderFiresAt(
            sheetDue,
            choice.minutes,
            sheet.openedAt
          ).past;
          return (
            <View key={choice.minutes}>
              {/* Faded when that moment is already behind them — tapping it
                  says why rather than arming a nudge that can't arrive. */}
              <View style={{ opacity: past ? 0.5 : 1 }}>
                <Sheet.Row
                  icon={chosen ? "check" : "clock"}
                  label={choice.label}
                  onPress={() => pickLead(choice)}
                />
              </View>
              {/* 46 lines the warning up with the row labels above it rather
                  than the sheet's edge: Sheet.Row draws a 36px icon tile and
                  a 10 gap. Taken from the primitive, not a spacing choice. */}
              {pastChoice === choice.minutes ? (
                <AppText
                  variant="caption"
                  style={{
                    color: theme.warning,
                    marginLeft: 46,
                    marginBottom: space.tight,
                  }}
                >
                  That moment has passed — pick something closer in.
                </AppText>
              ) : null}
            </View>
          );
        });

  const reminderSheet = (
    <Sheet
      visible={sheet !== null}
      onClose={closeReminders}
      title={sheet?.item.title ?? "Reminder"}
    >
      {sheet ? (
        <AppText variant="caption" muted style={{ marginBottom: space.snug }}>
          {/* Loose on purpose: the sweep ticks hourly, so a nudge lands near
              the moment they picked, not on the minute. */}
          {`Due ${shortDay(sheet.item.due_at)}${timeSuffix(sheet.item.due_at)}.${
            sheetTooLate ? "" : " One nudge, around the time you pick."
          }`}
        </AppText>
      ) : null}
      {sheetTooLate ? (
        <AppText
          variant="caption"
          style={{ color: theme.warning, marginBottom: space.snug }}
        >
          This one's due too soon — even the closest reminder would land after
          the deadline.
        </AppText>
      ) : (
        <ScrollView
          style={{ flexShrink: 1 }}
          contentContainerStyle={{ gap: space.tight }}
          showsVerticalScrollIndicator={false}
        >
          {leadLadder}
        </ScrollView>
      )}
      {sheetReminder ? (
        <>
          <View
            style={{
              height: 1,
              backgroundColor: theme.border,
              marginTop: space.snug,
              marginBottom: space.cosy,
            }}
          />
          <Sheet.Row
            icon="bell-off"
            label="Don't remind me"
            onPress={dropLead}
          />
        </>
      ) : null}
    </Sheet>
  );

  const emptyState = (
    <EmptyState
      icon="calendar"
      title="Nothing on the calendar yet"
      body="Paste the syllabus once and every classmate gets the whole schedule."
      action={{ label: "Import syllabus", onPress: openSyllabus }}
    />
  );

  /* ------------------------------ screen ------------------------------ */

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ flex: 1, paddingTop: insets.top + space.close }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: space.close,
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

        <View style={{ flex: 1, paddingHorizontal: space.gutter }}>
          <AppText variant="display" style={{ marginTop: space.hair }}>
            Class calendar
          </AppText>
          <AppText
            variant="caption"
            muted
            style={{ marginTop: space.snug, marginBottom: space.card }}
          >
            {courseCode ? `${courseCode} · shared` : "Shared"} with everyone in
            the class — check off what you've handled.
          </AppText>

          {/* Stays put above the list rather than riding in the header, so
              the way back to today is one tap from anywhere in the term. */}
          {status === "ready" && todayAt !== null && todayAt.behind > 0 ? (
            <View style={{ flexDirection: "row", marginBottom: space.close }}>
              <Chip
                label="Jump to today"
                icon="arrow-down"
                size="md"
                accessibilityLabel={`Jump to today, past ${
                  todayAt.behind === 1 ? "1 earlier date" : `${todayAt.behind} earlier dates`
                }`}
                onPress={jumpToToday}
              />
            </View>
          ) : null}

          {status === "loading" ? (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                gap: space.close,
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
                gap: space.room,
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
              ref={listRef}
              sections={sections}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              renderSectionHeader={renderSectionHeader}
              onScrollToIndexFailed={handleScrollFailed}
              stickySectionHeadersEnabled={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingBottom: insets.bottom + space.rest,
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

      {reminderSheet}
    </KeyboardAvoidingView>
  );
}
