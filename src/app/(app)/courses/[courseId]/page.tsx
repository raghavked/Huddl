import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Camera,
  CircleAlert,
  GraduationCap,
  Hash,
  ListChecks,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { Classmates, type ClassmateEntry } from "@/features/notes/classmates";
import {
  NotesSection,
  type NoteWithUploader,
} from "@/features/notes/notes-section";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { Course, EnrollmentSource, Term } from "@/lib/types";

type CourseRow = Course & { term: Pick<Term, "name"> | null };

const SOURCE_META: Record<
  EnrollmentSource,
  { label: string; icon: LucideIcon }
> = {
  canvas: { label: "Synced from Canvas", icon: GraduationCap },
  schedule_image: { label: "From your schedule", icon: Camera },
  manual: { label: "Added manually", icon: ListChecks },
};

/** RLS scopes courses to the viewer's university — outside it this is null. */
const getCourse = cache(async (courseId: string): Promise<CourseRow | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("courses")
    .select("*, term:terms(name)")
    .eq("id", courseId)
    .maybeSingle();
  return (data as CourseRow | null) ?? null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ courseId: string }>;
}): Promise<Metadata> {
  const { courseId } = await params;
  const course = await getCourse(courseId);
  return { title: course ? course.code : "Course" };
}

/**
 * Join a course the viewer isn't enrolled in yet. The enrollment-insert
 * trigger creates the course channel (if needed) and joins them to it.
 */
async function joinCourse(formData: FormData) {
  "use server";
  const courseId = formData.get("courseId");
  if (typeof courseId !== "string" || courseId.length === 0) {
    redirect("/courses");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("enrollments").insert({
    user_id: user.id,
    course_id: courseId,
    source: "manual",
  });

  // 23505 = already enrolled; treat as success so the UI just settles.
  if (error && error.code !== "23505") {
    redirect(`/courses/${courseId}?error=join`);
  }
  revalidatePath("/courses");
  revalidatePath(`/courses/${courseId}`);
  redirect(`/courses/${courseId}`);
}

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ tab?: string; error?: string }>;
}) {
  const [{ courseId }, { tab: rawTab, error: errorParam }, user] =
    await Promise.all([params, searchParams, getCurrentUser()]);
  if (!user) redirect("/login");

  const course = await getCourse(courseId);
  if (!course) notFound();

  const supabase = await createClient();
  const [{ data: channel }, { data: noteRows }, { data: enrollmentRows }] =
    await Promise.all([
      supabase
        .from("channels")
        .select("id")
        .eq("course_id", course.id)
        .maybeSingle(),
      supabase
        .from("notes")
        .select("*, uploader:profiles(*)")
        .eq("course_id", course.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("enrollments")
        .select("*, profile:profiles(*)")
        .eq("course_id", course.id),
    ]);

  const classmates = ((enrollmentRows ?? []) as ClassmateEntry[]).filter(
    (row) => Boolean(row.profile)
  );
  const myEnrollment =
    classmates.find((row) => row.user_id === user.userId) ?? null;

  const backLink = (
    <Link
      href="/courses"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <ArrowLeft className="size-4" aria-hidden />
      My courses
    </Link>
  );

  if (!myEnrollment) {
    return (
      <div className="mx-auto max-w-xl px-4 py-6">
        {backLink}

        {errorParam === "join" ? (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            Couldn&apos;t join this course. Please try again.
          </p>
        ) : null}

        <div className="mt-4 rounded-card border border-border bg-surface p-6">
          <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft">
            <BookOpen className="size-6 text-brand-strong" aria-hidden />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">
            {course.code}
          </h1>
          <p className="mt-0.5 text-muted">{course.title}</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs">
            {course.term ? (
              <span className="rounded-full bg-surface-2 px-2.5 py-1 font-medium text-muted">
                {course.term.name}
              </span>
            ) : null}
            <span className="rounded-full bg-surface-2 px-2.5 py-1 font-medium text-muted">
              {user.university.short_name}
            </span>
          </div>
          <p className="mt-4 text-sm text-muted">
            You&apos;re not in this course yet. Join to unlock the course chat,
            shared notes and the classmate list.
          </p>
          <form action={joinCourse} className="mt-5">
            <input type="hidden" name="courseId" value={course.id} />
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <UserPlus className="size-4" aria-hidden />
              Join this course
            </button>
          </form>
          <p className="mt-3 text-center text-xs text-muted">
            Joining adds you to the {course.code} channel automatically — you
            can drop the course anytime.
          </p>
        </div>
      </div>
    );
  }

  const notes = (noteRows ?? []) as NoteWithUploader[];
  const tab = rawTab === "classmates" ? "classmates" : "notes";
  const source = SOURCE_META[myEnrollment.source];
  const SourceIcon = source.icon;

  const tabs = [
    {
      key: "notes",
      label: "Notes",
      count: notes.length,
      href: `/courses/${course.id}`,
    },
    {
      key: "classmates",
      label: "Classmates",
      count: classmates.length,
      href: `/courses/${course.id}?tab=classmates`,
    },
  ] as const;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {backLink}

      <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{course.code}</h1>
          <p className="mt-0.5 text-muted">{course.title}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
            {course.term ? (
              <span className="rounded-full bg-surface-2 px-2.5 py-1 font-medium text-muted">
                {course.term.name}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 font-medium text-accent">
              <SourceIcon className="size-3.5" aria-hidden />
              {source.label}
            </span>
          </div>
        </div>
        {channel ? (
          <Link
            href={`/channels/${channel.id}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Hash className="size-4" aria-hidden />
            Course chat
          </Link>
        ) : null}
      </header>

      <nav
        aria-label="Course sections"
        className="mt-6 flex gap-1 rounded-full bg-surface-2 p-1"
      >
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={tab === item.key ? "page" : undefined}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
              tab === item.key
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            )}
          >
            {item.label}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                tab === item.key
                  ? "bg-brand-soft text-brand-strong"
                  : "bg-surface-3 text-muted"
              )}
            >
              {item.count}
            </span>
          </Link>
        ))}
      </nav>

      <section
        className="mt-4"
        aria-label={tab === "notes" ? "Shared notes" : "Classmates"}
      >
        {tab === "notes" ? (
          <NotesSection
            courseId={course.id}
            currentUser={user.profile}
            notes={notes}
          />
        ) : (
          <Classmates entries={classmates} currentUserId={user.userId} />
        )}
      </section>
    </div>
  );
}
