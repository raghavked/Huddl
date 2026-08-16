"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import {
  Archive,
  CheckCircle2,
  ChevronRight,
  CloudOff,
  EyeOff,
  Loader2,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { GatheringScene, ShieldScene } from "@/components/illustrations";
import { Badge, Button, Card, Skeleton, cardClasses } from "@/components/ui";
import {
  ModerationError,
  STATUSES,
  amIModerator,
  categoryLabel,
  fetchQueue,
  fetchQueueCounts,
  fetchReportedContent,
  filedAgo,
  moveCount,
  reporterLine,
  reportSubject,
  setStatus,
  statusLabel,
  subjectHref,
  summarize,
  triageActions,
  type ModerationReport,
  type ReportedContent,
  type ReportStatus,
} from "@/lib/moderation";
import { cn } from "@/lib/utils";

/* Reports: the moderation queue's front door.
 *
 * Reports have been piling up since migration 0015 with triage locked behind
 * the service role. 0034 hands a few students the key, and this is the room it
 * opens.
 *
 * Who this screen is for shapes everything on it: a volunteer, probably a
 * sophomore, reading what their own campus flagged, probably late, probably on
 * their phone in bed. So there are no dashboards, no throughput numbers, no
 * red. Three counts on three chips is all the arithmetic anyone needs, and
 * they're there to say "nothing's waiting" as often as they say "six are".
 *
 * The one thing this insists on is context. A moderator should be able to
 * decide without leaving: the category the reporter picked, what the subject
 * actually was, the reporter's reason IN FULL (nothing here truncates it to a
 * tidy line, because that reason is the substance), and the reported words
 * themselves quoted in a well. When the subject can't be shown, whether it was
 * deleted or sits in a channel this moderator never joined, the card says so in
 * a sentence instead of leaving a gap the reader has to interpret. Every one of
 * those decisions comes from the one call to `reportSubject`, so the title, the
 * quote and the link can never disagree.
 *
 * Triage is optimistic and reversible. A click starts the card leaving straight
 * away; the write goes out alongside it and the card is only really dropped
 * once both have landed. A refusal brings it back with a warm line under it.
 * Nothing is a trapdoor: every card offers a way back to `open`, because a
 * tired click at 1am shouldn't be a decision anyone has to live with.
 */

/** How long a triaged card takes to leave. One house `base`, then it's gone. */
const SETTLE_MS = 240;

/* ------------------------------- the well ------------------------------- */

/**
 * The recessed block that holds someone else's words. One step back from the
 * card it sits in, with a hairline, so a quote never reads as the moderator's
 * own text.
 */
function Well({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-2 p-3">
      {children}
    </div>
  );
}

/** The small muted heading over a well. */
function WellLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold tracking-wide text-muted">{children}</p>
  );
}

/**
 * Who said the reported words and when, for the line above them.
 *
 * `reported_content` hands back an author id rather than a person, and the
 * only person this card can put a name to is the one the report was filed
 * against, so the name is used only when those two ids are the same. Anyone
 * else stays unnamed rather than guessed at, on a card whose whole job is
 * deciding something about a named person.
 */
function byline(
  content: ReportedContent,
  report: ModerationReport,
  now: Date
): string {
  const reported = report.reported;
  const who =
    reported !== null && content.author_id === reported.id
      ? reported.display_name
      : "Someone on campus";
  if (content.created_at === null) return who;
  return `${who} · ${filedAgo({ created_at: content.created_at }, now)}`;
}

/**
 * Reported words the queue query couldn't carry: a message in a channel this
 * moderator isn't in, a direct message, which no moderator is ever a
 * participant of, or a club announcement, whose table never opens up for the
 * queue.
 *
 * Deliberately behind a click rather than loaded with the list. These are
 * private words, and the difference between "a page that can show you a
 * reported message" and "a page that pulls a hundred private messages out of
 * the database to draw a list" is exactly this button.
 */
function HiddenMessage({
  report,
  note,
  announcement,
  now,
}: {
  report: ModerationReport;
  note: string;
  /** True when the hidden words are a club announcement, not a message. */
  announcement: boolean;
  /** The page's one moment, so "sent" and "filed" are measured from it. */
  now: Date;
}) {
  const [content, setContent] = useState<ReportedContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  /* The button that asks for these words unmounts once they arrive, and in
     Chrome and Firefox a removed element hands its focus to <body>. A
     moderator working by keyboard would be thrown to the top of the page and
     have to tab all the way back to the two triage buttons on the card they
     were reading. So the revealed block takes the focus the button gave up. */
  const revealedRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const found = await fetchReportedContent(report.id);
      if (found) setContent(found);
      else setEmpty(true);
      // After paint, so the target exists to receive it.
      requestAnimationFrame(() => revealedRef.current?.focus());
    } catch (caught) {
      setError(
        caught instanceof ModerationError
          ? caught.message
          : "We couldn't load what was reported. Give it another go."
      );
    } finally {
      setLoading(false);
    }
  }, [report.id, loading]);

  return (
    <div className="flex flex-col items-start gap-2">
      {/* The button that asked for these words is gone by the time they land,
          taking the reader's focus with it, so this region is mounted with the
          card and swaps its contents in place, a live region that appears at
          the same moment as its text is announced by nothing. */}
      <div
        ref={revealedRef}
        tabIndex={-1}
        aria-live="polite"
        className="flex w-full flex-col gap-1.5 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {content ? (
          <>
            <WellLabel>
              {content.kind === "announcement"
                ? "The announcement"
                : content.kind === "direct"
                  ? "The direct message"
                  : "What they said"}
            </WellLabel>
            <Well>
              <p className="text-xs text-muted">
                {byline(content, report, now)}
              </p>
              <p className="text-sm break-words whitespace-pre-wrap">
                {content.content}
              </p>
              {content.deleted_at ? (
                <p className="text-xs text-muted">
                  The author has taken this down since.
                </p>
              ) : null}
            </Well>
          </>
        ) : (
          <p className="flex items-start gap-2 text-xs text-muted">
            <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {empty
              ? announcement
                ? "That announcement has been deleted outright. The report is all that's left."
                : "That message has been deleted outright. The report is all that's left."
              : note}
          </p>
        )}
      </div>

      {/* A report whose words are gone is still a report to decide, so the
          only thing that leaves with them is the button. */}
      {content || empty ? null : (
        <Button
          variant="secondary"
          size="sm"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : null}
          {announcement ? "Read the announcement" : "Read the message"}
        </Button>
      )}

      {error ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * What was reported, quoted, or a sentence saying where it went.
 *
 * A soft-deleted message keeps its content here on purpose: "they took it down
 * after being reported" is the most useful thing a moderator can know, and
 * hiding the words would leave them deciding on nothing.
 */
function Subject({ report, now }: { report: ModerationReport; now: Date }) {
  const subject = reportSubject(report);

  if (subject.kind === "gone") {
    /* Words we can't embed aren't necessarily words we can't read.
       `messages` is channel-member-only, `dm_messages` is participant-only,
       and a club announcement (0060) never embeds at all, so a moderator
       used to be judging words they couldn't see. `reported_content()` is the
       one narrow way through, so offer it rather than the shrug. */
    if (subject.was === "message" || subject.was === "announcement") {
      return (
        <HiddenMessage
          report={report}
          note={subject.note}
          announcement={subject.was === "announcement"}
          now={now}
        />
      );
    }
    return (
      <p className="flex items-start gap-2 text-xs text-muted">
        <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {subject.note}
      </p>
    );
  }

  if (subject.kind === "message") {
    const { message } = subject;
    return (
      <div className="flex flex-col gap-1.5">
        <WellLabel>What they said</WellLabel>
        <Well>
          {message.channel ? (
            <p className="text-xs text-muted">{message.channel.name}</p>
          ) : null}
          <p className="text-sm break-words whitespace-pre-wrap">
            {message.content}
          </p>
          {message.deleted_at ? (
            <p className="text-xs text-muted">
              The author has taken this down since.
            </p>
          ) : null}
        </Well>
      </div>
    );
  }

  if (subject.kind === "post") {
    const { post } = subject;
    return (
      <div className="flex flex-col gap-1.5">
        <WellLabel>The post</WellLabel>
        <Well>
          <p className="text-sm font-semibold break-words">{post.title}</p>
          {post.body ? (
            <p className="text-sm break-words whitespace-pre-wrap">
              {post.body}
            </p>
          ) : null}
          {post.closed_at ? (
            <p className="text-xs text-muted">
              The author has marked this sorted.
            </p>
          ) : null}
        </Well>
      </div>
    );
  }

  const { profile } = subject;
  return (
    <div className="flex flex-col gap-1.5">
      <WellLabel>Their profile</WellLabel>
      <Well>
        <div className="flex items-center gap-2.5">
          <Avatar name={profile.display_name} src={profile.avatar_url} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {profile.display_name}
            </span>
            <span className="block truncate text-xs text-muted">
              @{profile.handle}
            </span>
          </span>
        </div>
        {profile.bio ? (
          <p className="text-sm break-words whitespace-pre-wrap">
            {profile.bio}
          </p>
        ) : null}
      </Well>
    </div>
  );
}

/* ------------------------------- the card ------------------------------- */

/**
 * One report, whole: what kind of thing was flagged, who flagged it and when,
 * why in their own words, the words themselves, and the two ways out.
 *
 * The settle is the only animation here and it reports a completion: the card
 * you just triaged leaving the pile it's no longer in. It runs the moment you
 * click, alongside the write rather than after it, so the click feels answered;
 * a refusal retraces the same curve back and the card stays put. Reduce motion
 * lands it in a millisecond, from `globals.css`.
 */
function ReportCard({
  report,
  now,
  settling,
  busy,
  error,
  onTriage,
}: {
  report: ModerationReport;
  now: Date;
  settling: boolean;
  busy: boolean;
  error: string | null;
  onTriage: (next: ReportStatus) => void;
}) {
  const href = subjectHref(report);
  const title = summarize(report);
  const actions = triageActions(report.status);
  /* No reporter means Hearth filed it (the 0051 slur auto-flag), and that's
     worth a quiet mark of its own: a moderator reads an automatic flag with
     different eyes to a classmate's complaint. */
  const auto = report.reporter === null;

  return (
    <li
      className={cardClasses({
        padding: "none",
        className: cn(
          "overflow-hidden transition-all duration-[240ms] ease-in-out",
          settling && "pointer-events-none scale-[0.97] opacity-0"
        ),
      })}
      aria-busy={settling || undefined}
    >
      <div className="flex flex-col gap-2.5 p-4">
        {/* The reporter's own pick, in their words. Brand, never danger: a
            category is what this is about, not a verdict on it. The muted
            "Auto" beside it marks a row Hearth filed itself. */}
        <div className="flex flex-wrap items-center gap-2 self-start">
          <Badge tone="brand">{categoryLabel(report.category)}</Badge>
          {auto ? <Badge tone="neutral">Auto</Badge> : null}
        </div>

        {href ? (
          <Link
            href={href}
            className="group inline-flex items-start gap-1 self-start rounded-xl text-sm font-semibold transition-colors hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {title}
            <ChevronRight
              className="mt-0.5 size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        ) : (
          <p className="text-sm font-semibold">{title}</p>
        )}

        <p className="text-xs text-muted">
          {reporterLine(report)} · {filedAgo(report, now)}
        </p>

        {/* The reporter's own words, in full. This is the substance of the
            report; a one-line preview would be the wrong economy. */}
        <p className="text-sm break-words whitespace-pre-wrap text-pretty">
          {report.reason}
        </p>

        <Subject report={report} now={now} />
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-border p-3">
        {actions.map((action, index) => (
          <Button
            key={action.status}
            variant={index === 0 ? "soft" : "secondary"}
            size="sm"
            disabled={busy}
            onClick={() => onTriage(action.status)}
          >
            {action.label}
          </Button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="px-4 pb-3.5 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/* ------------------------------ the empties ----------------------------- */

/** What each pile says when there's nothing in it. */
const EMPTIES: Record<ReportStatus, { title: string; body: string }> = {
  open: {
    title: "The queue is clear",
    body: "Nothing's waiting on you. Either someone got here first, or campus is just having a quiet night.",
  },
  reviewed: {
    title: "Nothing reviewed yet",
    body: "Reports you've acted on collect here, so you can look back at what you decided.",
  },
  dismissed: {
    title: "Nothing dismissed yet",
    body: "Reports that turned out to be fine end up here. Worth a second look now and then.",
  },
};

/* ------------------------------- the queue ------------------------------ */

/**
 * The whole moderation page below its title.
 *
 * `initialModerator` is `null` only when the server couldn't read the badge.
 * The retry button re-runs that check in the browser, so a hiccup on the way
 * in never leaves a moderator locked out of their own queue.
 */
export function ModerationQueue({
  initialModerator,
  initialReports,
  initialCounts,
  initialError,
  nowIso,
}: {
  /** True, false, or null when the check itself failed. */
  initialModerator: boolean | null;
  initialReports: ModerationReport[] | null;
  initialCounts: Record<ReportStatus, number> | null;
  initialError: string | null;
  /** The server's clock, so first paint and hydration agree on "3h ago". */
  nowIso: string;
}) {
  const [moderator, setModerator] = useState<boolean | null>(initialModerator);
  const [status, setStatusFilter] = useState<ReportStatus>("open");
  const [reports, setReports] = useState<ModerationReport[] | null>(
    initialReports
  );
  const [counts, setCounts] = useState<Record<ReportStatus, number> | null>(
    initialCounts
  );
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  // Every "3h ago" on the page reads off one moment, refreshed with the list,
  // so two cards can't disagree about what "now" is.
  const [now, setNow] = useState(() => new Date(nowIso));

  /**
   * Read one pile, plus the counts, plus the badge. The badge is re-checked
   * every time rather than cached: it's one cheap row, and a moderator who
   * stepped down mid-session should stop seeing other people's reports at the
   * next refresh, not at the next cold start.
   */
  const load = useCallback(async (next: ReportStatus) => {
    setLoading(true);
    setRowError(null);
    try {
      const allowed = await amIModerator();
      setModerator(allowed);
      if (!allowed) {
        setReports(null);
        setCounts(null);
        setError(null);
        return;
      }
      const [rows, tallies] = await Promise.all([
        fetchQueue(next),
        fetchQueueCounts(),
      ]);
      setReports(rows);
      setCounts(tallies);
      setNow(new Date());
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ModerationError
          ? caught.message
          : "We couldn't load the queue. Check your connection and give it another go."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const pickFilter = useCallback(
    (next: ReportStatus) => {
      if (next === status || loading) return;
      // A different pile is a different query, so clear the rows rather than
      // leaving one pile's cards sitting under another's chip.
      setStatusFilter(next);
      setReports(null);
      void load(next);
    },
    [status, loading, load]
  );

  /**
   * Move a report to another pile. The card starts leaving on the click; the
   * write goes out alongside it; the card is only dropped once both have
   * landed, and comes back with a line under it if the write didn't.
   */
  const triage = useCallback(
    async (report: ModerationReport, next: ReportStatus) => {
      if (settlingId !== null) return;
      setRowError(null);
      setSettlingId(report.id);

      const settled = new Promise<void>((resolve) => {
        window.setTimeout(resolve, SETTLE_MS);
      });

      try {
        await setStatus(report.id, next);
        await settled;
        setReports((rows) => (rows ?? []).filter((row) => row.id !== report.id));
        setCounts((current) =>
          current === null ? null : moveCount(current, report.status, next)
        );
      } catch (caught) {
        setRowError({
          id: report.id,
          message:
            caught instanceof ModerationError
              ? caught.message
              : "That didn't save. Give it another go in a moment.",
        });
      } finally {
        setSettlingId(null);
      }
    },
    [settlingId]
  );

  /* Not a moderator: a warm door, never a permissions error. The queue isn't
     a secret, it's just somebody else's chore. */
  if (moderator === false) {
    return (
      <div className="mt-8 rounded-card border border-dashed border-border">
        <EmptyState
          illustration={<GatheringScene />}
          icon={ShieldCheck}
          title="This one's for the moderators"
          description="A few students look after campus here. They read what gets flagged and decide what happens next. Anything you've reported is already with them."
        />
      </div>
    );
  }

  /* The badge check itself failed. One pane, one button, and the button
     re-runs the check as well as the query. */
  if (moderator === null) {
    return (
      <div className="mt-8 flex flex-col items-center gap-2.5 px-6 py-16 text-center">
        <CloudOff className="size-7 text-muted" aria-hidden />
        <p className="font-bold tracking-tight">Something went sideways</p>
        <p className="max-w-xs text-sm text-muted text-pretty">
          {error ?? "We couldn't check your account just now."}
        </p>
        <Button
          variant="soft"
          size="sm"
          disabled={loading}
          onClick={() => void load(status)}
          className="mt-1"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : null}
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mt-6 flex items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-muted text-pretty">
          What campus has flagged. Take them one at a time. There&apos;s no
          clock on this.
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => void load(status)}
          aria-label="Refresh the queue"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <RotateCw className="size-3.5" aria-hidden />
          )}
          Refresh
        </Button>
      </div>

      {/* The rail bleeds into both gutters so it runs off the edge rather than
          stopping short of it, and scrolls inside itself so the page never
          moves sideways. */}
      <div
        role="group"
        aria-label="Filter reports by status"
        className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1"
      >
        {STATUSES.map((candidate) => {
          const label = statusLabel(candidate);
          const count = counts?.[candidate];
          const active = candidate === status;
          return (
            <button
              key={candidate}
              type="button"
              aria-pressed={active}
              aria-label={
                count === undefined
                  ? label
                  : `${label}, ${count} ${count === 1 ? "report" : "reports"}`
              }
              disabled={loading}
              onClick={() => pickFilter(candidate)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                "disabled:pointer-events-none disabled:opacity-60",
                active
                  ? "bg-brand text-brand-fg shadow-soft"
                  : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-foreground"
              )}
            >
              {label}
              {count === undefined ? null : (
                <span
                  aria-hidden
                  className={cn(
                    "text-xs font-bold tabular-nums",
                    active ? "opacity-80" : "text-muted"
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && reports !== null ? (
        <p role="alert" className="mt-3 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}

      {reports === null ? (
        error ? (
          <div className="mt-6 flex flex-col items-center gap-2.5 px-6 py-16 text-center">
            <CloudOff className="size-7 text-muted" aria-hidden />
            <p className="font-bold tracking-tight">Something went sideways</p>
            <p className="max-w-xs text-sm text-muted text-pretty">{error}</p>
            <Button
              variant="soft"
              size="sm"
              disabled={loading}
              onClick={() => void load(status)}
              className="mt-1"
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : null}
              Try again
            </Button>
          </div>
        ) : (
          <div
            role="status"
            aria-label="Loading the queue"
            className="mt-4 flex flex-col gap-3"
          >
            {[0, 1, 2].map((index) => (
              <Card key={index} className="flex flex-col gap-3">
                <Skeleton className="h-6 w-28 rounded-full" />
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-16 w-full" />
              </Card>
            ))}
          </div>
        )
      ) : reports.length === 0 ? (
        <div className="mt-4 rounded-card border border-dashed border-border">
          <EmptyState
            illustration={status === "open" ? <ShieldScene /> : undefined}
            icon={status === "reviewed" ? CheckCircle2 : Archive}
            title={EMPTIES[status].title}
            description={EMPTIES[status].body}
          />
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {reports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              now={now}
              settling={settlingId === report.id}
              busy={settlingId !== null}
              error={rowError?.id === report.id ? rowError.message : null}
              onTriage={(next) => void triage(report, next)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
