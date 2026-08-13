import { kindLabel, type CalendarKind } from "@/lib/syllabus";
import { cn } from "@/lib/utils";

/**
 * Quiet chip palette for class-calendar kinds: exams glow ember-clay,
 * quizzes/projects lean sage, the rest stay neutral. Mirrors the native
 * course calendar and syllabus import.
 */
export function kindChipClasses(kind: CalendarKind): string {
  switch (kind) {
    case "exam":
      return "bg-brand-soft text-brand-ink";
    case "quiz":
    case "project":
      return "bg-accent-soft text-accent";
    default:
      return "bg-surface-2 text-muted";
  }
}

export function KindChip({
  kind,
  className,
}: {
  kind: CalendarKind;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        kindChipClasses(kind),
        className
      )}
    >
      {kindLabel(kind)}
    </span>
  );
}

/** "Fri, Oct 14" */
export function shortDay(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "today", "tomorrow", "in 6 days", "3 weeks ago": calendar-day distance. */
export function relativeDay(iso: string): string {
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

/** A due time only shows when someone set one; 11:59 PM is the quiet default. */
export function timeSuffix(iso: string): string {
  const d = new Date(iso);
  if (d.getHours() === 23 && d.getMinutes() === 59) return "";
  return ` · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/** "Fri, Oct 14 · 3:00 PM": how plan entries and study blocks read. */
export function formatDayTime(d: Date): string {
  const day = d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}
