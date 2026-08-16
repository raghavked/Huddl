import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import {
  BarChart2,
  BookOpen,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  DoorOpen,
  FilePlus2,
  History,
  Layers,
  ListChecks,
  Timer,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { Classmates, type ClassmateEntry } from "@/features/notes/classmates";
import {
  NotesSection,
  type NoteWithUploader,
} from "@/features/notes/notes-section";
import { CourseDetails } from "@/features/study/course-details";
import {
  COURSE_LINK_SELECT,
  CourseLinks,
  type CourseLinkRow,
} from "@/features/study/course-links";
import {
  Badge,
  Card,
  PageHeader,
  buttonClasses,
  cardClasses,
} from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { buddyCountLabel, countBuddies } from "@/lib/study-buddy";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { Course, EnrollmentSource, Term } from "@/lib/types";

// instructor / meeting_info / location are the classmate-kept details from
// migration 0024, carried on the row by select("*") and typed here until they
// land in the shared Course type.
type CourseRow = Course & {
  term: Pick<Term, "name"> | null;
  instructor: string | null;
  meeting_info: string | null;
  location: string | null;
};

// 'canvas' / 'schedule_image' are historical sources from retired import
// flows. Old rows keep them, so they render as a plain history label.
const SOURCE_META: Record<
  EnrollmentSource,
  { label: string; icon: LucideIcon }
> = {
  canvas: { label: "Added a while back", icon: History },
  schedule_image: { label: "Added a while back", icon: History },
  manual: { label: "Added by you", icon: ListChecks },
};

/** One doorway out of the course home. */
type StudyLink = {
  key: string;
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

/**
 * Every room of the course. The study layer that grew out of the course chat
 * (migrations 0018 + 0024) covers side rooms, the shared class calendar,
 * paste-first syllabus import and shared decks. 0028 added your private grade
 * sheet, the who's-looking list, and the campus focus room.
 */
function studyLinks(courseId: string, buddyLabel: string | null): StudyLink[] {
  return [
    {
      key: "rooms",
      href: `/courses/${courseId}/rooms`,
      label: "Rooms",
      description: "Side rooms for lectures and study groups",
      icon: DoorOpen,
    },
    {
      key: "calendar",
      href: `/courses/${courseId}/calendar`,
      label: "Class calendar",
      description: "Shared dates you check off as you go",
      icon: CalendarDays,
    },
    {
      key: "decks",
      href: `/courses/${courseId}/decks`,
      label: "Flashcards",
      description: "Shared decks the whole class builds together",
      icon: Layers,
    },
    {
      key: "grades",
      href: `/courses/${courseId}/grades`,
      label: "Grades",
      description: "What you're carrying so far. Only you see it",
      icon: BarChart2,
    },
    {
      key: "buddies",
      href: `/courses/${courseId}/buddies`,
      label: "Study partners",
      description: buddyLabel ?? "Find someone to work through it with",
      icon: UsersRound,
    },
    {
      key: "focus",
      href: "/focus",
      label: "Focus",
      description: "Sit down with a goal and see who else is heads-down",
      icon: Timer,
    },
    {
      key: "syllabus",
      href: `/courses/${courseId}/syllabus`,
      label: "Import syllabus",
      description: "Paste it once, the whole class gets the schedule",
      icon: FilePlus2,
    },
  ];
}

/** RLS scopes courses to the viewer's university, so outside it this is null. */
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
  const [
    { data: channel },
    { data: noteRows },
    { data: enrollmentRows },
    { data: linkRows },
    buddyCount,
  ] = await Promise.all([
    // A course can have many rooms (0018), so link to the main one.
    supabase
      .from("channels")
      .select("id")
      .eq("course_id", course.id)
      .eq("is_main", true)
      .maybeSingle(),
    supabase
      .from("notes")
      .select(
        "*, uploader:profiles(id, handle, display_name, avatar_url, verified_at, major, grad_year, is_public, university_id)"
      )
      .eq("course_id", course.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("enrollments")
      .select(
        "*, profile:profiles(id, handle, display_name, avatar_url, verified_at, major, grad_year, is_public, university_id)"
      )
      .eq("course_id", course.id),
    // Pinned course links (0024). RLS keeps them classmate-only.
    supabase
      .from("course_links")
      .select(COURSE_LINK_SELECT)
      .eq("course_id", course.id)
      .order("created_at", { ascending: true }),
    // How many classmates are looking for a study partner (0028). Head-only,
    // never throws, and reads 0 for anyone who isn't in the class.
    countBuddies(course.id, { client: supabase, userId: user.userId }),
  ]);

  const classmates = ((enrollmentRows ?? []) as ClassmateEntry[]).filter(
    (row) => Boolean(row.profile)
  );
  const myEnrollment =
    classmates.find((row) => row.user_id === user.userId) ?? null;

  if (!myEnrollment) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
        <PageHeader
          backHref="/courses"
          backLabel="My courses"
          title={course.code}
          description={course.title}
        />

        {errorParam === "join" ? (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            Couldn&apos;t join this course. Give it another go.
          </p>
        ) : null}

        <Card padding="lg" className="mt-6 max-w-xl animate-fade-up">
          <span className="flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <BookOpen className="size-6" aria-hidden />
          </span>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {course.term ? (
              <Badge tone="neutral">{course.term.name}</Badge>
            ) : null}
            <Badge tone="neutral">{user.university.short_name}</Badge>
          </div>
          <p className="mt-4 text-sm text-muted">
            You&apos;re not in this course yet. Join to see the course chat, the
            shared notes and who else is in it.
          </p>
          <form action={joinCourse} className="mt-5">
            <input type="hidden" name="courseId" value={course.id} />
            <button
              type="submit"
              className={buttonClasses({ className: "w-full" })}
            >
              <UserPlus className="size-4" aria-hidden />
              Join this course
            </button>
          </form>
          <p className="mt-3 text-center text-xs text-muted">
            Joining adds you to the {course.code} channel. You can drop the
            course anytime.
          </p>
        </Card>
      </div>
    );
  }

  const notes = (noteRows ?? []) as NoteWithUploader[];
  const courseLinks = (linkRows ?? []) as unknown as CourseLinkRow[];
  const buddyLabel = buddyCountLabel(buddyCount);
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
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref="/courses"
        backLabel="My courses"
        title={course.code}
        description={course.title}
        action={
          channel ? (
            <Link
              href={`/channels/${channel.id}`}
              className={buttonClasses({ size: "sm", className: "gap-1.5" })}
            >
              <BookOpen className="size-4" aria-hidden />
              Course chat
            </Link>
          ) : undefined
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {course.term ? <Badge tone="neutral">{course.term.name}</Badge> : null}
        <Badge tone="accent">
          <SourceIcon className="size-3.5" aria-hidden />
          {source.label}
        </Badge>
      </div>

      {/* The study layer: rooms, the calendar, flashcards, grades, study
          partners, focus, syllabus import. */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {studyLinks(course.id, buddyLabel).map(
          ({ key, href, label, description, icon: Icon }) => (
            <Link
              key={key}
              href={href}
              className={cardClasses({
                padding: "sm",
                interactive: true,
                className: "flex items-center gap-3",
              })}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{label}</span>
                <span className="block truncate text-xs text-muted">
                  {description}
                </span>
              </span>
              <ChevronRight
                className="size-4 shrink-0 text-muted"
                aria-hidden
              />
            </Link>
          )
        )}
      </div>

      {/* Classmate-kept course facts + pinned links (migration 0024). */}
      <div className="mt-8 flex flex-col gap-8">
        <CourseDetails
          courseId={course.id}
          initialDetails={{
            instructor: course.instructor,
            meeting_info: course.meeting_info,
            location: course.location,
          }}
        />
        <CourseLinks
          courseId={course.id}
          userId={user.userId}
          initialLinks={courseLinks}
        />
      </div>

      <nav
        aria-label="Course sections"
        className="mt-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-border bg-surface-2 p-1"
      >
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={tab === item.key ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
              tab === item.key
                ? "bg-surface text-foreground shadow-soft"
                : "text-muted hover:text-foreground"
            )}
          >
            {item.label}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                tab === item.key
                  ? "bg-brand-soft text-brand-ink"
                  : "bg-surface-3 text-muted"
              )}
            >
              {item.count}
            </span>
          </Link>
        ))}
      </nav>

      <section
        className="mt-6"
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
