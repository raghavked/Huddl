import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PhoneVerify } from "@/features/settings/phone-verify";

export const metadata: Metadata = {
  title: "Phone verification",
  description:
    "Verify your phone number for an optional trust badge. Your number is never shown to other students.",
};

export default async function PhoneSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Prefill from the owner-only phone_verifications table — the number is no
  // longer stored on the public profiles row.
  const supabase = await createClient();
  const { data: lastVerification } = await supabase
    .from("phone_verifications")
    .select("phone")
    .eq("user_id", user.userId)
    .not("verified_at", "is", null)
    .order("verified_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        title="Phone verification"
        description="Verifying adds a trust badge to your profile so classmates know you're a real person. It's optional, and your number is never shown to other students."
        backHref="/settings"
        backLabel="Settings"
      />
      <div className="mt-8">
        <PhoneVerify
          initialPhone={
            (lastVerification as { phone: string } | null)?.phone ?? null
          }
          verifiedAt={user.profile.phone_verified_at}
        />
      </div>
    </div>
  );
}
