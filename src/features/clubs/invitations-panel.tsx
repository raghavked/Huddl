"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Mail, Search, UserPlus } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Button, Input, SectionHeader, cardClasses } from "@/components/ui";
import { revokeClubInvite, sendClubInvite } from "@/features/clubs/actions";
import {
  searchInvitees,
  type InviteCandidate,
  type PendingClubInvite,
} from "@/lib/club-invites";

/* The officer's side of the door: search the campus, send invitations,
 * take pending ones back. The database enforces every rule this panel
 * assumes (officer standing, same campus, no inviting members, one pending
 * invitation each); the filtering here just keeps the list from offering
 * someone the insert would refuse. */

/** A keystroke's rest before the search runs. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * The name a row prints. Private profiles arrive masked (search) or carry
 * is_public false (pending rows); either way the handle is all we show,
 * the same rule the directory and the roster live by.
 */
function candidateName(person: {
  handle: string;
  display_name: string | null;
  is_public: boolean;
}): string {
  return person.is_public && person.display_name
    ? person.display_name
    : `@${person.handle}`;
}

function PersonLine({
  name,
  handle,
  isPublic,
  detail,
}: {
  name: string;
  handle: string;
  isPublic: boolean;
  detail?: string;
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-semibold">{name}</span>
      <span className="block truncate text-xs text-muted">
        {detail ?? (isPublic ? `@${handle}` : "Private profile")}
      </span>
    </span>
  );
}

/**
 * Officer-only invitations panel for the club page: a classmate search that
 * sends invitations, and the list of pending ones with their Revoke.
 */
export function InvitationsPanel({
  clubId,
  myId,
  myName,
  memberIds,
  initialInvites,
}: {
  clubId: string;
  /** The officer's own `profiles.id`, kept out of search results. */
  myId: string;
  /** Their display name, for the inviter line on rows they just sent. */
  myName: string;
  memberIds: string[];
  initialInvites: PendingClubInvite[];
}) {
  const [invites, setInvites] = useState<PendingClubInvite[]>(initialInvites);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InviteCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // The freshest request wins; a slow early response never overwrites.
  const searchSeq = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      void searchInvitees(trimmed).then((found) => {
        if (searchSeq.current !== seq) return;
        setResults(found);
        setSearching(false);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Members and the already-invited would be refused by the database, so
  // the list never offers them. The officer isn't invitable either.
  const excluded = new Set<string>([
    myId,
    ...memberIds,
    ...invites.map((invite) => invite.user_id),
  ]);
  const candidates = results.filter((person) => !excluded.has(person.id));

  const send = (person: InviteCandidate) => {
    setError(null);
    setBusyId(person.id);
    startTransition(async () => {
      const result = await sendClubInvite(clubId, person.id);
      setBusyId(null);
      const sent = result.invite;
      if (result.error || !sent) {
        setError(result.error ?? null);
        return;
      }
      // The row the server just made, drawn from what's already in hand.
      setInvites((prev) => [
        {
          id: sent.id,
          club_id: clubId,
          user_id: person.id,
          invited_by: myId,
          created_at: sent.created_at,
          invitee: {
            id: person.id,
            handle: person.handle,
            display_name: person.display_name ?? `@${person.handle}`,
            avatar_url: person.avatar_url,
            is_public: person.is_public,
          },
          inviter: { id: myId, display_name: myName },
        },
        ...prev,
      ]);
    });
  };

  const revoke = (invite: PendingClubInvite) => {
    setError(null);
    setBusyId(invite.id);
    // Optimistic: the row leaves now and comes back if the server demurs.
    const previous = invites;
    setInvites(previous.filter((row) => row.id !== invite.id));
    startTransition(async () => {
      const result = await revokeClubInvite(invite.id, clubId);
      setBusyId(null);
      if (result.error) {
        setInvites(previous);
        setError(result.error);
      }
    });
  };

  return (
    <section className="mt-8" aria-label="Invitations">
      <SectionHeader title="Invitations" />

      <div className={cardClasses({ padding: "sm", className: "mt-3" })}>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Invite a classmate"
            aria-label="Invite a classmate"
            className="pl-10"
          />
        </div>

        {query.trim().length > 0 ? (
          searching ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Searching…
            </p>
          ) : candidates.length === 0 ? (
            <p className="mt-3 text-xs text-muted">
              No classmates match that. Members and people already invited
              don&apos;t show up here.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {candidates.map((person) => {
                const name = candidateName(person);
                return (
                  <li
                    key={person.id}
                    className="flex items-center gap-3 py-2.5"
                  >
                    <Avatar name={name} src={person.avatar_url} size="sm" />
                    <PersonLine
                      name={name}
                      handle={person.handle}
                      isPublic={person.is_public}
                    />
                    <Button
                      variant="soft"
                      size="sm"
                      disabled={busyId !== null}
                      aria-label={`Invite ${name}`}
                      onClick={() => send(person)}
                    >
                      {busyId === person.id ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <UserPlus className="size-3.5" aria-hidden />
                      )}
                      Invite
                    </Button>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}

        {error ? (
          <p role="alert" className="mt-3 text-xs font-medium text-danger">
            {error}
          </p>
        ) : null}

        {invites.length === 0 ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted">
            <Mail className="size-4" aria-hidden />
            No invitations out right now.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border border-t border-border">
            {invites.map((invite) => {
              // A ghost row helps nobody; skip invitations whose invitee
              // profile has gone.
              if (!invite.invitee) return null;
              const name = candidateName(invite.invitee);
              const inviter = invite.inviter?.display_name ?? "A past officer";
              return (
                <li key={invite.id} className="flex items-center gap-3 py-2.5">
                  <Avatar
                    name={name}
                    src={invite.invitee.avatar_url}
                    size="sm"
                  />
                  <PersonLine
                    name={name}
                    handle={invite.invitee.handle}
                    isPublic={invite.invitee.is_public}
                    detail={`Invited by ${inviter}`}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="hover:text-danger"
                    disabled={busyId !== null}
                    onClick={() => revoke(invite)}
                  >
                    Revoke
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
