import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Bell, ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PrivacyDashboard } from "@/features/schedule/privacy-dashboard";
import type { ScheduleUpload, ScheduleUploadEvent } from "@/lib/types";

export const metadata: Metadata = {
  title: "Privacy · Schedule images",
  description:
    "See every schedule image you've uploaded, its full audit trail, and delete anything you've stored.",
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
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          Privacy &amp; schedule images
        </h1>
        <p className="mt-1 text-sm text-muted">
          Everything Huddl has ever done with your schedule images, in one
          place — with a receipt for each step.
        </p>
      </header>

      <section
        aria-label="The receipt guarantee"
        className="mt-6 rounded-card border border-border bg-surface p-5"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft">
            <ShieldCheck className="size-5 text-accent" aria-hidden />
          </span>
          <div>
            <h2 className="font-semibold">The receipt guarantee</h2>
            <p className="mt-1 text-sm text-muted">
              Your schedule photos are read on your device, and nothing is
              stored unless you switch it on. Every event below — processing,
              storing, accessing, deleting — is written to an audit log, and
              the database itself turns each one into a notification to you.
              App code can&apos;t skip it, so if something touches your image,
              you hear about it.
            </p>
            <Link
              href="/notifications"
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand transition-colors hover:text-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <Bell className="size-4" aria-hidden />
              See your receipts in notifications
            </Link>
          </div>
        </div>
      </section>

      <div className="mt-6">
        {uploads.length === 0 ? (
          <div className="rounded-card border border-border bg-surface">
            <EmptyState
              icon={ShieldCheck}
              title="No schedule images yet"
              description="If you set up courses from a photo of your schedule, its full audit trail will show up here."
              action={
                <Link
                  href="/setup/schedule"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  Upload a schedule
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              }
            />
          </div>
        ) : (
          <PrivacyDashboard uploads={uploads} events={events} />
        )}
      </div>
    </div>
  );
}
