import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { SyllabusImport } from "@/features/study/syllabus-import";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Course } from "@/lib/types";

export const metadata: Metadata = { title: "Import syllabus" };

/**
 * Paste-first syllabus import. Parsing happens entirely in the browser —
 * the syllabus text never reaches a server; only the dates the student
 * confirms are written to the shared class calendar.
 */
export default async function SyllabusImportPage({
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

  // Importing is for classmates — the course page has the join door.
  if (!enrollment) redirect(`/courses/${course.id}`);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref={`/courses/${course.id}/calendar`}
        backLabel="Class calendar"
        title="Import syllabus"
        description={`${course.code} · parsed right here in your browser — the syllabus itself never leaves it.`}
      />

      <div className="mt-6">
        <SyllabusImport
          courseId={course.id}
          courseCode={course.code}
          userId={user.userId}
        />
      </div>
    </div>
  );
}
