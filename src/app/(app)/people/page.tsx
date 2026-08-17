import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Compass, SearchX, X } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader, buttonClasses } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  PeopleDirectory,
  type DirectoryPage,
  type DirectoryPerson,
} from "@/features/people/people-directory";
import type { Profile } from "@/lib/types";

export const metadata: Metadata = { title: "People" };

/** The interest normalizer from migration 0034, in miniature. */
const MAX_INTEREST_LENGTH = 28;

/** One directory page: enough to scroll through, cheap to ask for again. */
const PAGE_SIZE = 60;

const DIRECTORY_SELECT =
  "id, handle, display_name, avatar_url, major, grad_year, is_public, interests";

type DirectoryRow = Pick<
  Profile,
  | "id"
  | "handle"
  | "display_name"
  | "avatar_url"
  | "major"
  | "grad_year"
  | "is_public"
  | "interests"
>;

/* PostgREST's or() gives % _ , ( ) grammatical weight, so a search sheds
   them before it is spliced into the filter. */
function sanitizeSearch(raw: string): string {
  return raw.replace(/[%_,()]/g, "").trim();
}

// People you blocked stay off your directory, the same way the native
// list works. Their profile page still answers directly, on purpose.
function blockedIdSet(rows: unknown[] | null): Set<string> {
  return new Set(
    (rows ?? []).map((row) => (row as { blocked_id: string }).blocked_id)
  );
}

/**
 * What a row becomes before it ships. A private profile that isn't the
 * viewer's own keeps its handle and avatar and loses everything else, and
 * `interests` stays on the server for everyone: nothing hidden rides along
 * in the payload.
 */
function toPerson(p: DirectoryRow, viewerId: string): DirectoryPerson {
  return p.is_public || p.id === viewerId
    ? {
        id: p.id,
        handle: p.handle,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
        major: p.major,
        grad_year: p.grad_year,
        is_public: p.is_public,
      }
    : {
        id: p.id,
        handle: p.handle,
        display_name: null,
        avatar_url: p.avatar_url,
        major: null,
        grad_year: null,
        is_public: false,
      };
}

/**
 * One page of the A to Z walk, or of a search across it. Runs on the server
 * so the university scope comes from the session rather than the caller, and
 * so private profiles are stripped before anything ships. Offsets count raw
 * rows: a page that loses cards to the block filter simply runs short, and
 * the next fetch still starts in the right place.
 */
async function fetchPeoplePage(
  offset: number,
  rawQuery: string
): Promise<DirectoryPage> {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const from = Number.isInteger(offset) && offset > 0 ? offset : 0;
  const q = sanitizeSearch(typeof rawQuery === "string" ? rawQuery : "");

  const supabase = await createClient();
  // The A-to-Z walk streams the (university_id, display_name) index through
  // PostgREST. Search goes through search_directory instead: the definer
  // function plans with the real campus and pattern in hand, where the same
  // filter phrased as a PostgREST or() falls off the index at campus scale.
  const pagePromise =
    q.length > 0
      ? supabase.rpc("search_directory", { p_query: q, p_offset: from })
      : supabase
          .from("profiles")
          .select(DIRECTORY_SELECT)
          .eq("university_id", user.profile.university_id)
          .order("display_name", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

  const [{ data }, { data: blockRows }] = await Promise.all([
    pagePromise,
    supabase.from("blocks").select("blocked_id").eq("blocker_id", user.userId),
  ]);

  const blocked = blockedIdSet(blockRows);
  const rows = (data ?? []) as DirectoryRow[];
  return {
    people: rows
      .filter((p) => !blocked.has(p.id))
      .map((p) => toPerson(p, user.userId)),
    hasMore: rows.length === PAGE_SIZE,
  };
}

/**
 * Campus people directory: everyone at the viewer's university, walked
 * A to Z one page at a time. Profiles are platform-readable via RLS, so we
 * scope to the viewer's university here and strip private profiles down to
 * handle + avatar before anything ships to the client (the viewer always
 * sees their own full card). Search runs on the server too, over names and
 * handles, so the browser never needs the whole campus at once.
 *
 * `?interest=` narrows the list to one shared interest. The chips on a
 * profile link here, so "she's into intramurals too" is one click from the
 * people who are. Interests are stored lowercase and deduped by 0034's
 * trigger, so the match is a plain lookup. A private profile is left out of a
 * filtered list entirely: their interests are a hidden column like any other,
 * and appearing in a filter would give one away by inference. A filtered
 * list is a narrow slice already, so it still arrives whole.
 */
export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ interest?: string }>;
}) {
  const [{ interest: rawInterest }, user] = await Promise.all([
    searchParams,
    getCurrentUser(),
  ]);
  if (!user) redirect("/login");

  const trimmed =
    typeof rawInterest === "string"
      ? rawInterest.trim().toLowerCase().slice(0, MAX_INTEREST_LENGTH)
      : "";
  const interest = trimmed.length > 0 ? trimmed : null;

  const supabase = await createClient();
  const blocksQuery = supabase
    .from("blocks")
    .select("blocked_id")
    .eq("blocker_id", user.userId);

  let people: DirectoryPerson[];
  let count: number;
  let hasMore = false;

  if (interest === null) {
    const [{ data, count: total }, { data: blockRows }] = await Promise.all([
      supabase
        .from("profiles")
        .select(DIRECTORY_SELECT, { count: "exact" })
        .eq("university_id", user.profile.university_id)
        .order("display_name", { ascending: true })
        .range(0, PAGE_SIZE - 1),
      blocksQuery,
    ]);

    const blocked = blockedIdSet(blockRows);
    const rows = (data ?? []) as DirectoryRow[];
    people = rows
      .filter((p) => !blocked.has(p.id))
      .map((p) => toPerson(p, user.userId));
    hasMore = rows.length === PAGE_SIZE;

    // The header promises a campus-wide number, so blocked classmates are
    // counted out of it the same way they are kept out of the pages.
    let hidden = 0;
    if (blocked.size > 0) {
      const { count: blockedHere } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("university_id", user.profile.university_id)
        .in("id", [...blocked]);
      hidden = blockedHere ?? 0;
    }
    count = Math.max(0, (total ?? 0) - hidden);
  } else {
    const [{ data }, { data: blockRows }] = await Promise.all([
      supabase
        .from("profiles")
        .select(DIRECTORY_SELECT)
        .eq("university_id", user.profile.university_id)
        .order("display_name", { ascending: true }),
      blocksQuery,
    ]);

    const blocked = blockedIdSet(blockRows);
    const rows = ((data ?? []) as DirectoryRow[]).filter(
      (p) => !blocked.has(p.id)
    );
    people = rows
      .filter(
        (p) =>
          (p.is_public || p.id === user.userId) &&
          (p.interests ?? []).some(
            (entry) => typeof entry === "string" && entry.trim() === interest
          )
      )
      .map((p) => toPerson(p, user.userId));

    // Full cards first (alphabetical), limited private cards after (by handle).
    people.sort((a, b) => {
      const aLimited = a.display_name === null;
      const bLimited = b.display_name === null;
      if (aLimited !== bLimited) return aLimited ? 1 : -1;
      return (a.display_name ?? a.handle).localeCompare(
        b.display_name ?? b.handle
      );
    });

    count = people.length;
  }

  const plural = count === 1 ? "student" : "students";

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        title="People"
        description={
          interest === null
            ? `${count} ${plural} at ${user.university.short_name}. Find classmates to trade notes or study with.`
            : `${count} ${plural} at ${user.university.short_name} into ${interest}.`
        }
      />

      {interest !== null ? (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-sm font-semibold text-brand-ink">
            <Compass className="size-3.5 text-brand" aria-hidden />
            {interest}
          </span>
          <Link
            href="/people"
            className={buttonClasses({ variant: "ghost", size: "sm" })}
          >
            <X className="size-4" aria-hidden />
            Show everyone
          </Link>
        </div>
      ) : null}

      {interest !== null && count === 0 ? (
        <div className="mt-6 rounded-card border border-dashed border-border">
          <EmptyState
            className="py-10"
            icon={SearchX}
            title={`Nobody's put "${interest}" up yet`}
            description="Add it to your own profile and you'll be the one people find."
            action={
              <Link
                href="/settings/account"
                className={buttonClasses({ variant: "soft", size: "sm" })}
              >
                Edit your profile
              </Link>
            }
          />
        </div>
      ) : interest !== null ? (
        <PeopleDirectory people={people} meId={user.userId} />
      ) : (
        <PeopleDirectory
          people={people}
          meId={user.userId}
          fetchPage={fetchPeoplePage}
          initialHasMore={hasMore}
        />
      )}
    </div>
  );
}
