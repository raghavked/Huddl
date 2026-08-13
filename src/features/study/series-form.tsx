"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, CircleAlert, Loader2 } from "lucide-react";
import { Button, Card, Input, Label, Hint } from "@/components/ui";
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
import { cn } from "@/lib/utils";

/* Add a weekly pattern: the composer for "this meets Mon and Wed at 10".
 *
 * The whole form is wrapped around one pure function. Every keystroke re-runs
 * `generateSeries`, and what comes back is both the preview the student reads
 * AND the exact rows the save writes: there is no second code path that could
 * disagree with the sentence above the button. Nobody puts twenty dates on a
 * shared class calendar blind.
 *
 * Nothing here loads. The only async moment is the save, so the four data
 * states collapse to two: the form, and the warm confirmation that replaces
 * it before we drop back to the calendar.
 */

/* ───────────────────────── the patterns ───────────────────────── */

/**
 * The shapes a weekly pattern actually takes, each mapped onto a real
 * `CalendarKind`.
 *
 * A class meeting has more shapes than the calendar has kinds (a section and
 * a lab are both lectures as far as the column is concerned), so a pattern
 * carries two things: the `kind` that gets stored, and the `noun` that seeds
 * the title. That keeps the calendar's vocabulary exactly as it is (no new
 * enum, no migration, every row still reads the same on the class calendar and
 * in the syllabus importer) while letting the picker say the word the student
 * would say. Where the two differ the form says so out loud rather than
 * quietly filing a lab under "lecture".
 *
 * `problem set` is the one that isn't a meeting: it writes an `assignment` and
 * pairs with a blank time, which the calendar prints as a due date rather than
 * an appointment.
 */
const PATTERNS = [
  { id: "lecture", label: "lecture", kind: "lecture", noun: "lecture" },
  {
    id: "section",
    label: "section",
    kind: "lecture",
    noun: "discussion section",
  },
  { id: "lab", label: "lab", kind: "lecture", noun: "lab" },
  {
    id: "office-hours",
    label: "office hours",
    kind: "other",
    noun: "office hours",
  },
  {
    id: "problem-set",
    label: "problem set",
    kind: "assignment",
    noun: "problem set",
  },
] as const satisfies readonly {
  id: string;
  label: string;
  kind: CalendarKind;
  noun: string;
}[];

type Pattern = (typeof PATTERNS)[number];

/** Ten weeks: one quarter of instruction, near enough for a default. */
const QUARTER_DAYS = 70;

/* ───────────────────────── pure helpers ───────────────────────── */

/** "MAT 21A lecture" when we know the code, "Lecture" when we don't. */
function suggestTitle(pattern: Pattern, courseCode: string): string {
  if (courseCode.trim() !== "") return `${courseCode.trim()} ${pattern.noun}`;
  return pattern.noun.charAt(0).toUpperCase() + pattern.noun.slice(1);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** A local calendar day as "2026-01-06". Never `toISOString`, which would
    hand back yesterday for anyone west of Greenwich in the evening. */
function toDateText(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Calendar-day arithmetic, so a default end date can't land an hour off
    across a daylight-saving change the way adding milliseconds would. */
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Days in a 1-based month. Same helper as the calendar's add-a-date form. */
function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

type Parsed<T> = { value: T } | { error: string };

/** The date field's rules and the date field's warm messages, matching the
    "Add a date" form on the calendar page exactly. */
function parseDate(text: string): Parsed<Date> {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (!match) {
    return { error: "Dates look like YYYY-MM-DD, as in 2026-10-14." };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(month, year)) {
    return {
      error: "That day doesn't exist. Double-check the month and day.",
    };
  }
  return { value: new Date(year, month - 1, day) };
}

/** Blank means "no particular time", which the calendar draws as 11:59 pm and
    then hides, the same bargain the "Add a date" form makes. */
function parseTime(text: string): Parsed<{ time: TimeOfDay; set: boolean }> {
  const trimmed = text.trim();
  if (trimmed === "") return { value: { time: END_OF_DAY, set: false } };
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  const hour = match ? Number(match[1]) : Number.NaN;
  const minute = match ? Number(match[2]) : Number.NaN;
  if (!match || hour > 23 || minute > 59) {
    return { error: "Times look like HH:MM, as in 14:30, or leave it blank." };
  }
  return { value: { time: { hour, minute }, set: true } };
}

/** "10:00 AM" in the reader's own locale. */
function clockLabel(time: TimeOfDay): string {
  return new Date(2000, 0, 1, time.hour, time.minute).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Jan 6": the date without its weekday, for the range in a sentence. */
function monthDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

/** "Mon, Jan 6": the preview rows, same shape as a calendar row's caption. */
function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * "Mondays and Wednesdays": the days as prose.
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

type SampleRow = { kind: "date"; iso: string } | { kind: "gap"; hidden: number };

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
    .map((draft) => ({ kind: "date" as const, iso: draft.due_at }));
  rows.push({ kind: "gap", hidden: drafts.length - 4 });
  const last = drafts[drafts.length - 1];
  if (last) rows.push({ kind: "date", iso: last.due_at });
  return rows;
}

/* ─────────────────────────── the form ────────────────────────── */

export function SeriesForm({
  courseId,
  courseCode,
}: {
  courseId: string;
  /** e.g. "MAT 21A"; seeds the title and names the class in the copy. */
  courseCode: string;
}) {
  const router = useRouter();

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
  const [title, setTitle] = useState(() =>
    suggestTitle(PATTERNS[0], courseCode)
  );
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

  const calendarHref = `/courses/${courseId}/calendar`;

  // The confirmation is meant to be read, not dismissed. It sits for a beat
  // and then the calendar is where they left it, with the dates on it. The
  // cleanup matters: if they navigate somewhere else inside that beat, the
  // push would land after they'd already chosen a different page.
  useEffect(() => {
    if (done === null) return;
    const timer = setTimeout(() => {
      router.push(calendarHref);
      router.refresh();
    }, 1800);
    return () => clearTimeout(timer);
  }, [done, router, calendarHref]);

  function pickPattern(next: Pattern) {
    setPattern(next);
    setSaveError(null);
    if (!titleEdited) setTitle(suggestTitle(next, courseCode));
  }

  function editTitle(next: string) {
    setTitle(next);
    setTitleEdited(next.trim() !== "");
  }

  function toggleDay(index: WeekdayIndex) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  /* ------------------------------ preview ------------------------------ */

  // Week order, however the chips were clicked.
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
            "No dates land between those two. Widen the range or pick another day of the week.",
        };
      }
      return { state: "ready", drafts };
    } catch (caught) {
      return {
        state: "blocked",
        message:
          caught instanceof SeriesError
            ? caught.message
            : "Something in that pattern doesn't add up. Check the dates and try again.",
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
    if (drafts.length === 1) return `${shortDay(first.due_at)}, ${clock}`;
    return `${weekdaysPhrase(weekdays)}, ${clock}, ${monthDay(
      first.due_at
    )} through ${monthDay(last.due_at)}`;
  }, [preview, parsedTime, weekdays]);

  /* -------------------------------- save ------------------------------- */

  async function handleAdd() {
    if (pending || preview.state !== "ready") return;
    const drafts = preview.drafts;
    const last = drafts[drafts.length - 1];
    setPending(true);
    setSaveError(null);
    try {
      const rows = await saveSeries(courseId, drafts);
      const saved = rows[rows.length - 1] ?? last;
      setDone({
        count: rows.length,
        line: `${title.trim()}: ${weekdaysPhrase(weekdays)}${
          saved ? `, through ${monthDay(saved.due_at)}` : ""
        }.`,
      });
    } catch (caught) {
      setSaveError(
        caught instanceof SeriesError
          ? caught.message
          : "We couldn't add those dates just now. Give it another go."
      );
      setPending(false);
    }
  }

  /* ------------------------------- render ------------------------------ */

  if (done !== null) {
    return (
      <div
        className="flex animate-fade-up flex-col items-center gap-3 px-6 py-16 text-center"
        role="status"
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
          <Check className="size-6" aria-hidden />
        </span>
        <p className="font-bold tracking-tight">
          {countPhrase(done.count)} on the class calendar
        </p>
        <p className="max-w-sm text-sm text-muted text-pretty">
          {done.line} Everyone in {courseCode || "the class"} sees them now.
        </p>
      </div>
    );
  }

  const kindNote =
    pattern.label === kindLabel(pattern.kind)
      ? null
      : `On the calendar they read as ${kindLabel(pattern.kind)}s.`;

  const count = preview.state === "ready" ? preview.drafts.length : 0;

  return (
    <div>
      <Card className="animate-fade-up">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            {/* A plain heading, not a <Label>: these are buttons in a group,
                and a <label> with no control to point at is a lie to a screen
                reader. `aria-labelledby` on the group does the naming. */}
            <p id="series-pattern-label" className="text-sm font-semibold">
              What is it?
            </p>
            <div
              role="group"
              aria-labelledby="series-pattern-label"
              className="flex flex-wrap gap-2"
            >
              {PATTERNS.map((option) => {
                const selected = option.id === pattern.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => pickPattern(option)}
                    disabled={pending}
                    className={cn(
                      "h-11 rounded-full border px-4 text-xs font-semibold transition-colors disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                      selected
                        ? "border-transparent bg-brand-soft text-brand-ink"
                        : "border-border bg-surface text-muted hover:text-foreground"
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            {kindNote ? <Hint>{kindNote}</Hint> : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="series-title">Title</Label>
            <Input
              id="series-title"
              value={title}
              onChange={(event) => editTitle(event.target.value)}
              placeholder={suggestTitle(pattern, courseCode)}
              maxLength={200}
              disabled={pending}
            />
          </div>

          <div className="flex flex-col gap-2">
            <p id="series-days-label" className="text-sm font-semibold">
              Which days?
            </p>
            <div
              role="group"
              aria-labelledby="series-days-label"
              className="flex flex-wrap gap-2"
            >
              {WEEKDAYS.map((day) => {
                const selected = days.has(day.index);
                return (
                  <button
                    key={day.index}
                    type="button"
                    aria-pressed={selected}
                    aria-label={day.label}
                    onClick={() => toggleDay(day.index)}
                    disabled={pending}
                    className={cn(
                      "size-11 rounded-full border text-xs font-semibold transition-colors disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                      selected
                        ? "border-transparent bg-accent-soft text-accent"
                        : "border-border bg-surface text-muted hover:text-foreground"
                    )}
                  >
                    {day.short}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="series-time">Time</Label>
            <Input
              id="series-time"
              value={timeText}
              onChange={(event) => setTimeText(event.target.value)}
              placeholder="10:00"
              autoComplete="off"
              aria-describedby="series-time-hint"
              disabled={pending}
            />
            <Hint id="series-time-hint">
              24-hour, so 2pm is 14:00. Leave it blank for something with no set
              time, like a weekly problem set.
            </Hint>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="series-start">First date</Label>
              <Input
                id="series-start"
                value={startText}
                onChange={(event) => setStartText(event.target.value)}
                placeholder="2026-01-06"
                autoComplete="off"
                disabled={pending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="series-end">Last date</Label>
              <Input
                id="series-end"
                value={endText}
                onChange={(event) => setEndText(event.target.value)}
                placeholder="2026-03-13"
                autoComplete="off"
                disabled={pending}
              />
            </div>
          </div>
        </div>
      </Card>

      <h2 className="mt-8 px-1 text-xs font-bold uppercase tracking-widest text-muted">
        Preview
      </h2>

      {preview.state === "ready" ? (
        <Card className="mt-3">
          <p className="font-bold tracking-tight">
            {countPhrase(preview.drafts.length)}
          </p>
          {summary ? <p className="mt-1 text-xs text-muted">{summary}</p> : null}
          <ul className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
            {sampleRows(preview.drafts).map((row) =>
              row.kind === "gap" ? (
                <li key="gap" className="ml-4 text-xs text-muted">
                  + {row.hidden} more
                </li>
              ) : (
                <li key={row.iso} className="flex items-center gap-2.5 text-sm">
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-brand"
                    aria-hidden
                  />
                  {shortDay(row.iso)}
                </li>
              )
            )}
          </ul>
        </Card>
      ) : (
        <div className="mt-3 flex items-start gap-2.5 rounded-card border border-dashed border-border bg-surface px-4 py-3.5">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p className="text-xs font-medium text-warning">{preview.message}</p>
        </div>
      )}

      {saveError ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {saveError}
        </p>
      ) : null}

      <Button
        onClick={() => void handleAdd()}
        disabled={pending || preview.state !== "ready"}
        className="mt-5 w-full"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <CalendarDays className="size-4" aria-hidden />
        )}
        {count > 0 ? `Add ${countPhrase(count)}` : "Add these dates"}
      </Button>
      <p className="mt-3 text-center text-xs text-muted text-pretty">
        These go on the shared calendar. Everyone in{" "}
        {courseCode || "the class"} sees them, and each one can be removed on
        its own later.
      </p>
    </div>
  );
}
