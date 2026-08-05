import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ScheduleWizard } from "@/features/schedule/schedule-wizard";

export const metadata: Metadata = {
  title: "Upload your schedule",
  description:
    "Snap a photo of your schedule — it's read on your device, and your courses become chat channels.",
};

export default async function ScheduleSetupPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: term } = await supabase
    .from("terms")
    .select("id, name")
    .eq("university_id", user.university.id)
    .eq("is_current", true)
    .limit(1)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        eyebrow="Setup"
        backHref="/setup"
        backLabel="Setup"
        title="Upload your schedule"
        description={`We'll read it right on your device and match your ${user.university.short_name} courses — each one comes with its own chat channel.`}
      />
      <div className="mt-8 animate-fade-up">
        <ScheduleWizard
          userId={user.userId}
          universityId={user.university.id}
          termId={term?.id ?? null}
          termName={term?.name ?? null}
        />
      </div>
    </div>
  );
}
