import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { SeriesForm } from "@/features/study/series-form";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Course } from "@/lib/types";

export const metadata: Metadata = { title: "Add a weekly pattern" };

/**
 * Set a weekly class meeting up once and every week of it lands on the shared
 * class calendar.
 *
 * There is no recurrence engine behind this — a pattern becomes ordinary
 * calendar rows that happen to share a `series_id`, so each one can be opened,
 * reminded about, or removed on its own afterwards. See `@/lib/series`.
 *
 * Enrolled classmates only: the rows are shared with the whole class, and the
 * INSERT policy requires an enrolment, so the door is the course page.
 */
export default async function CourseSeriesPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const [{ courseId }, user] = await Promise.all([params, getCurrentUser()]);
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: courseRow } = await supabase
    .from("courses")
    .select("id, code, title")
    .eq("id", courseId)
    .maybeSingle();
  const course = courseRow as Pick<Course, "id" | "code" | "title"> | null;
  if (!course) notFound();

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", course.id)
    .eq("user_id", user.userId)
    .maybeSingle();
  // Writing the class schedule is for classmates — the course page has the
  // join door, and the INSERT policy would refuse this anyway.
  if (!enrollment) redirect(`/courses/${course.id}`);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref={`/courses/${course.id}/calendar`}
        backLabel="Class calendar"
        title="Add a weekly pattern"
        description={`${course.code} · set it up once and every week of it lands on the class calendar.`}
      />

      <div className="mt-6">
        <SeriesForm courseId={course.id} courseCode={course.code} />
      </div>
    </div>
  );
}
