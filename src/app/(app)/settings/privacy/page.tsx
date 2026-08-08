import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ShieldScene } from "@/components/illustrations";
import { PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PrivacyDashboard } from "@/features/schedule/privacy-dashboard";
import type { ScheduleUpload, ScheduleUploadEvent } from "@/lib/types";

export const metadata: Metadata = {
  title: "Privacy · Stored images",
  description:
    "The audit trail for any image you stored in the past — see every recorded event, and delete anything still on file.",
};

export default async function PrivacySettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: uploadsData } = await supabase
    .from("schedule_uploads")
    .select("*")
    .eq("user_id", user.userId)
    .order("created_at", { ascending: false });
  const uploads = (uploadsData ?? []) as ScheduleUpload[];

  let events: ScheduleUploadEvent[] = [];
  if (uploads.length > 0) {
    const { data: eventsData } = await supabase
      .from("schedule_upload_events")
      .select("*")
      .in(
        "upload_id",
        uploads.map((u) => u.id)
      )
      .order("created_at", { ascending: true });
    events = (eventsData ?? []) as ScheduleUploadEvent[];
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        title="Privacy & stored images"
        description="Everything Huddl has ever done with an image you stored, in one place — with a receipt for each step."
        backHref="/settings"
        backLabel="Settings"
      />

      <section
        aria-label="The receipt guarantee"
        className="mt-8 animate-fade-up rounded-card border border-accent/20 bg-accent-soft p-5 shadow-soft"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="font-semibold">The receipt guarantee</h2>
            <p className="mt-1 text-sm text-muted">
              If you stored an image here in the past, this is its full
              record. Every event below — processing, storing, accessing,
              deleting — was written to an audit log, and a database trigger
              turns each logged event into a notification to you. That last
              step can&apos;t be silently skipped, so if anything touches a
              stored image, you hear about it.
            </p>
            <Link
              href="/notifications"
              className="mt-2 inline-flex items-center gap-1.5 rounded-full text-sm font-semibold text-accent transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <Bell className="size-4" aria-hidden />
              See your receipts in notifications
            </Link>
          </div>
        </div>
      </section>

      <div className="mt-6">
        {uploads.length === 0 ? (
          <div className="rounded-card border border-dashed border-border">
            <EmptyState
              illustration={<ShieldScene />}
              icon={ShieldCheck}
              title="Nothing stored, nothing to audit"
              description="You've never stored an image with Huddl. If you had, its full audit trail would live here — every access logged, every log a notification."
            />
          </div>
        ) : (
          <PrivacyDashboard uploads={uploads} events={events} />
        )}
      </div>
    </div>
  );
}
