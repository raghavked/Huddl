"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, CloudOff, Loader2, Lock, Plus, Search } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Button, cardClasses } from "@/components/ui";
import { useBlockedIds } from "@/features/chat/blocks";
import {
  fetchMyUniversityId,
  searchCampusPeople,
  type CampusCandidate,
} from "@/features/dm/group-actions";
import type { ThreadPerson } from "@/features/dm/group-dm";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 300;

/** Shared empty set so the optional props keep a stable identity. */
const NO_IDS: ReadonlySet<string> = new Set<string>();

function PickerRow({
  person,
  selected,
  pending,
  disabled,
  onPick,
}: {
  person: CampusCandidate;
  selected: boolean;
  pending: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const shownName = person.locked ? `@${person.handle}` : person.display_name;

  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        disabled={disabled || pending}
        aria-pressed={selected}
        aria-label={
          selected ? `Remove ${shownName}` : `Add ${shownName} to the group`
        }
        className={cardClasses({
          padding: "none",
          interactive: true,
          className:
            "flex w-full min-h-14 items-center gap-3 px-3.5 py-2.5 text-left disabled:pointer-events-none disabled:opacity-60",
        })}
      >
        <Avatar
          name={person.display_name}
          src={person.locked ? null : person.avatar_url}
          size="md"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {shownName}
          </span>
          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
            {person.locked ? (
              <>
                <Lock className="size-3 shrink-0" aria-hidden />
                Private profile
              </>
            ) : (
              <span className="truncate">@{person.handle}</span>
            )}
          </span>
        </span>
        <span
          aria-hidden
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full",
            selected
              ? "bg-accent-soft text-accent"
              : "bg-surface-2 text-muted"
          )}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : selected ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <Plus className="size-4" aria-hidden />
          )}
        </span>
      </button>
    </li>
  );
}

/**
 * Search-as-you-type over the classmates at your university, shared by the
 * group composer and the group's info panel.
 *
 * Everyone here shares your campus (the only people a group may hold), you
 * are never in your own results, and anyone you've blocked is filtered out
 * before the list renders. Private profiles appear as a handle behind a
 * lock: enough to invite someone you know without exposing their name.
 *
 * @param userId      The signed-in student, for scoping and blocks.
 * @param excludeIds  Ids to drop from results entirely (existing members).
 * @param selectedIds Ids drawn with a fern check; picking one again lets
 *   the caller toggle it back off.
 * @param onPick      Called with the tapped classmate.
 * @param pendingId   Id currently being written to the server, if any.
 */
export function CampusPeoplePicker({
  userId,
  excludeIds = NO_IDS,
  selectedIds = NO_IDS,
  onPick,
  pendingId = null,
  disabled = false,
  label,
  placeholder,
  autoFocus = false,
}: {
  userId: string;
  excludeIds?: ReadonlySet<string>;
  selectedIds?: ReadonlySet<string>;
  onPick: (person: ThreadPerson) => void;
  pendingId?: string | null;
  disabled?: boolean;
  label: string;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const { blockedIds } = useBlockedIds(userId);
  const inputId = useId();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CampusCandidate[]>([]);
  // Starts true so the very first paint is a spinner rather than a wrong
  // "nobody here": the campus lookup hasn't come back yet.
  const [searching, setSearching] = useState(true);
  const [failed, setFailed] = useState(false);

  // One university lookup per mount, then every search reuses it.
  const universityRef = useRef<string | null>(null);
  const requestRef = useRef(0);

  const runSearch = useCallback(
    async (raw: string) => {
      const ticket = ++requestRef.current;
      try {
        const universityId =
          universityRef.current ?? (await fetchMyUniversityId(userId));
        universityRef.current = universityId;
        const found = await searchCampusPeople({
          universityId,
          excludeId: userId,
          query: raw,
        });
        if (ticket !== requestRef.current) return; // a newer keystroke won
        setResults(found);
        setFailed(false);
      } catch {
        if (ticket !== requestRef.current) return;
        setFailed(true);
      } finally {
        if (ticket === requestRef.current) setSearching(false);
      }
    },
    [userId]
  );

  // An empty query lists the first slice of campus alphabetically, so the
  // picker has something to show before anyone types.
  useEffect(() => {
    setSearching(true);
    setFailed(false);
    const timer = setTimeout(() => void runSearch(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const retry = useCallback(() => {
    setSearching(true);
    setFailed(false);
    void runSearch(query.trim());
  }, [query, runSearch]);

  const visible = results.filter(
    (person) => !excludeIds.has(person.id) && !blockedIds.has(person.id)
  );

  return (
    <div>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          id={inputId}
          type="search"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          // The panel opens straight into "add people", and the search box
          // is the whole point of that view, so focus belongs in it.
          autoFocus={autoFocus}
          // The pill variant of `controlClasses`: same border, caret,
          // placeholder and focus ring, drawn round for a search box, and
          // held at the 44px target a thumb needs.
          className="min-h-11 w-full rounded-full border border-border bg-surface py-2.5 pl-10 pr-4 text-sm text-foreground shadow-soft transition-colors placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      <p aria-live="polite" className="mt-3 min-h-4 text-xs text-muted">
        {searching || failed || visible.length === 0
          ? ""
          : `${visible.length} ${visible.length === 1 ? "classmate" : "classmates"}`}
      </p>

      <div className="mt-1">
        {searching ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Looking around campus…
          </p>
        ) : failed ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-2 py-8 text-center"
          >
            <CloudOff className="size-6 text-muted" aria-hidden />
            <p className="text-sm font-semibold">
              The campus directory didn&rsquo;t load
            </p>
            <p className="max-w-xs text-xs text-muted">
              Check your connection and give it another go. Nobody you
              already picked has gone anywhere.
            </p>
            <Button variant="soft" size="sm" onClick={retry}>
              Try again
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm font-semibold">
              {query.trim() ? "Nobody by that name" : "Nobody to add yet"}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted">
              {query.trim()
                ? "Try a different name or handle. Groups only hold people from your campus."
                : "As classmates join your campus they'll show up here."}
            </p>
          </div>
        ) : (
          <ul aria-label="Classmates" className="flex flex-col gap-2">
            {visible.map((person) => (
              <PickerRow
                key={person.id}
                person={person}
                selected={selectedIds.has(person.id)}
                pending={pendingId === person.id}
                disabled={disabled}
                onPick={() => onPick(person)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
