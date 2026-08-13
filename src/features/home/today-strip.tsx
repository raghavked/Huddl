"use client";

import Link from "next/link";
import { useMemo } from "react";
import { CalendarDays, ChevronRight } from "lucide-react";
import { cardClasses } from "@/components/ui";
import type { PlanItemRow } from "@/features/study/plan-section";
import { buildPlan, toPlanKind, type PlanItem } from "@/lib/study-plan";

/** The upcoming events the strip gets to pick today's one out of. */
export type TodayEventRow = { title: string; starts_at: string };

/** "PHYS 9B review tonight" / "Coffee hour at 3:00 PM" for the Today strip. */
function eventTodayPhrase(event: TodayEventRow) {
  const start = new Date(event.starts_at);
  if (start.getHours() >= 17) return `${event.title} tonight`;
  const time = start.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${event.title} at ${time}`;
}

/** One calm line from what today actually holds. Null means stay silent. */
function buildTodayLine(
  dueCount: number,
  firstDueTitle: string | null,
  event: TodayEventRow | null
): string | null {
  const eventPart = event ? eventTodayPhrase(event) : null;
  if (dueCount > 0 && eventPart) {
    return `${dueCount} due · ${eventPart}`;
  }
  if (dueCount > 0) {
    return firstDueTitle
      ? `${dueCount} due today · ${firstDueTitle}`
      : `${dueCount} due today`;
  }
  return eventPart;
}

/**
 * Today at a glance: what's still due today plus the first event that lands
 * today, on one quiet line above the rest of Home.
 *
 * This runs in the browser on purpose. "Today" is a calendar day, and both
 * halves of the line decide one by reading the local clock: `buildPlan`
 * buckets on whole local days, and the event match compares local dates. Done
 * on the server that would be the server's day: on a UTC host, a deadline the
 * syllabus importer wrote for 11:59pm tonight sits in tomorrow's bucket all
 * afternoon, and Home and the phone disagree about what's due. So the page
 * hands down the raw rows and its own moment, and the day math happens here,
 * where the student's day is.
 */
export function TodayStrip({
  nowIso,
  items,
  checkedIds,
  events,
}: {
  /** The server's "now". The instant is fine to ship; only the zone isn't. */
  nowIso: string;
  items: PlanItemRow[];
  checkedIds: string[];
  events: TodayEventRow[];
}) {
  const line = useMemo(() => {
    const now = new Date(nowIso);
    const planItems = items.map(
      (row): PlanItem => ({
        id: row.id,
        courseCode: row.courseCode,
        kind: toPlanKind(row.kind),
        title: row.title,
        dueAt: new Date(row.due_at),
      })
    );
    const plan = buildPlan(planItems, new Set(checkedIds), now);
    // What's still ahead of me today and unhandled, from the same buckets the
    // plan page draws, so the two never disagree.
    const dueToday =
      plan.groups
        .find((group) => group.label === "Today")
        ?.entries.filter((entry) => !entry.done) ?? [];
    const firstDue = dueToday[0];
    const todayStamp = now.toDateString();
    const eventToday =
      events.find(
        (event) => new Date(event.starts_at).toDateString() === todayStamp
      ) ?? null;
    return buildTodayLine(
      dueToday.length,
      firstDue ? `${firstDue.courseCode} ${firstDue.title}` : null,
      eventToday
    );
  }, [nowIso, items, checkedIds, events]);

  if (!line) return null;

  return (
    <section className="mt-8" aria-label="Today">
      <Link
        href="/calendar"
        aria-label={`Today: ${line}`}
        className={cardClasses({
          padding: "none",
          interactive: true,
          className: "flex items-center gap-3 px-4 py-3",
        })}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <CalendarDays className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {line}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
      </Link>
    </section>
  );
}
