import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Settings
      </Link>
      <header className="mt-3">
        <h1 className="text-2xl font-bold tracking-tight">
          Phone verification
        </h1>
        <p className="mt-1 text-sm text-muted">
          Verifying adds a trust badge to your profile so classmates know
          you&apos;re a real person. It&apos;s optional, and your number is
          never shown to other students.
        </p>
      </header>
      <div className="mt-6">
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
