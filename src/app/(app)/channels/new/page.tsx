import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Hash, ShieldCheck, UsersRound } from "lucide-react";
import { CreateChannelForm } from "@/features/discover/create-channel-form";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "New channel" };

const PERKS = [
  {
    icon: UsersRound,
    text: "Anyone on campus can find it in Browse and join instantly",
  },
  {
    icon: ShieldCheck,
    text: "You're the moderator from day one",
  },
  {
    icon: Hash,
    text: "It gets a #handle that's yours — first come, first served",
  },
] as const;

export default async function NewChannelPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href="/channels"
        className="inline-flex items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All channels
      </Link>

      <h1 className="mt-4 text-xl font-bold">Start a topic channel</h1>
      <p className="mt-1 text-sm text-muted">
        Dorm gossip, intramural soccer, late-night ramen runs — if it&apos;s a
        thing at {user.university.short_name}, it deserves a channel.
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
        <CreateChannelForm universityName={user.university.short_name} />
      </div>
    </div>
  );
}
