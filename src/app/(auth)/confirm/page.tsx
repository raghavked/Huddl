import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertCircle,
  KeyRound,
  LogIn,
  MailCheck,
  RefreshCw,
} from "lucide-react";
import { Card, buttonClasses } from "@/components/ui";
import { describeConfirmLink, type ConfirmKind } from "@/lib/confirm-link";

export const metadata: Metadata = { title: "Confirm your email" };

/**
 * The page every auth email links to. It shows the student what the link
 * is about to do and waits for a real press; only the button carries the
 * one-time token on to /auth/confirm, which spends it and moves on to
 * /confirmed or the reset form. That one hop is what stops an inbox's
 * link scanner from using the token up before the student ever taps.
 *
 * The button is a plain anchor on purpose: a Next <Link> would prefetch
 * the route and spend the token on hover, the exact thing this page exists
 * to prevent.
 *
 * The same page is where the confirm route bounces back to when a token has
 * expired or been used, arriving with `?error=`, so the dead end explains
 * itself and offers a fresh start.
 */

const COPY: Record<
  ConfirmKind,
  { icon: typeof MailCheck; heading: string; body: string; button: string }
> = {
  signup: {
    icon: MailCheck,
    heading: "Confirm your email",
    body: "One press and your Hearth account is ready. Nothing happens until you press it, so a link-scanning inbox can't use it up on your behalf.",
    button: "Confirm my email",
  },
  magiclink: {
    icon: LogIn,
    heading: "Sign in to Hearth",
    body: "Press the button to finish signing in. Sign-in links work once, and they don't stay good for long.",
    button: "Continue",
  },
  recovery: {
    icon: KeyRound,
    heading: "Reset your password",
    body: "Press the button to open the reset form. Reset links work once, and they don't stay good for long.",
    button: "Continue to reset",
  },
  email_change: {
    icon: MailCheck,
    heading: "Confirm your new email",
    body: "Press the button and your account moves to this address. Nothing changes until you do.",
    button: "Confirm the change",
  },
};

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{
    token_hash?: string | string[];
    type?: string | string[];
    next?: string | string[];
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const link = describeConfirmLink(params);
  const error = typeof params.error === "string" ? params.error : null;

  if (!link) {
    return (
      <Card padding="lg" className="animate-fade-up text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <RefreshCw className="size-6" aria-hidden />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">
          {error ? "That link has been used up" : "This link is missing a piece"}
        </h1>
        <p className="mt-3 text-sm text-muted text-pretty">
          {error ??
            "Confirmation links are one-time and don't stay good for long. Sign up again for a fresh one, or head back to the site."}
        </p>
        <div className="mt-6 flex flex-col items-center gap-3">
          <Link
            href="/signup"
            className={buttonClasses({ variant: "secondary", size: "md" })}
          >
            Sign up again
          </Link>
          <Link
            href="/"
            className="text-sm font-semibold text-brand hover:underline"
          >
            Back to uhearth.app
          </Link>
        </div>
      </Card>
    );
  }

  const copy = COPY[link.kind];
  const Icon = copy.icon;

  return (
    <Card padding="lg" className="animate-fade-up text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
        <Icon className="size-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">{copy.heading}</h1>
      <p className="mt-3 text-sm text-muted text-pretty">{copy.body}</p>

      {error ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl bg-danger/10 px-3.5 py-2.5 text-left text-sm text-danger"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col items-center gap-3">
        {/* A plain anchor, not <Link>: prefetching would spend the token. */}
        <a
          href={link.href}
          rel="nofollow"
          className={buttonClasses({ variant: "primary", size: "lg" })}
        >
          {copy.button}
        </a>
        <Link
          href="/"
          className="text-sm font-semibold text-brand hover:underline"
        >
          Back to uhearth.app
        </Link>
      </div>

      <p className="mt-6 border-t border-border pt-4 text-xs text-muted text-pretty">
        Didn&apos;t ask for this? Close the page. Nothing happens until the
        button is pressed.
      </p>
    </Card>
  );
}
