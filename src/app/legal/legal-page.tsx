import Link from "next/link";
import { Wordmark } from "@/components/logo";
import { buttonClasses } from "@/components/ui";
import type { LegalDoc } from "./content";

/* ------------------------------------------------------------------ */
/* Shared shell for the public /legal/* pages: the marketing header,   */
/* one quiet column of prose, and cross-links to the sibling docs.     */
/* Server component, no client JS. Content lives in ./content.ts.      */
/* ------------------------------------------------------------------ */

const LEGAL_DOCS = [
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/guidelines", label: "Community Guidelines" },
];

export function LegalPage({ doc }: { doc: LegalDoc }) {
  const siblings = LEGAL_DOCS.filter((d) => d.label !== doc.title);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="glass sticky top-0 z-40 border-b border-border/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
            aria-label="Hearth home"
          >
            <Wordmark />
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1.5 sm:gap-2">
            <Link
              href="/login"
              className={buttonClasses({ variant: "ghost", size: "sm" })}
            >
              Log in
            </Link>
            <Link href="/signup" className={buttonClasses({ size: "sm" })}>
              Join
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          {doc.title}
        </h1>
        <p className="mt-2 text-sm text-muted">Last updated {doc.updated}</p>

        {doc.sections.map((section) => (
          <section key={section.heading} className="mt-10">
            <h2 className="text-xl font-bold tracking-tight">
              {section.heading}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted text-pretty sm:text-base">
              {section.body}
            </p>
          </section>
        ))}

        <nav
          aria-label="More legal pages"
          className="mt-14 border-t border-border/60 pt-6"
        >
          <p className="text-sm font-semibold">Read next</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {siblings.map((sibling) => (
              <li key={sibling.href}>
                <Link
                  href={sibling.href}
                  className={buttonClasses({ variant: "soft", size: "sm" })}
                >
                  {sibling.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>

      <footer className="border-t border-border/60 bg-surface">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-8 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            Made for students, between classes. Never selling your data, never
            running ads in your course channels.
          </p>
          <p>&copy; {new Date().getFullYear()} Hearth</p>
        </div>
      </footer>
    </div>
  );
}
