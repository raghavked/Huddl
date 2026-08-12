import Link from "next/link";
import { Lock } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Badge, cardClasses } from "@/components/ui";
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
    <Badge
      tone={role === "owner" ? "brand" : "accent"}
      className="uppercase tracking-wide"
    >
      {role}
    </Badge>
  );
}

/**
 * Roster grid: avatar, name, handle, role badge; each tile links to /u/<handle>.
 *
 * A classmate who turned Public profile off is a handle and a face here, the
 * same as in the people directory, on the board, and on the native roster.
 * Joining a club is not consent to have your name and your major drawn beside
 * the membership — and nothing in the database withholds them (migration 0012
 * left the redaction to the app), so this component is the only thing between
 * a private student and a page their whole club reads.
 *
 * Blocked members are deliberately still here. Blocking hides what someone
 * writes; a roster row is a membership fact the club itself published, and
 * dropping it would put the list out of step with the member count beside it
 * and with the native roster, which shows blocked members too.
 *
 * @param currentUserId The viewer's `profiles.id`, so a private student still
 *   reads their own row in full. Optional because the club page has yet to
 *   pass it: without it a private viewer is redacted from themselves, which is
 *   the harmless way to be wrong.
 */
export function Roster({
  members,
  currentUserId,
}: {
  members: RosterEntry[];
  currentUserId?: string;
}) {
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2">
      {members.map((member) => {
        const isMe = member.user_id === currentUserId;
        // Falsy rather than `=== false`, so an `is_public` that never made it
        // into the select redacts instead of leaking.
        const locked = !isMe && !member.profile.is_public;
        // The avatar falls back to initials, so it has to be built from the
        // name we're allowed to print — otherwise a private student's tile
        // still spells out their real one.
        const name = locked
          ? `@${member.profile.handle}`
          : member.profile.display_name;
        return (
          <li key={member.user_id}>
            <Link
              href={`/u/${member.profile.handle}`}
              className={cardClasses({
                padding: "none",
                interactive: true,
                className: "flex items-center gap-3 p-3",
              })}
            >
              <Avatar name={name} src={member.profile.avatar_url} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{name}</span>
                  <RoleBadge role={member.role} />
                </span>
                {locked ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted">
                    <Lock className="size-3.5" aria-hidden />
                    Private profile
                  </span>
                ) : (
                  <span className="block truncate text-xs text-muted">
                    @{member.profile.handle}
                    {member.profile.major ? ` · ${member.profile.major}` : ""}
                  </span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
