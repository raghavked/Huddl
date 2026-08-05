import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarDays, Crown, MessageCircle } from "lucide-react";
import { PageHeader, cardClasses } from "@/components/ui";
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
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref="/clubs"
        backLabel="All clubs"
        eyebrow="Clubs"
        title="Start a club"
        description={`Found a new student org at ${user.university.short_name}. Here's what you get:`}
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
            <span className="text-pretty">{text}</span>
          </li>
        ))}
      </ul>

      <div className={cardClasses({ padding: "lg", className: "mt-6" })}>
        <ClubForm
          universityId={user.university.id}
          universityName={user.university.short_name}
          userId={user.userId}
        />
      </div>
    </div>
  );
}
