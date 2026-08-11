import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  GraduationCap,
  History,
  ListChecks,
  Palette,
  Plus,
  Trash2,
  TrendingUp,
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
import {
  archiveCourse,
  fetchMyCourses,
  groupByTerm,
  unarchiveCourse,
  type MyCourse,
} from "@/lib/course-archive";
import {
  COURSE_TINT_KEYS,
  COURSE_TINT_LABELS,
  asCourseTint,
  colorForCourse,
  courseTintClasses,
  type CourseTint,
} from "@/lib/course-color";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { EnrollmentSource } from "@/lib/types";

export const metadata: Metadata = { title: "My courses" };

// 'canvas' / 'schedule_image' are historical sources from retired import
// flows — old rows keep them, so they render as a plain history label.
const SOURCE_META: Record<
  EnrollmentSource,
  { label: string; icon: LucideIcon }
> = {
  canvas: { label: "Added a while back", icon: History },
  schedule_image: { label: "Added a while back", icon: History },
  manual: { label: "Added by you", icon: ListChecks },
};

/** What each `?error=` on this page says out loud. */
const ERRORS: Record<string, string> = {
  drop: "Couldn't drop that course. Please try again.",
  shelve: "We couldn't shelve that class just now. Give it another go.",
  unshelve: "We couldn't bring that class back just now. Give it another go.",
  color: "That colour didn't stick just now. Give it another go.",
};

/**
 * Drop a course. Deleting the enrollment fires the DB trigger that also
 * removes the matching course-channel membership — no extra cleanup here.
 *
 * This is the destructive path. Shelving is {@link shelveCourse} and it
 * deletes nothing.
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

/**
 * Shelve a finished class: `enrollments.archived_at` gets a timestamp and
 * nothing else moves. The channel membership, the chat, the notes and the
 * calendar history all stay exactly where they were — the class just stops
 * crowding this quarter's list.
 */
async function shelveCourse(formData: FormData) {
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

  let failed = false;
  try {
    await archiveCourse(enrollmentId, { client: supabase, userId: user.id });
  } catch {
    // The module already refuses to report a write that changed nothing.
    failed = true;
  }

  if (failed) redirect("/courses?error=shelve");
  revalidatePath("/courses");
  redirect("/courses");
}

/** Bring a shelved class back to this quarter's list. Nothing to rebuild. */
async function unshelveCourse(formData: FormData) {
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

  let failed = false;
  try {
    await unarchiveCourse(enrollmentId, { client: supabase, userId: user.id });
  } catch {
    failed = true;
  }

  if (failed) redirect("/courses?error=unshelve");
  revalidatePath("/courses");
  redirect("/courses");
}

/**
 * Hang a colour on one of the caller's own enrollments.
 *
 * The colour is personal: it goes on the student's own `enrollments` row,
 * scoped by `user_id` as well as `id`, and no classmate ever sees it.
 *
 * BACKEND GAP — READ BEFORE DEBUGGING A COLOUR THAT WON'T STICK.
 * Migration 0029 revoked blanket UPDATE on `enrollments` and granted it back
 * one column at a time; 0032 added `color` without extending that grant. Until
 * it does, every write here is refused and the swatch snaps back with the
 * apology in {@link ERRORS} — which is the honest behaviour, not a bug on this
 * page. The fix is one line:
 *
 *   grant update (color) on public.enrollments to authenticated;
 *
 * The row policy from 0029 ("students shelve their own enrollments") already
 * scopes UPDATE to `user_id = auth.uid()`, so nothing else is needed and no
 * classmate's tint becomes writable.
 */
async function paintCourse(formData: FormData) {
  "use server";
  const enrollmentId = formData.get("enrollmentId");
  const color = asCourseTint(
    typeof formData.get("color") === "string"
      ? String(formData.get("color"))
      : null
  );
  if (typeof enrollmentId !== "string" || enrollmentId.length === 0 || !color) {
    redirect("/courses");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("enrollments")
    .update({ color })
    .eq("id", enrollmentId)
    .eq("user_id", user.id)
    .select("id, color")
    .maybeSingle();

  // No row back means RLS refused the update and PostgREST reported no error —
  // the same silent no-op `@/lib/course-archive` guards against.
  if (error || data === null) redirect("/courses?error=color");
  revalidatePath("/courses");
  redirect("/courses");
}

/** One class on this quarter's list, with its two ways out and its colour. */
function ActiveCourseCard({
  course,
  tint,
}: {
  course: MyCourse;
  /** The tint this class wears for this student. See {@link colorForCourse}. */
  tint: CourseTint;
}) {
  const source = SOURCE_META[course.source];
  const SourceIcon = source.icon;
  const dropId = `drop-confirm-${course.enrollment_id}`;
  const shelveId = `shelve-confirm-${course.enrollment_id}`;
  const colorId = `color-picker-${course.enrollment_id}`;
  const paint = courseTintClasses(tint);

  return (
    <li
      className={cardClasses({
        padding: "sm",
        className: "flex h-full flex-col",
      })}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            paint.chip
          )}
        >
          <BookOpen className="size-5" aria-hidden />
        </span>

        <span className="-mr-2.5 -mt-2.5 flex shrink-0 items-center">
          <button
            type="button"
            popoverTarget={colorId}
            aria-label={`Change the colour of ${course.code}`}
            title="Course colour"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Palette className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            popoverTarget={shelveId}
            aria-label={`Shelve ${course.code}`}
            title="Shelve course"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Archive className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            popoverTarget={dropId}
            aria-label={`Drop ${course.code}`}
            title="Drop course"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </span>
      </div>

      <Link
        href={`/courses/${course.course_id}`}
        className="group mt-3 flex min-w-0 flex-1 flex-col rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-sm font-bold transition-shadow group-hover:ring-1 group-hover:ring-current",
              paint.chip
            )}
          >
            {course.code}
          </span>
          {course.term ? <Badge tone="neutral">{course.term}</Badge> : null}
        </span>
        {course.title ? (
          <span className="mt-1 block truncate text-sm text-muted transition-colors group-hover:text-foreground">
            {course.title}
          </span>
        ) : null}
        <span className="mt-auto inline-flex items-center gap-1 pt-2.5 text-xs font-medium text-accent">
          <SourceIcon className="size-3.5" aria-hidden />
          {source.label}
        </span>
      </Link>

      {/* Native popover confirms — top-layer, light dismiss, no client JS,
          so this page stays a server component. */}
      <div
        id={colorId}
        popover="auto"
        role="dialog"
        aria-labelledby={`${colorId}-title`}
        aria-describedby={`${colorId}-body`}
        className="m-auto w-[min(92vw,22rem)] rounded-card border border-border bg-surface p-5 text-foreground shadow-lift backdrop:bg-black/50"
      >
        <h2 id={`${colorId}-title`} className="font-bold tracking-tight">
          {course.code}&apos;s colour
        </h2>
        <p id={`${colorId}-body`} className="mt-1.5 text-sm text-muted">
          Yours alone — your lab partner can give the same class a different
          one, and neither of you ever sees the other&apos;s.
        </p>
        <form action={paintCourse} className="mt-4">
          <input
            type="hidden"
            name="enrollmentId"
            value={course.enrollment_id}
          />
          <div className="grid grid-cols-3 gap-2">
            {COURSE_TINT_KEYS.map((key) => {
              const swatch = courseTintClasses(key);
              const chosen = key === tint;
              return (
                <button
                  key={key}
                  type="submit"
                  name="color"
                  value={key}
                  aria-pressed={chosen}
                  className={cn(
                    "flex h-11 items-center justify-center gap-1.5 rounded-full border text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                    swatch.chip,
                    chosen ? "border-current" : "border-transparent"
                  )}
                >
                  {chosen ? <Check className="size-3.5" aria-hidden /> : null}
                  {COURSE_TINT_LABELS[key]}
                </button>
              );
            })}
          </div>
        </form>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            popoverTarget={colorId}
            popoverTargetAction="hide"
            className={buttonClasses({ variant: "ghost", size: "sm" })}
          >
            Done
          </button>
        </div>
      </div>

      <div
        id={shelveId}
        popover="auto"
        role="dialog"
        aria-labelledby={`${shelveId}-title`}
        aria-describedby={`${shelveId}-body`}
        className="m-auto w-[min(92vw,22rem)] rounded-card border border-border bg-surface p-5 text-foreground shadow-lift backdrop:bg-black/50"
      >
        <h2 id={`${shelveId}-title`} className="font-bold tracking-tight">
          Shelve {course.code}?
        </h2>
        <p id={`${shelveId}-body`} className="mt-1.5 text-sm text-muted">
          Chat and notes stay put — you keep the {course.code} channel and
          everything in it. The class just stops showing up in this quarter&apos;s
          lists, and you can bring it back whenever you like.
        </p>
        <form action={shelveCourse} className="mt-4 flex justify-end gap-2">
          <input
            type="hidden"
            name="enrollmentId"
            value={course.enrollment_id}
          />
          <button
            type="button"
            popoverTarget={shelveId}
            popoverTargetAction="hide"
            className={buttonClasses({ variant: "ghost", size: "sm" })}
          >
            Keep it here
          </button>
          <button
            type="submit"
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            <Archive className="size-3.5" aria-hidden />
            Shelve course
          </button>
        </form>
      </div>

      <div
        id={dropId}
        popover="auto"
        role="dialog"
        aria-labelledby={`${dropId}-title`}
        aria-describedby={`${dropId}-body`}
        className="m-auto w-[min(92vw,22rem)] rounded-card border border-border bg-surface p-5 text-foreground shadow-lift backdrop:bg-black/50"
      >
        <h2 id={`${dropId}-title`} className="font-bold tracking-tight">
          Drop {course.code}?
        </h2>
        <p id={`${dropId}-body`} className="mt-1.5 text-sm text-muted">
          You&apos;ll leave the {course.code} channel too. Notes you shared stay
          available to classmates, and you can re-join anytime. To keep the
          chat, shelve it instead.
        </p>
        <form action={dropCourse} className="mt-4 flex justify-end gap-2">
          <input
            type="hidden"
            name="enrollmentId"
            value={course.enrollment_id}
          />
          <button
            type="button"
            popoverTarget={dropId}
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
}

/** One shelved class: quieter, and one click from coming back. */
function ArchivedCourseRow({
  course,
  tint,
}: {
  course: MyCourse;
  tint: CourseTint;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      {/* The tint carries over onto the shelf, so a class you're digging back
          into is the colour you remember it being. Soft fill, ink hairline —
          a wash this small would otherwise be invisible on cream. */}
      <span
        className={cn(
          "size-2.5 shrink-0 rounded-full ring-1 ring-current",
          courseTintClasses(tint).soft,
          courseTintClasses(tint).ink
        )}
        aria-hidden
      />
      <Link
        href={`/courses/${course.course_id}`}
        className="group min-w-0 flex-1 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <span className="block truncate text-sm font-semibold transition-colors group-hover:text-brand">
          {course.code}
        </span>
        {course.title ? (
          <span className="mt-0.5 block truncate text-xs text-muted">
            {course.title}
          </span>
        ) : null}
      </Link>
      <form action={unshelveCourse}>
        <input type="hidden" name="enrollmentId" value={course.enrollment_id} />
        <button
          type="submit"
          aria-label={`Bring ${course.code} back to this quarter`}
          className={buttonClasses({ variant: "secondary", size: "sm" })}
        >
          <ArchiveRestore className="size-3.5" aria-hidden />
          Bring back
        </button>
      </form>
    </li>
  );
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
  let active: MyCourse[] = [];
  let archived: MyCourse[] = [];
  let loadError: string | null = null;
  try {
    ({ active, archived } = await fetchMyCourses({
      client: supabase,
      userId: user.userId,
    }));
  } catch {
    loadError =
      "We couldn't load your classes. Check your connection and give it another go.";
  }

  /* The student's own tints, in a second small query rather than widened onto
     `MY_COURSES_SELECT`: the colour is this page's business, and every other
     caller of `fetchMyCourses` would otherwise pay for a column it ignores.
     A failure here is not worth an error — the hash fallback is a perfectly
     good answer, so the page just draws the default tints. */
  const { data: colorRows } = await supabase
    .from("enrollments")
    .select("id, color")
    .eq("user_id", user.userId);
  const pickedColors = new Map<string, string | null>(
    ((colorRows ?? []) as { id: string; color: string | null }[]).map((row) => [
      row.id,
      row.color,
    ])
  );

  /** The colour a class wears: the student's pick, else its code hashed. */
  const tintOf = (course: MyCourse): CourseTint =>
    colorForCourse(pickedColors.get(course.enrollment_id), course.code);

  const shelves = groupByTerm(archived);
  const errorText =
    (errorParam ? ERRORS[errorParam] : undefined) ?? loadError ?? null;

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
        title="My courses"
        description={
          active.length === 0
            ? `Your classes at ${user.university.short_name}`
            : `${active.length} ${
                active.length === 1 ? "course" : "courses"
              } at ${user.university.short_name}`
        }
        action={active.length > 0 ? addButton : undefined}
      />

      {errorText ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {errorText}
        </p>
      ) : null}

      {active.length === 0 ? (
        <div className="mt-6 rounded-card border border-dashed border-border">
          <EmptyState
            icon={GraduationCap}
            title={
              archived.length === 0
                ? "No courses yet"
                : "Nothing on this quarter's list"
            }
            description={
              archived.length === 0
                ? "Add your classes to unlock course chat, shared notes and your classmate list — each course gets its own channel automatically."
                : "Add this quarter's classes, or bring one back off the shelf below."
            }
            action={addButton}
          />
        </div>
      ) : (
        <>
          <Link
            href="/semester"
            className={cardClasses({
              padding: "none",
              interactive: true,
              className:
                "mt-6 flex animate-fade-up items-center gap-3 px-4 py-3.5",
            })}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <TrendingUp className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">This semester</span>
              <span className="mt-0.5 block text-xs text-muted">
                Your own estimate across every class. Only you can see it.
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
          </Link>

          <ul className="mt-3 grid animate-fade-up gap-3 sm:grid-cols-2">
            {active.map((course) => (
              <ActiveCourseCard
                key={course.enrollment_id}
                course={course}
                tint={tintOf(course)}
              />
            ))}
          </ul>
        </>
      )}

      {shelves.length > 0 ? (
        <details className="group mt-8">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full px-1 py-2 text-xs font-bold uppercase tracking-widest text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <ChevronDown
              className="size-4 transition-transform group-open:rotate-180"
              aria-hidden
            />
            Shelved · {archived.length}
          </summary>

          <p className="mt-2 px-1 text-xs leading-relaxed text-muted text-pretty">
            Finished classes, kept whole. Their chat, notes and calendar are
            all still here — bring one back any time.
          </p>

          <div className="mt-3 flex flex-col gap-5">
            {shelves.map((shelf) => (
              <section key={shelf.term} aria-label={shelf.term}>
                <h2 className="px-1 text-xs font-bold uppercase tracking-widest text-muted">
                  {shelf.term}
                </h2>
                <ul
                  className={cardClasses({
                    padding: "none",
                    className: "mt-2 divide-y divide-border overflow-hidden",
                  })}
                >
                  {shelf.courses.map((course) => (
                    <ArchivedCourseRow
                      key={course.enrollment_id}
                      course={course}
                      tint={tintOf(course)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
