import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { FocusPanel, type CourseOption } from "@/features/focus/focus-panel";
import { getCurrentUser } from "@/lib/auth";
import {
  computeFocusStreak,
  fetchMyOpenSession,
  fetchStudyingNow,
  FocusError,
  type FocusSession,
  type StudyingNow,
} from "@/lib/focus";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Focus" };

/** How far back the streak query looks — long enough for any real run. */
const STREAK_WINDOW_DAYS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

type EnrollmentJoin = { course: CourseOption | null };

/**
 * Focus: sit down with a goal, and see who else on campus is heads-down.
 *
 * Everything the first paint needs is loaded here — your open session (if you
 * left one running on your phone), the campus's "studying now" list, your
 * live classes for the course chips, and the streak. The panel takes it from
 * there: it owns the clock, the writes, and the realtime subscription.
 */
export default async function FocusPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const ctx = { client: supabase, userId: user.userId };
  const now = new Date();
  const since = new Date(now.getTime() - STREAK_WINDOW_DAYS * DAY_MS);

  let mine: FocusSession | null = null;
  let studying: StudyingNow[] = [];
  let loadError: string | null = null;
  try {
    [mine, studying] = await Promise.all([
      fetchMyOpenSession(ctx),
      fetchStudyingNow(undefined, ctx),
    ]);
  } catch (caught) {
    loadError =
      caught instanceof FocusError
        ? caught.message
        : "We couldn't open focus just now.";
  }

  // Secondary data — a failure in either is a missing chip or a missing
  // streak, never a page that won't draw.
  const [{ data: enrollRows }, { data: streakRows }] = await Promise.all([
    supabase
      .from("enrollments")
      .select("course:courses(id, code)")
      .eq("user_id", user.userId)
      .is("archived_at", null),
    supabase
      .from("focus_sessions")
      .select("ended_at")
      .eq("user_id", user.userId)
      .not("ended_at", "is", null)
      .gte("started_at", since.toISOString())
      .order("started_at", { ascending: false })
      .limit(400),
  ]);

  const courses = ((enrollRows ?? []) as unknown as EnrollmentJoin[])
    .map((row) => row.course)
    .filter((course): course is CourseOption => course !== null)
    .sort((a, b) => a.code.localeCompare(b.code));

  const streak = computeFocusStreak(
    (streakRows ?? []) as { ended_at: string | null }[],
    now
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader backHref="/home" backLabel="Home" title="Focus" />

      <FocusPanel
        userId={user.userId}
        nowIso={now.toISOString()}
        initialSession={mine}
        initialStudying={studying.filter((row) => row.user_id !== user.userId)}
        initialStreak={streak}
        courses={courses}
        initialError={loadError}
      />
    </div>
  );
}
