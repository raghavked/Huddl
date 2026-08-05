"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Lock, Search, SearchX, UsersRound } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";

/**
 * The shape the /people server page hands down. For private profiles that
 * aren't the viewer's own, the server nulls out everything but handle +
 * avatar so hidden fields never reach the browser payload.
 */
export interface DirectoryPerson {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  major: string | null;
  grad_year: number | null;
  is_public: boolean;
}

function matches(person: DirectoryPerson, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  // Private profiles only expose their handle, so only the handle is searchable.
  const haystack = [
    person.handle,
    person.display_name,
    person.major,
    person.grad_year ? String(person.grad_year) : null,
  ]
    .filter((v): v is string => Boolean(v))
    .map((v) => v.toLowerCase());
  return haystack.some((v) => v.includes(q));
}

function PersonCard({
  person,
  isMe,
}: {
  person: DirectoryPerson;
  isMe: boolean;
}) {
  const limited = person.display_name === null;
  const detail = [
    person.major,
    person.grad_year ? `Class of ${person.grad_year}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li>
      <Link
        href={`/u/${person.handle}`}
        className="flex items-center gap-3 rounded-card border border-border bg-surface p-4 transition-colors hover:border-brand/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <Avatar
          name={person.display_name ?? person.handle}
          src={person.avatar_url}
          size="md"
        />
        {limited ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">
              @{person.handle}
            </span>
            <span className="mt-0.5 inline-flex items-center gap-1 text-sm text-muted">
              <Lock className="size-3.5" aria-hidden />
              Private profile
            </span>
          </span>
        ) : (
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate font-semibold">
                {person.display_name}
              </span>
              {isMe ? (
                <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-strong">
                  You
                </span>
              ) : null}
              {isMe && !person.is_public ? (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted"
                  title="Only you can see your full profile"
                >
                  <Lock className="size-3" aria-hidden />
                  Private
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-sm text-muted">
              @{person.handle}
            </span>
            {detail ? (
              <span className="mt-0.5 block truncate text-sm text-muted">
                {detail}
              </span>
            ) : null}
          </span>
        )}
      </Link>
    </li>
  );
}

/** Searchable card grid for the campus people directory. */
export function PeopleDirectory({
  people,
  meId,
}: {
  people: DirectoryPerson[];
  meId: string;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () => people.filter((p) => matches(p, query)),
    [people, query]
  );

  const searching = query.trim().length > 0;

  return (
    <div>
      <div className="relative mt-4">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <label htmlFor="people-search" className="sr-only">
          Search people by name, handle or major
        </label>
        <input
          id="people-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, handle or major"
          autoComplete="off"
          className="w-full rounded-full border border-border bg-surface py-2.5 pl-10 pr-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        />
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-sm text-muted">
        {searching
          ? `${filtered.length} ${filtered.length === 1 ? "match" : "matches"}`
          : ""}
      </p>

      {people.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No one here yet"
          description="As classmates join with their school email, they'll show up in the directory automatically."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No matches"
          description={`No one matches "${query.trim()}". Try a different name, handle or major.`}
          action={
            <button
              type="button"
              onClick={() => setQuery("")}
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Clear search
            </button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((person) => (
            <PersonCard
              key={person.id}
              person={person}
              isMe={person.id === meId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
