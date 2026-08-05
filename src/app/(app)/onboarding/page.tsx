import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { OnboardingForm } from "@/features/auth/onboarding-form";

export const metadata: Metadata = {
  title: "Welcome",
};

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const firstName =
    user.profile.display_name.trim().split(/\s+/)[0] ||
    user.profile.display_name;

  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      <div className="flex flex-col items-start gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-strong">
          <GraduationCap className="size-3.5" aria-hidden />
          {user.university.name}
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome to Huddl, {firstName}!
          </h1>
          <p className="mt-1 text-sm text-muted">
            You&apos;re verified as a {user.university.short_name} student
            (@{user.profile.handle}). Tell your classmates a little about
            yourself — you can change any of this later.
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-card border border-border bg-surface p-5">
        <OnboardingForm profile={user.profile} />
      </div>
    </div>
  );
}
