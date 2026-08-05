import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ManualPicker } from "@/features/schedule/manual-picker";
import type { Course } from "@/lib/types";

export const metadata: Metadata = {
  title: "Pick your courses",
  description:
    "Browse your school's course list, check off your classes and land in a chat channel for each one.",
};

export default async function ManualSetupPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  const { data: term } = await supabase
    .from("terms")
    .select("id, name")
    .eq("university_id", user.university.id)
    .eq("is_current", true)
    .limit(1)
    .maybeSingle();

  let coursesQuery = supabase
    .from("courses")
    .select("*")
    .eq("university_id", user.university.id)
    .order("code");
  if (term) {
    coursesQuery = coursesQuery.or(`term_id.eq.${term.id},term_id.is.null`);
  }
  const [{ data: courses }, { data: enrollments }] = await Promise.all([
    coursesQuery,
    supabase.from("enrollments").select("course_id").eq("user_id", user.userId),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        eyebrow="Setup"
        backHref="/setup"
        backLabel="Setup"
        title="Pick your courses"
        description={`Check off your ${user.university.short_name} classes — each one comes with its own chat channel full of your classmates.`}
      />
      <div className="mt-8 animate-fade-up">
        <ManualPicker
          userId={user.userId}
          universityId={user.university.id}
          termId={term?.id ?? null}
          termName={term?.name ?? null}
          initialCourses={(courses ?? []) as Course[]}
          enrolledCourseIds={(enrollments ?? []).map((e) => e.course_id as string)}
        />
      </div>
    </div>
  );
}
