import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Smartphone } from "lucide-react";
import { Card, buttonClasses } from "@/components/ui";

export const metadata: Metadata = { title: "Email confirmed" };

/**
 * Where the confirmation email's link finally lands, via /auth/confirm.
 * One page serves two journeys that the link itself cannot tell apart: a
 * student who signed up in the iOS app and opened the email on their phone,
 * and one who signed up in this browser. The first needs to be told,
 * plainly, to go back to the app; the second is already signed in here (the
 * confirm route set the session cookies) and just needs a door forward. So
 * the app instruction leads and the browser path follows, and neither is
 * a dead end.
 */
export default function ConfirmedPage() {
  return (
    <Card padding="lg" className="animate-fade-up text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-success/10 text-success">
        <CheckCircle2 className="size-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">
        You&apos;re confirmed
      </h1>
      <p className="mt-3 text-sm text-muted text-pretty">
        Your email checks out, and your account is ready. One last step:
        pick up where you started.
      </p>

      <div className="mt-6 rounded-xl bg-brand-soft/60 px-4 py-4 text-left">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Smartphone className="size-4 text-brand" aria-hidden />
          Signed up in the Hearth app?
        </p>
        <p className="mt-1.5 text-sm text-muted text-pretty">
          Head back to the app on your phone and log in with your email and
          password. Everything from here on lives there.
        </p>
      </div>

      <div className="mt-4 rounded-xl border border-border px-4 py-4 text-left">
        <p className="text-sm font-semibold">Signed up here in the browser?</p>
        <p className="mt-1.5 text-sm text-muted text-pretty">
          You&apos;re already logged in on this device. Keep going and set up
          your profile.
        </p>
        <Link
          href="/onboarding"
          className={buttonClasses({ size: "md", className: "mt-3" })}
        >
          Continue in the browser
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>

      <div className="mt-6 border-t border-border pt-4 text-sm text-muted">
        <p>
          Curious what Hearth is all about?{" "}
          <Link href="/" className="font-semibold text-brand hover:underline">
            Take the tour
          </Link>
        </p>
      </div>
    </Card>
  );
}
