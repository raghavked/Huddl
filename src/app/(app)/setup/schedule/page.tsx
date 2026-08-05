import type { Metadata } from "next";
import { redirect } from "next/navigation";
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
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          Upload your schedule
        </h1>
        <p className="mt-1 text-sm text-muted">
          We&apos;ll read it right on your device and match your{" "}
          {user.university.short_name} courses — each one comes with its own
          chat channel.
        </p>
      </header>
      <div className="mt-6">
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
