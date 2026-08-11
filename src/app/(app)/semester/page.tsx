import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, CircleAlert, Lock, TrendingUp } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  Card,
  PageHeader,
  buttonClasses,
  cardClasses,
} from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { courseTintClasses } from "@/lib/course-color";
import {
  GRADE_POINT_MAX,
  SemesterError,
  fetchSemester,
  formatGpa,
  totalUnits,
  type Semester,
  type SemesterCourse,
  type SemesterEstimate,
} from "@/lib/semester";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "This semester" };

/* This semester — every class's estimate, and the one number across them.
 *
 * Scratch math from top to bottom. Every figure here is arithmetic on scores
 * the student typed into their own private gradebook: nothing on this page is
 * a transcript, a registrar number, or a grade of record, and none of it is
 * ever visible to a classmate. It is also an estimate OF an estimate — each
 * course number is already a projection from partial grades — so the copy
 * stays hedged the whole way down: the privacy line up top, the note under the
 * number, and the line about the 4.0 scale at the bottom.
 *
 * All the math lives in `@/lib/semester` and all of it is pure. This file
 * fetches once, decides what to show, and writes the sentences the module
 * didn't already write. It never averages anything itself.
 */

/* ------------------------------ formatting ----------------------------- */

/** "86.7", "90", "45" — a percentage the way a person writes it. */
function pctText(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** "4 units", "1 unit", or the plain truth when nobody has filled them in. */
function unitsText(units: number | null): string {
  if (units === null || !Number.isFinite(units) || units <= 0) {
    return "Units not set";
  }
  const value = Math.round(units * 100) / 100;
  return `${value} ${value === 1 ? "unit" : "units"}`;
}

/**
 * The semester's units, but only when every class has them. `totalUnits`
 * happily adds up the classes it knows about, and "17 units" beside a
 * half-known list would read as the whole semester when it isn't. Null means
 * leave the line out — the summary note already says which classes are short.
 */
function unitsLine(courses: readonly SemesterCourse[]): string | null {
  const known = courses.every(
    (course) =>
      typeof course.units === "number" &&
      Number.isFinite(course.units) &&
      course.units > 0
  );
  if (!known) return null;
  const total = totalUnits(courses);
  return total === null ? null : unitsText(total);
}

/** "3 of 5 classes have grades in" — the ledger beside the note's prose. */
function coverageLine(estimate: SemesterEstimate): string {
  if (estimate.total === 1) return "Your one class has grades in";
  const verb = estimate.graded === 1 ? "has" : "have";
  return `${estimate.graded} of ${estimate.total} classes ${verb} grades in`;
}

/**
 * The class where "add a category" is genuinely the next step: one with no
 * gradebook set up at all, falling back to the first class on the list. Null
 * only when there are no classes, and that case has its own empty state.
 */
function recruitCourse(
  courses: readonly SemesterCourse[]
): SemesterCourse | null {
  const noGradebook = courses.find((course) => course.categoryCount === 0);
  return noGradebook ?? courses[0] ?? null;
}

/**
 * ", about an A minus" — the letter said aloud rather than spelled, with the
 * article that fits it. Empty when there's no letter to say, so it can be
 * dropped straight onto the end of the sentence.
 */
function spokenLetterClause(letter: string | null): string {
  if (letter === null || letter.length === 0) return "";
  const article = /^[AF]/.test(letter) ? "an" : "a";
  const spoken = letter.replace("+", " plus").replace("-", " minus");
  return `, about ${article} ${spoken}`;
}

/** Everything one row says, in one sentence, for a screen reader. */
function rowLabel(course: SemesterCourse): string {
  const parts: string[] = [course.code];
  if (course.title) parts.push(course.title);
  // Mid-sentence, so it's spoken lowercase: "…, 4 units, estimated 88 percent."
  parts.push(unitsText(course.units).toLowerCase());
  const pct = course.estimate.pct;
  parts.push(
    pct === null
      ? "no grades yet"
      : `estimated ${pctText(pct)} percent${spokenLetterClause(course.letter)}`
  );
  return `${parts.join(", ")}.`;
}

/* ------------------------------ small parts ---------------------------- */

/**
 * The promise this page is built on, stated once at the top and never
 * repeated. Fern-soft rather than ember: reassurance, not an alert.
 *
 * Word for word the line the single-course grade page opens with, on purpose.
 * Those are the only places in the app that show a student their own grades,
 * and a promise that changes wording between them is a promise a reader has to
 * re-read.
 */
function PrivacyLine() {
  return (
    <p className="mt-3 flex items-start gap-2.5 rounded-xl bg-accent-soft px-3 py-2.5 text-xs leading-relaxed text-accent">
      <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      Only you can see this. Huddl never shares your grades with classmates or
      your school.
    </p>
  );
}

/**
 * The course code, wearing that course's colour.
 *
 * Not a `Badge`, which takes a `tone` — six fixed meanings — where a course
 * tint is one of a personal palette rather than a meaning. The metrics match
 * `Badge`'s smaller shape exactly, so this is a colour change and nothing
 * else. The code is always rendered, so a student who can't separate two of
 * the tints still reads the row correctly.
 */
function CourseCodeChip({ course }: { course: SemesterCourse }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        courseTintClasses(course.color).chip
      )}
    >
      {course.code}
    </span>
  );
}

/**
 * The headline: the estimated GPA, what the number covers, and how many
 * classes are actually in it.
 */
function SummaryCard({
  summary,
  units,
}: {
  summary: SemesterEstimate;
  units: string | null;
}) {
  const gpa = formatGpa(summary.gpa);
  if (gpa === null) return null;

  const coverage = coverageLine(summary);
  const scale = GRADE_POINT_MAX.toFixed(1);

  return (
    <Card className="animate-fade-up">
      <p className="text-xs text-muted">Estimated GPA</p>
      <p
        className="mt-1 flex items-end gap-2"
        aria-label={`Estimated grade point average ${gpa} out of ${scale}`}
      >
        <span className="font-display text-4xl font-bold tracking-tight">
          {gpa}
        </span>
        <span className="pb-1.5 text-xs text-muted">out of {scale}</span>
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted">{summary.note}</p>
      <p className="mt-1 text-xs text-muted">
        {units ? `${coverage} · ${units}` : coverage}
      </p>
    </Card>
  );
}

/**
 * What stands in for the number before there is one. A 0.00 would be a lie
 * with a decimal point on it — an empty gradebook is not a failing semester —
 * so the card recruits toward the one thing that starts it: a category off a
 * syllabus in a class that hasn't got one yet.
 */
function RecruitCard({ course }: { course: SemesterCourse }) {
  return (
    <div className="mt-6 rounded-card border border-dashed border-border">
      <EmptyState
        icon={TrendingUp}
        title="Your average starts with one score"
        description={`Add a category off your syllabus — homework 20%, midterm 30% — to ${course.code}, then log a score. Every class you set up joins the average.`}
        action={
          <Link
            href={`/courses/${course.courseId}/grades`}
            className={buttonClasses({ variant: "soft", size: "sm" })}
          >
            Set up {course.code}
          </Link>
        }
      />
    </div>
  );
}

/* --------------------------------- rows -------------------------------- */

function CourseRow({ course }: { course: SemesterCourse }) {
  const pct = course.estimate.pct;

  return (
    <li>
      <Link
        href={`/courses/${course.courseId}/grades`}
        aria-label={rowLabel(course)}
        className={cardClasses({
          padding: "none",
          interactive: true,
          className: "flex items-center gap-3 py-3 pl-4 pr-2",
        })}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <CourseCodeChip course={course} />
            <span className="text-xs text-muted">
              {unitsText(course.units)}
            </span>
          </span>
          {course.title ? (
            <span className="mt-1 block truncate text-sm font-semibold">
              {course.title}
            </span>
          ) : null}
        </span>

        <span className="shrink-0 text-right">
          {pct === null ? (
            <span className="text-xs text-muted">No grades yet</span>
          ) : (
            <>
              <span className="block text-sm font-semibold">
                {pctText(pct)}%
              </span>
              {course.letter !== null && course.gradePoint !== null ? (
                /* The letter and what it's worth, so the number at the top of
                   the page is traceable to the rows under it. */
                <span className="mt-0.5 block text-xs text-muted">
                  {course.letter} · {course.gradePoint.toFixed(1)}
                </span>
              ) : null}
            </>
          )}
        </span>

        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  );
}

/* --------------------------------- page -------------------------------- */

export default async function SemesterPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  let semester: Semester | null = null;
  let loadError: string | null = null;
  try {
    semester = await fetchSemester({ client: supabase, userId: user.userId });
  } catch (caught) {
    loadError =
      caught instanceof SemesterError
        ? caught.message
        : "We couldn't put your semester together just now. Give it another go.";
  }

  const courses = semester?.courses ?? [];
  const summary = semester?.summary ?? null;
  const recruit = recruitCourse(courses);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref="/courses"
        backLabel="My courses"
        title="This semester"
      />
      <PrivacyLine />

      {loadError ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {loadError}
        </p>
      ) : null}

      {courses.length === 0 || summary === null ? (
        loadError ? null : (
          <div className="mt-6 rounded-card border border-dashed border-border">
            <EmptyState
              icon={TrendingUp}
              title="No classes yet"
              description="Add this quarter's classes and each one gets its own estimate here, with one average across all of them."
              action={
                <Link
                  href="/setup"
                  className={buttonClasses({ variant: "soft", size: "sm" })}
                >
                  Add your classes
                </Link>
              }
            />
          </div>
        )
      ) : (
        <>
          {summary.gpa !== null ? (
            <div className="mt-6">
              <SummaryCard summary={summary} units={unitsLine(courses)} />
            </div>
          ) : recruit !== null ? (
            <RecruitCard course={recruit} />
          ) : null}

          <h2 className="mt-8 px-1 text-xs font-bold uppercase tracking-widest text-muted">
            Your classes
          </h2>

          {/* The tint is already resolved by `@/lib/semester`: the student's
              own pick where they made one, the stable hash of the course code
              where they didn't. It is personal — the lab partner reading the
              same class may well see a different colour. */}
          <ul className="mt-3 flex flex-col gap-2.5">
            {courses.map((course) => (
              <CourseRow key={course.enrollmentId} course={course} />
            ))}
          </ul>

          {/* The closing hedge: whose 4.0 scale this is, and whose it isn't. */}
          <p className="mt-6 px-1 text-xs leading-relaxed text-muted text-pretty">
            The letters here follow one common 4.0 scale — an A is 4.0, an A- is
            3.7, and nothing sits above 4.0. Plenty of schools count plus and
            minus their own way, so treat this as your math, not your
            registrar&apos;s.
          </p>
        </>
      )}
    </div>
  );
}
