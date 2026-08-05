"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  Loader2,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { cn, isValidPhone } from "@/lib/utils";

type Step = "verified" | "enter" | "code" | "done";

const inputCls =
  "mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted/70 focus:border-brand focus:ring-2 focus:ring-brand/25 disabled:opacity-60";
const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const outlineBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const linkBtn =
  "inline-flex items-center gap-1.5 rounded text-sm font-medium text-brand transition-colors hover:text-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-60";

function ErrorAlert({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

function PrivacyNote() {
  return (
    <p className="flex items-start gap-2 text-xs text-muted">
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
      Your number is never shown to other students — it&apos;s only used once,
      to confirm you&apos;re a real person.
    </p>
  );
}

function DevCodeCallout({ code }: { code: string }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm"
    >
      <p className="font-semibold text-warning">Dev mode — no SMS sent</p>
      <p className="mt-0.5 text-warning">
        Your verification code is{" "}
        <span className="font-mono text-base font-bold tracking-[0.2em]">
          {code}
        </span>
      </p>
    </div>
  );
}

export function PhoneVerify({
  initialPhone,
  verifiedAt,
}: {
  initialPhone: string | null;
  verifiedAt: string | null;
}) {
  const router = useRouter();
  const uid = useId();
  const codeInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(verifiedAt ? "verified" : "enter");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function startVerification(isResend: boolean) {
    if (!isValidPhone(phone)) {
      setError("Enter a valid phone number, like (415) 555-0123.");
      return;
    }
    setPending(true);
    setError(null);
    setResent(false);
    try {
      const res = await fetch("/api/phone/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        devCode?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Couldn't send a code. Please try again.");
        return;
      }
      setDevCode(data.devCode ?? null);
      setCode("");
      setStep("code");
      setResent(isResend);
      // Move focus to the code field for keyboard/screen-reader users.
      window.setTimeout(() => codeInputRef.current?.focus(), 0);
    } catch {
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  async function checkCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/phone/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "That code didn't work. Please try again.");
        return;
      }
      setStep("done");
      router.refresh();
    } catch {
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  if (step === "verified") {
    return (
      <section
        aria-label="Phone verified"
        className="rounded-card border border-border bg-surface p-5"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success/10">
            <BadgeCheck className="size-5 text-success" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">Your phone is verified</h2>
            <p className="mt-0.5 text-sm text-muted">
              {initialPhone ? (
                <>
                  <span className="font-medium text-foreground">
                    {initialPhone}
                  </span>{" "}
                  is linked to your account, and your profile shows the trust
                  badge.
                </>
              ) : (
                "Your profile shows the trust badge."
              )}
            </p>
          </div>
        </div>
        <div className="mt-4 border-t border-border pt-4">
          <PrivacyNote />
        </div>
        <button
          type="button"
          onClick={() => {
            setStep("enter");
            setError(null);
            setDevCode(null);
          }}
          className={cn(outlineBtn, "mt-4")}
        >
          <RefreshCw className="size-4" aria-hidden />
          Change or re-verify number
        </button>
      </section>
    );
  }

  if (step === "done") {
    return (
      <section
        aria-label="Verification complete"
        className="rounded-card border border-border bg-surface p-6 text-center"
      >
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-success/10">
          <BadgeCheck className="size-7 text-success" aria-hidden />
        </span>
        <h2 className="mt-3 text-lg font-bold">You&apos;re verified</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
          Your profile now shows a trust badge so classmates know you&apos;re a
          real student. Your number is never shown to other students.
        </p>
        <Link href="/settings" className={cn(primaryBtn, "mt-5")}>
          <ArrowLeft className="size-4" aria-hidden />
          Back to settings
        </Link>
      </section>
    );
  }

  if (step === "code") {
    return (
      <section
        aria-label="Enter verification code"
        className="rounded-card border border-border bg-surface p-5"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft">
            <MessageSquareText className="size-5 text-brand-strong" aria-hidden />
          </span>
          <div>
            <h2 className="font-semibold">Enter your code</h2>
            <p className="mt-0.5 text-sm text-muted">
              We sent a 6-digit code to{" "}
              <span className="font-medium text-foreground">{phone}</span>. It
              expires in 10 minutes.
            </p>
          </div>
        </div>

        {devCode ? (
          <div className="mt-4">
            <DevCodeCallout code={devCode} />
          </div>
        ) : null}
        {resent ? (
          <p role="status" className="mt-3 text-sm font-medium text-success">
            A new code is on its way.
          </p>
        ) : null}

        <form onSubmit={checkCode} noValidate className="mt-4 space-y-4">
          <div>
            <label htmlFor={`${uid}-code`} className="block text-sm font-medium">
              6-digit code
            </label>
            <input
              ref={codeInputRef}
              id={`${uid}-code`}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="••••••"
              required
              aria-invalid={error ? true : undefined}
              className={cn(
                inputCls,
                "max-w-[12rem] text-center font-mono text-xl tracking-[0.4em]"
              )}
            />
          </div>

          {error ? <ErrorAlert message={error} /> : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={pending || code.length !== 6}
              className={primaryBtn}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <BadgeCheck className="size-4" aria-hidden />
              )}
              {pending ? "Checking…" : "Verify"}
            </button>
            <button
              type="button"
              onClick={() => startVerification(true)}
              disabled={pending}
              className={linkBtn}
            >
              <RefreshCw className="size-3.5" aria-hidden />
              Resend code
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("enter");
                setError(null);
                setDevCode(null);
                setResent(false);
              }}
              disabled={pending}
              className={linkBtn}
            >
              Use a different number
            </button>
          </div>
        </form>

        <div className="mt-5 border-t border-border pt-4">
          <PrivacyNote />
        </div>
      </section>
    );
  }

  // step === "enter"
  return (
    <section
      aria-label="Add your phone number"
      className="rounded-card border border-border bg-surface p-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft">
          <Smartphone className="size-5 text-brand-strong" aria-hidden />
        </span>
        <div>
          <h2 className="font-semibold">Add your phone number</h2>
          <p className="mt-0.5 text-sm text-muted">
            We&apos;ll text you a 6-digit code to confirm it&apos;s yours.
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          startVerification(false);
        }}
        noValidate
        className="mt-4 space-y-4"
      >
        <div>
          <label htmlFor={`${uid}-phone`} className="block text-sm font-medium">
            Phone number
          </label>
          <input
            id={`${uid}-phone`}
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(415) 555-0123"
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={`${uid}-phone-help`}
            className={cn(inputCls, "max-w-sm")}
          />
          <p id={`${uid}-phone-help`} className="mt-1 text-xs text-muted">
            US numbers can skip the +1 — international numbers need a country
            code.
          </p>
        </div>

        {error ? <ErrorAlert message={error} /> : null}

        <button type="submit" disabled={pending} className={primaryBtn}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <MessageSquareText className="size-4" aria-hidden />
          )}
          {pending ? "Sending…" : "Text me a code"}
        </button>
      </form>

      <div className="mt-5 border-t border-border pt-4">
        <PrivacyNote />
      </div>
    </section>
  );
}
