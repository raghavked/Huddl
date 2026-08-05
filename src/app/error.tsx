"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Frown, RotateCcw } from "lucide-react";
import { LogoTile } from "@/components/logo";
import { Button, Card, buttonClasses } from "@/components/ui";

/**
 * Route-level error boundary — a calm landing spot when something throws.
 * No data dependencies: everything here must render even when the rest
 * of the app can't.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center px-4 pb-16 pt-10 sm:justify-center sm:pt-6">
      {/* Ambient wash — subtle, token-built (mirrors the auth shell). */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-80 bg-linear-to-b from-brand/[0.07] via-transparent to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 -z-10 h-64 bg-linear-to-t from-accent/[0.05] via-transparent to-transparent"
      />
      <Link
        href="/"
        aria-label="Huddl home"
        className="mb-8 flex items-center gap-2.5 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
      >
        <LogoTile />
        <span className="text-xl font-bold tracking-tight">huddl</span>
      </Link>
      <main className="w-full max-w-md">
        <Card
          padding="lg"
          className="flex animate-fade-up flex-col items-center gap-4 text-center"
        >
          <span className="flex size-16 items-center justify-center rounded-2xl bg-brand-soft">
            <Frown className="size-7 text-brand" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-balance">
              Something broke on our end
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted text-pretty">
              It&apos;s not you — something on our side hiccuped. Give it
              another try, and if it keeps happening we&apos;re probably
              already on it.
            </p>
          </div>
          {error.digest ? (
            <p className="font-mono text-xs text-muted">
              Error code: {error.digest}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button onClick={reset}>
              <RotateCcw className="size-4" aria-hidden />
              Try again
            </Button>
            <Link href="/home" className={buttonClasses({ variant: "ghost" })}>
              Go home
            </Link>
          </div>
        </Card>
      </main>
    </div>
  );
}
