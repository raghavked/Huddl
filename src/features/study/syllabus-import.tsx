"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CalendarDays,
  Check,
  CircleAlert,
  Loader2,
  Search,
  X,
} from "lucide-react";
import {
  Button,
  Card,
  Label,
  Textarea,
  buttonClasses,
  controlClasses,
} from "@/components/ui";
import { kindChipClasses, shortDay } from "@/features/study/kind-chip";
import { createClient } from "@/lib/supabase/client";
import {
  CALENDAR_KINDS,
  kindLabel,
  parseSyllabus,
  toCalendarRows,
  type CalendarKind,
  type ParsedItem,
} from "@/lib/syllabus";
import { cn } from "@/lib/utils";

/* A parsed row the student can still shape before it ships to the class. */
type EditableRow = {
  key: string;
  kind: CalendarKind;
  title: string;
  dueAt: Date;
  confidence: "high" | "low";
};

const PLACEHOLDER =
  "Week 3\nMon 10/14  Lecture: limits\nHW 3 due 10/16\nOct 24  Midterm exam";

/**
 * Paste-first syllabus import: the parser runs right here in the browser,
 * the student shapes the preview, and only the confirmed dates are written
 * to the shared class calendar (plus one audit row — never the text).
 */
export function SyllabusImport({
  courseId,
  courseCode,
  userId,
}: {
  courseId: string;
  courseCode: string;
  userId: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<EditableRow[] | null>(null); // null = not parsed yet
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);

  const calendarHref = `/courses/${courseId}/calendar`;

  // Warm confirmation lingers a beat, then the calendar is one step away.
  useEffect(() => {
    if (doneCount === null) return;
    const timer = setTimeout(() => router.push(calendarHref), 1600);
    return () => clearTimeout(timer);
  }, [doneCount, router, calendarHref]);

  function handleParse() {
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
  }

  function cycleKind(key: string) {
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
  }

  function retitle(key: string, title: string) {
    setRows((prev) =>
      prev === null
        ? prev
        : prev.map((row) => (row.key === key ? { ...row, title } : row))
    );
  }

  function removeRow(key: string) {
    setRows((prev) =>
      prev === null ? prev : prev.filter((row) => row.key !== key)
    );
  }

  async function handleAdd() {
    if (rows === null || rows.length === 0 || adding) return;
    if (rows.some((row) => row.title.trim() === "")) {
      setAddError("Every date needs a title — fill in the blank ones first.");
      return;
    }
    setAdding(true);
    setAddError(null);
    // RLS wants created_by to be the caller — stamp it onto each row.
    const inserts = toCalendarRows(
      rows.map((row) => ({
        kind: row.kind,
        title: row.title.trim(),
        dueAt: row.dueAt,
        confidence: row.confidence,
      })),
      courseId
    ).map((row) => ({ ...row, created_by: userId }));
    const supabase = createClient();
    const { error } = await supabase
      .from("course_calendar_items")
      .insert(inserts);
    if (error) {
      setAdding(false);
      setAddError(
        "We couldn't add those dates — check you're still in this course and give it another try."
      );
      return;
    }
    // The audit row is a nice-to-have; a hiccup here shouldn't undo success.
    await supabase.from("syllabus_imports").insert({
      course_id: courseId,
      user_id: userId,
      item_count: inserts.length,
    });
    setAdding(false);
    setDoneCount(inserts.length);
  }

  /* ------------------------------ render ------------------------------ */

  if (doneCount !== null) {
    const noun = doneCount === 1 ? "date" : "dates";
    return (
      <Card padding="lg" className="animate-fade-up text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
          <Check className="size-7" aria-hidden />
        </span>
        <p className="mt-4 font-bold tracking-tight">
          {doneCount} {noun} on the class calendar
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
          Everyone in {courseCode} sees them now — nice one.
        </p>
        <Link
          href={calendarHref}
          className={buttonClasses({
            variant: "soft",
            size: "sm",
            className: "mt-4",
          })}
        >
          Back to the calendar
        </Link>
      </Card>
    );
  }

  const parsedEmpty = rows !== null && rows.length === 0;
  const count = rows?.length ?? 0;
  const countNoun = count === 1 ? "date" : "dates";

  return (
    <div>
      <Label htmlFor="syllabus-text">
        Paste your syllabus — the schedule section works best
      </Label>
      <Textarea
        id="syllabus-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={PLACEHOLDER}
        disabled={adding}
        className="mt-1.5 min-h-40 font-mono text-xs sm:text-sm"
      />

      <Button
        variant="secondary"
        className="mt-4"
        disabled={text.trim() === "" || adding}
        onClick={handleParse}
      >
        <Search className="size-4" aria-hidden />
        Find the dates
      </Button>

      {parsedEmpty ? (
        <div className="mt-5 flex flex-col items-center gap-1.5 rounded-card border border-dashed border-border px-6 py-8 text-center">
          <CalendarDays className="size-5 text-muted" aria-hidden />
          <p className="mt-1 text-sm font-bold tracking-tight">No dates found</p>
          <p className="max-w-sm text-sm text-muted">
            Paste the part of the syllabus with the schedule table — the lines
            that pair a date with an assignment or exam.
          </p>
        </div>
      ) : null}

      {rows !== null && rows.length > 0 ? (
        <div className="mt-6">
          <p className="text-sm text-muted">
            Found {count} {countNoun} — click a chip to change what it is, fix
            any titles, and drop anything that doesn&apos;t belong.
          </p>

          <ul className="mt-3 flex flex-col gap-2.5">
            {rows.map((row) => {
              const low = row.confidence === "low";
              return (
                <li
                  key={row.key}
                  className={cn(
                    "rounded-card border bg-surface p-3 shadow-soft",
                    low ? "border-brand/40 bg-brand-soft" : "border-border"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Kind: ${kindLabel(row.kind)}. Click to change`}
                      onClick={() => cycleKind(row.key)}
                      className={cn(
                        "inline-flex shrink-0 items-center rounded-full border border-border px-2.5 py-0.5 text-[11px] font-semibold transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                        kindChipClasses(row.kind)
                      )}
                    >
                      {kindLabel(row.kind)}
                    </button>
                    <span className="flex-1 text-right text-xs text-muted">
                      {shortDay(row.dueAt)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      aria-label={`Remove ${row.title || "this date"}`}
                      className="rounded-full p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                  <input
                    aria-label="Title"
                    value={row.title}
                    onChange={(e) => retitle(row.key, e.target.value)}
                    placeholder="What's due?"
                    maxLength={120}
                    disabled={adding}
                    className={controlClasses("mt-2")}
                  />
                  {low ? (
                    <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-brand-ink">
                      <CircleAlert className="size-3.5 shrink-0" aria-hidden />
                      check this one
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {addError ? (
            <p role="alert" className="mt-3 text-xs font-medium text-danger">
              {addError}
            </p>
          ) : null}

          <Button
            className="mt-4 w-full"
            disabled={adding}
            onClick={() => void handleAdd()}
          >
            {adding ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <CalendarDays className="size-4" aria-hidden />
            )}
            Add {count} {countNoun} to the class calendar
          </Button>
        </div>
      ) : null}
    </div>
  );
}
