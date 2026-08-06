import Link from "next/link";
import { Wordmark } from "@/components/logo";

/** Calm centered shell for login / signup / verify. Hearth: warm, flat, quiet. */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 pb-16 pt-12 sm:justify-center sm:pt-6">
      <Link
        href="/"
        aria-label="Huddl home"
        className="mb-8 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
      >
        <Wordmark />
      </Link>
      <main className="w-full max-w-sm rounded-3xl border border-border bg-surface p-6 shadow-sm">
        {children}
      </main>
    </div>
  );
}
