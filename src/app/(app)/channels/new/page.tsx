import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AtSign, ShieldCheck, UsersRound } from "lucide-react";
import { Card, PageHeader, cardClasses } from "@/components/ui";
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
    icon: AtSign,
    text: "It gets a handle that's yours: first come, first served",
  },
] as const;

export default async function NewChannelPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        title="Start a topic room"
        description={`Dorm gossip, intramural soccer, late-night ramen runs. If it's a thing at ${user.university.short_name}, it deserves a channel.`}
        backHref="/channels"
        backLabel="All channels"
      />

      <ul
        className={cardClasses({
          padding: "sm",
          className: "mt-6 flex animate-fade-up flex-col gap-3",
        })}
      >
        {PERKS.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-3 text-sm">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <Icon className="size-5" aria-hidden />
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ul>

      <Card padding="lg" className="mt-6">
        <CreateChannelForm universityName={user.university.short_name} />
      </Card>
    </div>
  );
}
