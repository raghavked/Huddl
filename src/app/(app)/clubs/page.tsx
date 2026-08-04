import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
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
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-fg transition-opacity hover:opacity-90"
    >
      <Plus className="size-4" aria-hidden />
      Start a club
    </Link>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Clubs</h1>
          <p className="truncate text-sm text-muted">
            Student orgs at {user.university.short_name}
          </p>
        </div>
        {startButton}
      </header>

      <nav
        aria-label="Filter clubs by category"
        className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1"
      >
        <Link
          href="/clubs"
          aria-current={active === null ? "page" : undefined}
          className={cn(
            "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
            active === null
              ? "bg-brand text-brand-fg"
              : "bg-surface-2 text-muted hover:text-foreground"
          )}
        >
          All
        </Link>
        {CATEGORIES.map((category) => (
          <Link
            key={category}
            href={`/clubs?category=${category}`}
            aria-current={active === category ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              active === category
                ? "bg-brand text-brand-fg"
                : "bg-surface-2 text-muted hover:text-foreground"
            )}
          >
            {categoryLabel(category)}
          </Link>
        ))}
      </nav>

      {clubs.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title={active ? `No ${active} clubs yet` : "No clubs yet"}
          description={
            active
              ? `Nobody has started a ${active} club at ${user.university.short_name} yet — be the first.`
              : `Start the first one at ${user.university.short_name}.`
          }
          action={startButton}
        />
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
