import Link from "next/link";
import { Wordmark } from "@/components/logo";

/** Centered shell for login / signup / verify, on a vibrant gradient backdrop. */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center overflow-hidden px-4 pb-16 pt-10 sm:justify-center sm:pt-6">
      {/* Floating gradient blobs. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 -top-16 size-72 rounded-full bg-brand-gradient opacity-20 blur-3xl animate-float-blob"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -right-16 size-80 rounded-full bg-brand-gradient opacity-15 blur-3xl animate-float-blob"
        style={{ animationDelay: "-4s" }}
      />

      <Link
        href="/"
        aria-label="Huddl home"
        className="relative mb-8 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
      >
        <Wordmark />
      </Link>
      <main className="relative w-full max-w-sm rounded-3xl border border-border bg-surface/90 p-6 shadow-glow backdrop-blur-sm">
        {children}
      </main>
    </div>
  );
}
