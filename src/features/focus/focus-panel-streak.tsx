"use client";

import { useMemo, type ComponentProps } from "react";
import { FocusPanel } from "@/features/focus/focus-panel";
import { computeFocusStreak } from "@/lib/focus";

/**
 * The focus panel, with the streak counted in the student's own days.
 *
 * `computeFocusStreak` keys sessions by local calendar day, so wherever it
 * runs decides what a day is. Run on the server it counts the server's days:
 * on a UTC host an evening session in California lands on tomorrow, and the
 * page opens claiming a two-day streak the student never sat for — until the
 * panel recounts in the browser and the badge quietly vanishes. Counting it
 * here instead means the first paint and every recount after it agree, and
 * they agree with the phone.
 *
 * The panel owns the number from then on; this layer only hands it the right
 * one to start with.
 */
export function FocusPanelWithStreak({
  streakRows,
  ...panel
}: Omit<ComponentProps<typeof FocusPanel>, "initialStreak"> & {
  /** Closed sessions, newest first — `ended_at` is all the count needs. */
  streakRows: { ended_at: string | null }[];
}) {
  const streak = useMemo(
    () => computeFocusStreak(streakRows, new Date()),
    [streakRows]
  );
  return <FocusPanel {...panel} initialStreak={streak} />;
}
