import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Hash, ListChecks, Sparkles, Users } from "lucide-react";
import { PageHeader, buttonClasses, cardClasses } from "@/components/ui";

export const metadata: Metadata = {
  title: "Add your courses",
};

const POINTS = [
  {
    icon: Hash,
    text: "Every course gets its own chat — add a class and you're in it with your classmates.",
  },
  {
    icon: Sparkles,
    text: "Start typing a code and the campus catalog fills in the rest.",
  },
  {
    icon: Users,
    text: "Class not listed yet? Add it — you'll be its first member and classmates join after you.",
  },
];

export default function SetupPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        title="Add your courses"
        description="You're in charge of your course list — add your classes and each one opens its chat for you."
      />

      <section
        aria-label="How adding courses works"
        className={cardClasses({
          padding: "lg",
          className: "mt-8 animate-fade-up",
        })}
      >
        <span className="flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <ListChecks className="size-6" aria-hidden />
        </span>
        <h2 className="mt-4 text-xl font-bold tracking-tight">
          Your classes, added in seconds
        </h2>
        <ul className="mt-4 flex flex-col gap-3">
          {POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-2.5 text-sm">
              <Icon
                className="mt-0.5 size-4 shrink-0 text-brand"
                aria-hidden
              />
              <span className="text-muted">{text}</span>
            </li>
          ))}
        </ul>
        <Link
          href="/setup/manual"
          className={buttonClasses({
            size: "lg",
            className: "mt-6 w-full sm:w-auto",
          })}
        >
          Pick your courses
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </section>

      <p className="mt-8 text-center">
        <Link
          href="/home"
          className={buttonClasses({ variant: "ghost", size: "sm" })}
        >
          Skip for now — you can add courses anytime
        </Link>
      </p>
    </div>
  );
}
