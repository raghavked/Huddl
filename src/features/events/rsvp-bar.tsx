"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, HelpCircle, Loader2, XCircle } from "lucide-react";
import { rsvp } from "@/features/events/actions";
import { cn } from "@/lib/utils";
import type { RsvpStatus } from "@/lib/types";

const OPTIONS: readonly {
  value: RsvpStatus;
  label: string;
  icon: typeof CheckCircle2;
}[] = [
  { value: "going", label: "Going", icon: CheckCircle2 },
  { value: "maybe", label: "Maybe", icon: HelpCircle },
  { value: "declined", label: "Can't go", icon: XCircle },
];

/**
 * Going / Maybe / Can't-go segmented control backed by the rsvp server
 * action. `atCapacity` disables new "going" taps up front; the server
 * re-checks anyway (someone may free a spot, or take the last one).
 */
export function RsvpBar({
  eventId,
  initialStatus,
  atCapacity,
}: {
  eventId: string;
  initialStatus: RsvpStatus | null;
  atCapacity: boolean;
}) {
  const [status, setStatus] = useState<RsvpStatus | null>(initialStatus);
  const [pendingStatus, setPendingStatus] = useState<RsvpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function choose(next: RsvpStatus) {
    if (isPending || next === status) return;
    setError(null);
    setPendingStatus(next);
    startTransition(async () => {
      const result = await rsvp(eventId, next);
      if (result.error) {
        setError(result.error);
      } else {
        setStatus(next);
      }
      setPendingStatus(null);
    });
  }

  const goingBlocked = atCapacity && status !== "going";

  return (
    <div>
      <div
        role="group"
        aria-label="Your RSVP"
        className="grid grid-cols-3 gap-2"
      >
        {OPTIONS.map(({ value, label, icon: Icon }) => {
          const active = status === value;
          const blocked = value === "going" && goingBlocked;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              disabled={isPending || blocked}
              title={blocked ? "This event is full" : undefined}
              onClick={() => choose(value)}
              className={cn(
                "inline-flex h-11 select-none items-center justify-center gap-1.5 rounded-full border px-2 text-sm font-semibold transition-all active:scale-[0.98]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                "disabled:cursor-not-allowed disabled:opacity-60",
                active
                  ? "border-transparent bg-brand text-brand-fg shadow-soft"
                  : "border-border bg-surface shadow-soft hover:border-brand/30 hover:bg-surface-2"
              )}
            >
              {pendingStatus === value ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Icon className="size-4" aria-hidden />
              )}
              {label}
            </button>
          );
        })}
      </div>
      {goingBlocked && !error ? (
        <p className="mt-2 text-xs text-muted">
          This event is full, but you can still RSVP &ldquo;maybe&rdquo; in case
          a spot opens up.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
