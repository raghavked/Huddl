"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AuthError } from "@supabase/supabase-js";
import {
  AlertCircle,
  KeyRound,
  Loader2,
  MailCheck,
  Send,
} from "lucide-react";
import { Badge, Button, Card, Hint, Input, Label } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

/* Step one of getting back in: ask for the email, send the link, say nothing.
 *
 * The one rule this screen exists to keep is that it never tells you whether
 * an address has an account. `resetPasswordForEmail` succeeds either way by
 * design, and so does the copy: "if that address has an account" is not
 * hedging, it's the feature. A campus is a small place and knowing which of
 * your classmates is on Hearth is not something a stranger with a form should
 * be able to find out.
 *
 * The link goes to /auth/confirm rather than straight to /reset-password: the
 * route handler is what turns the emailed token into a session cookie, and it
 * forwards to `next` when the exchange works. See auth/confirm/route.ts.
 *
 * The resend cooldown is copied from the verify screen and is load-bearing.
 * Supabase rate-limits auth email, so a student who taps "resend" four times
 * gets an error instead of a fourth email. Thirty seconds of a disabled button
 * is kinder than an error they caused. */

type ResendState = "idle" | "sending" | "sent";

/** Warm words for a send that didn't go out. Never the raw API text. */
function sendFailureMessage(error: AuthError): string {
  if (error.status === 429 || error.code === "over_email_send_rate_limit") {
    return "We've sent a few of those already. Give it a minute, then ask again.";
  }
  return "That email didn't go out. Give it a minute, then try again.";
}

export function ForgotPasswordForm({
  initialEmail,
  initialError,
}: {
  initialEmail: string;
  initialError: string | null;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [resendState, setResendState] = useState<ResendState>("idle");
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
    };
  }, []);

  /** Give inboxes (and Supabase's rate limiter) a moment. */
  function startCooldown() {
    setResendState("sent");
    if (cooldownRef.current) clearTimeout(cooldownRef.current);
    cooldownRef.current = setTimeout(() => setResendState("idle"), 30_000);
  }

  async function send(address: string): Promise<AuthError | null> {
    const supabase = createClient();
    const { error: sendError } = await supabase.auth.resetPasswordForEmail(
      address,
      { redirectTo: `${location.origin}/auth/confirm?next=/reset-password` }
    );
    return sendError;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const address = email.trim();
    if (pending || !address) return;
    setPending(true);
    setError(null);

    const sendError = await send(address);
    setPending(false);
    if (sendError) {
      setError(sendFailureMessage(sendError));
      return;
    }
    setSentTo(address);
    startCooldown();
  }

  async function handleResend() {
    if (!sentTo || resendState !== "idle") return;
    setResendState("sending");
    setError(null);
    const sendError = await send(sentTo);
    if (sendError) {
      setResendState("idle");
      setError(sendFailureMessage(sendError));
      return;
    }
    startCooldown();
  }

  const alert = error ? (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl bg-danger/10 px-3.5 py-2.5 text-left text-sm text-danger"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      {error}
    </p>
  ) : null;

  if (sentTo) {
    return (
      <Card padding="lg" className="animate-fade-up text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <MailCheck className="size-6" aria-hidden />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">
          Check your inbox
        </h1>
        <p className="mt-3">
          <Badge tone="brand" className="max-w-full">
            <span className="truncate">{sentTo}</span>
          </Badge>
        </p>
        {/* Neutral on purpose: we don't confirm whether that address is on
            Hearth, to anyone, ever. */}
        <p className="mt-3 text-sm text-muted text-pretty">
          If that address has a Hearth account, a link to set a new password is
          on its way. It works once, and it doesn&apos;t stay good for long, so
          open it when it lands.
        </p>
        <p className="mt-2 text-sm text-muted text-pretty">
          Nothing yet? Check your spam folder. Campus mail filters are strict
          about links.
        </p>

        {alert ? <div className="mt-4">{alert}</div> : null}

        {resendState === "sent" ? (
          <p
            role="status"
            className="mt-5 flex items-center justify-center gap-2 text-sm font-medium text-success"
          >
            <MailCheck className="size-4" aria-hidden />
            Sent. Give it a minute to land.
          </p>
        ) : (
          <Button
            variant="secondary"
            onClick={handleResend}
            disabled={resendState === "sending"}
            className="mt-5"
          >
            {resendState === "sending" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
            {resendState === "sending" ? "Sending…" : "Send it again"}
          </Button>
        )}

        <div className="mt-6 space-y-1.5 border-t border-border pt-4 text-sm text-muted">
          <p>
            Typed the wrong address?{" "}
            <button
              type="button"
              onClick={() => {
                setSentTo(null);
                setError(null);
              }}
              className="rounded-sm font-semibold text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Try another one
            </button>
          </p>
          <p>
            Remembered it?{" "}
            <Link
              href="/login"
              className="font-semibold text-brand hover:underline"
            >
              Log in
            </Link>
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="lg" className="animate-fade-up">
      <span className="flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
        <KeyRound className="size-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">
        Forgot your password?
      </h1>
      <p className="mt-1.5 text-sm text-muted text-pretty">
        Happens to everyone mid-semester. Tell us your university email and
        we&apos;ll send a link to set a new one.
      </p>

      <form
        onSubmit={handleSubmit}
        aria-label="Send a password reset link"
        className="mt-6 flex flex-col gap-5"
        noValidate
      >
        {alert}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="forgot-email">University email</Label>
          <Input
            id="forgot-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@school.edu"
            aria-describedby="forgot-email-hint"
          />
          <Hint id="forgot-email-hint">
            The address you signed up with. The link only works there.
          </Hint>
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={pending || !email.trim()}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : null}
          {pending ? "Sending the link…" : "Send reset link"}
        </Button>
      </form>
    </Card>
  );
}
