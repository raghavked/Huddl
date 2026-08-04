import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CalendarDays, Crown, MessageCircle } from "lucide-react";
import { ClubForm } from "@/features/clubs/club-form";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Start a club" };

const PERKS = [
  {
    icon: MessageCircle,
    text: "A chat channel just for members — created automatically",
  },
  {
    icon: CalendarDays,
    text: "An events board for meetings, socials and everything else",
  },
  {
    icon: Crown,
    text: "A roster with you as the owner — promote officers any time",
  },
] as const;

export default async function NewClubPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href="/clubs"
        className="inline-flex items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All clubs
      </Link>

      <h1 className="mt-4 text-xl font-bold">Start a club</h1>
      <p className="mt-1 text-sm text-muted">
        Found a new student org at {user.university.short_name}. Here&apos;s
        what you get:
      </p>

      <ul className="mt-4 flex flex-col gap-2.5 rounded-card border border-border bg-surface-2 p-4">
        {PERKS.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-2.5 text-sm">
            <Icon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <span>{text}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6 rounded-card border border-border bg-surface p-5">
        <ClubForm
          universityId={user.university.id}
          universityName={user.university.short_name}
          userId={user.userId}
        />
      </div>
    </div>
  );
}
