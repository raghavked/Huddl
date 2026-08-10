import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  Bell,
  Bookmark,
  ChevronRight,
  LogOut,
  ShieldCheck,
  Smartphone,
  SunMoon,
  UserRound,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Badge,
  PageHeader,
  SectionHeader,
  buttonClasses,
  cardClasses,
} from "@/components/ui";
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
      tile: "bg-brand-soft text-brand",
      title: "Account",
      description: "Name, handle, major, bio and photo",
      trailing: null as React.ReactNode,
    },
    {
      href: "/settings/phone",
      icon: Smartphone,
      tile: "bg-accent-soft text-accent",
      title: "Phone verification",
      description: "Optional trust badge — your number stays private",
      trailing: phoneVerified ? (
        <Badge tone="success">
          <BadgeCheck className="size-3.5" aria-hidden />
          Verified
        </Badge>
      ) : (
        <Badge tone="brand">Add</Badge>
      ),
    },
    {
      href: "/settings/notifications",
      icon: Bell,
      tile: "bg-brand-soft text-brand",
      title: "Notifications",
      description: "Choose what gets pushed to your phone",
      trailing: null as React.ReactNode,
    },
    {
      href: "/saved",
      icon: Bookmark,
      tile: "bg-brand-soft text-brand",
      title: "Saved messages",
      description: "Every message you kept — private to you",
      trailing: null as React.ReactNode,
    },
    {
      href: "/settings/privacy",
      icon: ShieldCheck,
      tile: "bg-accent-soft text-accent",
      title: "Privacy & stored images",
      description: "The audit trail for anything you stored in the past",
      trailing: null as React.ReactNode,
    },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        title="Settings"
        description="Your profile, trust badge and privacy — all in one place."
      />

      <section
        aria-label="Your profile"
        className={cardClasses({ className: "mt-8 animate-fade-up" })}
      >
        <div className="flex items-center gap-4">
          <Avatar
            name={profile.display_name}
            src={profile.avatar_url}
            size="lg"
          />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="truncate text-lg font-bold tracking-tight">
                {profile.display_name}
              </span>
              {phoneVerified ? (
                <Badge tone="success">
                  <BadgeCheck className="size-3.5" aria-hidden />
                  Phone verified
                </Badge>
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
        <ul
          className={cardClasses({
            padding: "none",
            className: "divide-y divide-border overflow-hidden",
          })}
        >
          {rows.map(({ href, icon: Icon, tile, title, description, trailing }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-xl",
                    tile
                  )}
                >
                  <Icon className="size-5" aria-hidden />
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

      <section aria-label="Appearance" className="mt-8">
        <SectionHeader title="Appearance" />
        <div
          className={cardClasses({
            padding: "none",
            className: "mt-3 flex items-center gap-3 px-4 py-3.5",
          })}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <SunMoon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Theme</p>
            <p className="mt-0.5 truncate text-xs text-muted">
              Light, dark, or match your system
            </p>
          </div>
          <ThemeToggle />
        </div>
      </section>

      <form action={signOut} className="mt-8">
        <button
          type="submit"
          className={buttonClasses({
            variant: "danger-ghost",
            className: "w-full sm:w-auto",
          })}
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
