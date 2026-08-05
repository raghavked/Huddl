"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  MailQuestion,
  MailCheck,
} from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

type ResendState = "idle" | "sending" | "sent";

export function LoginForm({
  next,
  initialError,
}: {
  next: string;
  initialError: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resendState, setResendState] = useState<ResendState>("idle");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    setUnconfirmed(false);
    setResendState("idle");

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setPending(false);
      if (
        signInError.code === "email_not_confirmed" ||
        /not confirmed/i.test(signInError.message)
      ) {
        setUnconfirmed(true);
      } else if (
        signInError.code === "invalid_credentials" ||
        /invalid login credentials/i.test(signInError.message)
      ) {
        setError("That email and password don't match. Give it another try.");
      } else {
        setError(signInError.message);
      }
      return;
    }

    // Keep the pending state on while we navigate so the button doesn't flicker.
    router.push(next);
    router.refresh();
  }

  async function handleResend() {
    if (resendState !== "idle" || !email.trim()) return;
    setResendState("sending");
    setError(null);
    const supabase = createClient();
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: `${location.origin}/auth/confirm` },
    });
    if (resendError) {
      setResendState("idle");
      setError(resendError.message);
      return;
    }
    setResendState("sent");
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5" noValidate>
      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {unconfirmed ? (
        <div
          role="alert"
          className="space-y-2 rounded-xl bg-accent-soft px-3.5 py-3 text-sm"
        >
          <p className="flex items-start gap-2 text-accent">
            <MailQuestion className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Your email isn&apos;t confirmed yet. Check your inbox for the
              link we sent to <strong>{email.trim()}</strong>.
            </span>
          </p>
          {resendState === "sent" ? (
            <p className="flex items-center gap-2 pl-6 text-success">
              <MailCheck className="size-4" aria-hidden />
              Confirmation email sent — check your inbox (and spam).
            </p>
          ) : (
            <button
              type="button"
              onClick={handleResend}
              disabled={resendState === "sending"}
              className="ml-6 inline-flex items-center gap-1.5 rounded-sm font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
            >
              {resendState === "sending" ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : null}
              Resend confirmation email
            </button>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-email">University email</Label>
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@school.edu"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-password">Password</Label>
        <div className="relative">
          <Input
            id="login-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
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
      </div>

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={pending || !email.trim() || !password}
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {pending ? "Logging in…" : "Log in"}
      </Button>
    </form>
  );
}
