"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertCircle, DoorOpen, Loader2, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  FieldError,
  Hint,
  Input,
  Label,
  buttonClasses,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

/* Leaving for good.
 *
 * The Terms and the privacy policy both tell students "Settings, then Delete
 * account", and until now the web app had no such thing — only the native app
 * did. This is that door.
 *
 * WHY IT LOOKS NOTHING LIKE THE NATIVE ONE. On the phone this is two stacked
 * OS alerts, because that is the only modal a native app gets and tapping
 * through two of them is genuinely deliberate. A browser dialog is not that:
 * it is a thing people dismiss reflexively, and `confirm()` in particular is
 * one keypress away from gone. So the confirmation here is typing — your own
 * handle, exactly — in a field that starts empty and stays visible. There is
 * no hidden step and no second dialog, because the typing *is* the second
 * step, and nothing a mouse can do on its own reaches the button.
 *
 * WHAT IT CALLS. `delete_own_account()` from migration 0021 — security
 * definer, granted to `authenticated` only, filtered on `auth.uid()`. It
 * sweeps the student's storage folders and then deletes the auth row, which
 * cascades through profiles to every table. The same RPC the native app
 * calls; no new server surface was needed for this page.
 *
 * WHAT HAPPENS AFTER. The account is already gone by the time the promise
 * resolves, so the sign-out that follows is only clearing this device and a
 * failure there can't undo anything. We deliberately do NOT refresh the router
 * or bounce the student out: the confirmation that it worked is the last thing
 * we owe them, and every route they could reach from here now sends them to
 * the login screen anyway.
 */

type Phase = "idle" | "working" | "error" | "done";

/** Exactly what goes, named out loud, because §6 says confirmations do that. */
const WHAT_GOES: readonly string[] = [
  "Your profile, your photo and your place in the people directory",
  "Every message you've written — channels, threads and DMs",
  "Your notes, uploads and schedule files",
  "Your courses, clubs, events and RSVPs",
  "Your saved messages, your blocks and your push tokens",
];

export function DeleteAccount({ handle }: { handle: string }) {
  const [confirmation, setConfirmation] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");

  /* Generous about the shape, strict about the name: a leading @ and stray
     whitespace are typing, not hesitation. Handles are already lowercase by
     constraint, and folding case here means caps lock never reads as a
     refusal to let someone leave. */
  const typed = confirmation.trim().replace(/^@+/, "").toLowerCase();
  const matches = typed.length > 0 && typed === handle.toLowerCase();
  /* Held back until they've typed enough characters to have finished, so the
     line doesn't flash red at somebody half-way through their own name. */
  const mistyped = !matches && typed.length >= handle.length;

  async function handleDelete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!matches || phase === "working") return;
    setPhase("working");

    const supabase = createClient();
    const { error } = await supabase.rpc("delete_own_account");
    if (error) {
      setPhase("error");
      return;
    }

    try {
      await supabase.auth.signOut();
    } catch {
      // The account is gone server-side either way; this only clears cookies.
    }
    setPhase("done");
  }

  if (phase === "done") {
    return (
      <Card padding="lg" className="animate-fade-up text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-surface-2 text-muted">
          <DoorOpen className="size-6" aria-hidden />
        </span>
        <h2 className="mt-4 text-xl font-bold tracking-tight">
          Your account is deleted
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-sm text-muted text-pretty">
          Everything of yours is gone from Huddl, and you&apos;re signed out on
          this device too. If you ever come back, you&apos;ll start from a
          blank page — which is a fine way to start a semester.
        </p>
        <Link
          href="/"
          className={buttonClasses({ variant: "secondary", className: "mt-5" })}
        >
          Back to the front page
        </Link>
      </Card>
    );
  }

  /* Hand-built rather than <Card> so the hairline can be danger-tinted
     without two border-colour utilities fighting over the same element —
     the same reason `notification-list` builds its unread row by hand. The
     tint is the only visual warning the section needs; the tile and the
     button carry the rest. */
  return (
    <div className="rounded-card border border-danger/30 bg-surface p-5 shadow-soft">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-danger/10 text-danger">
          <Trash2 className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="font-bold tracking-tight">Delete your account</h2>
          <p className="mt-1 text-sm text-muted text-pretty">
            This happens the moment you confirm it. There&apos;s no recovery
            window, no archive, and nobody at Huddl can put it back.
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-1.5 text-sm text-muted">
        {WHAT_GOES.map((line) => (
          <li key={line} className="flex items-start gap-2 text-pretty">
            <span
              aria-hidden
              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-danger/50"
            />
            {line}
          </li>
        ))}
      </ul>

      <p className="mt-4 border-t border-border pt-4 text-sm text-muted text-pretty">
        Want a copy before you go?{" "}
        <Link
          href="/settings/data"
          className="font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Your data
        </Link>{" "}
        hands you one file with everything Huddl holds that&apos;s yours. It
        takes a minute, and it&apos;s the last chance to take it.
      </p>

      <form
        onSubmit={handleDelete}
        aria-label="Delete your account"
        className="mt-5 flex flex-col gap-1.5"
        noValidate
      >
        <Label htmlFor="delete-confirm">
          Type <span className="font-mono">@{handle}</span> to confirm
        </Label>
        <Input
          id="delete-confirm"
          name="handle-confirmation"
          type="text"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          placeholder={`@${handle}`}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          disabled={phase === "working"}
          aria-describedby="delete-confirm-hint"
          aria-invalid={mistyped || undefined}
        />
        <div id="delete-confirm-hint" aria-live="polite" className="min-h-5">
          {mistyped ? (
            <FieldError className="flex items-start gap-1.5 text-xs">
              <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
              That&apos;s not your handle yet — it&apos;s @{handle}.
            </FieldError>
          ) : (
            <Hint>
              Your own handle, so this can&apos;t happen by a stray click.
            </Hint>
          )}
        </div>

        {phase === "error" ? (
          <p
            role="alert"
            className="mt-2 flex items-start gap-2 rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            We couldn&apos;t delete your account just now, and nothing was
            removed. Give it another go in a minute.
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="danger"
            disabled={!matches || phase === "working"}
          >
            {phase === "working" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="size-4" aria-hidden />
            )}
            {phase === "working"
              ? "Deleting everything…"
              : phase === "error"
                ? "Try again"
                : "Delete my account"}
          </Button>
          <Link
            href="/settings"
            className={buttonClasses({ variant: "ghost" })}
          >
            Keep my account
          </Link>
        </div>
      </form>
    </div>
  );
}
