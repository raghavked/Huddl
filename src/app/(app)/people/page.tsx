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
  type DirectoryPerson,
} from "@/features/people/people-directory";
import type { Profile } from "@/lib/types";

export const metadata: Metadata = { title: "People" };

/** The interest normalizer from migration 0034, in miniature. */
const MAX_INTEREST_LENGTH = 28;

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

/**
 * Campus people directory: everyone at the viewer's university. Profiles are
 * platform-readable via RLS, so we scope to the viewer's university here and
 * strip private profiles down to handle + avatar before anything ships to the
 * client (the viewer always sees their own full card).
 *
 * `?interest=` narrows the list to one shared interest. The chips on a
 * profile link here, so "she's into intramurals too" is one click from the
 * people who are. Interests are stored lowercase and deduped by 0034's
 * trigger, so the match is a plain lookup. A private profile is left out of a
 * filtered list entirely: their interests are a hidden column like any other,
 * and appearing in a filter would give one away by inference.
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
  const { data } = await supabase
    .from("profiles")
    .select(
      "id, handle, display_name, avatar_url, major, grad_year, is_public, interests"
    )
    .eq("university_id", user.profile.university_id)
    .order("display_name", { ascending: true });

  const rows = (data ?? []) as DirectoryRow[];
  const matching =
    interest === null
      ? rows
      : rows.filter(
          (p) =>
            (p.is_public || p.id === user.userId) &&
            (p.interests ?? []).some(
              (entry) => typeof entry === "string" && entry.trim() === interest
            )
        );

  // `interests` stays on the server: nothing hidden rides along in the payload.
  const people: DirectoryPerson[] = matching.map((p) =>
    p.is_public || p.id === user.userId
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
        }
  );

  // Full cards first (alphabetical), limited private cards after (by handle).
  people.sort((a, b) => {
    const aLimited = a.display_name === null;
    const bLimited = b.display_name === null;
    if (aLimited !== bLimited) return aLimited ? 1 : -1;
    return (a.display_name ?? a.handle).localeCompare(
      b.display_name ?? b.handle
    );
  });

  const count = people.length;
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
      ) : (
        <PeopleDirectory people={people} meId={user.userId} />
      )}
    </div>
  );
}
