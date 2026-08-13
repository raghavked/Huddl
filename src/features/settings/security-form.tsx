"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthError } from "@supabase/supabase-js";
import {
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogOut,
  MonitorSmartphone,
} from "lucide-react";
import { Button, Card, FieldError, Hint, Input, Label } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import {
  PASSWORD_MIN_LENGTH,
  checkPassword,
  describeProblem,
  describeStrength,
  passwordsMatch,
} from "@/lib/password";
import { cn } from "@/lib/utils";

/* The two things a signed-in student can do about their own credentials:
 * change the password, and throw everyone else off the account.
 *
 * WHY THERE IS A "CURRENT PASSWORD" FIELD. Supabase doesn't ask for one.
 * `updateUser({ password })` will happily rewrite the password of whatever
 * session is on the device. That is the wrong default for a campus app.
 * Laptops get left open on the third floor of Shields for an hour at a time,
 * and a password change is the one action that turns a borrowed screen into a
 * stolen account. So this form proves it is you first, by signing in again
 * with the session's own email, and only then writes.
 *
 * WHAT THAT COSTS. The re-auth is a real login attempt: it counts against
 * Supabase's auth rate limit and it mints a fresh session for this device. So
 * a wrong guess can't be hammered: every miss puts the submit button behind
 * a countdown that doubles, 15 seconds then 30 then a minute. That is a
 * kinder wall than the 429 a student would otherwise walk into, and it is
 * the same reasoning as the resend cooldown on the verify screen.
 *
 * The rules about what makes a password acceptable are not decided here.
 * They live in `@/lib/password`, shared with signup, the reset-from-link flow
 * and the native app, because a password accepted on a laptop has to be
 * accepted on the phone that sets it next. `ok` gates the button; `strength`
 * is only a word under the field.
 *
 * Nothing Supabase says out loud reaches a student. Every failure below is
 * mapped to a sentence that explains what happened and what to do next.
 */

/** The word under the field, tinted. Weak never blocks; it only advises. */
const STRENGTH_TONE = {
  weak: "text-warning",
  ok: "text-muted",
  strong: "text-success",
} as const;

/** First miss waits 15s, then 30, then a minute for as long as it takes. */
function cooldownFor(misses: number): number {
  return Math.min(15 * 2 ** (misses - 1), 60);
}

/* ------------------------------- password -------------------------------- */

type ChangeError = {
  message: string;
  /** Shows the "send yourself a reset link" way out under the message. */
  offerReset: boolean;
};

/** The re-auth refused us. Warm words, and a door out if they've forgotten. */
function describeReauthFailure(error: AuthError): ChangeError {
  const code = error.code ?? "";
  if (error.status === 429 || /rate limit/i.test(error.message ?? "")) {
    return {
      message:
        "That's a few tries in a row, so Hearth is asking us to slow down. Give it a moment and go again.",
      offerReset: true,
    };
  }
  if (code === "invalid_credentials" || error.status === 400) {
    return {
      message: "That current password didn't match.",
      offerReset: true,
    };
  }
  return {
    message:
      "We couldn't check that password just now. Check your connection and give it another go.",
    offerReset: false,
  };
}

/** The write itself refused us. Same rules as the reset-from-link screen. */
function describeUpdateFailure(error: AuthError): ChangeError {
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (code === "same_password" || /should be different/i.test(message)) {
    return {
      message: "That's the password you already have. Pick a different one.",
      offerReset: false,
    };
  }
  if (code === "weak_password") {
    return {
      message:
        "That password was turned down as too easy to guess. A couple more words will do it.",
      offerReset: false,
    };
  }
  if (code === "reauthentication_needed" || /reauthenticat/i.test(message)) {
    return {
      message:
        "Hearth wants a fresher login before it'll change a password. Sign out, sign back in, and this will go through.",
      offerReset: false,
    };
  }
  if (error.status === 429) {
    return {
      message: "That's a lot of tries in a row. Wait a minute, then save again.",
      offerReset: false,
    };
  }
  if (
    error.status === 401 ||
    code === "session_not_found" ||
    code === "session_expired"
  ) {
    return {
      message:
        "Your session ran out part-way through, so nothing changed. Sign out, sign back in, and try again.",
      offerReset: false,
    };
  }
  return {
    message:
      "We couldn't save that password just now. Your old one still works, so give it another go in a moment.",
    offerReset: false,
  };
}

export function ChangePasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ChangeError | null>(null);
  const [misses, setMisses] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);

  /* One timeout per remaining second. Re-arming on every tick is cheaper to
     read than a ref holding an interval, and it cleans itself up on unmount. */
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [secondsLeft]);

  const check = checkPassword(next, { email });
  const problem = next ? check.problems[0] : undefined;
  const sameAsCurrent = next.length > 0 && next === current;
  const mismatch =
    confirmation.length > 0 && !passwordsMatch(next, confirmation);
  const canSubmit =
    !pending &&
    secondsLeft === 0 &&
    current.length > 0 &&
    check.ok &&
    !sameAsCurrent &&
    passwordsMatch(next, confirmation);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setSaved(false);
    setError(null);

    const supabase = createClient();

    /* Step one: prove it's you. This is a genuine sign-in, so it also swaps
       this device onto a brand-new session. The one it was holding a second
       ago becomes just another signed-in device, which "sign out everywhere
       else" below will tidy up. */
    let reauthError: AuthError | null;
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      reauthError = signInError;
    } catch {
      setPending(false);
      setError({
        message:
          "We couldn't reach Hearth to check that password. Check your connection and try again.",
        offerReset: false,
      });
      return;
    }

    if (reauthError) {
      const nextMisses = misses + 1;
      setPending(false);
      setMisses(nextMisses);
      setSecondsLeft(cooldownFor(nextMisses));
      setError(describeReauthFailure(reauthError));
      return;
    }
    setMisses(0);

    // Step two: the write.
    let updateError: AuthError | null;
    try {
      const { error: writeError } = await supabase.auth.updateUser({
        password: next,
      });
      updateError = writeError;
    } catch {
      setPending(false);
      setError({
        message:
          "We couldn't reach Hearth to save that. Your old password still works, so try again in a moment.",
        offerReset: false,
      });
      return;
    }

    setPending(false);
    if (updateError) {
      setError(describeUpdateFailure(updateError));
      return;
    }

    setCurrent("");
    setNext("");
    setConfirmation("");
    setShowPasswords(false);
    setSaved(true);
    // The session cookie changed twice on the way through here; let the
    // server components pick up the current one.
    router.refresh();
  }

  return (
    <Card className="animate-fade-up">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <KeyRound className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="font-bold tracking-tight">Change your password</h2>
          <p className="mt-1 text-sm text-muted text-pretty">
            We&apos;ll ask for the one you have now first. Otherwise anyone
            who found your laptop open could lock you out of your own account.
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        aria-label="Change your password"
        className="mt-5 flex flex-col gap-5"
        noValidate
      >
        {/* Password managers want to see whose password this is before they
            offer to update the saved entry. The address is already on the
            page below, so this copy of it is for them, not for a reader. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={email}
          readOnly
          tabIndex={-1}
          aria-hidden
          className="sr-only"
        />

        {error ? (
          <div
            role="alert"
            className="space-y-2 rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
          >
            <p className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {error.message}
            </p>
            {error.offerReset ? (
              <p className="pl-6 text-pretty">
                Forgotten it?{" "}
                <Link
                  href="/forgot-password"
                  className="font-semibold underline underline-offset-2"
                >
                  Send yourself a reset link
                </Link>{" "}
                and set a new one from your inbox.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="security-current">Current password</Label>
          <Input
            id="security-current"
            name="current-password"
            type={showPasswords ? "text" : "password"}
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="The one you use now"
            aria-describedby="security-current-hint"
          />
          <Hint id="security-current-hint">
            Signed in as {email}.
          </Hint>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="security-new">New password</Label>
          <div className="relative">
            <Input
              id="security-new"
              name="new-password"
              type={showPasswords ? "text" : "password"}
              autoComplete="new-password"
              required
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
              aria-describedby="security-new-hint"
              aria-invalid={problem || sameAsCurrent ? true : undefined}
              className="pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPasswords((v) => !v)}
              aria-label={
                showPasswords ? "Hide passwords" : "Show passwords"
              }
              className="absolute inset-y-0 right-0 flex items-center rounded-r-xl px-3 text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
            >
              {showPasswords ? (
                <EyeOff className="size-4" aria-hidden />
              ) : (
                <Eye className="size-4" aria-hidden />
              )}
            </button>
          </div>
          {/* One line, four jobs: the rule, the reason it was refused, the
              "that's the one you already have" catch, or how it reads. Fixed
              height so the form doesn't jump as you type. */}
          <div id="security-new-hint" aria-live="polite" className="min-h-5">
            {sameAsCurrent ? (
              <FieldError className="flex items-start gap-1.5 text-xs">
                <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
                That&apos;s the password you already have. Pick a different
                one.
              </FieldError>
            ) : problem ? (
              <FieldError className="flex items-start gap-1.5 text-xs">
                <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
                {describeProblem(problem)}
              </FieldError>
            ) : next ? (
              <p
                className={cn(
                  "text-xs font-medium",
                  STRENGTH_TONE[check.strength]
                )}
              >
                {describeStrength(check.strength)}. Length matters more than
                symbols.
              </p>
            ) : (
              <Hint>
                At least {PASSWORD_MIN_LENGTH} characters. Length matters more
                than symbols.
              </Hint>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="security-confirm">Type it again</Label>
          <Input
            id="security-confirm"
            name="confirm-password"
            type={showPasswords ? "text" : "password"}
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder="Same password"
            aria-describedby="security-confirm-hint"
            aria-invalid={mismatch || undefined}
          />
          <div id="security-confirm-hint" aria-live="polite" className="min-h-5">
            {mismatch ? (
              <FieldError className="flex items-start gap-1.5 text-xs">
                <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
                Those two don&apos;t match yet.
              </FieldError>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!canSubmit}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {pending
              ? "Saving your password…"
              : secondsLeft > 0
                ? `Try again in ${secondsLeft}s`
                : "Change password"}
          </Button>
          <span aria-live="polite">
            {saved ? (
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-success">
                <Check className="size-4" aria-hidden />
                Password changed
              </span>
            ) : null}
          </span>
        </div>

        {saved ? (
          <p className="text-xs text-muted text-pretty">
            You&apos;re still signed in here. If Hearth is open anywhere else
            (your phone, a lab machine), that device will ask for the new
            password next time.
          </p>
        ) : null}
      </form>
    </Card>
  );
}

/* ------------------------------ other devices ----------------------------- */

type SweepPhase = "idle" | "working" | "done" | "error";

/**
 * Sign out everywhere else. One Supabase call with `scope: 'others'`, which
 * revokes every session on the account except the one asking, so the student
 * doing the tidying doesn't tidy themselves out and have to log back in on the
 * device they're holding.
 */
export function SignOutOtherDevices() {
  const [phase, setPhase] = useState<SweepPhase>("idle");

  async function handleSignOutOthers() {
    setPhase("working");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signOut({ scope: "others" });
      setPhase(error ? "error" : "done");
    } catch {
      setPhase("error");
    }
  }

  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <MonitorSmartphone className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="font-bold tracking-tight">Other devices</h2>
          <p className="mt-1 text-sm text-muted text-pretty">
            Left Hearth open on a library machine, or passed an old phone along?
            This signs out every other browser and device on your account. You
            stay signed in here.
          </p>
        </div>
      </div>

      {phase === "error" ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          That didn&apos;t go through, so nothing changed. Give it another go.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          onClick={() => void handleSignOutOthers()}
          disabled={phase === "working"}
        >
          {phase === "working" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <LogOut className="size-4" aria-hidden />
          )}
          {phase === "working"
            ? "Signing them out…"
            : phase === "error"
              ? "Try again"
              : "Sign out everywhere else"}
        </Button>
        <span aria-live="polite">
          {phase === "done" ? (
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-success">
              <Check className="size-4" aria-hidden />
              Every other device is signed out
            </span>
          ) : null}
        </span>
      </div>
    </Card>
  );
}
