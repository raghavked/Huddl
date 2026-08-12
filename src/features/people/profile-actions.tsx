"use client";

import { useId, useState } from "react";
import { Flag, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { reportProfile } from "@/features/moderation/actions";
import {
  REPORT_CATEGORIES,
  categoryLabel,
  type ReportCategory,
} from "@/lib/moderation";
import { cn } from "@/lib/utils";

/** What `reports.reason` will take: 1–500 characters, per its check constraint. */
const REASON_MAX = 500;

/**
 * Report this person, from their profile.
 *
 * @param personId `profiles.id` of whoever the page is about. Never the
 *   viewer's own — the page doesn't render this on your own profile, and
 *   `reportProfile` refuses it besides.
 * @param name What to call them out loud. A private profile withholds the
 *   display name, so the caller passes the handle instead — the panel has to
 *   name the person the viewer can actually see.
 */
export function ReportPersonButton({
  personId,
  name,
}: {
  personId: string;
  name: string;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [detail, setDetail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  /* Nothing closes the panel while a report is in flight — on a slow network
     the answer, sent or failed, has to land somewhere the reporter is still
     looking. What they picked and typed stays put when it does close, so
     reopening picks up where they left off rather than starting again. */
  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }

  async function handleSubmit() {
    if (pending) return;
    if (category === null) {
      setError("Pick the category that fits best.");
      return;
    }
    setPending(true);
    setError(null);
    /* `reports.reason` is not nullable, and a student who picked a category
       and had nothing to add has still said something — the category's own
       words stand in rather than blocking the report on a second field. */
    const words = detail.trim();
    /* A server action is an HTTP POST, so offline or a 500 REJECTS rather
       than resolving `{ error }`. Unhandled, that rejection would skip
       setPending(false) and leave the panel stuck on "Sending…" — with
       Cancel, Escape and the trigger all guarded on `pending` and therefore
       dead with it. */
    let failure: string | undefined;
    try {
      const result = await reportProfile(
        personId,
        category,
        words.length > 0 ? words : categoryLabel(category)
      );
      failure = result.error;
    } catch {
      failure = "Couldn't send that report — check your connection and try again.";
    } finally {
      setPending(false);
    }
    if (failure) {
      setError(failure);
      return;
    }
    setOpen(false);
    setCategory(null);
    setDetail("");
    setSent(true);
  }

  return (
    <>
      <Button
        variant="secondary"
        aria-expanded={open}
        aria-controls={open ? `${uid}-panel` : undefined}
        aria-label={`Report ${name}`}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          setError(null);
          setSent(false);
          setOpen(true);
        }}
      >
        <Flag className="size-4" aria-hidden />
        Report
      </Button>

      {/* Full-width so it lands on its own line in the caller's wrapping row,
          the same way the block confirmation does. */}
      {sent ? (
        <p
          role="status"
          className="w-full text-sm font-medium text-success text-pretty"
        >
          Report sent. A person reads it within 24 hours. You won&apos;t hear
          back about what we decide, and {name} isn&apos;t told you reported
          them.
        </p>
      ) : null}

      {open ? (
        <div
          id={`${uid}-panel`}
          role="group"
          aria-labelledby={`${uid}-title`}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
          className="w-full max-w-sm animate-scale-in rounded-card border border-border bg-surface p-4 text-left shadow-soft"
        >
          <p id={`${uid}-title`} className="text-sm font-semibold">
            Report {name}
          </p>
          <p className="mt-1 text-sm text-muted text-pretty">
            Reports are private — they won&apos;t know it was you. A person
            reads every one within 24 hours. This one is about {name}, not
            about a single message; to report something they said, use the flag
            on the message itself.
          </p>

          <p
            id={`${uid}-category`}
            className="mt-4 text-[11px] font-bold uppercase tracking-widest text-muted"
          >
            What&apos;s going on?
          </p>
          <div
            role="radiogroup"
            aria-labelledby={`${uid}-category`}
            className="mt-2 flex flex-wrap gap-1.5"
          >
            {REPORT_CATEGORIES.map((value) => {
              const selected = category === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setCategory(value);
                    setError(null);
                  }}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-full border px-3.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
                    selected
                      ? "border-brand-ink bg-brand-soft text-brand-ink"
                      : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
                  )}
                >
                  {categoryLabel(value)}
                </button>
              );
            })}
          </div>

          <label
            htmlFor={`${uid}-detail`}
            className="mt-4 block text-xs font-medium text-muted"
          >
            Anything to add? Optional.
          </label>
          <textarea
            id={`${uid}-detail`}
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            rows={3}
            maxLength={REASON_MAX}
            placeholder="What's been happening? A sentence or two is plenty."
            className="mt-1 w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted/70 focus:border-brand focus:ring-[3px] focus:ring-brand/15"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void handleSubmit()}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Flag className="size-4" aria-hidden />
              )}
              {pending ? "Sending…" : "Send report"}
            </Button>
            <Button variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
