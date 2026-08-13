import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { AccountForm } from "@/features/settings/account-form";
import { InterestsEditor } from "@/features/profile/interests-editor";

export const metadata: Metadata = {
  title: "Account settings",
  description:
    "Edit your Huddl profile: name, handle, major, bio, photo, and what you're into.",
};

export default async function AccountSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
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

      {/* Saved on its own, because it is its own thought: the two columns
          from migration 0034 that turn a directory row into a person. */}
      <div className="mt-6">
        <InterestsEditor
          userId={user.userId}
          initialInterests={user.profile.interests ?? []}
          initialLookingFor={user.profile.looking_for}
        />
      </div>
    </div>
  );
}
