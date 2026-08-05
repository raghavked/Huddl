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
import {
  Badge,
  Button,
  Hint,
  Input,
  Label,
  buttonClasses,
  cardClasses,
  controlClasses,
} from "@/components/ui";
import { isValidPhone } from "@/lib/utils";

type Step = "verified" | "enter" | "code" | "done";

const linkBtn =
  "inline-flex items-center gap-1.5 rounded-full text-sm font-semibold text-accent transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-60";

function ErrorAlert({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger"
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
      className="rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-sm"
    >
      <p className="font-semibold text-warning">Dev mode — no SMS sent</p>
      <p className="mt-0.5 text-warning">
        Your verification code is{" "}
        <span className="font-mono text-base font-bold tracking-widest">
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
        className={cardClasses({ className: "animate-fade-up" })}
      >
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success">
            <BadgeCheck className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">Your phone is verified</h2>
              <Badge tone="success">
                <BadgeCheck className="size-3.5" aria-hidden />
                Verified
              </Badge>
            </div>
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
        <Button
          variant="secondary"
          onClick={() => {
            setStep("enter");
            setError(null);
            setDevCode(null);
          }}
          className="mt-4"
        >
          <RefreshCw className="size-4" aria-hidden />
          Change or re-verify number
        </Button>
      </section>
    );
  }

  if (step === "done") {
    return (
      <section
        aria-label="Verification complete"
        className={cardClasses({
          padding: "lg",
          className: "animate-fade-up text-center",
        })}
      >
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-success/10 text-success">
          <BadgeCheck className="size-7" aria-hidden />
        </span>
        <h2 className="mt-3 text-lg font-bold tracking-tight">
          You&apos;re verified
        </h2>
        <div className="mt-2 flex justify-center">
          <Badge tone="success">
            <BadgeCheck className="size-3.5" aria-hidden />
            Trust badge unlocked
          </Badge>
        </div>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted text-pretty">
          Your profile now shows a trust badge so classmates know you&apos;re a
          real student. Your number is never shown to other students.
        </p>
        <Link
          href="/settings"
          className={buttonClasses({ className: "mt-5" })}
        >
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
        className={cardClasses({ className: "animate-fade-up" })}
      >
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <MessageSquareText className="size-5" aria-hidden />
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-code`}>6-digit code</Label>
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
              className={controlClasses(
                "max-w-48 text-center font-mono text-xl tracking-widest"
              )}
            />
          </div>

          {error ? <ErrorAlert message={error} /> : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || code.length !== 6}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <BadgeCheck className="size-4" aria-hidden />
              )}
              {pending ? "Checking…" : "Verify"}
            </Button>
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
      className={cardClasses({ className: "animate-fade-up" })}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Smartphone className="size-5" aria-hidden />
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-phone`}>Phone number</Label>
          <Input
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
            className="max-w-sm"
          />
          <Hint id={`${uid}-phone-help`}>
            US numbers can skip the +1 — international numbers need a country
            code.
          </Hint>
        </div>

        {error ? <ErrorAlert message={error} /> : null}

        <Button type="submit" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <MessageSquareText className="size-4" aria-hidden />
          )}
          {pending ? "Sending…" : "Text me a code"}
        </Button>
      </form>

      <div className="mt-5 border-t border-border pt-4">
        <PrivacyNote />
      </div>
    </section>
  );
}
