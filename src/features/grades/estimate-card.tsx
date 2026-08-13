"use client";

import { useMemo } from "react";
import { CircleAlert, TrendingUp } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Badge, Card } from "@/components/ui";
import {
  courseEstimate,
  letterFor,
  weightWarning,
  type EntriesLookup,
  type GradeCategory,
} from "@/lib/grades";
import { pctText } from "./format";

/* The headline: one number, one letter, and the sentence that says how much
 * of the grade the number actually rests on.
 *
 * Deliberately not a chart. A weighted estimate off five categories is one
 * figure with a caveat attached, and a bar chart of it would dress the caveat
 * up as precision. The honest version is the number, the share it's based on,
 * and the line reminding a student that instructors curve. */

/** The amber heads-up when the syllabus weights don't add to 100. */
function WeightWarning({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-2 text-xs leading-relaxed text-warning">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

/**
 * The estimate card, or (before there's anything to estimate from) the
 * dashed invitation that replaces it. Both branches carry the weight warning,
 * because a syllabus that doesn't add to 100 is worth knowing about from the
 * first category.
 */
export function EstimateCard({
  categories,
  entriesByCategory,
}: {
  categories: GradeCategory[];
  entriesByCategory: EntriesLookup;
}) {
  const estimate = useMemo(
    () => courseEstimate(categories, entriesByCategory),
    [categories, entriesByCategory]
  );
  const warning = useMemo(() => weightWarning(categories), [categories]);
  const letter = letterFor(estimate.pct);

  if (estimate.pct === null) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-card border border-dashed border-border">
          <EmptyState
            icon={TrendingUp}
            title="Your estimate starts here"
            description="Add a category and your first score, and the estimate starts working."
            className="py-12"
          />
        </div>
        {warning ? <WeightWarning message={warning} /> : null}
      </div>
    );
  }

  return (
    <Card className="flex animate-fade-up flex-col gap-2">
      <p className="text-xs font-semibold text-muted">Estimated grade</p>
      <p
        className="flex items-center gap-3"
        aria-label={`Estimated grade ${pctText(estimate.pct)} percent${
          letter ? `, about a ${letter}` : ""
        }`}
      >
        <span className="font-display text-4xl font-bold tracking-tight">
          {pctText(estimate.pct)}%
        </span>
        {letter ? (
          <Badge tone="brand" className="px-3 py-1 text-sm" aria-hidden>
            {letter}
          </Badge>
        ) : null}
      </p>
      <p className="text-xs leading-relaxed text-muted">{estimate.note}</p>
      {warning ? <WeightWarning message={warning} /> : null}
      <p className="text-xs leading-relaxed text-muted">
        An estimate, not a grade of record. Instructors curve, drop a low
        score, and round their own way.
      </p>
    </Card>
  );
}
