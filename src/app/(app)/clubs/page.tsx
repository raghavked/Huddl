import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, UsersRound } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { HuddleScene } from "@/components/illustrations";
import { PageHeader, buttonClasses } from "@/components/ui";
import { ClubCard } from "@/features/clubs/club-card";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { Club, ClubCategory, ClubMember } from "@/lib/types";

export const metadata: Metadata = { title: "Clubs" };

const CATEGORIES: readonly ClubCategory[] = [
  "academic",
  "professional",
  "cultural",
  "sports",
  "social",
  "service",
  "other",
];

type ClubRow = Club & { club_members: { count: number }[] };

/** "academic" -> "Academic". Local copy — club-card's version lives in a
 * client module and client functions can't be called from the server. */
function categoryLabel(category: ClubCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function chipClasses(active: boolean): string {
  return cn(
    "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
    active
      ? "bg-brand text-brand-fg shadow-soft"
      : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-foreground"
  );
}

export default async function ClubsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const [{ category: rawCategory }, user] = await Promise.all([
    searchParams,
    getCurrentUser(),
  ]);
  if (!user) redirect("/login");

  const active = CATEGORIES.includes(rawCategory as ClubCategory)
    ? (rawCategory as ClubCategory)
    : null;

  const supabase = await createClient();
  let clubsQuery = supabase
    .from("clubs")
    .select("*, club_members(count)")
    .eq("university_id", user.university.id);
  if (active) clubsQuery = clubsQuery.eq("category", active);

  const [{ data: clubRows }, { data: memberships }] = await Promise.all([
    clubsQuery.order("name"),
    supabase
      .from("club_members")
      .select("club_id, role")
      .eq("user_id", user.userId),
  ]);

  const clubs = (clubRows ?? []) as ClubRow[];
  const myRoles = new Map<string, ClubMember["role"]>(
    ((memberships ?? []) as Pick<ClubMember, "club_id" | "role">[]).map(
      (m) => [m.club_id, m.role] as [string, ClubMember["role"]]
    )
  );

  const startButton = (
    <Link
      href="/clubs/new"
      className={buttonClasses({ size: "sm", className: "gap-1.5" })}
    >
      <Plus className="size-4" aria-hidden />
      Found a club
    </Link>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        title="Clubs"
        description={`Student orgs at ${user.university.short_name} — find your people or found them.`}
        action={clubs.length === 0 ? undefined : startButton}
      />

      <nav
        aria-label="Filter clubs by category"
        className="-mx-4 mt-6 flex animate-fade-up gap-2 overflow-x-auto px-4 pb-1"
      >
        <Link
          href="/clubs"
          aria-current={active === null ? "page" : undefined}
          className={chipClasses(active === null)}
        >
          All
        </Link>
        {CATEGORIES.map((category) => (
          <Link
            key={category}
            href={`/clubs?category=${category}`}
            aria-current={active === category ? "page" : undefined}
            className={chipClasses(active === category)}
          >
            {categoryLabel(category)}
          </Link>
        ))}
      </nav>

      {clubs.length === 0 ? (
        <div className="mt-6 rounded-card border border-dashed border-border">
          <EmptyState
            illustration={<HuddleScene />}
            icon={UsersRound}
            title={active ? `No ${active} clubs yet` : "No clubs yet"}
            description={
              active
                ? `Nobody has started a ${active} club at ${user.university.short_name} yet — be the first.`
                : `Start the first one at ${user.university.short_name}.`
            }
            action={startButton}
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {clubs.map((club) => (
            <ClubCard
              key={club.id}
              club={club}
              memberCount={club.club_members?.[0]?.count ?? 0}
              myRole={myRoles.get(club.id) ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
