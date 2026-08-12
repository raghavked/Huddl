import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader, SectionHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import {
  ChangePasswordForm,
  SignOutOtherDevices,
} from "@/features/settings/security-form";
import { DeleteAccount } from "@/features/settings/delete-account";

export const metadata: Metadata = {
  title: "Password and security",
  description:
    "Change your Huddl password, sign out on every other device, or delete your account for good.",
};

/* Password and security — everything a student can do about the credentials
 * and the account itself, on one page instead of three.
 *
 * The three actions here are strangers to each other in every way except
 * consequence: changing a password, throwing other devices off, and leaving.
 * What they share is that each one is a thing you come looking for exactly
 * once, usually in a hurry, usually because something happened. Putting them
 * behind one row in Settings means the student only has to remember one
 * place, and the page can order them by how permanent they are — the reversible
 * pair first, the irreversible one last and under its own heading.
 *
 * The state model lives with the actions, not here. This page reads only the
 * session, and the session cannot half-arrive: `getCurrentUser()` either has
 * it or the student gets bounced to the login screen, and the settings
 * segment's `loading.tsx` covers the wait. There is no list on the page, so
 * there is nothing here that can be empty. Loading, failure-with-a-way-back
 * and success all belong to the two client components below, and both carry
 * all of them.
 *
 * Deletion sits behind `#delete-account` because the Settings index links
 * straight to it — the Terms and the privacy policy both promise students
 * "Settings, then Delete account", and a promise like that should land on the
 * thing itself rather than somewhere near it.
 */
export default async function SecuritySettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref="/settings"
        backLabel="Settings"
        title="Password and security"
        description="Your password, the other devices you're signed in on, and the way out if you want it."
      />

      <div className="mt-8 space-y-4">
        <ChangePasswordForm email={user.email} />
        <SignOutOtherDevices />
      </div>

      {/* `scroll-mt` keeps the heading clear of the frosted top bar when the
          Settings index jumps a student straight down here. */}
      <section id="delete-account" className="mt-10 scroll-mt-24">
        <SectionHeader title="Leaving Huddl" />
        <div className="mt-3">
          <DeleteAccount handle={user.profile.handle} />
        </div>
      </section>
    </div>
  );
}
