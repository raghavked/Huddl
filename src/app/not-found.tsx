import type { Metadata } from "next";
import Link from "next/link";
import { DiscoverScene } from "@/components/illustrations";
import { LogoTile } from "@/components/logo";
import { buttonClasses } from "@/components/ui";

export const metadata: Metadata = { title: "Page not found" };

/**
 * On-brand 404. Works for signed-in and signed-out visitors alike —
 * no auth calls, no data, just a nudge back toward campus.
 */
export default function NotFound() {
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
      <main className="flex w-full max-w-md animate-fade-up flex-col items-center gap-5 text-center">
        <DiscoverScene />
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-ink">
            404
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-balance">
            This page wandered off
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted text-pretty">
            The link might be old, or this page moved somewhere new. Campus is
            still buzzing, though — head back and jump in.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/home" className={buttonClasses()}>
            Take me home
          </Link>
          <Link href="/" className={buttonClasses({ variant: "ghost" })}>
            Back to the front page
          </Link>
        </div>
      </main>
    </div>
  );
}
