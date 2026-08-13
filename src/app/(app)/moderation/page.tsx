import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { ModerationQueue } from "@/features/moderation/queue";
import { getCurrentUser } from "@/lib/auth";
import {
  ModerationError,
  amIModerator,
  fetchQueue,
  fetchQueueCounts,
  type ModerationReport,
  type ReportStatus,
} from "@/lib/moderation";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Reports",
  description: "What campus has flagged, and what happens next.",
};

/**
 * The moderation queue.
 *
 * The badge is read here, on the server, so the common paths render without
 * waiting on the browser: a moderator's first paint already has their queue in
 * it, and a student who wandered in gets the warm door with no spinner in
 * front of it. Only the two moving parts (the status filter and triage) need
 * the client, and `@/features/moderation/queue` owns those.
 *
 * A failure to read the badge is not a locked door: `initialModerator` goes
 * null and the client's "Try again" re-runs the whole check.
 */
export default async function ModerationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const ctx = { client: supabase, userId: user.userId };

  let moderator: boolean | null = null;
  let reports: ModerationReport[] | null = null;
  let counts: Record<ReportStatus, number> | null = null;
  let error: string | null = null;

  try {
    moderator = await amIModerator(ctx);
  } catch (caught) {
    error =
      caught instanceof ModerationError
        ? caught.message
        : "We couldn't check your account just now. Give it another go.";
  }

  if (moderator === true) {
    try {
      const [rows, tallies] = await Promise.all([
        fetchQueue("open", ctx),
        fetchQueueCounts(ctx),
      ]);
      reports = rows;
      counts = tallies;
    } catch (caught) {
      error =
        caught instanceof ModerationError
          ? caught.message
          : "We couldn't load the queue. Check your connection and give it another go.";
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref="/settings"
        backLabel="Settings"
        title="Reports"
        description="Everything campus has flagged, and the two ways out of each one."
      />

      <ModerationQueue
        initialModerator={moderator}
        initialReports={reports}
        initialCounts={counts}
        initialError={error}
        nowIso={new Date().toISOString()}
      />
    </div>
  );
}
