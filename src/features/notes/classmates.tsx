import Link from "next/link";
import { Lock, UsersRound } from "lucide-react";
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
 *
 * Someone who turned Public profile off appears under their handle and their
 * avatar and nothing else: the same redaction the people directory, the board
 * and `@/lib/study-buddy` apply. Sharing a lecture hall is not consent to have
 * your name and your major read off a class list, and no policy stops it:
 * migration 0012 left this to the app. You always see your own row in full.
 *
 * Blocked classmates are still listed, and that is a decision rather than an
 * omission. Blocking hides what a person writes (their notes and their
 * messages, each filtered on the surface that draws them), but an enrolment is
 * a fact the course published, not something the person wrote, and a class
 * list that quietly loses people stops being one. Their name here is already
 * redacted if their profile is private, so hiding the row would cost the list
 * its accuracy and buy nothing.
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

  const sorted = entries
    .map((entry) => {
      const isMe = entry.user_id === currentUserId;
      // Falsy rather than `=== false`, so an `is_public` that never made it
      // into the select redacts instead of leaking.
      const locked = !isMe && !entry.profile.is_public;
      return {
        entry,
        isMe,
        locked,
        // Also what the avatar's initials are built from, so a private
        // classmate's tile doesn't spell out the name the row won't print.
        name: locked ? `@${entry.profile.handle}` : entry.profile.display_name,
      };
    })
    // Sorted on the printed name, not the stored one: ordering the list by a
    // name we're withholding would give it away a letter at a time.
    .sort(
      (a, b) =>
        ROLE_WEIGHT[a.entry.role] - ROLE_WEIGHT[b.entry.role] ||
        a.name.localeCompare(b.name)
    );
  const alone = sorted.length === 1 && sorted[0]!.isMe;

  return (
    <div>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {sorted.map(({ entry, isMe, locked, name }) => (
          <li key={entry.id}>
            <Link
              href={`/u/${entry.profile.handle}`}
              className={cardClasses({
                padding: "none",
                interactive: true,
                className: "flex items-center gap-3 p-3",
              })}
            >
              <Avatar name={name} src={entry.profile.avatar_url} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{name}</span>
                  {isMe ? <Badge tone="brand">You</Badge> : null}
                  <RoleBadge role={entry.role} />
                </span>
                {locked ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted">
                    <Lock className="size-3.5" aria-hidden />
                    Private profile
                  </span>
                ) : (
                  <span className="block truncate text-xs text-muted">
                    @{entry.profile.handle}
                    {entry.profile.major ? ` · ${entry.profile.major}` : ""}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {alone ? (
        <p className="mt-4 text-center text-sm text-muted">
          It&apos;s just you so far. Classmates show up here as they add the
          course.
        </p>
      ) : null}
    </div>
  );
}
