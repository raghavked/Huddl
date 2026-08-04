"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, Loader2, LogOut, UserPlus, Users } from "lucide-react";
import { joinClub, leaveClub } from "@/features/clubs/actions";
import { cn } from "@/lib/utils";
import type { Club, ClubCategory, ClubMember } from "@/lib/types";

/** "academic" -> "Academic" — every category is a single word. */
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
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand-strong",
        className
      )}
    >
      {categoryLabel(category)}
    </span>
  );
}

/**
 * Lightweight confirm dialog — bottom sheet on mobile, centered on larger
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
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="presentation"
      onClick={pending ? undefined : onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-card border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !pending) onCancel();
        }}
      >
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1.5 text-sm text-muted">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-full bg-danger px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Join / Leave controls for the club detail page. Owners get neither —
 * their exit is the disband flow.
 */
export function MembershipActions({
  clubId,
  clubName,
  role,
}: {
  clubId: string;
  clubName: string;
  role: ClubMember["role"] | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (role === "owner") return null;

  if (role === null) {
    return (
      <>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await joinClub(clubId);
              if (result.error) setError(result.error);
            });
          }}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-fg transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <UserPlus className="size-4" aria-hidden />
          )}
          Join club
        </button>
        {error ? (
          <p role="alert" className="w-full text-xs text-danger">
            {error}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          setConfirmingLeave(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-danger disabled:opacity-60"
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <LogOut className="size-4" aria-hidden />
        )}
        Leave
      </button>
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
        <p role="alert" className="w-full text-xs text-danger">
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
    <article className="relative flex flex-col gap-2 rounded-card border border-border bg-surface p-4 transition-colors hover:border-brand/50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/clubs/${club.id}`}
            className="font-semibold leading-snug after:absolute after:inset-0 after:content-['']"
          >
            {club.name}
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <CategoryBadge category={club.category} />
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Users className="size-3.5" aria-hidden />
              {memberCount} {memberCount === 1 ? "member" : "members"}
            </span>
          </div>
        </div>
        {myRole !== null ? (
          <span className="relative z-10 inline-flex shrink-0 items-center gap-1 py-1.5 text-xs font-semibold text-success">
            <Check className="size-3.5" aria-hidden />
            {myRole === "member"
              ? "Joined"
              : myRole === "owner"
                ? "Owner"
                : "Officer"}
          </span>
        ) : (
          <button
            type="button"
            disabled={isPending}
            aria-label={`Join ${club.name}`}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await joinClub(club.id);
                if (result.error) setError(result.error);
              });
            }}
            className="relative z-10 inline-flex shrink-0 items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <UserPlus className="size-3.5" aria-hidden />
            )}
            Join
          </button>
        )}
      </div>
      {club.description ? (
        <p className="line-clamp-2 text-sm text-muted">{club.description}</p>
      ) : null}
      {error ? (
        <p role="alert" className="relative z-10 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </article>
  );
}
