import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { GradesSection } from "@/features/grades/grades-section";
import { Badge, PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  GradesError,
  fetchGradeBook,
  type GradeCategory,
  type GradeEntry,
} from "@/lib/grades";
import type { Course } from "@/lib/types";

export const metadata: Metadata = { title: "Your grades" };

/**
 * One class's private grade sheet: the weighted estimate, the categories off
 * the syllabus with your scores in them, and the what-if panel.
 *
 * `grade_categories` and `grade_entries` are RLS self-only. No classmate,
 * no club officer and no instructor can read a row of this, so the page
 * loads with the request-scoped client and hands the whole gradebook to the
 * client section, which owns every write from there.
 */
export default async function CourseGradesPage({
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

  let categories: GradeCategory[] = [];
  let entriesByCategory: Record<string, GradeEntry[]> = {};
  let loadError: string | null = null;
  try {
    const book = await fetchGradeBook(course.id, {
      client: supabase,
      userId: user.userId,
    });
    categories = book.categories;
    entriesByCategory = book.entriesByCategory;
  } catch (caught) {
    loadError =
      caught instanceof GradesError
        ? caught.message
        : "We couldn't load your grades for this class.";
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref={`/courses/${course.id}`}
        backLabel={course.code}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            Your grades
            <Badge tone="brand">{course.code}</Badge>
          </span>
        }
      />

      {/* The promise this page is built on, stated once. Fern-soft rather
          than ember: reassurance about a mechanism, not a warning. */}
      <p className="mt-4 flex items-start gap-2.5 rounded-xl bg-accent-soft px-3 py-3 text-xs leading-relaxed text-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
        Only you can see this. Huddl never shares your grades with classmates
        or your school.
      </p>

      <div className="mt-6">
        <GradesSection
          courseId={course.id}
          courseCode={course.code}
          userId={user.userId}
          initialCategories={categories}
          initialEntries={entriesByCategory}
          initialError={loadError}
        />
      </div>
    </div>
  );
}
