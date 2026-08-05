import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  PeopleDirectory,
  type DirectoryPerson,
} from "@/features/people/people-directory";
import type { Profile } from "@/lib/types";

export const metadata: Metadata = { title: "People" };

type DirectoryRow = Pick<
  Profile,
  | "id"
  | "handle"
  | "display_name"
  | "avatar_url"
  | "major"
  | "grad_year"
  | "is_public"
>;

/**
 * Campus people directory: everyone at the viewer's university. Profiles are
 * platform-readable via RLS, so we scope to the viewer's university here and
 * strip private profiles down to handle + avatar before anything ships to the
 * client (the viewer always sees their own full card).
 */
export default async function PeoplePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, handle, display_name, avatar_url, major, grad_year, is_public")
    .eq("university_id", user.profile.university_id)
    .order("display_name", { ascending: true });

  const people: DirectoryPerson[] = ((data ?? []) as DirectoryRow[]).map(
    (p) =>
      p.is_public || p.id === user.userId
        ? p
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

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        title="People"
        description={`${count} ${count === 1 ? "student" : "students"} at ${user.university.short_name} — find classmates to trade notes or study with.`}
      />

      <PeopleDirectory people={people} meId={user.userId} />
    </div>
  );
}
