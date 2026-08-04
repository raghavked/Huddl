import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { cn } from "@/lib/utils";
import type { ClubMember, Profile } from "@/lib/types";

export type RosterEntry = ClubMember & { profile: Profile };

const ROLE_WEIGHT: Record<ClubMember["role"], number> = {
  owner: 0,
  officer: 1,
  member: 2,
};

/** Owner first, then officers, then members — each group oldest-first. */
export function sortRoster(entries: RosterEntry[]): RosterEntry[] {
  return [...entries].sort(
    (a, b) =>
      ROLE_WEIGHT[a.role] - ROLE_WEIGHT[b.role] ||
      a.joined_at.localeCompare(b.joined_at)
  );
}

function RoleBadge({ role }: { role: ClubMember["role"] }) {
  if (role === "member") return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        role === "owner"
          ? "bg-brand-soft text-brand-strong"
          : "bg-accent-soft text-accent"
      )}
    >
      {role}
    </span>
  );
}

/** Roster grid: avatar, name, handle, role badge; each tile links to /u/<handle>. */
export function Roster({ members }: { members: RosterEntry[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {members.map((member) => (
        <li key={member.user_id}>
          <Link
            href={`/u/${member.profile.handle}`}
            className="flex items-center gap-3 rounded-card border border-border bg-surface p-3 transition-colors hover:bg-surface-2"
          >
            <Avatar
              name={member.profile.display_name}
              src={member.profile.avatar_url}
              size="sm"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">
                  {member.profile.display_name}
                </span>
                <RoleBadge role={member.role} />
              </span>
              <span className="block truncate text-xs text-muted">
                @{member.profile.handle}
                {member.profile.major ? ` · ${member.profile.major}` : ""}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
