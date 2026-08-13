import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PlanSection, type PlanItemRow } from "@/features/study/plan-section";
import { getCurrentUser } from "@/lib/auth";
import { colorForCourse, courseTintClasses } from "@/lib/course-color";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Your plan" };

const DAY_MS = 24 * 60 * 60 * 1000;

type EnrollmentJoin = {
  /** The student's own tint for this class, or null for "let the app choose". */
  color: string | null;
  course: { id: string; code: string } | null;
};

type ItemRow = {
  id: string;
  course_id: string;
  kind: string;
  title: string;
  due_at: string;
};

/**
 * The personal study plan: every enrolled course's shared calendar,
 * flattened and bucketed by time, with private check-offs on top.
 */
export default async function PlanPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const now = new Date();

  const { data: enrollRows } = await supabase
    .from("enrollments")
    .select("color, course:courses(id, code)")
    .eq("user_id", user.userId);

  /* Each class with the colour it wears for this student: their own pick where
     they made one, the stable hash of the course code where they didn't. The
     tint is personal (a classmate reading the same class may well see a
     different one), so it never travels anywhere shared. */
  const courses = ((enrollRows ?? []) as unknown as EnrollmentJoin[]).flatMap(
    (row) =>
      row.course === null
        ? []
        : [
            {
              id: row.course.id,
              code: row.course.code,
              tint: colorForCourse(row.color, row.course.code),
            },
          ]
  );

  let items: PlanItemRow[] = [];
  let checkedIds: string[] = [];
  if (courses.length > 0) {
    const codeById = new Map(courses.map((c) => [c.id, c.code]));
    // The plan window opens a week back so a missed deadline still nags,
    // and runs forward without limit. buildPlan buckets the far stuff
    // under "Later".
    const since = new Date(now.getTime() - 7 * DAY_MS).toISOString();
    const [itemsRes, checkoffsRes] = await Promise.all([
      supabase
        .from("course_calendar_items")
        .select("id, course_id, kind, title, due_at")
        .in("course_id", [...codeById.keys()])
        .gte("due_at", since)
        .order("due_at", { ascending: true }),
      supabase
        .from("study_checkoffs")
        .select("item_id")
        .eq("user_id", user.userId),
    ]);
    items = ((itemsRes.data ?? []) as ItemRow[]).map((row) => ({
      id: row.id,
      courseCode: codeById.get(row.course_id) ?? "Course",
      kind: row.kind,
      title: row.title,
      due_at: row.due_at,
    }));
    checkedIds = ((checkoffsRes.data ?? []) as { item_id: string }[]).map(
      (row) => row.item_id
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref="/home"
        backLabel="Home"
        title="Your plan"
        description="Everything due across your classes, in one place. Check off what you've handled."
      />

      {courses.length > 0 ? (
        /* The classes feeding this list, each wearing its own colour: the
           same tint the course card and the semester row use, so a student
           reads "the plum one" the same way everywhere. Wrapped rather than
           scrolled sideways: the page is one phone-width column and stays one. */
        <nav
          aria-label="Your classes"
          className="mt-5 flex animate-fade-up flex-wrap gap-2"
        >
          {courses.map((course) => (
            <Link
              key={course.id}
              href={`/courses/${course.id}`}
              className={cn(
                "inline-flex h-11 shrink-0 items-center rounded-full px-4 text-xs font-semibold transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                courseTintClasses(course.tint).chip
              )}
            >
              {course.code}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="mt-6">
        <PlanSection
          userId={user.userId}
          nowIso={now.toISOString()}
          items={items}
          initialCheckedIds={checkedIds}
          hasCourses={courses.length > 0}
        />
      </div>
    </div>
  );
}
