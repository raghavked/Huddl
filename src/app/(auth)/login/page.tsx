import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, Smartphone } from "lucide-react";
import { Card, buttonClasses } from "@/components/ui";

export const metadata: Metadata = { title: "Log in" };

/**
 * The website has no signed-in surface anymore; the product lives in the
 * app. This page stays because the world still links here: the header, old
 * bookmarks, and the confirmation route's error bounces (which arrive with
 * `?error=`). It tells the truth and offers the two things a browser can
 * still do: reset a password, or go read about the app.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <Card padding="lg" className="animate-fade-up text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
        <Smartphone className="size-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">
        Hearth lives in the app
      </h1>
      <p className="mt-3 text-sm text-muted text-pretty">
        Log in inside the Hearth app on your phone. This website handles
        sign-up, email confirmation, and password resets, and not much else.
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

      <div className="mt-6 flex flex-col items-center gap-3">
        <Link
          href="/forgot-password"
          className={buttonClasses({ variant: "secondary", size: "md" })}
        >
          Reset my password
        </Link>
        <Link href="/" className="text-sm font-semibold text-brand hover:underline">
          Back to the tour
        </Link>
      </div>
    </Card>
  );
}
