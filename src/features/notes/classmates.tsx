import Link from "next/link";
import { UsersRound } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { Badge, cardClasses } from "@/components/ui";
import type { Enrollment, Profile } from "@/lib/types";

export type ClassmateEntry = Enrollment & { profile: Profile };

const ROLE_WEIGHT: Record<Enrollment["role"], number> = {
  instructor: 0,
  ta: 1,
  student: 2,
};

function RoleBadge({ role }: { role: Enrollment["role"] }) {
  if (role === "student") return null;
  return (
    <Badge tone={role === "instructor" ? "brand" : "accent"}>
      {role === "instructor" ? "Instructor" : "TA"}
    </Badge>
  );
}

/**
 * Classmates tab of a course page: instructors first, then TAs, then students,
 * each tile linking to the person's profile.
 */
export function Classmates({
  entries,
  currentUserId,
}: {
  entries: ClassmateEntry[];
  currentUserId: string;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={UsersRound}
        title="No classmates yet"
        description="People show up here as they add this course."
      />
    );
  }

  const sorted = [...entries].sort(
    (a, b) =>
      ROLE_WEIGHT[a.role] - ROLE_WEIGHT[b.role] ||
      a.profile.display_name.localeCompare(b.profile.display_name)
  );
  const alone = sorted.length === 1 && sorted[0]!.user_id === currentUserId;

  return (
    <div>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {sorted.map((entry) => {
          const isMe = entry.user_id === currentUserId;
          return (
            <li key={entry.id}>
              <Link
                href={`/u/${entry.profile.handle}`}
                className={cardClasses({
                  padding: "none",
                  interactive: true,
                  className: "flex items-center gap-3 p-3",
                })}
              >
                <Avatar
                  name={entry.profile.display_name}
                  src={entry.profile.avatar_url}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">
                      {entry.profile.display_name}
                    </span>
                    {isMe ? <Badge tone="neutral">You</Badge> : null}
                    <RoleBadge role={entry.role} />
                  </span>
                  <span className="block truncate text-xs text-muted">
                    @{entry.profile.handle}
                    {entry.profile.major ? ` · ${entry.profile.major}` : ""}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {alone ? (
        <p className="mt-4 text-center text-sm text-muted">
          It&apos;s just you so far — classmates show up here as they add the
          course.
        </p>
      ) : null}
    </div>
  );
}
