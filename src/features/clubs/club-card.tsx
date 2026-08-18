"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import {
  Check,
  Loader2,
  Lock,
  LogOut,
  MailOpen,
  UserPlus,
  Users,
  UsersRound,
} from "lucide-react";
import { Badge, Button, cardClasses } from "@/components/ui";
import {
  joinClub,
  leaveClub,
  respondToClubInvite,
} from "@/features/clubs/actions";
import type { Club, ClubCategory, ClubMember, ClubPrivacy } from "@/lib/types";

/** "academic" -> "Academic". Every category is a single word. */
export function categoryLabel(category: ClubCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function CategoryBadge({
  category,
  className,
}: {
  category: ClubCategory;
  className?: string;
}) {
  return (
    <Badge tone="brand" className={className}>
      {categoryLabel(category)}
    </Badge>
  );
}

/** The closed-door marker, worn by invite clubs on cards and the club page. */
export function InviteOnlyBadge({ className }: { className?: string }) {
  return (
    <Badge tone="neutral" className={className}>
      <Lock className="size-3" aria-hidden />
      Invite only
    </Badge>
  );
}

/**
 * Lightweight confirm dialog: bottom sheet on mobile, centered on larger
 * screens. Shared by the leave and disband flows.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const bodyId = useId();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-black/50 p-4 sm:items-center"
      role="presentation"
      onClick={pending ? undefined : onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={bodyId}
        className="w-full max-w-sm animate-scale-in rounded-card border border-border bg-surface p-5 shadow-lift"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !pending) onCancel();
        }}
      >
        <h2 className="font-bold tracking-tight">{title}</h2>
        <p id={bodyId} className="mt-1.5 text-sm text-muted">
          {body}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            autoFocus
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Join / Leave controls for the club detail page. Open clubs keep the plain
 * join button; an invite club's door only opens from the inside, so a
 * non-member sees the closed door, or their invitation when one is waiting.
 * The president's leave stays visible but disabled: the database would
 * refuse it anyway, and the caption says the way out instead.
 */
export function MembershipActions({
  clubId,
  clubName,
  role,
  privacy,
  inviteId,
}: {
  clubId: string;
  clubName: string;
  role: ClubMember["role"] | null;
  privacy: ClubPrivacy;
  /** The viewer's own pending invitation to this club, when one exists. */
  inviteId: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (role === "owner") {
    return (
      <div className="flex flex-col gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          className="self-start text-muted"
          disabled
        >
          <LogOut className="size-4" aria-hidden />
          Leave
        </Button>
        <p className="text-xs text-muted">
          Hand the presidency to someone first, or disband the club.
        </p>
      </div>
    );
  }

  if (role === null) {
    // An invitation outranks the door policy: answering it is the point.
    if (inviteId !== null) {
      return (
        <div className="w-full rounded-xl bg-brand-soft px-4 py-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-ink">
            <MailOpen className="size-4 text-brand" aria-hidden />
            {"You're invited."}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await respondToClubInvite(
                    inviteId,
                    clubId,
                    true
                  );
                  if (result.error) setError(result.error);
                });
              }}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Check className="size-4" aria-hidden />
              )}
              Accept
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={isPending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await respondToClubInvite(
                    inviteId,
                    clubId,
                    false
                  );
                  if (result.error) setError(result.error);
                });
              }}
            >
              Decline
            </Button>
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-xs font-medium text-danger">
              {error}
            </p>
          ) : null}
        </div>
      );
    }

    if (privacy === "invite") {
      return (
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Lock className="size-4 text-muted" aria-hidden />
            Invite only
          </p>
          <p className="mt-0.5 text-xs text-muted">
            An officer can invite you.
          </p>
        </div>
      );
    }

    return (
      <>
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await joinClub(clubId);
              if (result.error) setError(result.error);
            });
          }}
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <UserPlus className="size-4" aria-hidden />
          )}
          Join club
        </Button>
        {error ? (
          <p role="alert" className="w-full text-xs font-medium text-danger">
            {error}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="text-muted hover:text-danger"
        disabled={isPending}
        onClick={() => {
          setError(null);
          setConfirmingLeave(true);
        }}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <LogOut className="size-4" aria-hidden />
        )}
        Leave
      </Button>
      <ConfirmDialog
        open={confirmingLeave}
        title={`Leave ${clubName}?`}
        body="You'll be removed from the roster and the club chat. You can rejoin any time."
        confirmLabel="Leave club"
        pending={isPending}
        onCancel={() => setConfirmingLeave(false)}
        onConfirm={() => {
          startTransition(async () => {
            const result = await leaveClub(clubId);
            if (result.error) setError(result.error);
            setConfirmingLeave(false);
          });
        }}
      />
      {error ? (
        <p role="alert" className="w-full text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** Directory card: whole card links to the club; Join sits above the link. */
export function ClubCard({
  club,
  memberCount,
  myRole,
}: {
  club: Club;
  memberCount: number;
  myRole: ClubMember["role"] | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <article
      className={cardClasses({
        padding: "sm",
        interactive: true,
        className: "relative flex flex-col gap-2.5",
      })}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <UsersRound className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <Link
            href={`/clubs/${club.id}`}
            className="font-semibold leading-snug after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {club.name}
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <CategoryBadge category={club.category} />
            <Badge tone="neutral">
              <Users className="size-3" aria-hidden />
              {memberCount} {memberCount === 1 ? "member" : "members"}
            </Badge>
            {club.privacy === "invite" ? <InviteOnlyBadge /> : null}
          </div>
        </div>
        {myRole !== null ? (
          <Badge tone="brand" className="relative z-10">
            <Check className="size-3" aria-hidden />
            {myRole === "member"
              ? "Joined"
              : myRole === "owner"
                ? "President"
                : "Officer"}
          </Badge>
        ) : club.privacy === "invite" ? null : (
          <Button
            variant="soft"
            size="sm"
            className="relative z-10"
            disabled={isPending}
            aria-label={`Join ${club.name}`}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await joinClub(club.id);
                if (result.error) setError(result.error);
              });
            }}
          >
            {isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <UserPlus className="size-3.5" aria-hidden />
            )}
            Join
          </Button>
        )}
      </div>
      {club.description ? (
        <p className="line-clamp-2 text-sm text-muted">{club.description}</p>
      ) : null}
      {error ? (
        <p role="alert" className="relative z-10 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </article>
  );
}
