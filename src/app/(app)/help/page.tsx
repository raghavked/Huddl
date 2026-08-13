import type { Metadata } from "next";
import { PageHeader, Card } from "@/components/ui";
import { HELP_INTRO, HELP_SECTIONS } from "@/lib/help-content";

export const metadata: Metadata = {
  title: "How Hearth works",
  description:
    "What each tab does, what a class brings with it, and who can see what.",
};

/*
 * The help page. Same sentences as the native screen, from the same module,
 * laid out as a document rather than a tour: someone lands here with a
 * question, so the terms are headings and the answers are one line each.
 *
 * Every section is anchored by its key, so a support reply can link straight
 * to /help#privacy rather than saying "scroll down a bit".
 */
export default function HelpPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6">
      <PageHeader
        title="How Hearth works"
        description={HELP_INTRO}
        backHref="/settings"
        backLabel="Settings"
      />

      <div className="mt-8 space-y-8">
        {HELP_SECTIONS.map((section) => (
          <section key={section.key} id={section.key} aria-labelledby={`${section.key}-heading`}>
            <h2
              id={`${section.key}-heading`}
              className="text-lg font-semibold tracking-tight"
            >
              {section.title}
            </h2>
            {section.intro ? (
              <p className="mt-1 text-sm text-muted">{section.intro}</p>
            ) : null}

            <Card className="mt-3">
              <dl className="divide-y divide-border">
                {section.items.map((item, index) => (
                  <div
                    key={item.term}
                    className={index === 0 ? "pb-3" : "py-3 last:pb-0"}
                  >
                    <dt className="text-sm font-semibold">{item.term}</dt>
                    <dd className="mt-1 text-sm text-muted">{item.detail}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </section>
        ))}
      </div>
    </div>
  );
}
