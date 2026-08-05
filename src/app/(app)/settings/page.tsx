import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  ChevronRight,
  Link2,
  LogOut,
  ShieldCheck,
  Smartphone,
  UserRound,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage your Huddl account, phone verification and privacy.",
};

async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { profile, university, email } = user;
  const phoneVerified = Boolean(profile.phone_verified_at);

  const rows = [
    {
      href: "/settings/account",
      icon: UserRound,
      title: "Account",
      description: "Name, handle, major, bio and photo",
      trailing: null as React.ReactNode,
    },
    {
      href: "/settings/phone",
      icon: Smartphone,
      title: "Phone verification",
      description: "Optional trust badge — your number stays private",
      trailing: phoneVerified ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
          <BadgeCheck className="size-3.5" aria-hidden />
          Verified
        </span>
      ) : (
        <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand-strong">
          Add
        </span>
      ),
    },
    {
      href: "/settings/canvas",
      icon: Link2,
      title: "Canvas connection",
      description: "Sync your courses and channels from Canvas",
      trailing: null as React.ReactNode,
    },
    {
      href: "/settings/privacy",
      icon: ShieldCheck,
      title: "Privacy & schedule images",
      description: "Audit trail and controls for anything you've uploaded",
      trailing: null as React.ReactNode,
    },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      </header>

      <section
        aria-label="Your profile"
        className="mt-6 rounded-card border border-border bg-surface p-5"
      >
        <div className="flex items-center gap-4">
          <Avatar
            name={profile.display_name}
            src={profile.avatar_url}
            size="lg"
          />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="truncate text-lg font-bold">
                {profile.display_name}
              </span>
              {phoneVerified ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                  <BadgeCheck className="size-3.5" aria-hidden />
                  Phone verified
                </span>
              ) : null}
            </p>
            <p className="truncate text-sm text-muted">@{profile.handle}</p>
            <p className="mt-0.5 truncate text-sm text-muted">
              {university.name} · {email}
            </p>
          </div>
        </div>
      </section>

      <section aria-label="Settings sections" className="mt-4">
        <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
          {rows.map(({ href, icon: Icon, title, description, trailing }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2">
                  <Icon className="size-5 text-muted" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {description}
                  </span>
                </span>
                {trailing}
                <ChevronRight
                  className="size-4 shrink-0 text-muted"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <form action={signOut} className="mt-6">
        <button
          type="submit"
          className={cn(
            "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-danger transition-colors hover:bg-surface-2",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger sm:w-auto"
          )}
        >
          <LogOut className="size-4" aria-hidden />
          Sign out
        </button>
      </form>

      <footer className="mt-10 text-center text-xs text-muted">
        Huddl 0.1
      </footer>
    </div>
  );
}
