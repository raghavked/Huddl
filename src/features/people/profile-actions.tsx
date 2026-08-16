"use client";

import { useId, useState } from "react";
import {
  Check,
  Clock,
  Flag,
  Loader2,
  UserRoundCheck,
  UserRoundPlus,
  UserRoundX,
} from "lucide-react";
import { Button } from "@/components/ui";
import { reportProfile } from "@/features/moderation/actions";
import {
  FriendsError,
  acceptRequest,
  removeEdge,
  sendRequest,
  type FriendState,
} from "@/lib/friends";
import {
  REPORT_CATEGORIES,
  categoryLabel,
  type ReportCategory,
} from "@/lib/moderation";
import { cn } from "@/lib/utils";

/**
 * The friend button, first on the profile's action row.
 *
 * One control wearing the four states of {@link FriendState}: "Add friend"
 * (none), "Request sent" (outgoing, tapping offers Cancel request), "Accept
 * request" with a quieter "Ignore" (incoming), and "Friends" (accepted,
 * tapping offers Remove friend). Every write is optimistic: the button flips
 * first and flips back with an inline error if the server disagrees, which
 * `sendRequest` and friends were written to make safe.
 *
 * Like the block button below, it renders bare flex children so the caller's
 * wrapping row owns the layout: the disclosure panel is `w-full` and drops
 * onto its own line rather than shoving the other buttons around.
 *
 * @param name What to call them out loud. A private profile withholds the
 *   display name, so the caller passes the handle instead.
 */
export function FriendButton({
  personId,
  name,
  initialState,
}: {
  personId: string;
  name: string;
  initialState: FriendState;
}) {
  const panelId = useId();
  const [state, setState] = useState<FriendState>(initialState);
  // The disclosure under "Request sent" and "Friends", where the quieter
  // second thought (cancel, unfriend) lives behind one more deliberate tap.
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Flip first, write second, flip back with the warm copy if it fails. */
  async function transition(next: FriendState, write: () => Promise<void>) {
    if (working) return;
    const previous = state;
    setError(null);
    setWorking(true);
    setAsking(false);
    setState(next);
    try {
      await write();
    } catch (err) {
      setState(previous);
      setError(
        err instanceof FriendsError
          ? err.message
          : "That didn't go through. Give it another go in a moment."
      );
    } finally {
      setWorking(false);
    }
  }

  /* Full-width so it lands on its own line in the caller's wrapping row,
     the same way the block confirmation does. */
  const notice = error ? (
    <p
      role="alert"
      className="w-full text-sm font-medium text-danger text-pretty"
    >
      {error}
    </p>
  ) : null;

  const spinner = <Loader2 className="size-4 animate-spin" aria-hidden />;

  if (state === "none") {
    return (
      <>
        <Button
          disabled={working}
          aria-label={`Add ${name} as a friend`}
          onClick={() =>
            void transition("outgoing", () => sendRequest(personId))
          }
        >
          {working ? spinner : <UserRoundPlus className="size-4" aria-hidden />}
          Add friend
        </Button>
        {notice}
      </>
    );
  }

  if (state === "incoming") {
    return (
      <>
        <Button
          disabled={working}
          aria-label={`Accept the friend request from ${name}`}
          onClick={() =>
            void transition("friends", () => acceptRequest(personId))
          }
        >
          {working ? spinner : <Check className="size-4" aria-hidden />}
          Accept request
        </Button>
        {/* Ignoring is the same quiet delete as cancelling: their edge simply
            stops existing, and nobody is told which word you used. */}
        <Button
          variant="ghost"
          disabled={working}
          aria-label={`Ignore the friend request from ${name}`}
          onClick={() => void transition("none", () => removeEdge(personId))}
        >
          Ignore
        </Button>
        {notice}
      </>
    );
  }

  const accepted = state === "friends";
  return (
    <>
      <Button
        variant="secondary"
        disabled={working}
        aria-expanded={asking}
        aria-controls={asking ? panelId : undefined}
        aria-label={
          accepted
            ? `Friends with ${name}`
            : `Friend request sent to ${name}`
        }
        onClick={() => {
          setError(null);
          setAsking((open) => !open);
        }}
      >
        {working ? (
          spinner
        ) : accepted ? (
          <UserRoundCheck className="size-4" aria-hidden />
        ) : (
          <Clock className="size-4" aria-hidden />
        )}
        {accepted ? "Friends" : "Request sent"}
      </Button>

      {asking ? (
        <div
          id={panelId}
          role="group"
          aria-label={accepted ? `Friends with ${name}` : `Request sent to ${name}`}
          onKeyDown={(event) => {
            if (event.key === "Escape") setAsking(false);
          }}
          className="w-full max-w-sm animate-scale-in rounded-card border border-border bg-surface p-4 text-left shadow-soft"
        >
          <p className="text-sm text-muted text-pretty">
            {accepted
              ? `You and ${name} are friends. Removing them is quiet: they aren't told, and you can always ask again.`
              : `You've asked ${name} and they haven't answered yet. Cancelling quietly takes the ask back.`}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="danger-ghost"
              size="sm"
              disabled={working}
              onClick={() =>
                void transition("none", () => removeEdge(personId))
              }
            >
              <UserRoundX className="size-4" aria-hidden />
              {accepted ? "Remove friend" : "Cancel request"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={working}
              onClick={() => setAsking(false)}
            >
              Never mind
            </Button>
          </div>
        </div>
      ) : null}
      {notice}
    </>
  );
}

/** What `reports.reason` will take: 1–500 characters, per its check constraint. */
const REASON_MAX = 500;

/**
 * Report this person, from their profile.
 *
 * @param personId `profiles.id` of whoever the page is about. Never the
 *   viewer's own: the page doesn't render this on your own profile, and
 *   `reportProfile` refuses it besides.
 * @param name What to call them out loud. A private profile withholds the
 *   display name, so the caller passes the handle instead. The panel has to
 *   name the person the viewer can actually see.
 */
export function ReportPersonButton({
  personId,
  name,
}: {
  personId: string;
  name: string;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [detail, setDetail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  /* Nothing closes the panel while a report is in flight. On a slow network
     the answer, sent or failed, has to land somewhere the reporter is still
     looking. What they picked and typed stays put when it does close, so
     reopening picks up where they left off rather than starting again. */
  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }

  async function handleSubmit() {
    if (pending) return;
    if (category === null) {
      setError("Pick the category that fits best.");
      return;
    }
    setPending(true);
    setError(null);
    /* `reports.reason` is not nullable, and a student who picked a category
       and had nothing to add has still said something. The category's own
       words stand in rather than blocking the report on a second field. */
    const words = detail.trim();
    /* A server action is an HTTP POST, so offline or a 500 REJECTS rather
       than resolving `{ error }`. Unhandled, that rejection would skip
       setPending(false) and leave the panel stuck on "Sending…", with
       Cancel, Escape and the trigger all guarded on `pending` and therefore
       dead with it. */
    let failure: string | undefined;
    try {
      const result = await reportProfile(
        personId,
        category,
        words.length > 0 ? words : categoryLabel(category)
      );
      failure = result.error;
    } catch {
      failure = "Couldn't send that report. Check your connection and try again.";
    } finally {
      setPending(false);
    }
    if (failure) {
      setError(failure);
      return;
    }
    setOpen(false);
    setCategory(null);
    setDetail("");
    setSent(true);
  }

  return (
    <>
      <Button
        variant="secondary"
        aria-expanded={open}
        aria-controls={open ? `${uid}-panel` : undefined}
        aria-label={`Report ${name}`}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          setError(null);
          setSent(false);
          setOpen(true);
        }}
      >
        <Flag className="size-4" aria-hidden />
        Report
      </Button>

      {/* Full-width so it lands on its own line in the caller's wrapping row,
          the same way the block confirmation does. */}
      {sent ? (
        <p
          role="status"
          className="w-full text-sm font-medium text-success text-pretty"
        >
          Report sent. A person reads it, usually within a day. You won&apos;t hear
          back about what we decide, and {name} isn&apos;t told you reported
          them.
        </p>
      ) : null}

      {open ? (
        <div
          id={`${uid}-panel`}
          role="group"
          aria-labelledby={`${uid}-title`}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
          className="w-full max-w-sm animate-scale-in rounded-card border border-border bg-surface p-4 text-left shadow-soft"
        >
          <p id={`${uid}-title`} className="text-sm font-semibold">
            Report {name}
          </p>
          <p className="mt-1 text-sm text-muted text-pretty">
            Reports are private. They won&apos;t know it was you. A person
            reads every one, usually within a day. This one is about {name}, not
            about a single message; to report something they said, use the flag
            on the message itself.
          </p>

          <p
            id={`${uid}-category`}
            className="mt-4 text-[11px] font-bold uppercase tracking-widest text-muted"
          >
            What&apos;s going on?
          </p>
          <div
            role="radiogroup"
            aria-labelledby={`${uid}-category`}
            className="mt-2 flex flex-wrap gap-1.5"
          >
            {REPORT_CATEGORIES.map((value) => {
              const selected = category === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setCategory(value);
                    setError(null);
                  }}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-full border px-3.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
                    selected
                      ? "border-brand-ink bg-brand-soft text-brand-ink"
                      : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
                  )}
                >
                  {categoryLabel(value)}
                </button>
              );
            })}
          </div>

          <label
            htmlFor={`${uid}-detail`}
            className="mt-4 block text-xs font-medium text-muted"
          >
            Anything to add? Optional.
          </label>
          <textarea
            id={`${uid}-detail`}
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            rows={3}
            maxLength={REASON_MAX}
            placeholder="What's been happening? A sentence or two is plenty."
            className="mt-1 w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted/70 focus:border-brand focus:ring-[3px] focus:ring-brand/15"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void handleSubmit()}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Flag className="size-4" aria-hidden />
              )}
              {pending ? "Sending…" : "Send report"}
            </Button>
            <Button variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
