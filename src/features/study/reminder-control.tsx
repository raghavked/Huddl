"use client";

import { useState } from "react";
import { Bell, BellOff, Check, CircleAlert, Clock } from "lucide-react";
import { cardClasses } from "@/components/ui";
import {
  KindChip,
  relativeDay,
  shortDay,
  timeSuffix,
} from "@/features/study/kind-chip";
import {
  LEAD_CHOICES,
  LEAD_MIN_MINUTES,
  ReminderError,
  clearReminder,
  describeLead,
  reminderFiresAt,
  setReminder,
  type LeadChoice,
  type Reminder,
} from "@/lib/reminders";
import type { CalendarKind } from "@/lib/syllabus";
import { cn } from "@/lib/utils";

/* The bell on a class-calendar row, and the lead-time ladder behind it.
 *
 * Everything about how a reminder works lives in `@/lib/reminders`; this file
 * only draws it. Two things are worth knowing before changing the copy:
 *
 *   - The sweep ticks hourly, so a nudge lands at the first tick after the
 *     moment the student picked, not on the minute. Nothing here ever says a
 *     clock time for a reminder; "around the time you pick" is the promise
 *     we can actually keep.
 *   - A lead longer than the time left is a reminder that will never arrive.
 *     `reminderFiresAt` is how we know, and a rung in that state is faded and
 *     says why when it's clicked, rather than arming a bell that can't ring.
 *
 * Writes are optimistic: the bell fills the moment it's clicked and rolls back
 * with a warm line if the write doesn't land.
 */

/** Serializable row shape the calendar page passes down. */
export type ReminderItemRow = {
  id: string;
  kind: CalendarKind;
  title: string;
  /** ISO timestamp. */
  due_at: string;
};

/** A reminder as the server hands it over, the same shape the module returns. */
export type ReminderRow = Reminder;

/* ------------------------------- copy bits -------------------------------- */

/** A ladder label dropped into the middle of a sentence: "the night before". */
function leadPhrase(minutes: number): string {
  const label = describeLead(minutes);
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * The quiet second line on a row that has a reminder on it. A stamped reminder
 * already did its job, so it says so rather than sounding armed.
 */
function reminderCaption(reminder: Reminder): string {
  const phrase = leadPhrase(reminder.lead_minutes);
  return reminder.sent_at === null
    ? `Reminder: ${phrase}`
    : `Reminded you ${phrase}`;
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ReminderError ? error.message : fallback;
}

/* --------------------------------- the row -------------------------------- */

function ReminderRowCard({
  item,
  reminder,
  onArm,
  onDisarm,
}: {
  item: ReminderItemRow;
  reminder: Reminder | undefined;
  onArm: (item: ReminderItemRow, minutes: number) => void;
  onDisarm: (item: ReminderItemRow) => void;
}) {
  /* The moment the ladder was opened. Every "has this gone by?" question in
     the panel is answered against this one reading, so two rungs can never
     disagree because the clock moved between them. */
  const [openedAt, setOpenedAt] = useState<Date | null>(null);
  const [pastChoice, setPastChoice] = useState<number | null>(null);

  const panelId = `reminder-ladder-${item.id}`;
  const open = openedAt !== null;
  const due = new Date(item.due_at);

  /* Even the closest rung is behind us. There is no honest choice left to
     offer, so the panel explains instead of listing seven dead ones. */
  const tooLate =
    openedAt !== null &&
    reminderFiresAt(due, LEAD_MIN_MINUTES, openedAt).past;

  function toggle() {
    setPastChoice(null);
    setOpenedAt((current) => (current === null ? new Date() : null));
  }

  function pick(choice: LeadChoice) {
    if (openedAt === null) return;
    // A lead longer than the time left is a nudge the sweep would skip, so say
    // so where they clicked instead of arming nothing.
    if (reminderFiresAt(due, choice.minutes, openedAt).past) {
      setPastChoice(choice.minutes);
      return;
    }
    setOpenedAt(null);
    setPastChoice(null);
    onArm(item, choice.minutes);
  }

  return (
    <li className={cardClasses({ padding: "none", className: "px-4 py-3" })}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <KindChip kind={item.kind} />
            <p className="min-w-0 truncate text-sm font-semibold">
              {item.title}
            </p>
          </div>
          <p className="mt-1 text-xs text-muted">
            {shortDay(item.due_at)} · {relativeDay(item.due_at)}
            {timeSuffix(item.due_at)}
          </p>
          {reminder ? (
            <p className="mt-0.5 text-xs font-medium text-brand-ink">
              {reminderCaption(reminder)}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={
            reminder
              ? `Change the reminder for ${item.title}, currently ${leadPhrase(
                  reminder.lead_minutes
                )}`
              : `Remind me about ${item.title}`
          }
          title={reminder ? "Change this reminder" : "Remind me"}
          className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <span
            className={cn(
              "flex size-8 items-center justify-center rounded-full transition-colors",
              reminder
                ? "bg-brand-soft text-brand"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            )}
          >
            <Bell className="size-4" aria-hidden />
          </span>
        </button>
      </div>

      {open ? (
        <div id={panelId} className="mt-3 border-t border-border pt-3">
          <p className="text-xs text-muted">
            {/* Loose on purpose: the sweep ticks hourly, so a nudge lands near
                the moment they picked, not on the minute. */}
            Due {shortDay(item.due_at)}
            {timeSuffix(item.due_at)}.
            {tooLate ? "" : " One nudge, around the time you pick."}
          </p>

          {tooLate ? (
            <p className="mt-2 text-xs font-medium text-warning">
              This one&apos;s due too soon. Even the closest reminder would
              land after the deadline.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {LEAD_CHOICES.map((choice) => {
                const chosen = reminder?.lead_minutes === choice.minutes;
                const past =
                  openedAt !== null &&
                  reminderFiresAt(due, choice.minutes, openedAt).past;
                return (
                  <li key={choice.minutes}>
                    <button
                      type="button"
                      onClick={() => pick(choice)}
                      aria-pressed={chosen}
                      className={cn(
                        "flex h-11 w-full items-center gap-2.5 rounded-full px-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                        chosen
                          ? "bg-brand-soft font-semibold text-brand-ink"
                          : "hover:bg-surface-2",
                        // Faded when that moment is already behind them:
                        // clicking says why rather than arming a dead nudge.
                        past && !chosen && "opacity-60"
                      )}
                    >
                      {chosen ? (
                        <Check className="size-4 shrink-0" aria-hidden />
                      ) : (
                        <Clock
                          className="size-4 shrink-0 text-muted"
                          aria-hidden
                        />
                      )}
                      {choice.label}
                    </button>
                    {pastChoice === choice.minutes ? (
                      <p className="mb-1 ml-10 text-xs font-medium text-warning">
                        That moment has passed. Pick something closer in.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {reminder ? (
            <button
              type="button"
              onClick={() => {
                setOpenedAt(null);
                setPastChoice(null);
                onDisarm(item);
              }}
              className="mt-1 flex h-11 w-full items-center gap-2.5 rounded-full border-t border-border px-3 text-left text-sm text-danger transition-colors hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
            >
              <BellOff className="size-4 shrink-0" aria-hidden />
              Don&apos;t remind me
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/* ------------------------------- the section ------------------------------ */

/**
 * The reminders panel on a class calendar: every date still far enough ahead
 * for a nudge to reach you, each with a bell.
 *
 * The page filters the list, so anything rendered here can honestly be armed.
 * An item whose closest possible reminder is already behind it doesn't appear
 * unless there's a reminder on it to read and turn off.
 *
 * Reminders are private. The dates are the class's; who wants nudging about
 * them is nobody else's business, and nothing here is ever visible to a
 * classmate.
 */
export function ReminderControl({
  items,
  initialReminders,
  loadError,
}: {
  /** Upcoming rows, earliest first. */
  items: ReminderItemRow[];
  /** The caller's own reminders across those rows. */
  initialReminders: ReminderRow[];
  /** Set when the server couldn't read the reminders. Say so, don't hide it. */
  loadError?: string | null;
}) {
  const [reminders, setReminders] = useState<Map<string, Reminder>>(
    () => new Map(initialReminders.map((row) => [row.item_id, row]))
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  /** Put one item's reminder back the way it was: its own inverse. */
  function restore(itemId: string, previous: Reminder | undefined) {
    setReminders((prev) => {
      const next = new Map(prev);
      if (previous) next.set(itemId, previous);
      else next.delete(itemId);
      return next;
    });
  }

  /** Arm or re-aim a reminder. The bell fills now; the row syncs behind it. */
  async function arm(item: ReminderItemRow, minutes: number) {
    const previous = reminders.get(item.id);
    setActionError(null);
    setReminders((prev) =>
      new Map(prev).set(item.id, {
        item_id: item.id,
        lead_minutes: minutes,
        // Picking a new lead re-arms a reminder that already went out.
        sent_at: null,
      })
    );
    try {
      const saved = await setReminder(item.id, minutes);
      setReminders((prev) => new Map(prev).set(item.id, saved));
      setAnnouncement(
        `You'll be reminded about ${item.title} ${leadPhrase(minutes)}.`
      );
    } catch (caught) {
      restore(item.id, previous);
      setActionError(
        messageFor(
          caught,
          "We couldn't set that reminder just now. Give it another go."
        )
      );
    }
  }

  /** Take the reminder off, with the bell emptying first. */
  async function disarm(item: ReminderItemRow) {
    const previous = reminders.get(item.id);
    setActionError(null);
    setReminders((prev) => {
      const next = new Map(prev);
      next.delete(item.id);
      return next;
    });
    try {
      await clearReminder(item.id);
      setAnnouncement(`No more reminders about ${item.title}.`);
    } catch (caught) {
      restore(item.id, previous);
      setActionError(
        messageFor(
          caught,
          "We couldn't turn that reminder off just now. Give it another go."
        )
      );
    }
  }

  const error = actionError ?? loadError ?? null;

  return (
    <div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {error ? (
        <p
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2.5">
        {items.map((item) => (
          <ReminderRowCard
            key={item.id}
            item={item}
            reminder={reminders.get(item.id)}
            onArm={(row, minutes) => void arm(row, minutes)}
            onDisarm={(row) => void disarm(row)}
          />
        ))}
      </ul>
    </div>
  );
}
