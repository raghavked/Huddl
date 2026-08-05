import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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

  const club = (clubRow as { id: string; name: string } | null) ?? null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href={club ? `/clubs/${club.id}` : "/events"}
        className="inline-flex items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {club ? club.name : "All events"}
      </Link>

      <h1 className="mt-4 text-xl font-bold">Plan an event</h1>
      <p className="mt-1 text-sm text-muted">
        {club
          ? `A ${club.name} event — everyone at ${user.university.short_name} can see it and RSVP.`
          : `A study session for your class or a meetup for everyone at ${user.university.short_name}.`}
      </p>

      <div className="mt-6 rounded-card border border-border bg-surface p-5">
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
