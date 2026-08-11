import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  Bell,
  CircleAlert,
  Eye,
  PencilLine,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ShieldScene } from "@/components/illustrations";
import { PageHeader, SectionHeader, cardClasses } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { PrivacyDashboard } from "@/features/schedule/privacy-dashboard";
import type { ScheduleUpload, ScheduleUploadEvent } from "@/lib/types";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "The two signals you can switch off, and the audit trail for any image you stored in the past.",
};

/* Privacy — the two reciprocal signals, then the receipts.
 *
 * The top half is a choice: read receipts and typing indicators, both on by
 * default (migration 0033, `not null default true`), and both RECIPROCAL by
 * design. Turning yours off stops your signal going out AND stops everyone
 * else's coming in. A one-sided view of who has read what is a trap, not a
 * feature, so every caption here says both halves out loud.
 *
 * The bottom half is the stored-image audit that has always lived here, and
 * it stays exactly as it was.
 *
 * Both switches are plain forms posting to a server action, so they work
 * before a single byte of JavaScript arrives and there is no client state to
 * disagree with the row. A refusal comes back as `?error=sharing` and says so
 * in one warm line at the top. */

/* ---------------------------- the two switches ---------------------------- */

/** The column on `profiles`, and the exact sentence that goes under it. */
type SharingToggle = {
  column: "share_read_receipts" | "share_typing";
  icon: LucideIcon;
  label: string;
  /** States the reciprocity in one sentence. Both halves, every time. */
  caption: string;
};

const TOGGLES: readonly SharingToggle[] = [
  {
    column: "share_read_receipts",
    icon: Eye,
    label: "Read receipts",
    caption:
      "Turn this off and classmates stop seeing when you've read a message — and you stop seeing theirs.",
  },
  {
    column: "share_typing",
    icon: PencilLine,
    label: "Typing indicators",
    caption:
      "Turn this off and nobody sees you composing a message — and you stop seeing them, too.",
  },
];

/**
 * What the current pair actually means, in one sentence under the card.
 * Pure — it takes the two booleans and nothing else, so the copy can be read
 * (and changed) without chasing state around the page.
 */
function sharingSentence(readReceipts: boolean, typing: boolean): string {
  if (readReceipts && typing) {
    return "Both are on, which is how Huddl starts out: classmates can tell when you're composing and when you've caught up, and you can tell the same about them.";
  }
  if (!readReceipts && !typing) {
    return "Both are off. Nobody can tell whether you're typing or whether you've opened a message, and those signals are gone from your side of the conversation too. Your messages still send and arrive exactly the same.";
  }
  if (typing) {
    return "Read receipts are off, so nobody can tell whether you've opened a message, and you won't see whether they have. Typing still shows both ways.";
  }
  return "Typing indicators are off, so nobody sees you composing, and you won't see them composing either. Read receipts still show both ways.";
}

/** What each `?error=` on this page says out loud. */
const ERRORS: Record<string, string> = {
  sharing:
    "That switch didn't save, so the setting is still the way it was. Give it another go.",
};

/**
 * Flip one sharing preference. Both columns are `not null default true`, so
 * this only ever writes an explicit boolean — there is no "unset" to fall back
 * to and nothing to clean up when someone turns a signal back on.
 */
async function setSharing(formData: FormData) {
  "use server";
  const column = formData.get("column");
  if (column !== "share_read_receipts" && column !== "share_typing") {
    redirect("/settings/privacy");
  }
  const next = formData.get("next") === "on";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("profiles")
    .update({ [column]: next })
    .eq("id", user.id);

  if (error) redirect("/settings/privacy?error=sharing");
  revalidatePath("/settings/privacy");
  redirect("/settings/privacy");
}

/**
 * The switch itself: a submit button wearing the same track-and-thumb as the
 * one on the notifications page. It carries `role="switch"` and `aria-checked`
 * because that is what it is, and the hidden field spells out the state it is
 * moving to rather than toggling a value the server has to guess at.
 */
function SharingSwitch({ toggle, on }: { toggle: SharingToggle; on: boolean }) {
  return (
    <form action={setSharing} className="shrink-0">
      <input type="hidden" name="column" value={toggle.column} />
      <input type="hidden" name="next" value={on ? "off" : "on"} />
      <button
        type="submit"
        role="switch"
        aria-checked={on}
        aria-label={toggle.label}
        className={cn(
          "relative flex h-11 w-11 items-center justify-center rounded-full",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        )}
      >
        <span
          aria-hidden
          className={cn(
            "relative block h-6 w-11 rounded-full transition-colors",
            on ? "bg-brand" : "bg-surface-3"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 size-5 rounded-full bg-on-solid shadow-soft transition-transform",
              on && "translate-x-5"
            )}
          />
        </span>
      </button>
    </form>
  );
}

/* --------------------------------- page ---------------------------------- */

export default async function PrivacySettingsPage({
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

  const [sharingRes, uploadsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("share_read_receipts, share_typing")
      .eq("id", user.userId)
      .maybeSingle(),
    supabase
      .from("schedule_uploads")
      .select("*")
      .eq("user_id", user.userId)
      .order("created_at", { ascending: false }),
  ]);

  /* Anything that isn't a literal `false` reads as sharing: true is the column
     default and the way the app behaved before the choice existed, so an odd
     row can't quietly opt someone out of something they never turned off. */
  const sharingRow = (sharingRes.data ?? {}) as Record<string, unknown>;
  const shares: Record<SharingToggle["column"], boolean> = {
    share_read_receipts: sharingRow["share_read_receipts"] !== false,
    share_typing: sharingRow["share_typing"] !== false,
  };

  const uploads = (uploadsRes.data ?? []) as ScheduleUpload[];
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

  const errorText = errorParam ? (ERRORS[errorParam] ?? null) : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        title="Privacy"
        description="Two signals you can switch off, and a full receipt for anything you ever stored here."
        backHref="/settings"
        backLabel="Settings"
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

      <section aria-label="What you share" className="mt-8">
        <SectionHeader title="What you share" />

        <div className={cardClasses({ padding: "none", className: "mt-3" })}>
          <ul className="divide-y divide-border">
            {TOGGLES.map((toggle) => {
              const on = shares[toggle.column];
              const Icon = toggle.icon;
              return (
                <li
                  key={toggle.column}
                  className="flex min-h-11 items-center gap-3 px-4 py-3"
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-xl",
                      on ? "bg-brand-soft text-brand" : "bg-surface-2 text-muted"
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">
                      {toggle.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted text-pretty">
                      {toggle.caption}
                    </span>
                  </span>
                  <SharingSwitch toggle={toggle} on={on} />
                </li>
              );
            })}
          </ul>
        </div>

        <p className="mt-3 px-1 text-xs text-muted text-pretty">
          {sharingSentence(
            shares.share_read_receipts,
            shares.share_typing
          )}
        </p>
      </section>

      <section aria-label="Stored images" className="mt-8">
        <SectionHeader title="Stored images" />

        <div
          className="mt-3 animate-fade-up rounded-card border border-accent/20 bg-accent-soft p-5 shadow-soft"
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
                className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full text-sm font-semibold text-accent transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <Bell className="size-4" aria-hidden />
                See your receipts in notifications
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-4">
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
      </section>
    </div>
  );
}
