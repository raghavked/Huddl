import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  BookOpen,
  Camera,
  ChevronRight,
  CircleAlert,
  GraduationCap,
  ListChecks,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Course, Enrollment, EnrollmentSource, Term } from "@/lib/types";

export const metadata: Metadata = { title: "My courses" };

type EnrollmentRow = Enrollment & {
  course: (Course & { term: Pick<Term, "name"> | null }) | null;
};

type CourseEnrollment = Enrollment & {
  course: Course & { term: Pick<Term, "name"> | null };
};

const SOURCE_META: Record<
  EnrollmentSource,
  { label: string; icon: LucideIcon }
> = {
  canvas: { label: "Synced from Canvas", icon: GraduationCap },
  schedule_image: { label: "From your schedule", icon: Camera },
  manual: { label: "Added manually", icon: ListChecks },
};

/**
 * Drop a course. Deleting the enrollment fires the DB trigger that also
 * removes the matching course-channel membership — no extra cleanup here.
 */
async function dropCourse(formData: FormData) {
  "use server";
  const enrollmentId = formData.get("enrollmentId");
  if (typeof enrollmentId !== "string" || enrollmentId.length === 0) {
    redirect("/courses");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("enrollments")
    .delete()
    .eq("id", enrollmentId)
    .eq("user_id", user.id);

  if (error) redirect("/courses?error=drop");
  revalidatePath("/courses");
  redirect("/courses");
}

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error: errorParam }, user] = await Promise.all([
    searchParams,
    getCurrentUser(),
  ]);
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase
    .from("enrollments")
    .select("*, course:courses(*, term:terms(name))")
    .eq("user_id", user.userId);

  const enrollments = ((data ?? []) as EnrollmentRow[])
    .filter((row): row is CourseEnrollment => row.course !== null)
    .sort((a, b) => a.course.code.localeCompare(b.course.code));

  const addButton = (
    <Link
      href="/setup"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <Plus className="size-4" aria-hidden />
      Add courses
    </Link>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">My courses</h1>
          <p className="truncate text-sm text-muted">
            {enrollments.length === 0
              ? `Your classes at ${user.university.short_name}`
              : `${enrollments.length} ${
                  enrollments.length === 1 ? "course" : "courses"
                } at ${user.university.short_name}`}
          </p>
        </div>
        {addButton}
      </header>

      {errorParam === "drop" ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Couldn&apos;t drop that course. Please try again.
        </p>
      ) : null}

      {enrollments.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No courses yet"
          description="Add your classes to unlock course chat, shared notes and your classmate list — each course gets its own channel automatically."
          action={addButton}
        />
      ) : (
        <ul className="mt-4 space-y-3">
          {enrollments.map((enrollment) => {
            const { course } = enrollment;
            const source = SOURCE_META[enrollment.source];
            const SourceIcon = source.icon;
            const confirmId = `drop-confirm-${enrollment.id}`;
            return (
              <li
                key={enrollment.id}
                className="flex items-center gap-2 rounded-card border border-border bg-surface p-4 transition-colors hover:border-brand/40"
              >
                <Link
                  href={`/courses/${course.id}`}
                  className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft">
                    <BookOpen
                      className="size-5 text-brand-strong"
                      aria-hidden
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-semibold transition-colors group-hover:text-brand">
                        {course.code}
                      </span>
                      {course.term ? (
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
                          {course.term.name}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-muted">
                      {course.title}
                    </span>
                    <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-accent">
                      <SourceIcon className="size-3.5" aria-hidden />
                      {source.label}
                    </span>
                  </span>
                  <ChevronRight
                    className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>

                <button
                  type="button"
                  popoverTarget={confirmId}
                  aria-label={`Drop ${course.code}`}
                  title="Drop course"
                  className="shrink-0 rounded-full p-2 text-muted transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>

                {/* Native popover confirm — top-layer modal with light dismiss,
                    no client JS needed so the page stays a server component. */}
                <div
                  id={confirmId}
                  popover="auto"
                  role="dialog"
                  aria-labelledby={`${confirmId}-title`}
                  className="m-auto w-[min(92vw,22rem)] rounded-card border border-border bg-surface p-5 text-foreground shadow-xl backdrop:bg-black/50"
                >
                  <h2 id={`${confirmId}-title`} className="font-bold">
                    Drop {course.code}?
                  </h2>
                  <p className="mt-1.5 text-sm text-muted">
                    You&apos;ll leave the {course.code} channel too. Notes you
                    shared stay available to classmates, and you can re-join
                    anytime.
                  </p>
                  <form action={dropCourse} className="mt-4 flex justify-end gap-2">
                    <input
                      type="hidden"
                      name="enrollmentId"
                      value={enrollment.id}
                    />
                    <button
                      type="button"
                      popoverTarget={confirmId}
                      popoverTargetAction="hide"
                      className="rounded-full px-4 py-2 text-sm font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="rounded-full bg-danger px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
                    >
                      Drop course
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
