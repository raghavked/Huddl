import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  BookOpen,
  Camera,
  CircleAlert,
  GraduationCap,
  ListChecks,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  Badge,
  PageHeader,
  buttonClasses,
  cardClasses,
} from "@/components/ui";
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
      className={buttonClasses({ size: "sm", className: "gap-1.5" })}
    >
      <Plus className="size-4" aria-hidden />
      Add courses
    </Link>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        eyebrow="Courses"
        title="My courses"
        description={
          enrollments.length === 0
            ? `Your classes at ${user.university.short_name}`
            : `${enrollments.length} ${
                enrollments.length === 1 ? "course" : "courses"
              } at ${user.university.short_name}`
        }
        action={enrollments.length > 0 ? addButton : undefined}
      />

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
        <div className="mt-6 rounded-card border border-dashed border-border">
          <EmptyState
            icon={GraduationCap}
            title="No courses yet"
            description="Add your classes to unlock course chat, shared notes and your classmate list — each course gets its own channel automatically."
            action={addButton}
          />
        </div>
      ) : (
        <ul className="mt-6 grid animate-fade-up gap-3 sm:grid-cols-2">
          {enrollments.map((enrollment) => {
            const { course } = enrollment;
            const source = SOURCE_META[enrollment.source];
            const SourceIcon = source.icon;
            const confirmId = `drop-confirm-${enrollment.id}`;
            return (
              <li
                key={enrollment.id}
                className={cardClasses({
                  padding: "sm",
                  className: "flex h-full flex-col",
                })}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <BookOpen className="size-5" aria-hidden />
                  </span>

                  <button
                    type="button"
                    popoverTarget={confirmId}
                    aria-label={`Drop ${course.code}`}
                    title="Drop course"
                    className="-mr-1 -mt-1 shrink-0 rounded-full p-2 text-muted transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>

                <Link
                  href={`/courses/${course.id}`}
                  className="group mt-3 flex min-w-0 flex-1 flex-col rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-bold transition-colors group-hover:text-brand">
                      {course.code}
                    </span>
                    {course.term ? (
                      <Badge tone="neutral">{course.term.name}</Badge>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-muted">
                    {course.title}
                  </span>
                  <span className="mt-auto inline-flex items-center gap-1 pt-2.5 text-xs font-medium text-accent">
                    <SourceIcon className="size-3.5" aria-hidden />
                    {source.label}
                  </span>
                </Link>

                {/* Native popover confirm — top-layer modal with light dismiss,
                    no client JS needed so the page stays a server component. */}
                <div
                  id={confirmId}
                  popover="auto"
                  role="dialog"
                  aria-labelledby={`${confirmId}-title`}
                  aria-describedby={`${confirmId}-body`}
                  className="m-auto w-[min(92vw,22rem)] rounded-card border border-border bg-surface p-5 text-foreground shadow-lift backdrop:bg-black/50"
                >
                  <h2 id={`${confirmId}-title`} className="font-bold tracking-tight">
                    Drop {course.code}?
                  </h2>
                  <p id={`${confirmId}-body`} className="mt-1.5 text-sm text-muted">
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
                      className={buttonClasses({ variant: "ghost", size: "sm" })}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className={buttonClasses({ variant: "danger", size: "sm" })}
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
