"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, MailCheck, Send } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
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
      // Warm words instead of raw API text. The fix is the same either way.
      setError(
        "That resend didn't go through. Give it a minute, then try again."
      );
      return;
    }
    setResendState("sent");
    // Give inboxes a moment before allowing another resend.
    cooldownRef.current = setTimeout(() => setResendState("idle"), 30_000);
  }

  return (
    <Card padding="lg" className="animate-fade-up text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
        <MailCheck className="size-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">
        Check your inbox
      </h1>
      {email ? (
        <p className="mt-3">
          <Badge tone="brand" className="max-w-full">
            <span className="truncate">{email}</span>
          </Badge>
        </p>
      ) : null}
      <p className="mt-3 text-sm text-muted text-pretty">
        We sent a confirmation link to{" "}
        {email ? "that address" : "your university email"}. Tap it to verify
        you&apos;re a student and finish setting up your account.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl bg-danger/10 px-3.5 py-2.5 text-left text-sm text-danger"
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
          Sent. Check your inbox (and spam).
        </p>
      ) : (
        <Button
          variant="secondary"
          onClick={handleResend}
          disabled={!email || resendState === "sending"}
          className="mt-5"
        >
          {resendState === "sending" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Send className="size-4" aria-hidden />
          )}
          {resendState === "sending" ? "Resending…" : "Resend email"}
        </Button>
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
    </Card>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16" role="status" aria-label="Loading">
          <Loader2 className="size-6 animate-spin text-muted" aria-hidden />
        </div>
      }
    >
      <VerifyContent />
    </Suspense>
  );
}
