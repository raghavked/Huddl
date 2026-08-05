import type { Metadata } from "next";
import Link from "next/link";
import {
  Camera,
  ChevronRight,
  GraduationCap,
  ListChecks,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import {
  Badge,
  PageHeader,
  buttonClasses,
  cardClasses,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Add your courses",
};

interface SetupOption {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  recommended?: boolean;
  privacyNote?: string;
}

const OPTIONS: SetupOption[] = [
  {
    href: "/setup/canvas",
    icon: GraduationCap,
    title: "Connect Canvas",
    description:
      "Sync your courses automatically and keep them up to date every term.",
    recommended: true,
  },
  {
    href: "/setup/schedule",
    icon: Camera,
    title: "Upload your schedule",
    description:
      "Snap a photo or screenshot of your schedule and we'll pick out your courses.",
    privacyNote: "Processed on your device",
  },
  {
    href: "/setup/manual",
    icon: ListChecks,
    title: "Pick courses manually",
    description: "Browse your school's course list and choose your classes.",
  },
];

export default function SetupPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        eyebrow="Setup"
        title="Add your courses"
        description="Every course gets its own chat — add yours and you're automatically in with your classmates."
      />

      <ul className="mt-8 flex animate-fade-up flex-col gap-3">
        {OPTIONS.map(
          ({ href, icon: Icon, title, description, recommended, privacyNote }) => (
            <li key={href}>
              <Link
                href={href}
                className={cardClasses({
                  interactive: true,
                  className: "group flex items-center gap-4",
                })}
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <Icon className="size-6" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-bold tracking-tight">{title}</span>
                    {recommended ? <Badge tone="brand">Fastest</Badge> : null}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted">
                    {description}
                  </span>
                  {privacyNote ? (
                    <span className="mt-1.5 flex items-center gap-1 text-xs font-medium text-accent">
                      <ShieldCheck className="size-3.5" aria-hidden />
                      {privacyNote}
                    </span>
                  ) : null}
                </span>
                <ChevronRight
                  className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </li>
          )
        )}
      </ul>

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
