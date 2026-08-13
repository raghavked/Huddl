"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import {
  Check,
  CheckCircle2,
  CloudOff,
  Loader2,
  Lock,
  MessageCircle,
  Pencil,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { GatheringScene } from "@/components/illustrations";
import {
  Badge,
  Button,
  Card,
  Label,
  SectionHeader,
  Textarea,
  cardClasses,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import {
  BUDDY_NOTE_MAX,
  StudyBuddyError,
  buddyDetail,
  fetchBuddies,
  fetchMyOptIn,
  optIn,
  optOut,
  type MyOptIn,
  type StudyBuddy,
} from "@/lib/study-buddy";

/* Study partners: one course's who's-looking list.
 *
 * Two halves, stacked. Up top is the student's own state: an invitation to
 * put their name up, or (once they have) a fern-toned card holding the note
 * their classmates can read, with a way to change it and a way to step out.
 * Below is everyone else, newest first, their own row lifted to the top by
 * `@/lib/study-buddy`.
 *
 * Every write here is optimistic. Opting in adds the row and flips the card
 * before the round trip; opting out takes it away instantly, which is what
 * the privacy line at the bottom promises. A refusal puts everything back
 * exactly as it was and explains itself in one warm line. */

/** Just enough of my own profile to draw my row before the refetch lands. */
export type MyProfile = {
  handle: string;
  display_name: string;
  avatar_url: string | null;
  major: string | null;
  grad_year: number | null;
};

/** How few characters have to be left before the counter earns its place. */
const COUNTER_FROM = 40;

/* ------------------------------ small parts ----------------------------- */

/** One warm line of red under a card or a form. */
function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs font-medium text-danger">
      {message}
    </p>
  );
}

/**
 * The closing promise, stated plainly once. Fern-soft rather than ember:
 * this is reassurance about a mechanism, not a warning.
 */
function PrivacyLine() {
  return (
    <p className="mt-6 flex items-start gap-2.5 rounded-xl bg-accent-soft px-3 py-3 text-xs leading-relaxed text-foreground">
      <Lock className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
      Only people in this class can see this list, and stepping out removes you
      instantly.
    </p>
  );
}

/**
 * One classmate: who they are, how they like to study, and the way to say
 * hello. My own row carries a "You" badge instead of a button, so I can see
 * exactly what my classmates see.
 */
function BuddyRow({
  buddy,
  messaging,
  disabled,
  errorText,
  onMessage,
}: {
  buddy: StudyBuddy;
  messaging: boolean;
  disabled: boolean;
  errorText: string | null;
  onMessage: () => void;
}) {
  const detail = buddyDetail(buddy);

  return (
    <li className={cardClasses({ padding: "sm", className: "flex flex-col gap-2.5" })}>
      <div className="flex items-center gap-3">
        <Link
          href={`/u/${buddy.handle}`}
          aria-label={`Open ${buddy.display_name}'s profile`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <Avatar name={buddy.display_name} src={buddy.avatar_url} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {buddy.display_name}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted">
              {detail ?? `@${buddy.handle}`}
            </span>
          </span>
        </Link>

        {buddy.is_me ? (
          <Badge tone="brand">You</Badge>
        ) : (
          <Button
            variant="soft"
            size="sm"
            disabled={disabled || messaging}
            aria-label={`Message ${buddy.display_name}`}
            onClick={onMessage}
          >
            {messaging ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <MessageCircle className="size-3.5" aria-hidden />
            )}
            Message
          </Button>
        )}
      </div>

      {buddy.note ? (
        <p className="text-sm break-words text-pretty">{buddy.note}</p>
      ) : null}
      <InlineError message={errorText} />
    </li>
  );
}

/* -------------------------------- helpers ------------------------------- */

/** A `StudyBuddyError` already reads like a person wrote it; nothing else does. */
function messageFor(caught: unknown, fallback: string): string {
  return caught instanceof StudyBuddyError ? caught.message : fallback;
}

/** A raw error message off anything shaped like an error, for matching only. */
function rawMessage(caught: unknown): string {
  if (typeof caught === "object" && caught !== null) {
    const message = (caught as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/* ------------------------------- section -------------------------------- */

/**
 * The whole study-partner page below its title: your own opt-in card, the
 * classmate list with a way to open a DM, and the privacy line that closes
 * it. Everything here is optimistic and rolls back on a refusal.
 */
export function BuddiesSection({
  courseId,
  courseCode,
  userId,
  myProfile,
  initialBuddies,
  initialOptIn,
  initialError,
}: {
  courseId: string;
  /** e.g. "ECS 36A": the class this list belongs to. */
  courseCode: string;
  /** The viewer's `profiles.id`, so an optimistic row is a real row. */
  userId: string;
  myProfile: MyProfile;
  initialBuddies: StudyBuddy[];
  initialOptIn: MyOptIn | null;
  initialError: string | null;
}) {
  const router = useRouter();

  const [buddies, setBuddies] = useState<StudyBuddy[]>(initialBuddies);
  const [mine, setMine] = useState<MyOptIn | null>(initialOptIn);
  const [error, setError] = useState<string | null>(initialError);
  const [reloading, setReloading] = useState(false);

  // The note composer. `editing` only matters once I'm already on the list;
  // before that the composer is the invitation itself.
  const [noteDraft, setNoteDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [messagingId, setMessagingId] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<{
    userId: string;
    text: string;
  } | null>(null);

  /** The retry behind the error state, and the way back from a stale list. */
  const reload = useCallback(async () => {
    setReloading(true);
    try {
      const [list, optin] = await Promise.all([
        fetchBuddies(courseId),
        fetchMyOptIn(courseId),
      ]);
      setBuddies(list);
      setMine(optin);
      setError(null);
    } catch (caught) {
      setError(
        messageFor(
          caught,
          "We couldn't load who's looking for a study partner. Give it another go."
        )
      );
    } finally {
      setReloading(false);
    }
  }, [courseId]);

  /** My row as classmates would see it, for the optimistic insert. */
  const buildMyRow = useCallback(
    (note: string | null, createdAt: string): StudyBuddy => ({
      user_id: userId,
      course_id: courseId,
      note,
      created_at: createdAt,
      handle: myProfile.handle,
      display_name: myProfile.display_name,
      avatar_url: myProfile.avatar_url,
      major: myProfile.major,
      grad_year: myProfile.grad_year,
      is_me: true,
    }),
    [courseId, userId, myProfile]
  );

  /**
   * Put my name up, or save an edited note: the same upsert either way. The
   * card flips and the row lands before the request goes out; a refusal puts
   * both back and reopens the composer with the text still in it.
   */
  const handleSave = useCallback(async () => {
    if (saving) return;
    const trimmed = noteDraft.trim();
    if (trimmed.length > BUDDY_NOTE_MAX) {
      setActionError(
        `Keep your note to ${BUDDY_NOTE_MAX} characters. Say when you study and where.`
      );
      return;
    }

    const previousMine = mine;
    const previousBuddies = buddies;
    const note = trimmed.length > 0 ? trimmed : null;
    const createdAt = previousMine?.created_at ?? new Date().toISOString();

    setActionError(null);
    setSaving(true);
    setEditing(false);
    setMine({ course_id: courseId, note, created_at: createdAt });
    setBuddies([
      buildMyRow(note, createdAt),
      ...previousBuddies.filter((b) => !b.is_me),
    ]);

    try {
      const saved = await optIn(courseId, note);
      setMine(saved);
      setNoteDraft("");
    } catch (caught) {
      setMine(previousMine);
      setBuddies(previousBuddies);
      setEditing(true);
      setActionError(
        messageFor(
          caught,
          "We couldn't add you to that list just now. Give it another go."
        )
      );
    } finally {
      setSaving(false);
    }
  }, [saving, noteDraft, mine, buddies, courseId, buildMyRow]);

  /** Take my name back down. The row leaves first, as the privacy line says. */
  const handleOptOut = useCallback(async () => {
    if (saving) return;
    const previousMine = mine;
    const previousBuddies = buddies;

    setActionError(null);
    setSaving(true);
    setEditing(false);
    setMine(null);
    setBuddies(previousBuddies.filter((b) => !b.is_me));

    try {
      await optOut(courseId);
      setNoteDraft("");
    } catch (caught) {
      setMine(previousMine);
      setBuddies(previousBuddies);
      setActionError(
        messageFor(
          caught,
          "We couldn't take your name down just now. Give it another go."
        )
      );
    } finally {
      setSaving(false);
    }
  }, [saving, mine, buddies, courseId]);

  /**
   * Open the 1:1 thread with a classmate. `create_dm_thread` is find-or-create
   * on the server (and since 0028 it skips group threads), so one call covers
   * both "we've talked before" and "we haven't".
   */
  const handleMessage = useCallback(
    async (buddy: StudyBuddy) => {
      if (messagingId) return;
      setMessageError(null);
      setMessagingId(buddy.user_id);
      try {
        const { data, error: rpcError } = await createClient().rpc(
          "create_dm_thread",
          { other_user: buddy.user_id }
        );
        const threadId = typeof data === "string" ? data : null;
        if (rpcError || !threadId) throw rpcError ?? new Error("No thread");
        router.push(`/messages/${threadId}`);
      } catch (caught) {
        setMessageError({
          userId: buddy.user_id,
          text: rawMessage(caught).includes("message this person")
            ? "You two can't message each other."
            : "We couldn't open that conversation. Give it another go.",
        });
        setMessagingId(null);
      }
    },
    [messagingId, router]
  );

  /* ------------------------------- render ------------------------------- */

  // Nothing loaded and nothing of mine: the whole section is the error.
  if (error && buddies.length === 0 && mine === null) {
    return (
      <div className="mt-6 flex flex-col items-center gap-2.5 px-6 py-16 text-center">
        <CloudOff className="size-7 text-muted" aria-hidden />
        <p className="font-bold tracking-tight">
          The study partner list didn&apos;t load
        </p>
        <p className="max-w-xs text-sm text-muted text-pretty">
          {error} Check your connection and give it another go.
        </p>
        <Button
          variant="soft"
          size="sm"
          disabled={reloading}
          onClick={() => void reload()}
          className="mt-1"
        >
          {reloading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : null}
          Try again
        </Button>
      </div>
    );
  }

  const remaining = BUDDY_NOTE_MAX - noteDraft.length;
  const others = buddies.filter((buddy) => !buddy.is_me);
  const composerOpen = mine === null || editing;

  /* The composer: the invitation when I'm not on the list, and the same
     field again when I'm editing the note that's already up there. */
  const composer = (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSave();
      }}
    >
      <div>
        <Label htmlFor="buddy-note">How you like to study (optional)</Label>
        <Textarea
          id="buddy-note"
          value={noteDraft}
          onChange={(e) => {
            setNoteDraft(e.target.value);
            if (actionError) setActionError(null);
          }}
          placeholder="Weeknights at the library, mostly problem sets"
          maxLength={BUDDY_NOTE_MAX}
          disabled={saving}
          className="mt-1.5 min-h-20"
        />
      </div>
      {remaining <= COUNTER_FROM ? (
        <p className="self-end text-xs text-muted">
          {remaining} character{remaining === 1 ? "" : "s"} left
        </p>
      ) : null}
      <InlineError message={actionError} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : mine === null ? (
            <UserPlus className="size-4" aria-hidden />
          ) : (
            <Check className="size-4" aria-hidden />
          )}
          {mine === null ? "I'm looking" : "Save note"}
        </Button>
        {mine === null ? null : (
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={() => {
              setEditing(false);
              setNoteDraft("");
              setActionError(null);
            }}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );

  /* Writing keeps the plain paper card. A tinted surface can't carry muted
     helper text, and the fern is for the settled state, not the draft. */
  const myStateCard = composerOpen ? (
    <Card className="animate-fade-up">
      <h2 className="font-bold tracking-tight text-balance">
        {mine === null
          ? "Looking for someone to work through this with?"
          : "Your note"}
      </h2>
      <p className="mt-1.5 text-sm text-muted text-pretty">
        {mine === null
          ? `Put your name up and everyone in ${courseCode} sees it here. Take it down whenever you like.`
          : "Say when you study and where. That gets more replies than a friendly hello."}
      </p>
      <div className="mt-4">{composer}</div>
    </Card>
  ) : (
    <Card className="animate-fade-up border-accent/30 bg-accent-soft">
      <h2 className="flex items-center gap-2 font-bold tracking-tight">
        <CheckCircle2 className="size-4 text-accent" aria-hidden />
        You&apos;re on the list
      </h2>
      {mine?.note ? (
        <p className="mt-2 text-sm leading-relaxed break-words text-pretty">
          {mine.note}
        </p>
      ) : (
        <p className="mt-2 text-sm text-accent">
          You didn&apos;t leave a note. Classmates will just see your name.
        </p>
      )}
      <div className="mt-2">
        <InlineError message={actionError} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={saving}
          onClick={() => {
            setActionError(null);
            setNoteDraft(mine?.note ?? "");
            setEditing(true);
          }}
        >
          <Pencil className="size-3.5" aria-hidden />
          Edit note
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={saving}
          onClick={() => void handleOptOut()}
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <X className="size-3.5" aria-hidden />
          )}
          Take my name down
        </Button>
      </div>
    </Card>
  );

  return (
    <div>
      {error ? (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2"
        >
          <p className="min-w-0 text-xs font-medium text-danger">{error}</p>
          <Button
            variant="soft"
            size="sm"
            disabled={reloading}
            onClick={() => void reload()}
          >
            {reloading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : null}
            Try again
          </Button>
        </div>
      ) : null}

      {myStateCard}

      <section className="mt-8" aria-label="Who's looking">
        <SectionHeader title="Who's looking" />

        {buddies.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2.5">
            {buddies.map((buddy) => (
              <BuddyRow
                key={buddy.user_id}
                buddy={buddy}
                messaging={messagingId === buddy.user_id}
                disabled={messagingId !== null && messagingId !== buddy.user_id}
                errorText={
                  messageError?.userId === buddy.user_id
                    ? messageError.text
                    : null
                }
                onMessage={() => void handleMessage(buddy)}
              />
            ))}
          </ul>
        ) : null}

        {others.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-border">
            <EmptyState
              illustration={mine === null ? <GatheringScene /> : undefined}
              icon={UsersRound}
              title={
                mine === null
                  ? "Nobody has raised a hand yet"
                  : "You're the first one up"
              }
              description={
                mine === null
                  ? "Be first, and your classmates will see you here."
                  : `Your name is up. The next person in ${courseCode} who comes looking will find you.`
              }
              className={mine === null ? undefined : "py-10"}
            />
          </div>
        ) : null}
      </section>

      <PrivacyLine />
    </div>
  );
}
