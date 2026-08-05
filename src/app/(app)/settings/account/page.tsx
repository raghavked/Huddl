import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { AccountForm } from "@/features/settings/account-form";

export const metadata: Metadata = {
  title: "Account settings",
  description: "Edit your Huddl profile — name, handle, major, bio and photo.",
};

export default async function AccountSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        eyebrow="Settings"
        title="Account"
        description="How you show up to classmates across channels, DMs and the people directory."
        backHref="/settings"
        backLabel="Settings"
      />
      <div className="mt-8">
        <AccountForm
          profile={user.profile}
          email={user.email}
          universityName={user.university.name}
        />
      </div>
    </div>
  );
}
