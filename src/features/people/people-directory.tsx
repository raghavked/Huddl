"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Lock, Search, SearchX, UsersRound } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { Badge, Button, cardClasses } from "@/components/ui";

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

  return (
    <li>
      <Link
        href={`/u/${person.handle}`}
        className={cardClasses({
          padding: "sm",
          interactive: true,
          className: "flex h-full items-center gap-4",
        })}
      >
        <Avatar
          name={person.display_name ?? person.handle}
          src={person.avatar_url}
          size="lg"
        />
        {limited ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              @{person.handle}
            </span>
            <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted">
              <Lock className="size-3.5" aria-hidden />
              Private profile
            </span>
          </span>
        ) : (
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">
                {person.display_name}
              </span>
              {isMe ? <Badge tone="brand">You</Badge> : null}
              {isMe && !person.is_public ? (
                <Badge
                  tone="neutral"
                  title="Only you can see your full profile"
                >
                  <Lock className="size-3" aria-hidden />
                  Private
                </Badge>
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted">
              @{person.handle}
            </span>
            {person.major || person.grad_year ? (
              <span className="mt-2 flex flex-wrap items-center gap-1.5">
                {person.major ? (
                  <Badge tone="neutral" className="max-w-full">
                    <span className="truncate">{person.major}</span>
                  </Badge>
                ) : null}
                {person.grad_year ? (
                  <Badge tone="neutral">Class of {person.grad_year}</Badge>
                ) : null}
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
      <div className="relative mt-6 animate-fade-up">
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
          className="w-full rounded-full border border-border bg-surface py-2.5 pl-10 pr-4 text-sm text-foreground shadow-soft transition-colors placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15"
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
            <Button size="sm" onClick={() => setQuery("")}>
              Clear search
            </Button>
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
