"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Loader2, Lock } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Badge, Button, cardClasses } from "@/components/ui";
import {
  removeClubMember,
  setClubMemberRole,
  transferClubPresidency,
} from "@/features/clubs/actions";
import { ConfirmDialog } from "@/features/clubs/club-card";
import type { RosterEntry } from "@/features/clubs/roster-order";
import type { ClubMember } from "@/lib/types";

/* The data says owner; the club says President. The database word names a
   permission, the badge names a person, and members read the badge. */
function RoleBadge({ role }: { role: ClubMember["role"] }) {
  if (role === "member") return null;
  return (
    <Badge
      tone={role === "owner" ? "brand" : "accent"}
      className="uppercase tracking-wide"
    >
      {role === "owner" ? "President" : "Officer"}
    </Badge>
  );
}

/**
 * The management strip under a tile. Everything here is pre-empting a
 * database guardrail rather than inventing one: officers manage the two
 * lesser roles and never the president's row, and only the president can
 * move the crown, so those are the only buttons that render.
 */
function MemberActions({
  clubId,
  member,
  name,
  viewerIsOwner,
}: {
  clubId: string;
  member: RosterEntry;
  name: string;
  viewerIsOwner: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirmingHandoff, setConfirmingHandoff] = useState(false);
  const [isPending, startTransition] = useTransition();

  const run = (action: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
    });
  };

  return (
    <div className="border-t border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-0">
        {isPending ? (
          <Loader2 className="size-3.5 animate-spin text-muted" aria-hidden />
        ) : null}
        {member.role === "member" ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(() => setClubMemberRole(clubId, member.user_id, "officer"))
            }
          >
            Make officer
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(() => setClubMemberRole(clubId, member.user_id, "member"))
            }
          >
            Make member
          </Button>
        )}
        {viewerIsOwner ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => {
              setError(null);
              setConfirmingHandoff(true);
            }}
          >
            Hand off presidency
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="hover:text-danger"
          disabled={isPending}
          onClick={() => run(() => removeClubMember(clubId, member.user_id))}
        >
          Remove from club
        </Button>
      </div>
      <ConfirmDialog
        open={confirmingHandoff}
        title="Hand off presidency"
        body={`The presidency moves to ${name}. You stay on as an officer.`}
        confirmLabel="Hand off presidency"
        pending={isPending}
        onCancel={() => setConfirmingHandoff(false)}
        onConfirm={() => {
          startTransition(async () => {
            const result = await transferClubPresidency(
              clubId,
              member.user_id
            );
            if (result.error) setError(result.error);
            setConfirmingHandoff(false);
          });
        }}
      />
      {error ? (
        <p role="alert" className="px-1 pb-1 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Roster grid: avatar, name, handle, role badge; each tile links to /u/<handle>.
 *
 * A classmate who turned Public profile off is a handle and a face here, the
 * same as in the people directory, on the board, and on the native roster.
 * Joining a club is not consent to have your name and your major drawn beside
 * the membership, and nothing in the database withholds them (migration 0012
 * left the redaction to the app), so this component is the only thing between
 * a private student and a page their whole club reads.
 *
 * Blocked members are deliberately still here. Blocking hides what someone
 * writes; a roster row is a membership fact the club itself published, and
 * dropping it would put the list out of step with the member count beside it
 * and with the native roster, which shows blocked members too.
 *
 * Officers additionally get the management strip under other people's tiles.
 * The president's own tile carries no actions for anyone: the crown moves
 * only through the handoff flow, and nobody removes the president.
 *
 * @param currentUserId The viewer's `profiles.id`, so a private student still
 *   reads their own row in full. Optional because the club page has yet to
 *   pass it: without it a private viewer is redacted from themselves, which is
 *   the harmless way to be wrong.
 * @param clubId Set alongside `viewerRole` to enable role management.
 * @param viewerRole The viewer's own club role; officers and the owner see
 *   the management strip, everyone else just reads names.
 */
export function Roster({
  members,
  currentUserId,
  clubId,
  viewerRole = null,
}: {
  members: RosterEntry[];
  currentUserId?: string;
  clubId?: string;
  viewerRole?: ClubMember["role"] | null;
}) {
  const canManage =
    clubId !== undefined &&
    (viewerRole === "officer" || viewerRole === "owner");

  return (
    <ul className="grid gap-2.5 sm:grid-cols-2">
      {members.map((member) => {
        const isMe = member.user_id === currentUserId;
        // Falsy rather than `=== false`, so an `is_public` that never made it
        // into the select redacts instead of leaking.
        const locked = !isMe && !member.profile.is_public;
        // The avatar falls back to initials, so it has to be built from the
        // name we're allowed to print. Otherwise a private student's tile
        // still spells out their real one.
        const name = locked
          ? `@${member.profile.handle}`
          : member.profile.display_name;
        const manageable = canManage && !isMe && member.role !== "owner";
        return (
          <li key={member.user_id}>
            <div
              className={cardClasses({
                padding: "none",
                interactive: true,
              })}
            >
              <Link
                href={`/u/${member.profile.handle}`}
                className="flex items-center gap-3 rounded-card p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <Avatar name={name} src={member.profile.avatar_url} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">
                      {name}
                    </span>
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
              {manageable && clubId ? (
                <MemberActions
                  clubId={clubId}
                  member={member}
                  name={name}
                  viewerIsOwner={viewerRole === "owner"}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
