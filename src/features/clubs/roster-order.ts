import type { ClubMember, Profile } from "@/lib/types";

/* The roster's shape and order, kept out of roster.tsx on purpose: the grid
   is a client component now that officers manage roles from it, and the
   server page still sorts before it ships. */

export type RosterEntry = ClubMember & { profile: Profile };

const ROLE_WEIGHT: Record<ClubMember["role"], number> = {
  owner: 0,
  officer: 1,
  member: 2,
};

/** Owner first, then officers, then members, each group oldest-first. */
export function sortRoster(entries: RosterEntry[]): RosterEntry[] {
  return [...entries].sort(
    (a, b) =>
      ROLE_WEIGHT[a.role] - ROLE_WEIGHT[b.role] ||
      a.joined_at.localeCompare(b.joined_at)
  );
}
