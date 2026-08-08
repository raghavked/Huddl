"use client";

import Link from "next/link";
import { useState } from "react";
import {
  CalendarDays,
  Check,
  CircleAlert,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  Button,
  Card,
  Input,
  Label,
  buttonClasses,
  cardClasses,
} from "@/components/ui";
import {
  KindChip,
  kindChipClasses,
  relativeDay,
  shortDay,
  timeSuffix,
} from "@/features/study/kind-chip";
import { createClient } from "@/lib/supabase/client";
import { CALENDAR_KINDS, kindLabel, type CalendarKind } from "@/lib/syllabus";
import { cn } from "@/lib/utils";

/** Serializable row shape the calendar page passes down. */
export type CalendarItemRow = {
  id: string;
  created_by: string | null;
  kind: CalendarKind;
  title: string;
  due_at: string;
  source: "manual" | "syllabus";
};

type MonthSection = { key: string; title: string; items: CalendarItemRow[] };

/** Group date-sorted items into month sections ("October 2026"). */
function groupByMonth(items: CalendarItemRow[]): MonthSection[] {
  const sections: MonthSection[] = [];
  let current: MonthSection | null = null;
  for (const item of items) {
    const d = new Date(item.due_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (current === null || current.key !== key) {
      current = {
        key,
        title: d.toLocaleDateString([], { month: "long", year: "numeric" }),
        items: [],
      };
      sections.push(current);
    }
    current.items.push(item);
  }
  return sections;
}

function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * The shared class calendar: month-grouped items with private check-off
 * circles, an inline "Add a date" form, and creator-only removal. Check-offs
 * flip optimistically and roll back if the write fails.
 */
export function CalendarSection({
  courseId,
  userId,
  initialItems,
  initialCheckedIds,
}: {
  courseId: string;
  userId: string;
  initialItems: CalendarItemRow[];
  initialCheckedIds: string[];
}) {
  const [items, setItems] = useState<CalendarItemRow[]>(initialItems);
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(initialCheckedIds)
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // The inline "Add a date" form — no datepicker dependency, just honest text.
  const [formOpen, setFormOpen] = useState(false);
  const [formKind, setFormKind] = useState<CalendarKind>("assignment");
  const [formTitle, setFormTitle] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formTime, setFormTime] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formPending, setFormPending] = useState(false);

  const syllabusHref = `/courses/${courseId}/syllabus`;

  /* --------------------------- check-offs ---------------------------- */

  async function toggleCheck(item: CalendarItemRow) {
    const wasChecked = checked.has(item.id);
    setActionError(null);
    // Optimistic: the circle flips now, the row syncs behind it.
    setChecked((prev) => {
      const next = new Set(prev);
      if (wasChecked) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    const supabase = createClient();
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
  }

  /* ------------------------ creator delete --------------------------- */

  async function deleteItem(item: CalendarItemRow) {
    setActionError(null);
    setDeletingId(item.id);
    const before = items;
    setItems((prev) => prev.filter((row) => row.id !== item.id));
    const supabase = createClient();
    const { error } = await supabase
      .from("course_calendar_items")
      .delete()
      .eq("id", item.id);
    setDeletingId(null);
    setConfirmingId(null);
    if (error) {
      setItems(before);
      setActionError("We couldn't remove that date. Give it another try.");
    }
  }

  /* --------------------------- add a date ---------------------------- */

  function resetForm() {
    setFormOpen(false);
    setFormKind("assignment");
    setFormTitle("");
    setFormDate("");
    setFormTime("");
    setFormError(null);
  }

  async function handleAdd() {
    if (formPending) return;
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
    const supabase = createClient();
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
      .select("id, created_by, kind, title, due_at, source")
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
  }

  /* ------------------------------ render ------------------------------ */

  return (
    <div>
      {formOpen ? (
        <Card className="animate-fade-up">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold tracking-tight">Add a date</h2>
            <button
              type="button"
              onClick={resetForm}
              disabled={formPending}
              aria-label="Close the add form"
              className="rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div
            className="mt-3 flex flex-wrap gap-2"
            role="group"
            aria-label="What kind of date is it?"
          >
            {CALENDAR_KINDS.map((kind) => {
              const selected = kind === formKind;
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`Kind: ${kindLabel(kind)}`}
                  onClick={() => setFormKind(kind)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                    selected
                      ? cn("border-transparent", kindChipClasses(kind))
                      : "border-border bg-surface text-muted hover:text-foreground"
                  )}
                >
                  {kindLabel(kind)}
                </button>
              );
            })}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleAdd();
            }}
          >
            <div className="mt-4">
              <Label htmlFor="calendar-title">Title</Label>
              <Input
                id="calendar-title"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Midterm 2"
                maxLength={200}
                disabled={formPending}
                className="mt-1.5"
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="calendar-date">Date</Label>
                <Input
                  id="calendar-date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  placeholder="2026-10-14"
                  autoComplete="off"
                  disabled={formPending}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="calendar-time">Time (optional)</Label>
                <Input
                  id="calendar-time"
                  value={formTime}
                  onChange={(e) => setFormTime(e.target.value)}
                  placeholder="14:30"
                  autoComplete="off"
                  disabled={formPending}
                  className="mt-1.5"
                />
              </div>
            </div>
            {formError ? (
              <p role="alert" className="mt-3 text-xs font-medium text-danger">
                {formError}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={formPending}
                onClick={resetForm}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={formPending}>
                {formPending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <CalendarDays className="size-3.5" aria-hidden />
                )}
                Add to the calendar
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Button variant="secondary" onClick={() => setFormOpen(true)}>
          <Plus className="size-4" aria-hidden />
          Add a date
        </Button>
      )}

      {actionError ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {actionError}
        </p>
      ) : null}

      {items.length === 0 ? (
        <div className="mt-6 rounded-card border border-dashed border-border">
          <EmptyState
            icon={CalendarDays}
            title="Nothing on the calendar yet"
            description="Paste the syllabus once and every classmate gets the whole schedule."
            action={
              <Link
                href={syllabusHref}
                className={buttonClasses({ variant: "soft", size: "sm" })}
              >
                Import syllabus
              </Link>
            }
          />
        </div>
      ) : (
        groupByMonth(items).map((section) => (
          <section key={section.key} className="mt-6" aria-label={section.title}>
            <h2 className="px-1 text-xs font-bold uppercase tracking-widest text-muted">
              {section.title}
            </h2>
            <ul className="mt-3 flex flex-col gap-2.5">
              {section.items.map((item) => {
                const done = checked.has(item.id);
                const mine = item.created_by === userId;
                return (
                  <li
                    key={item.id}
                    className={cardClasses({
                      padding: "none",
                      className: "flex items-center gap-2 py-3 pl-4 pr-2",
                    })}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <KindChip kind={item.kind} />
                        <p
                          className={cn(
                            "min-w-0 truncate text-sm font-semibold",
                            done && "text-muted line-through"
                          )}
                        >
                          {item.title}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {shortDay(item.due_at)} · {relativeDay(item.due_at)}
                        {timeSuffix(item.due_at)}
                      </p>
                    </div>
                    {mine ? (
                      confirmingId === item.id ? (
                        <span className="flex shrink-0 items-center gap-1">
                          <span className="text-xs font-medium text-muted">
                            Remove for the class?
                          </span>
                          <button
                            type="button"
                            onClick={() => void deleteItem(item)}
                            disabled={deletingId === item.id}
                            className={buttonClasses({
                              variant: "danger",
                              size: "sm",
                            })}
                          >
                            {deletingId === item.id ? (
                              <Loader2
                                className="size-3.5 animate-spin"
                                aria-hidden
                              />
                            ) : null}
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingId(null)}
                            disabled={deletingId === item.id}
                            aria-label="Keep this date"
                            className="rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                          >
                            <X className="size-4" aria-hidden />
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setActionError(null);
                            setConfirmingId(item.id);
                          }}
                          aria-label={`Remove ${item.title} from the class calendar`}
                          title="Remove"
                          className="shrink-0 rounded-full p-2 text-muted transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      )
                    ) : null}
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={done}
                      aria-label={`${item.title}, ${shortDay(item.due_at)}`}
                      onClick={() => void toggleCheck(item)}
                      className="flex size-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      <span
                        className={cn(
                          "flex size-7 items-center justify-center rounded-full border-2 transition-colors",
                          done
                            ? "border-transparent bg-success text-on-solid"
                            : "border-border"
                        )}
                      >
                        {done ? <Check className="size-4" aria-hidden /> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
