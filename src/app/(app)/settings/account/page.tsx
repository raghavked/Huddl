import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Settings
      </Link>
      <header className="mt-3">
        <h1 className="text-2xl font-bold tracking-tight">Account</h1>
        <p className="mt-1 text-sm text-muted">
          How you show up to classmates across channels, DMs and the people
          directory.
        </p>
      </header>
      <div className="mt-6">
        <AccountForm
          profile={user.profile}
          email={user.email}
          universityName={user.university.name}
        />
      </div>
    </div>
  );
}
