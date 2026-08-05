"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, MailCheck, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type ResendState = "idle" | "sending" | "sent";

function VerifyContent() {
  const email = useSearchParams().get("email");
  const [resendState, setResendState] = useState<ResendState>("idle");
  const [error, setError] = useState<string | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
    };
  }, []);

  async function handleResend() {
    if (!email || resendState !== "idle") return;
    setResendState("sending");
    setError(null);
    const supabase = createClient();
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${location.origin}/auth/confirm` },
    });
    if (resendError) {
      setResendState("idle");
      setError(resendError.message);
      return;
    }
    setResendState("sent");
    // Give inboxes a moment before allowing another resend.
    cooldownRef.current = setTimeout(() => setResendState("idle"), 30_000);
  }

  return (
    <div className="rounded-card border border-border bg-surface p-6 text-center">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-soft">
        <MailCheck className="size-7 text-brand-strong" aria-hidden />
      </span>
      <h1 className="mt-4 text-xl font-bold tracking-tight">
        Check your inbox
      </h1>
      <p className="mt-2 text-sm text-muted">
        We sent a confirmation link to{" "}
        {email ? (
          <strong className="font-semibold text-foreground">{email}</strong>
        ) : (
          "your university email"
        )}
        . Tap it to verify you&apos;re a student and finish setting up your
        account.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-left text-sm text-danger"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {resendState === "sent" ? (
        <p
          role="status"
          className="mt-5 flex items-center justify-center gap-2 text-sm font-medium text-success"
        >
          <MailCheck className="size-4" aria-hidden />
          Sent — check your inbox (and spam).
        </p>
      ) : (
        <button
          type="button"
          onClick={handleResend}
          disabled={!email || resendState === "sending"}
          className="mt-5 inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface-2 px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
        >
          {resendState === "sending" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Send className="size-4" aria-hidden />
          )}
          {resendState === "sending" ? "Resending…" : "Resend email"}
        </button>
      )}

      <div className="mt-6 space-y-1.5 border-t border-border pt-4 text-sm text-muted">
        <p>
          Wrong email?{" "}
          <Link
            href="/signup"
            className="font-semibold text-brand hover:underline"
          >
            Start over
          </Link>
        </p>
        <p>
          Already confirmed?{" "}
          <Link
            href="/login"
            className="font-semibold text-brand hover:underline"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16" aria-hidden>
          <Loader2 className="size-6 animate-spin text-muted" />
        </div>
      }
    >
      <VerifyContent />
    </Suspense>
  );
}
