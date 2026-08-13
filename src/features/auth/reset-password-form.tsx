"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthError } from "@supabase/supabase-js";
import {
  AlertCircle,
  CloudOff,
  Eye,
  EyeOff,
  Loader2,
  MailQuestion,
  ShieldCheck,
} from "lucide-react";
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
import {
  PASSWORD_MIN_LENGTH,
  checkPassword,
  describeProblem,
  describeStrength,
  passwordsMatch,
} from "@/lib/password";
import { cn } from "@/lib/utils";

/* Step two: the new password itself.
 *
 * This screen runs on the session the emailed link created (/auth/confirm
 * traded the token for cookies before forwarding here), so there is no "old
 * password" field and no token in this file. The link *is* the proof.
 *
 * That makes the session the only thing that can be missing, and it can be
 * missing in two different ways, which is why the check on mount has two
 * failure states rather than one. An expired or already-used link means
 * there's nothing to check and the way forward is a fresh email. A network
 * that dropped means the check itself failed and the way forward is trying
 * again. Collapsing those two into "something went wrong" would send half of
 * these students to the wrong door.
 *
 * The rules about what counts as a password live in `@/lib/password` and are
 * shared with signup, settings and the native app: a password accepted on a
 * laptop has to be accepted on the phone that set it. `ok` gates the button;
 * `strength` is only a word under the field.
 *
 * Supabase can also refuse the write at the last moment: a link old enough to
 * need a fresh login, or sibling sessions revoked out from under us. Both are
 * handled as errors with a way forward, never as a silent success. */

type Status = "checking" | "ready" | "expired" | "unreachable" | "done";

type SubmitError = { message: string; offerFreshLink: boolean };

/** The word under the field, tinted. Weak advises rather than blocks. */
const STRENGTH_TONE = {
  weak: "text-warning",
  ok: "text-muted",
  strong: "text-success",
} as const;

export function ResetPasswordForm() {
  const [status, setStatus] = useState<Status>("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SubmitError | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /* getSession() reads what's already on the device (including the tokens a
     hash-fragment link leaves in the URL, which the browser client picks up on
     its own); getUser() is the round trip that proves the session is real.
     Asking in that order is what separates "no link" from "no network". */
  const checkSession = useCallback(async () => {
    setStatus("checking");
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!alive.current) return;
      if (!session) {
        setStatus("expired");
        return;
      }
      const { data, error: userError } = await supabase.auth.getUser();
      if (!alive.current) return;
      if (userError || !data.user) {
        setStatus("unreachable");
        return;
      }
      setEmail(data.user.email ?? null);
      setStatus("ready");
    } catch {
      if (alive.current) setStatus("unreachable");
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const check = checkPassword(password, { email: email ?? undefined });
  const problem = password ? check.problems[0] : undefined;
  const mismatch = confirmation.length > 0 && !passwordsMatch(password, confirmation);
  const canSubmit =
    !pending && check.ok && passwordsMatch(password, confirmation);

  /** Warm words for every way the write can fail. Never the raw API text. */
  function describeFailure(updateError: AuthError): SubmitError {
    const code = updateError.code ?? "";
    const message = updateError.message ?? "";
    if (code === "same_password" || /should be different/i.test(message)) {
      return {
        message: "That's the password you already have. Pick a different one.",
        offerFreshLink: false,
      };
    }
    if (code === "weak_password") {
      return {
        message:
          "That password was turned down as too easy to guess. A couple more words will do it.",
        offerFreshLink: false,
      };
    }
    if (code === "reauthentication_needed" || /reauthenticat/i.test(message)) {
      return {
        message:
          "This link is too old to change a password with. Ask for a fresh one and open it as soon as it lands.",
        offerFreshLink: true,
      };
    }
    if (updateError.status === 429) {
      return {
        message: "That's a lot of tries in a row. Wait a minute, then save again.",
        offerFreshLink: false,
      };
    }
    return {
      message:
        "We couldn't save that password just now. Give it another go in a moment.",
      offerFreshLink: false,
    };
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);

    let updateError: AuthError | null;
    try {
      const supabase = createClient();
      const result = await supabase.auth.updateUser({ password });
      updateError = result.error;
    } catch {
      if (alive.current) {
        setPending(false);
        setError({
          message:
            "We couldn't reach Hearth to save that. Check your connection and try again.",
          offerFreshLink: false,
        });
      }
      return;
    }
    if (!alive.current) return;

    if (updateError) {
      setPending(false);
      // A session that died mid-flow isn't an error on this form. It belongs
      // on the expired-link screen, the only place with a way forward.
      if (
        updateError.status === 401 ||
        updateError.code === "session_not_found" ||
        updateError.code === "session_expired"
      ) {
        setStatus("expired");
        return;
      }
      setError(describeFailure(updateError));
      return;
    }

    setStatus("done");
  }

  if (status === "checking") {
    return (
      <div
        className="flex justify-center py-16"
        role="status"
        aria-label="Checking your reset link"
      >
        <Loader2 className="size-6 animate-spin text-muted" aria-hidden />
      </div>
    );
  }

  if (status === "unreachable") {
    return (
      <Card padding="lg" className="animate-fade-up text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-surface-2">
          <CloudOff className="size-6 text-muted" aria-hidden />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">
          Something went sideways
        </h1>
        <p className="mt-3 text-sm text-muted text-pretty">
          We couldn&apos;t check your reset link just now. Check your
          connection and give it another go. The link is still good.
        </p>
        <Button variant="soft" onClick={() => void checkSession()} className="mt-5">
          Try again
        </Button>
      </Card>
    );
  }

  if (status === "expired") {
    return (
      <Card padding="lg" className="animate-fade-up text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <MailQuestion className="size-6" aria-hidden />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">
          That link has run out
        </h1>
        <p className="mt-3 text-sm text-muted text-pretty">
          Reset links work once, and they don&apos;t stay good for long. This
          one has been used already, or it sat too long. Ask for a fresh one
          and open it as soon as it lands.
        </p>
        <Link
          href="/forgot-password"
          className={buttonClasses({ size: "lg", className: "mt-5" })}
        >
          Send a new link
        </Link>
        <p className="mt-6 border-t border-border pt-4 text-sm text-muted">
          Remembered it after all?{" "}
          <Link href="/login" className="font-semibold text-brand hover:underline">
            Log in
          </Link>
        </p>
      </Card>
    );
  }

  if (status === "done") {
    return (
      <Card padding="lg" className="animate-fade-up text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <ShieldCheck className="size-6" aria-hidden />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">
          Your new password is saved
        </h1>
        <p className="mt-3 text-sm text-muted text-pretty">
          You&apos;re still signed in here. If Hearth is open anywhere else
          (your phone, a lab machine), that device will ask for the new
          password next time.
        </p>
        <Link
          href="/home"
          className={buttonClasses({ size: "lg", className: "mt-5" })}
        >
          Back to Hearth
        </Link>
      </Card>
    );
  }

  return (
    <Card padding="lg" className="animate-fade-up">
      <h1 className="text-2xl font-bold tracking-tight">
        Choose a new password
      </h1>
      <p className="mt-1.5 text-sm text-muted text-pretty">
        {email ? (
          <>
            You&apos;re setting the password for <strong>{email}</strong>.
          </>
        ) : (
          <>Set it once here and you&apos;re back in.</>
        )}
      </p>

      <form
        onSubmit={handleSubmit}
        aria-label="Choose a new password"
        className="mt-6 flex flex-col gap-5"
        noValidate
      >
        {error ? (
          <div
            role="alert"
            className="space-y-2 rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
          >
            <p className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {error.message}
            </p>
            {error.offerFreshLink ? (
              <p className="pl-6">
                <Link
                  href="/forgot-password"
                  className="font-semibold underline underline-offset-2"
                >
                  Send a new link
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reset-password">New password</Label>
          <div className="relative">
            <Input
              id="reset-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
              aria-describedby="reset-password-hint"
              aria-invalid={problem ? true : undefined}
              className="pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex items-center rounded-r-xl px-3 text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
            >
              {showPassword ? (
                <EyeOff className="size-4" aria-hidden />
              ) : (
                <Eye className="size-4" aria-hidden />
              )}
            </button>
          </div>
          {/* One line, three jobs: the rule, the reason it was refused, or how
              it reads. Fixed height so the form doesn't jump as you type. */}
          <div id="reset-password-hint" aria-live="polite" className="min-h-5">
            {problem ? (
              <FieldError className="flex items-start gap-1.5 text-xs">
                <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
                {describeProblem(problem)}
              </FieldError>
            ) : password ? (
              <p className={cn("text-xs font-medium", STRENGTH_TONE[check.strength])}>
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
          <Label htmlFor="reset-confirmation">Type it again</Label>
          <Input
            id="reset-confirmation"
            name="confirmation"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder="Same password"
            aria-describedby="reset-confirmation-hint"
            aria-invalid={mismatch || undefined}
          />
          <div id="reset-confirmation-hint" aria-live="polite" className="min-h-5">
            {mismatch ? (
              <FieldError className="flex items-start gap-1.5 text-xs">
                <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
                Those two don&apos;t match yet.
              </FieldError>
            ) : null}
          </div>
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={!canSubmit}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : null}
          {pending ? "Saving your password…" : "Save new password"}
        </Button>
      </form>
    </Card>
  );
}
