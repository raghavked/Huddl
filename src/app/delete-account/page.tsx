import type { Metadata } from "next";
import Link from "next/link";
import { Card, buttonClasses } from "@/components/ui";
import { LogoTile } from "@/components/logo";

export const metadata: Metadata = {
  title: "Delete your account",
  description:
    "How to delete your Hearth account and everything in it, from the app or by email.",
};

/**
 * The public account-deletion page. Both app stores ask for a URL that
 * explains how a person deletes their account without being inside the
 * app, and a student locked out of their phone needs the same answer.
 * The in-app path is primary; the email path is for everyone else.
 */
export default function DeleteAccountPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 pb-16 pt-10 sm:justify-center sm:pt-6">
      <Link
        href="/"
        aria-label="Hearth home"
        className="mb-8 flex items-center gap-2.5 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
      >
        <LogoTile />
        <span className="text-xl font-bold tracking-tight">hearth</span>
      </Link>
      <main id="main" className="w-full max-w-md">
        <Card padding="lg" className="animate-fade-up">
          <h1 className="text-2xl font-bold tracking-tight">
            Delete your account
          </h1>
          <p className="mt-3 text-sm text-muted text-pretty">
            Deleting your Hearth account removes everything at once: your
            profile, messages, posts, files, courses, blocks, and push tokens.
            It happens immediately and permanently, with no recovery window.
          </p>

          <h2 className="mt-6 text-base font-semibold">In the app</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-muted">
            <li>Open Hearth and go to Settings.</li>
            <li>Scroll to the bottom and tap Delete account.</li>
            <li>Confirm. You are signed out and the account is gone.</li>
          </ol>

          <h2 className="mt-6 text-base font-semibold">By email</h2>
          <p className="mt-2 text-sm text-muted text-pretty">
            If you can&apos;t get into the app, email{" "}
            <a
              href="mailto:hello@uhearth.app?subject=Delete%20my%20Hearth%20account"
              className="font-semibold text-brand hover:underline"
            >
              hello@uhearth.app
            </a>{" "}
            from the university address on the account. A person reads it,
            and the account is deleted within 30 days, usually the same day.
          </p>

          <h2 className="mt-6 text-base font-semibold">Before you go</h2>
          <p className="mt-2 text-sm text-muted text-pretty">
            Settings, then Privacy, then Your data gives you one file with
            everything Hearth holds about you. Download it first if you want
            a copy; nothing survives the deletion.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/legal/privacy"
              className={buttonClasses({ variant: "secondary", size: "md" })}
            >
              Read the privacy policy
            </Link>
            <Link href="/" className="text-sm font-semibold text-brand hover:underline">
              Back to uhearth.app
            </Link>
          </div>
        </Card>
      </main>
    </div>
  );
}
