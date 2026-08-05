import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader, cardClasses } from "@/components/ui";
import { EventForm, type CourseOption } from "@/features/events/event-form";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New event" };

export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ club?: string }>;
}) {
  const [{ club: clubId }, user] = await Promise.all([
    searchParams,
    getCurrentUser(),
  ]);
  if (!user) redirect("/login");

  const supabase = await createClient();
  const [{ data: enrollmentRows }, { data: clubRow }] = await Promise.all([
    supabase
      .from("enrollments")
      .select("course:courses(id, code, title)")
      .eq("user_id", user.userId),
    clubId
      ? supabase.from("clubs").select("id, name").eq("id", clubId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const courses = (
    (enrollmentRows ?? []) as unknown as { course: CourseOption | null }[]
  )
    .map((row) => row.course)
    .filter((course): course is CourseOption => Boolean(course))
    .sort((a, b) => a.code.localeCompare(b.code));

  let club = (clubRow as { id: string; name: string } | null) ?? null;

  // Only club officers/owners may publish an event branded as that club.
  if (club) {
    const { data: membership } = await supabase
      .from("club_members")
      .select("role")
      .eq("club_id", club.id)
      .eq("user_id", user.userId)
      .maybeSingle();
    const role = (membership as { role: string } | null)?.role;
    if (role !== "officer" && role !== "owner") {
      club = null;
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref={club ? `/clubs/${club.id}` : "/events"}
        backLabel={club ? club.name : "All events"}
        eyebrow="Events"
        title="Plan an event"
        description={
          club
            ? `A ${club.name} event — everyone at ${user.university.short_name} can see it and RSVP.`
            : `A study session for your class or a meetup for everyone at ${user.university.short_name}.`
        }
      />

      <div
        className={cardClasses({
          padding: "lg",
          className: "mt-6 animate-fade-up",
        })}
      >
        <EventForm
          universityId={user.university.id}
          userId={user.userId}
          courses={courses}
          club={club}
        />
      </div>
    </div>
  );
}
