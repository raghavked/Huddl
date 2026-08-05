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
    <div className="mx-auto max-w-xl px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Add your courses</h1>
      <p className="mt-1 text-sm text-muted">
        Every course gets its own chat — add yours and you&apos;re
        automatically in with your classmates.
      </p>

      <ul className="mt-6 space-y-3">
        {OPTIONS.map(
          ({ href, icon: Icon, title, description, recommended, privacyNote }) => (
            <li key={href}>
              <Link
                href={href}
                className="group flex items-center gap-4 rounded-card border border-border bg-surface p-4 transition-colors hover:border-brand/60 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft">
                  <Icon className="size-5 text-brand-strong" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{title}</span>
                    {recommended ? (
                      <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-strong">
                        Recommended
                      </span>
                    ) : null}
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

      <p className="mt-6 text-center">
        <Link
          href="/home"
          className="text-sm font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Skip for now — you can add courses anytime
        </Link>
      </p>
    </div>
  );
}
