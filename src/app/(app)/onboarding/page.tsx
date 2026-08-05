import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { Badge, Card, PageHeader } from "@/components/ui";
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
    <div className="mx-auto max-w-xl px-4 py-6 md:py-10">
      <PageHeader
        eyebrow="Getting started"
        title={`Welcome to Huddl, ${firstName}!`}
        description={`You're verified as a ${user.university.short_name} student (@${user.profile.handle}). Tell your classmates a little about yourself — you can change any of this later.`}
        action={
          <Badge tone="accent">
            <GraduationCap className="size-3.5" aria-hidden />
            {user.university.name}
          </Badge>
        }
      />

      <Card padding="lg" className="mt-6 animate-fade-up">
        <OnboardingForm profile={user.profile} />
      </Card>
    </div>
  );
}
