"use client";

import { useId, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Info } from "lucide-react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";
import { whatIf, type EntriesLookup, type GradeCategory } from "@/lib/grades";

/* "What do I need for an A-?" Folded away until it's asked.
 *
 * This is the question that makes a grade tracker worth keeping, and also the
 * one that makes it stressful, so it sits closed by default and opens quietly
 * into four target chips and one sentence. The sentence is written by
 * `@/lib/grades`, including the two honest edges: already there, and out of
 * reach. Nothing here rounds a needed score down into a promise. */

/** The four targets worth a chip. Anything finer is a calculator, not a page. */
const TARGETS: readonly { label: string; value: number }[] = [
  { label: "A · 93", value: 93 },
  { label: "A- · 90", value: 90 },
  { label: "B+ · 87", value: 87 },
  { label: "B · 83", value: 83 },
];

/**
 * The quiet expandable under the categories: pick the grade you're aiming
 * for, read what the rest of the quarter has to average.
 */
export function WhatIfPanel({
  categories,
  entriesByCategory,
}: {
  categories: GradeCategory[];
  entriesByCategory: EntriesLookup;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(90);

  const result = useMemo(
    () => whatIf(categories, entriesByCategory, target),
    [categories, entriesByCategory, target]
  );

  return (
    <Card padding="none" className="overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
      >
        <span className="min-w-0 flex-1 font-bold tracking-tight">
          What do I need from here?
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted transition-transform",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <div id={panelId} className="flex flex-col gap-4 px-5 pb-5">
          <div
            role="radiogroup"
            aria-label="Grade you're aiming for"
            className="flex flex-wrap gap-2"
          >
            {TARGETS.map((option) => {
              const selected = target === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`Aim for ${option.value} percent`}
                  onClick={() => setTarget(option.value)}
                  className={cn(
                    "inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                    selected
                      ? "border-brand bg-brand-soft text-brand-ink"
                      : "border-border bg-surface text-muted hover:text-foreground"
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <p className="flex items-start gap-2.5 text-sm leading-relaxed">
            {result.reachable ? (
              <CheckCircle2
                className="mt-0.5 size-4 shrink-0 text-accent"
                aria-hidden
              />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            )}
            <span className="text-pretty">{result.message}</span>
          </p>
        </div>
      ) : null}
    </Card>
  );
}
