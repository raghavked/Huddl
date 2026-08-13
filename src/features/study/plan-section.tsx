"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarDays, Check, CircleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { buttonClasses, cardClasses } from "@/components/ui";
import { formatDayTime } from "@/features/study/kind-chip";
import { createClient } from "@/lib/supabase/client";
import {
  buildPlan,
  toPlanKind,
  type PlanEntry,
  type PlanItem,
  type PlanKind,
  type StudyBlock,
} from "@/lib/study-plan";
import { cn } from "@/lib/utils";

/** Serializable row shape the plan page passes down. */
export type PlanItemRow = {
  id: string;
  courseCode: string;
  kind: string;
  title: string;
  due_at: string;
};

function planKindLabel(kind: PlanKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Exams and quizzes pop in the accent green; everything else stays quiet. */
function planKindChipClasses(kind: PlanKind): string {
  if (kind === "exam" || kind === "quiz") {
    return "bg-accent-soft text-accent";
  }
  return "bg-surface-2 text-muted";
}

function Chip({ text, className }: { text: string; className: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        className
      )}
    >
      {text}
    </span>
  );
}

/** A derived study suggestion: plain text, nothing to check off. */
function BlockRow({ block }: { block: StudyBlock }) {
  return (
    <li className="ml-9 flex items-center gap-2.5 rounded-xl bg-surface-2 px-3 py-2.5">
      <CalendarDays className="size-4 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold">{block.label}</p>
        <p className="mt-0.5 text-xs text-muted">{formatDayTime(block.at)}</p>
      </div>
    </li>
  );
}

/**
 * The personal study plan: the shared class calendars of every enrolled
 * course, bucketed by time, with private check-offs and derived study
 * blocks ahead of exams. Check-offs flip optimistically and roll back if
 * the write fails.
 */
export function PlanSection({
  userId,
  nowIso,
  items,
  initialCheckedIds,
  hasCourses,
}: {
  userId: string;
  /** The server's "now". Keeps the first render deterministic across SSR + hydration. */
  nowIso: string;
  items: PlanItemRow[];
  initialCheckedIds: string[];
  hasCourses: boolean;
}) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(initialCheckedIds)
  );
  const [actionError, setActionError] = useState<string | null>(null);

  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const planItems = useMemo<PlanItem[]>(
    () =>
      items.map((row) => ({
        id: row.id,
        courseCode: row.courseCode,
        kind: toPlanKind(row.kind),
        title: row.title,
        dueAt: new Date(row.due_at),
      })),
    [items]
  );
  const plan = useMemo(
    () => buildPlan(planItems, checked, now),
    [planItems, checked, now]
  );

  /** Optimistic check-off: flip locally, persist, roll back if it fails. */
  async function toggle(entry: PlanEntry) {
    const marking = !entry.done;
    setActionError(null);
    const flip = (add: boolean) =>
      setChecked((prev) => {
        const next = new Set(prev);
        if (add) next.add(entry.id);
        else next.delete(entry.id);
        return next;
      });
    flip(marking);
    const supabase = createClient();
    const res = marking
      ? await supabase
          .from("study_checkoffs")
          .upsert(
            { user_id: userId, item_id: entry.id },
            { onConflict: "user_id,item_id", ignoreDuplicates: true }
          )
      : await supabase
          .from("study_checkoffs")
          .delete()
          .eq("user_id", userId)
          .eq("item_id", entry.id);
    if (res.error) {
      flip(!marking); // roll back
      setActionError("That check-off didn't save. Give it another tap.");
    }
  }

  const { stats } = plan;
  const allDone = stats.total > 0 && stats.handled === stats.total;
  const pct =
    stats.total > 0 ? Math.round((stats.handled / stats.total) * 100) : 0;

  if (stats.total === 0) {
    return (
      <div className="mt-6 rounded-card border border-dashed border-border">
        <EmptyState
          icon={CalendarDays}
          title={hasCourses ? "Nothing on your plan yet" : "No courses yet"}
          description={
            hasCourses
              ? "Import a syllabus from a course home. Assignments and exams land here, ready to check off."
              : "Add your classes first. Then import a syllabus and your whole term plans itself."
          }
          action={
            <Link
              href={hasCourses ? "/courses" : "/setup"}
              className={buttonClasses({ variant: "soft", size: "sm" })}
            >
              {hasCourses ? "Open your courses" : "Add your courses"}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div>
      {/* Progress header */}
      <div className={cardClasses({ className: "animate-fade-up" })}>
        <p className="font-bold tracking-tight">
          {allDone
            ? "All caught up. Go touch grass."
            : `You're on top of it: ${stats.handled} of ${stats.total} handled`}
        </p>
        <div
          role="progressbar"
          aria-valuenow={stats.handled}
          aria-valuemin={0}
          aria-valuemax={stats.total}
          aria-label={`${stats.handled} of ${stats.total} handled`}
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3"
        >
          <div
            className={cn(
              "h-full rounded-full transition-all",
              allDone ? "bg-success" : "bg-brand"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        {allDone ? (
          <p className="mt-2 text-xs text-muted">
            {stats.handled} of {stats.total} handled
          </p>
        ) : stats.nextUp ? (
          <p className="mt-2 truncate text-xs text-muted">
            Next up: {stats.nextUp.courseCode} {stats.nextUp.title}
          </p>
        ) : null}
      </div>

      {actionError ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {actionError}
        </p>
      ) : null}

      {plan.groups.map((group) => (
        <section key={group.label} className="mt-6" aria-label={group.label}>
          <h2 className="px-1 text-xs font-bold uppercase tracking-widest text-muted">
            {group.label}
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {group.entries.map((entry) => {
              const overdue = entry.dueAt.getTime() < now.getTime();
              return (
                <PlanEntryRows
                  key={entry.id}
                  entry={entry}
                  overdue={overdue}
                  onToggle={() => void toggle(entry)}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** One plan entry card plus any indented study-block rows beneath it. */
function PlanEntryRows({
  entry,
  overdue,
  onToggle,
}: {
  entry: PlanEntry;
  overdue: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <li
        className={cardClasses({
          padding: "none",
          className: "flex items-center gap-1 py-3 pl-1 pr-4",
        })}
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={entry.done}
          aria-label={`${entry.courseCode} ${entry.title}`}
          onClick={onToggle}
          className="flex size-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {entry.done ? (
            <span className="flex size-6 items-center justify-center rounded-full bg-brand text-brand-fg">
              <Check className="size-3.5" aria-hidden />
            </span>
          ) : (
            <span
              className={cn(
                "size-6 rounded-full border-2",
                overdue ? "border-brand" : "border-border"
              )}
            />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip text={entry.courseCode} className="bg-brand-soft text-brand-ink" />
            <Chip
              text={planKindLabel(entry.kind)}
              className={planKindChipClasses(entry.kind)}
            />
          </div>
          <p
            className={cn(
              "mt-1 text-sm font-semibold",
              entry.done && "text-muted line-through"
            )}
          >
            {entry.title}
          </p>
          <p
            className={cn(
              "mt-0.5 text-xs",
              overdue && !entry.done ? "font-medium text-danger" : "text-muted"
            )}
          >
            {overdue ? "Was due" : "Due"} {formatDayTime(entry.dueAt)}
          </p>
        </div>
      </li>
      {(entry.studyBlocks ?? []).map((block) => (
        <BlockRow key={block.key} block={block} />
      ))}
    </>
  );
}
