import Link from "next/link";
import { LogoTile } from "@/components/logo";

/** Centered v2 shell for login / signup / verify — the bridge from marketing to app. */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 pb-16 pt-10 sm:justify-center sm:pt-6">
      {/* Ambient wash — subtle, token-built. */}
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
      <main className="w-full max-w-md">{children}</main>
    </div>
  );
}
