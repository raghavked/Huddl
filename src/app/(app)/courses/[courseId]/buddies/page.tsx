import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Badge, PageHeader } from "@/components/ui";
import {
  BuddiesSection,
  type MyProfile,
} from "@/features/study/buddies-section";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  StudyBuddyError,
  fetchBuddies,
  fetchMyOptIn,
  type MyOptIn,
  type StudyBuddy,
} from "@/lib/study-buddy";
import type { Course } from "@/lib/types";

export const metadata: Metadata = { title: "Study partners" };

/**
 * One class's who's-looking list: your own opt-in on top, classmates below,
 * and a Message button that opens the DM. RLS keeps the whole table
 * classmate-only, so a student who hasn't added the class goes back to the
 * course page, which has the join door.
 */
export default async function CourseBuddiesPage({
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
  // Study partners are for classmates, and the course page has the join door.
  if (!enrollment) redirect(`/courses/${course.id}`);

  const ctx = { client: supabase, userId: user.userId };
  let buddies: StudyBuddy[] = [];
  let optIn: MyOptIn | null = null;
  let loadError: string | null = null;
  try {
    [buddies, optIn] = await Promise.all([
      fetchBuddies(course.id, ctx),
      fetchMyOptIn(course.id, ctx),
    ]);
  } catch (caught) {
    loadError =
      caught instanceof StudyBuddyError
        ? caught.message
        : "We couldn't load who's looking for a study partner. Give it another go.";
  }

  const myProfile: MyProfile = {
    handle: user.profile.handle,
    display_name: user.profile.display_name,
    avatar_url: user.profile.avatar_url,
    major: user.profile.major,
    grad_year: user.profile.grad_year,
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref={`/courses/${course.id}`}
        backLabel={course.code}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            Study partners
            <Badge tone="brand">{course.code}</Badge>
          </span>
        }
        description={`Classmates in ${course.code} who are up for working through it together.`}
      />

      <div className="mt-6">
        <BuddiesSection
          courseId={course.id}
          courseCode={course.code}
          userId={user.userId}
          myProfile={myProfile}
          initialBuddies={buddies}
          initialOptIn={optIn}
          initialError={loadError}
        />
      </div>
    </div>
  );
}
