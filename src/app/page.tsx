import Link from "next/link";
import { Wordmark } from "@/components/logo";

// Placeholder landing page — replaced by the marketing/frontend pass.
export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <Wordmark />
        <Link
          href="/login"
          className="rounded-full px-4 py-2 text-sm font-semibold text-muted hover:text-foreground"
        >
          Log in
        </Link>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="max-w-xl text-4xl font-bold tracking-tight">
          Your campus, in one huddle.
        </h1>
        <p className="max-w-md text-muted">
          Course chat, study sessions, notes, meetups, voice rooms and DMs —
          verified with your university email.
        </p>
        <Link
          href="/signup"
          className="rounded-full bg-brand px-6 py-3 font-semibold text-brand-fg transition-colors hover:bg-brand-strong"
        >
          Join with your school email
        </Link>
      </main>
    </div>
  );
}
