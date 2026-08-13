import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  Bell,
  CircleAlert,
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
import { BlockedList } from "@/features/settings/blocked-list";
import { PrivacyDashboard } from "@/features/schedule/privacy-dashboard";
import type { ScheduleUpload, ScheduleUploadEvent } from "@/lib/types";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "The signal you can switch off, the people you've blocked, and the audit trail for any image you stored in the past.",
};

/* Privacy: the signal, the people, then the receipts.
 *
 * The top of the page is a choice: typing indicators, on by default
 * (migration 0033, `not null default true`) and RECIPROCAL by design.
 * Turning yours off stops your signal going out AND stops everyone else's
 * coming in. A one-sided view of who is composing is a trap, not a feature,
 * so the caption says both halves out loud.
 *
 * The middle is the block list, the one privacy control whose effect the
 * student can never observe, because blocking is silent by design. Nobody is
 * told and nothing changes on their side, so the list is the only receipt
 * there is.
 *
 * The bottom is the stored-image audit that has always lived here, and it
 * stays exactly as it was.
 *
 * ## Why there is no read-receipts switch
 *
 * There was one, right up there beside typing, and 0033 still carries the
 * `profiles.share_read_receipts` column it wrote. It should never have
 * shipped. Hearth draws no read receipt anywhere: no screen tells one person
 * whether another has opened a message. The only thing the column could have
 * gated is `channel_members.last_read_at` / `dm_participants.last_read_at`,
 * which is the app's own unread cursor: the thing that decides whether YOUR
 * rooms show a dot. Freezing it wouldn't hide a receipt nobody draws; it
 * would light up every room you'd already read, forever, as the price of a
 * privacy switch.
 *
 * So the switch is gone rather than left inert. A toggle that writes a column
 * nothing consults, under a caption promising classmates "stop seeing when
 * you've read a message", is a false statement to a student about their own
 * privacy, and it quietly discredits the one beside it that genuinely works.
 * The native app removed it first; see the long note at the top of
 * `mobile/src/hooks/use-privacy-prefs.ts`.
 *
 * The column stays in the database. The day Hearth actually renders a receipt,
 * the switch comes back here, gated at the surface that draws it, not at the
 * cursor that tracks unread. Until then, don't re-add it.
 *
 * The switch is a plain form posting to a server action, so it works before a
 * single byte of JavaScript arrives and there is no client state to disagree
 * with the row. A refusal comes back as `?error=sharing` and says so in one
 * warm line at the top. */

/* ------------------------------ the switch -------------------------------- */

/** The column on `profiles`, and the exact sentence that goes under it. */
type SharingToggle = {
  column: "share_typing";
  icon: LucideIcon;
  label: string;
  /** States the reciprocity in one sentence. Both halves, every time. */
  caption: string;
};

/* One entry, and a list anyway: a second honest signal would slot in here
   without touching the markup. Read receipts were the other one; see above
   for why they left and what has to be true before they come back. */
const TOGGLES: readonly SharingToggle[] = [
  {
    column: "share_typing",
    icon: PencilLine,
    label: "Typing indicators",
    caption:
      "Turn this off and nobody sees you composing a message. You stop seeing them, too.",
  },
];

/**
 * What the current setting actually means, in one sentence under the card.
 * Pure: it takes the boolean and nothing else, so the copy can be read (and
 * changed) without chasing state around the page.
 */
function sharingSentence(typing: boolean): string {
  if (typing) {
    return "It's on, which is how Hearth starts out: classmates can tell when you're composing a message, and you can tell the same about them.";
  }
  /* "and notify" matters: the commonest worry about this switch is that it
     quietly mutes something. It does not. `share_typing` is read by the
     typing hook and nothing else. Word for word with the native screen. */
  return "It's off. Nobody sees you composing, and you won't see them composing either. Your messages still send, arrive and notify exactly the same.";
}

/** What each `?error=` on this page says out loud. */
const ERRORS: Record<string, string> = {
  sharing:
    "That switch didn't save, so the setting is still the way it was. Give it another go.",
};

/**
 * Flip one sharing preference. The column is `not null default true`, so this
 * only ever writes an explicit boolean. There is no "unset" to fall back to
 * and nothing to clean up when someone turns a signal back on.
 *
 * The allow-list is a single name today and stays an allow-list: `column`
 * arrives from a form field and goes straight into an update, so it is never
 * trusted, only recognised.
 */
async function setSharing(formData: FormData) {
  "use server";
  const column = formData.get("column");
  if (column !== "share_typing") {
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
      .select("share_typing")
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
        description="A signal you can switch off, everyone you've blocked, and a full receipt for anything you ever stored here."
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
          {sharingSentence(shares.share_typing)}
        </p>
      </section>

      <section aria-label="Blocked people" className="mt-8">
        <SectionHeader title="Blocked people" />
        <p className="mt-2 px-1 text-xs text-muted text-pretty">
          They can&apos;t DM you, and their posts stay out of sight. They were
          never told, so this list is the only place a block shows up.
        </p>
        {/* Loads itself; see the note in `blocked-list.tsx`. */}
        <BlockedList userId={user.userId} />
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
                record. Every event below (processing, storing, accessing,
                deleting) was written to an audit log, and a database trigger
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
                description="You've never stored an image with Hearth. If you had, its full audit trail would live here: every access logged, every log a notification."
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
