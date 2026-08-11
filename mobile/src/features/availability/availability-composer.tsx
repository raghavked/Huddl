import Feather from "@expo/vector-icons/Feather";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { AppText, Button, Field, Sheet } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import {
  AVAILABILITY_SLOTS_MAX,
  AVAILABILITY_SLOTS_MIN,
  AVAILABILITY_TITLE_MAX,
  AvailabilityError,
  createAvailabilityPoll,
  SUGGEST_SLOTS_DEFAULT,
  suggestSlots,
} from "@/lib/availability";
import { tapSuccess } from "@/lib/haptics";

/** Props for {@link AvailabilityComposer}. */
export type AvailabilityComposerProps = {
  /**
   * The channel the poll is asked in. `create_availability_poll` writes the
   * poll, its candidate times, and the chat message announcing it atomically,
   * so the student must already be a member of this channel (the backend
   * enforces it, and the sheet renders the refusal warmly if they aren't).
   */
  channelId: string;
  /**
   * Whether the sheet is shown. The room owns this — typically toggled from a
   * "+" or attachment action in the message bar. Drafts survive a dismiss;
   * the form only resets after a successful create. An untouched form
   * re-seeds its suggested times each time it opens, so a sheet left alone
   * overnight never opens on yesterday evening.
   */
  visible: boolean;
  /**
   * Called whenever the sheet should go away: scrim tap, the X button, the
   * hardware back button, and right after a successful create. The room
   * should set its `visible` flag false here.
   */
  onClose: () => void;
  /**
   * Called with the new `availability_polls.id` after a successful create,
   * just before `onClose`. Worth keeping: the announcing chat message carries
   * no poll id of its own, so this is the cheapest moment for the room to
   * learn which poll the message that's about to arrive belongs to — hand it
   * straight to `<AvailabilityBubble pollId={…} />`.
   */
  onCreated?: (pollId: string) => void;
};

/** One editable candidate time, as the student is typing it. */
type Draft = {
  /** Stable across adds and removes, so a row keeps its keyboard. */
  key: string;
  /** "2026-10-14". */
  date: string;
  /** "19:00". */
  time: string;
  dateError: string | null;
  timeError: string | null;
};

const CREATE_FAILED = "We couldn't start that poll just now. Try again.";

/** Row keys only have to be unique within one composer's lifetime. */
let draftSeq = 0;
function nextKey(): string {
  draftSeq += 1;
  return `slot-${draftSeq}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Days in a 1-based month — the same guard the event and calendar forms use. */
function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

/** A blank row, for when there's nothing sensible to prefill. */
function blankDraft(): Draft {
  return { key: nextKey(), date: "", time: "", dateError: null, timeError: null };
}

/** A row already filled in with a real moment, local time throughout. */
function draftFrom(at: Date): Draft {
  return {
    key: nextKey(),
    date: `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`,
    time: `${pad2(at.getHours())}:${pad2(at.getMinutes())}`,
    dateError: null,
    timeError: null,
  };
}

/**
 * Read one row. A row left completely blank is not an error — it's skipped,
 * the same bargain the poll composer makes with an empty option — but a half
 * filled one gets a warm nudge on the field that's missing.
 */
function parseDraft(draft: Draft): {
  at: Date | null;
  dateError: string | null;
  timeError: string | null;
} {
  const dateText = draft.date.trim();
  const timeText = draft.time.trim();
  if (dateText === "" && timeText === "") {
    return { at: null, dateError: null, timeError: null };
  }

  let dateError: string | null = null;
  let year = 0;
  let month = 0;
  let day = 0;
  const dateMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dateText);
  if (dateText === "") {
    dateError = "Add a date here, like 2026-10-14.";
  } else if (!dateMatch) {
    dateError = "Dates look like YYYY-MM-DD — try 2026-10-14.";
  } else {
    year = Number(dateMatch[1]);
    month = Number(dateMatch[2]);
    day = Number(dateMatch[3]);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(month, year)) {
      dateError = "That day doesn't exist — double-check the month and day.";
    }
  }

  let timeError: string | null = null;
  let hours = 0;
  let minutes = 0;
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeText);
  if (timeText === "") {
    timeError = "Add a start time, like 19:00.";
  } else if (!timeMatch) {
    timeError = "Times look like HH:MM — try 19:00.";
  } else {
    hours = Number(timeMatch[1]);
    minutes = Number(timeMatch[2]);
    if (hours > 23 || minutes > 59) {
      timeError = "Times look like HH:MM — try 19:00.";
    }
  }

  if (dateError !== null || timeError !== null) {
    return { at: null, dateError, timeError };
  }
  return {
    at: new Date(year, month - 1, day, hours, minutes),
    dateError: null,
    timeError: null,
  };
}

/** "Thu, Oct 15 · 7:00 PM" — the row read back in plain words. */
function whenLabel(at: Date): string {
  const day = at.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = at.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
}

/** The times the sheet opens with — a starting point, not a recommendation. */
function seedDrafts(now: Date): Draft[] {
  const seeded = suggestSlots(now, SUGGEST_SLOTS_DEFAULT).map(draftFrom);
  while (seeded.length < AVAILABILITY_SLOTS_MIN) seeded.push(blankDraft());
  return seeded;
}

/**
 * The row "Add another time" appends: a day on from the last time that reads
 * properly, at the same hour. Adding a fourth Tuesday evening shouldn't mean
 * typing a whole date out again.
 */
function nextDraft(rows: readonly Draft[]): Draft {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!row) continue;
    const { at } = parseDraft(row);
    if (!at) continue;
    return draftFrom(
      new Date(
        at.getFullYear(),
        at.getMonth(),
        at.getDate() + 1,
        at.getHours(),
        at.getMinutes()
      )
    );
  }
  return blankDraft();
}

/**
 * A slide-up sheet for asking a channel when everyone's free: a short title,
 * two to eight candidate times seeded with plausible evenings, and warm
 * inline validation on each row.
 *
 * On success the poll lands in the chat stream as a regular message (rendered
 * by the room via `AvailabilityBubble`), the new poll's id comes back through
 * `onCreated`, and the form resets for next time.
 */
export function AvailabilityComposer({
  channelId,
  visible,
  onClose,
  onCreated,
}: AvailabilityComposerProps) {
  const theme = useTheme();

  const [title, setTitle] = useState("");
  const [rows, setRows] = useState<Draft[]>(() => seedDrafts(new Date()));
  const [titleError, setTitleError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /* A form nobody has typed in yet is still ours to re-seed; once a student
     has touched it, the draft is theirs and survives a dismiss. */
  const touchedRef = useRef(false);

  useEffect(() => {
    if (!visible || touchedRef.current) return;
    setRows(seedDrafts(new Date()));
  }, [visible]);

  const editTitle = useCallback((value: string) => {
    touchedRef.current = true;
    setTitle(value);
    setTitleError(null);
    setFormError(null);
  }, []);

  const editDraft = useCallback(
    (key: string, patch: Partial<Pick<Draft, "date" | "time">>) => {
      touchedRef.current = true;
      setFormError(null);
      setRows((prev) =>
        prev.map((row) =>
          row.key === key
            ? { ...row, ...patch, dateError: null, timeError: null }
            : row
        )
      );
    },
    []
  );

  const addDraft = useCallback(() => {
    touchedRef.current = true;
    setFormError(null);
    setRows((prev) =>
      prev.length >= AVAILABILITY_SLOTS_MAX ? prev : [...prev, nextDraft(prev)]
    );
  }, []);

  const removeDraft = useCallback((key: string) => {
    touchedRef.current = true;
    setFormError(null);
    setRows((prev) =>
      prev.length <= AVAILABILITY_SLOTS_MIN
        ? prev
        : prev.filter((row) => row.key !== key)
    );
  }, []);

  const handleCreate = useCallback(async () => {
    if (pending) return;

    const cleanTitle = title.trim();
    if (cleanTitle.length === 0) {
      setFormError(null);
      setTitleError("Give this poll a title first.");
      return;
    }

    /* Read every row, then mark the second copy of a repeated time — two
       identical options aren't a choice, and the data layer would quietly
       drop one and leave the student wondering. */
    const read = rows.map((row) => ({ row, parsed: parseDraft(row) }));
    const seen = new Set<number>();
    let repeated = false;
    const checked: Draft[] = read.map(({ row, parsed }) => {
      let timeError = parsed.timeError;
      if (parsed.at) {
        const ms = parsed.at.getTime();
        if (seen.has(ms)) {
          timeError = "You've already offered this time.";
          repeated = true;
        } else {
          seen.add(ms);
        }
      }
      return { ...row, dateError: parsed.dateError, timeError };
    });

    setRows(checked);
    if (checked.some((row) => row.dateError !== null || row.timeError !== null)) {
      setFormError(
        repeated
          ? "Two of these are the same time — change one of them."
          : "One of these times needs a fix."
      );
      return;
    }

    const times = read
      .map(({ parsed }) => parsed.at)
      .filter((at): at is Date => at !== null);
    if (times.length < AVAILABILITY_SLOTS_MIN) {
      setFormError(
        "Offer at least two times, so there's something to choose between."
      );
      return;
    }

    setFormError(null);
    setPending(true);
    try {
      const pollId = await createAvailabilityPoll(channelId, cleanTitle, times);
      tapSuccess();
      onCreated?.(pollId);
      setTitle("");
      setRows(seedDrafts(new Date()));
      setTitleError(null);
      touchedRef.current = false;
      onClose();
    } catch (caught) {
      setFormError(
        caught instanceof AvailabilityError ? caught.message : CREATE_FAILED
      );
    } finally {
      setPending(false);
    }
  }, [pending, title, rows, channelId, onCreated, onClose]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Ask when everyone's free">
      {/* `Sheet` sits on the bottom edge and owns no keyboard behaviour — every
          other form in a sheet lifts its own content. On iOS the padding grows
          the card upward so the Create button clears the keyboard; on Android
          the window resize already does it. The scroll list is the part that
          gives up the room. */}
      <KeyboardAvoidingView
        style={{ flexShrink: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={{ flexGrow: 0, flexShrink: 1 }}
          contentContainerStyle={{ gap: 12, paddingBottom: 4 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <AppText variant="caption" muted>
            Everyone in the channel answers yes, maybe, or no to each time.
          </AppText>

          {/* No autofocus: the seeded times are the point of this sheet, and a
              keyboard on open would bury them. */}
          <Field
            label="Title"
            value={title}
            onChangeText={editTitle}
            maxLength={AVAILABILITY_TITLE_MAX}
            placeholder="Midterm review"
            editable={!pending}
            error={titleError}
          />

          {rows.map((row, index) => {
            const { at } = parseDraft(row);
            return (
              <View key={row.key} style={{ gap: 6 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 8,
                  }}
                >
                  <View style={{ flex: 1.5 }}>
                    <Field
                      label={`Time ${index + 1}`}
                      accessibilityLabel={`Date for time ${index + 1}`}
                      value={row.date}
                      onChangeText={(value) =>
                        editDraft(row.key, { date: value })
                      }
                      placeholder="2026-10-14"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="numbers-and-punctuation"
                      editable={!pending}
                      error={row.dateError}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="Starts"
                      accessibilityLabel={`Start time for time ${index + 1}`}
                      value={row.time}
                      onChangeText={(value) =>
                        editDraft(row.key, { time: value })
                      }
                      placeholder="19:00"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="numbers-and-punctuation"
                      editable={!pending}
                      error={row.timeError}
                    />
                  </View>
                  {rows.length > AVAILABILITY_SLOTS_MIN ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove time ${index + 1}`}
                      onPress={() => removeDraft(row.key)}
                      disabled={pending}
                      hitSlop={4}
                      style={({ pressed }) => ({
                        width: 44,
                        height: 44,
                        // Lines the X up with the middle of the inputs, which
                        // sit below their own 16px label and a 6px gap.
                        marginTop: 22,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <Feather name="x" size={18} color={theme.muted} />
                    </Pressable>
                  ) : null}
                </View>
                {at ? (
                  <AppText variant="caption" muted>
                    {whenLabel(at)}
                  </AppText>
                ) : null}
              </View>
            );
          })}

          {rows.length < AVAILABILITY_SLOTS_MAX ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add another time"
              onPress={addDraft}
              disabled={pending}
              style={({ pressed }) => ({
                minHeight: 44,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Feather name="plus" size={16} color={theme.brand} />
              <AppText variant="bodySemi" style={{ color: theme.brand }}>
                Add another time
              </AppText>
            </Pressable>
          ) : null}
        </ScrollView>

        {formError ? (
          <AppText
            variant="caption"
            style={{ color: theme.danger, marginTop: 8 }}
          >
            {formError}
          </AppText>
        ) : null}

        <Button
          label="Ask the channel"
          pending={pending}
          onPress={() => void handleCreate()}
          style={{ marginTop: 10 }}
        />
      </KeyboardAvoidingView>
    </Sheet>
  );
}
