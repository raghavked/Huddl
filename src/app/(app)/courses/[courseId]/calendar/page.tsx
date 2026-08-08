import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { PageHeader, buttonClasses } from "@/components/ui";
import {
  CalendarSection,
  type CalendarItemRow,
} from "@/features/study/calendar-section";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Course } from "@/lib/types";

export const metadata: Metadata = { title: "Class calendar" };

/**
 * The shared class calendar: due dates, exams, lectures — syllabus-imported
 * or hand-added by classmates, with private check-offs on top. RLS scopes
 * items to enrolled classmates.
 */
export default async function ClassCalendarPage({
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

  const [{ data: enrollment }, { data: itemRows }] = await Promise.all([
    supabase
      .from("enrollments")
      .select("id")
      .eq("course_id", course.id)
      .eq("user_id", user.userId)
      .maybeSingle(),
    supabase
      .from("course_calendar_items")
      .select("id, created_by, kind, title, due_at, source")
      .eq("course_id", course.id)
      .order("due_at", { ascending: true }),
  ]);

  // The calendar is for classmates — the course page has the join door.
  if (!enrollment) redirect(`/courses/${course.id}`);

  const items = (itemRows ?? []) as CalendarItemRow[];

  // Your own check-offs — private, one query, keyed by item.
  let checkedIds: string[] = [];
  if (items.length > 0) {
    const { data: checks } = await supabase
      .from("study_checkoffs")
      .select("item_id")
      .eq("user_id", user.userId)
      .in(
        "item_id",
        items.map((item) => item.id)
      );
    checkedIds = ((checks ?? []) as { item_id: string }[]).map(
      (row) => row.item_id
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref={`/courses/${course.id}`}
        backLabel={course.code}
        title="Class calendar"
        description={`${course.code} · shared with everyone in the class — check off what you've handled.`}
        action={
          <Link
            href={`/courses/${course.id}/syllabus`}
            className={buttonClasses({
              variant: "soft",
              size: "sm",
              className: "gap-1.5",
            })}
          >
            <FilePlus2 className="size-4" aria-hidden />
            Import syllabus
          </Link>
        }
      />

      <div className="mt-6">
        <CalendarSection
          courseId={course.id}
          userId={user.userId}
          initialItems={items}
          initialCheckedIds={checkedIds}
        />
      </div>
    </div>
  );
}
