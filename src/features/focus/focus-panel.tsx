"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  CircleAlert,
  CloudOff,
  Lamp,
  Loader2,
  Zap,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { DiscoverScene } from "@/components/illustrations";
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  SectionHeader,
  cardClasses,
} from "@/components/ui";
import {
  FOCUS_GOAL_DEFAULT,
  FOCUS_GOAL_PRESETS,
  FOCUS_NOTE_MAX,
  FocusError,
  computeFocusStreak,
  elapsedMinutes,
  endFocus,
  fetchMyOpenSession,
  fetchStudyingNow,
  formatDuration,
  progress,
  remainingMinutes,
  startFocus,
  subscribeStudyingNow,
  type FocusSession,
  type StudyingNow,
} from "@/lib/focus";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/* Focus: sit down with a goal, and see who else is heads-down.
 *
 * Two states in one page. Idle is an invitation: pick a length, maybe a
 * class, maybe a line about what you're doing, and start. Running is a timer
 * that takes over, with the "studying now" list still breathing underneath so
 * the room never feels empty.
 *
 * All the time math lives in `@/lib/focus` and takes a `now`. This component
 * only decides how often to hand it one (once a second, and only while a
 * session is actually running). The first `now` comes from the server so the
 * first paint and the hydration agree to the millisecond. */

/** A course you can attach a session to. */
export type CourseOption = { id: string; code: string };

/** How far back the streak query looks: long enough for any real run. */
const STREAK_WINDOW_DAYS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What "Done" leaves on the page: the one number worth saying out loud. */
type Finished = { minutes: number };

/* ------------------------------- copy -------------------------------- */

/** The one line a finished session earns. Warm, never a scoreboard. */
function completionLine(minutes: number): string {
  if (minutes < 1) return "Short one. It still counts.";
  if (minutes === 1) return "A minute down. That counts.";
  if (minutes < 60) return `${minutes} minutes down. That counts.`;
  return `${formatDuration(minutes)} down. That counts.`;
}

/** "23m in", or something kinder for someone who just sat down. */
function sinceLabel(minutes: number): string {
  return minutes < 1 ? "Just sat down" : `${formatDuration(minutes)} in`;
}

/* ------------------------------ queries ------------------------------ */

/**
 * Your focus streak, in days. `computeFocusStreak` only needs `ended_at`, so
 * that's all we pull: a few hundred timestamps at most. Called again after
 * a session closes, which is the one moment the number can change.
 */
async function loadStreak(userId: string): Promise<number> {
  const since = new Date(Date.now() - STREAK_WINDOW_DAYS * DAY_MS).toISOString();
  const { data, error } = await createClient()
    .from("focus_sessions")
    .select("ended_at")
    .eq("user_id", userId)
    .not("ended_at", "is", null)
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(400);
  if (error) throw error;
  const rows = (data ?? []) as { ended_at: string | null }[];
  return computeFocusStreak(rows, new Date());
}

/* ------------------------------- pieces ------------------------------ */

/** The quiet uppercase heading inside a card, in a section label's voice. */
function FormLabel({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-xs font-bold uppercase tracking-widest text-muted">
      {children}
    </p>
  );
}

/** A pickable pill: quiet until it's chosen, then clay-filled and inked. */
function ChoiceChip({
  label,
  selected,
  ariaLabel,
  onSelect,
}: {
  label: string;
  selected: boolean;
  ariaLabel?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={ariaLabel}
      onClick={onSelect}
      className={cn(
        "inline-flex h-11 shrink-0 items-center rounded-full border px-4 text-sm font-semibold transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        selected
          ? "border-brand-ink bg-brand-soft text-brand-ink"
          : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

/** The slim bar under the readout: brand fill on surface-2, no animation. */
function ProgressBar({ value }: { value: number }) {
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Progress through your goal"
      className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div
        className="h-full rounded-full bg-brand transition-[width]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** One classmate, heads-down. The whole row opens their profile. */
function StudyingRow({ row, now }: { row: StudyingNow; now: Date }) {
  const minutes = elapsedMinutes(row, now);
  const detail = row.note ?? `${formatDuration(row.goal_minutes)} goal`;

  return (
    <li>
      <Link
        href={`/u/${row.person.handle}`}
        className={cardClasses({
          padding: "none",
          interactive: true,
          className: "flex items-center gap-3 px-3.5 py-3",
        })}
      >
        <Avatar name={row.person.display_name} src={row.person.avatar_url} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">
              {row.person.display_name}
            </span>
            {row.course_code ? (
              <Badge tone="brand">{row.course_code}</Badge>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted">
            {sinceLabel(minutes)} · {detail}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  );
}

/* -------------------------------- panel ------------------------------ */

/**
 * The whole focus page below its title: your own state (idle form, running
 * timer, or the line a finished session earns) and the campus's "studying
 * now" list, kept honest over realtime.
 */
export function FocusPanel({
  userId,
  nowIso,
  initialSession,
  initialStudying,
  initialStreak,
  courses,
  initialError,
}: {
  userId: string;
  /** The server's "now". Keeps the first render deterministic across SSR + hydration. */
  nowIso: string;
  initialSession: FocusSession | null;
  initialStudying: StudyingNow[];
  initialStreak: number;
  courses: CourseOption[];
  initialError: string | null;
}) {
  const [mine, setMine] = useState<FocusSession | null>(initialSession);
  const [studying, setStudying] = useState<StudyingNow[]>(initialStudying);
  const [streak, setStreak] = useState(initialStreak);

  const [error, setError] = useState<string | null>(initialError);
  const [formError, setFormError] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);

  const [reloading, setReloading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [finished, setFinished] = useState<Finished | null>(null);

  /* The idle form's draft. */
  const [goal, setGoal] = useState<number>(FOCUS_GOAL_DEFAULT);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  /* The clock the whole page reads from. Starts on the server's moment, then
     ticks once a second while a session is running. */
  const [now, setNow] = useState<Date>(() => new Date(nowIso));

  /* ----------------------------- loading ----------------------------- */

  const refreshStudying = useCallback(async () => {
    try {
      const rows = await fetchStudyingNow();
      // You're the timer at the top of the page, not a row in the list.
      setStudying(rows.filter((row) => row.user_id !== userId));
      // An idle page doesn't tick, so a realtime change is also when the
      // "23m in" labels get to be honest again.
      setNow(new Date());
    } catch {
      // Keep the last good list; a dropped refresh isn't worth a banner.
    }
  }, [userId]);

  const refreshStreak = useCallback(async () => {
    try {
      setStreak(await loadStreak(userId));
    } catch {
      // The streak is a garnish; it never blocks the page.
    }
  }, [userId]);

  /** The retry behind every error state here. */
  const reload = useCallback(async () => {
    setReloading(true);
    try {
      const [open, rows] = await Promise.all([
        fetchMyOpenSession(),
        fetchStudyingNow(),
      ]);
      setMine(open);
      setStudying(rows.filter((row) => row.user_id !== userId));
      setNow(new Date());
      setError(null);
      void refreshStreak();
    } catch (caught) {
      setError(
        caught instanceof FocusError
          ? caught.message
          : "We couldn't open focus just now."
      );
    } finally {
      setReloading(false);
    }
  }, [userId, refreshStreak]);

  /* The list breathes while you sit: realtime payloads are bare rows with no
     profile attached, so every change is a refetch. */
  useEffect(
    () => subscribeStudyingNow(() => void refreshStudying()),
    [refreshStudying]
  );

  /* One 1s interval, only while running, cleared on unmount. Nothing here
     animates per frame: the bar just redraws each tick. */
  const running = mine !== null;
  useEffect(() => {
    if (!running) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [running]);

  /* ----------------------------- actions ----------------------------- */

  const start = useCallback(async () => {
    if (starting) return;
    setFormError(null);
    setStarting(true);
    try {
      const created = await startFocus({ courseId, goalMinutes: goal, note });
      setFinished(null);
      setMine(created);
      setNow(new Date());
      setNote("");
      void refreshStudying();
    } catch (caught) {
      setFormError(
        caught instanceof FocusError
          ? caught.message
          : "We couldn't start that session. Give it another go."
      );
    } finally {
      setStarting(false);
    }
  }, [starting, courseId, goal, note, refreshStudying]);

  /**
   * Stand up. Optimistic: the timer stops the moment you click, and the
   * session comes back (with a warm note) only if the write fails. `mode`
   * decides the ceremony: "done" earns a line, "quit" quietly puts things
   * away.
   */
  const finish = useCallback(
    async (mode: "done" | "quit") => {
      const current = mine;
      if (!current || ending) return;
      setEndError(null);
      setEnding(true);
      const minutes = elapsedMinutes(current, new Date());
      setMine(null);
      setFinished(mode === "done" ? { minutes } : null);
      try {
        await endFocus(current.id);
        void refreshStudying();
        void refreshStreak();
      } catch (caught) {
        setMine(current);
        setFinished(null);
        setEndError(
          caught instanceof FocusError
            ? caught.message
            : "We couldn't close that session. Give it another go."
        );
      } finally {
        setEnding(false);
      }
    },
    [mine, ending, refreshStudying, refreshStreak]
  );

  /* ----------------------------- derived ----------------------------- */

  /* The list's clock, rounded down to the minute. Elapsed labels are whole
     minutes anyway, so the rows stay still between ticks while the timer
     above them counts in real time. */
  const minuteMark = Math.floor(now.getTime() / 60_000);
  const listNow = useMemo(() => new Date(minuteMark * 60_000), [minuteMark]);

  const timer = useMemo(() => {
    if (!mine) return null;
    const left = remainingMinutes(mine, now);
    const done = elapsedMinutes(mine, now);
    const past = left === 0;
    const goalText = formatDuration(mine.goal_minutes);
    return {
      readout: past ? formatDuration(done) : formatDuration(left),
      caption: past
        ? `${goalText} goal reached. Stand up whenever you like`
        : `left of your ${goalText} goal`,
      value: progress(mine, now),
      courseCode:
        courses.find((course) => course.id === mine.course_id)?.code ?? null,
    };
  }, [mine, now, courses]);

  /* ------------------------------ render ----------------------------- */

  // Nothing loaded and nothing running: the whole page is the error.
  if (error && !mine && studying.length === 0) {
    return (
      <div className="mt-6 flex flex-col items-center gap-2.5 px-6 py-16 text-center">
        <CloudOff className="size-7 text-muted" aria-hidden />
        <p className="font-bold tracking-tight">Focus didn&apos;t load</p>
        <p className="max-w-xs text-sm text-muted text-pretty">
          {error} Check your connection and give it another go.
        </p>
        <Button
          variant="soft"
          size="sm"
          disabled={reloading}
          onClick={() => void reload()}
          className="mt-1"
        >
          {reloading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : null}
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div>
      {streak >= 2 ? (
        <div className="mt-4">
          {/* Quiet below 2: a streak is a gift, never a debt. */}
          <Badge tone="accent">
            <Zap className="size-3" aria-hidden />
            {streak}-day streak
          </Badge>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2"
        >
          <p className="flex min-w-0 items-start gap-2 text-xs font-medium text-danger">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            We couldn&apos;t refresh just now, so anything below may be a few
            minutes old.
          </p>
          <Button
            variant="soft"
            size="sm"
            disabled={reloading}
            onClick={() => void reload()}
          >
            {reloading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : null}
            Try again
          </Button>
        </div>
      ) : null}

      {mine && timer ? (
        /* --------------------------- running --------------------------- */
        <Card className="mt-5 flex animate-fade-up flex-col items-center gap-3.5 text-center">
          <p className="mt-1 font-display text-5xl font-bold tracking-tight tabular-nums">
            {timer.readout}
          </p>
          <p className="text-xs text-muted text-pretty">{timer.caption}</p>

          <ProgressBar value={timer.value} />

          {timer.courseCode || mine.note ? (
            <div className="flex flex-col items-center gap-2">
              {timer.courseCode ? (
                <Badge tone="brand">{timer.courseCode}</Badge>
              ) : null}
              {mine.note ? (
                <p className="text-sm font-medium break-words text-pretty">
                  {mine.note}
                </p>
              ) : null}
            </div>
          ) : null}

          {endError ? (
            <p role="alert" className="text-xs font-medium text-danger">
              {endError}
            </p>
          ) : null}

          <Button
            size="lg"
            className="mt-1 w-full"
            disabled={ending}
            onClick={() => void finish("done")}
          >
            {ending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            Done
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={ending}
            onClick={() => void finish("quit")}
          >
            Give up on this one
          </Button>
        </Card>
      ) : finished ? (
        /* ------------------------ just finished ------------------------ */
        <Card className="mt-5 flex animate-fade-up flex-col items-center gap-2.5 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent">
            <Check className="size-5" aria-hidden />
          </span>
          <p className="font-bold tracking-tight">
            {completionLine(finished.minutes)}
          </p>
          <p className="max-w-xs text-sm text-muted text-pretty">
            Stretch, get water, come back when you&apos;re ready.
          </p>
          <Button
            variant="soft"
            size="sm"
            className="mt-1"
            onClick={() => setFinished(null)}
          >
            Sit down again
          </Button>
        </Card>
      ) : (
        /* ---------------------------- idle ----------------------------- */
        <>
          <p className="mt-2 text-sm text-muted">
            Pick a length, sit down, and see who else is heads-down.
          </p>

          <Card className="mt-5 animate-fade-up">
            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                void start();
              }}
            >
              <div className="flex flex-col gap-2.5">
                <FormLabel id="focus-goal-label">How long</FormLabel>
                <div
                  role="radiogroup"
                  aria-labelledby="focus-goal-label"
                  className="flex flex-wrap gap-2"
                >
                  {FOCUS_GOAL_PRESETS.map((minutes) => (
                    <ChoiceChip
                      key={minutes}
                      label={formatDuration(minutes)}
                      ariaLabel={`${formatDuration(minutes)} goal`}
                      selected={goal === minutes}
                      onSelect={() => setGoal(minutes)}
                    />
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                <FormLabel id="focus-course-label">On what</FormLabel>
                <div
                  role="radiogroup"
                  aria-labelledby="focus-course-label"
                  className="flex flex-wrap gap-2"
                >
                  <ChoiceChip
                    label="Just studying"
                    selected={courseId === null}
                    onSelect={() => setCourseId(null)}
                  />
                  {courses.map((course) => (
                    <ChoiceChip
                      key={course.id}
                      label={course.code}
                      selected={courseId === course.id}
                      onSelect={() => setCourseId(course.id)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <Label htmlFor="focus-note">What are you working on?</Label>
                <Input
                  id="focus-note"
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  placeholder="Optional: problem set 4"
                  maxLength={FOCUS_NOTE_MAX}
                  disabled={starting}
                  className="mt-1.5"
                />
              </div>

              {formError ? (
                <p role="alert" className="text-xs font-medium text-danger">
                  {formError}
                </p>
              ) : null}

              <div className="flex flex-col gap-2">
                <Button type="submit" size="lg" disabled={starting}>
                  {starting ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : null}
                  Start
                </Button>
                <p className="text-center text-xs text-muted text-pretty">
                  Your name shows up below while you&apos;re sitting. That&apos;s
                  the whole trick.
                </p>
              </div>
            </form>
          </Card>
        </>
      )}

      <section className="mt-8" aria-label="Studying now">
        <SectionHeader title="Studying now" />
        {studying.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-border">
            <EmptyState
              illustration={<DiscoverScene />}
              icon={Lamp}
              title="Nobody's heads-down right now"
              description="Be the first. Start a session and the next person to open this sees they're not alone."
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2.5">
            {studying.map((row) => (
              <StudyingRow key={row.id} row={row} now={listNow} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
