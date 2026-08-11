"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  CloudOff,
  Loader2,
  Megaphone,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  Button,
  Card,
  Input,
  Label,
  SectionHeader,
  Textarea,
} from "@/components/ui";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  ANNOUNCEMENTS_PREVIEW,
  ClubAnnouncementError,
  canDeleteAnnouncement,
  deleteAnnouncement,
  postAnnouncement,
  type ClubAnnouncement,
} from "@/lib/club-announcements";

/* The club's board — officers writing to the whole club at once.
 *
 * One title, one body, one notification each: that last part is the reason
 * this exists instead of a pinned chat message, and the reason the line above
 * the composer says so out loud before anyone starts typing.
 *
 * Members read; officers and owners write; only an author can take their own
 * post back down. All three rules are RLS policies from migration 0028 — the
 * predicates in `@/lib/club-announcements` are the client-side twins, so a
 * button never offers something the database will refuse. */

/** Start warning about the cap this late — earlier is just nagging. */
const COUNT_VISIBLE_FROM = 1800;

/** How long the "posted" note sits there before it bows out. */
const CONFIRM_MS = 4000;

/** "Just now", "12m ago", "3d ago", then a plain date. */
function timeAgo(iso: string): string {
  const then = new Date(iso);
  const minutes = Math.floor((Date.now() - then.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * One notice on the board: headline, the notice itself, and who posted when.
 * Your own posts carry a delete — everyone else's are quiet text, because
 * only an author can take one down. The confirm opens in the row rather than
 * over the page: it names the consequence, and "Keep it" is the way out.
 */
function AnnouncementRow({
  post,
  first,
  mine,
  confirming,
  onAskDelete,
  onConfirmDelete,
  onKeep,
}: {
  post: ClubAnnouncement;
  first: boolean;
  mine: boolean;
  confirming: boolean;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onKeep: () => void;
}) {
  // A post outlives its author's account — the byline degrades, the notice
  // stays, because the club still needs to have read it.
  const who = post.author?.display_name ?? "A past officer";

  return (
    <li className={first ? "px-4 py-3.5" : "border-t border-border px-4 py-3.5"}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-pretty">{post.title}</p>
          <p className="mt-1 whitespace-pre-line text-sm text-muted text-pretty">
            {post.body}
          </p>
          <p className="mt-1.5 truncate text-xs text-muted">
            {who} · {timeAgo(post.created_at)}
          </p>
        </div>
        {mine && !confirming ? (
          <button
            type="button"
            onClick={onAskDelete}
            aria-label={`Delete "${post.title}"`}
            title="Delete"
            className="-mr-1 flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {confirming ? (
        <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5">
          <p className="text-xs text-muted text-pretty">
            It comes off the club&apos;s board for everyone. Notifications that
            already went out stay where they are.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button variant="danger" size="sm" onClick={onConfirmDelete}>
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={onKeep}>
              Keep it
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The announcements board on a club page: the three most recent notices, an
 * officer-only composer, and the author's own delete. Posting waits for the
 * row (so the board never shows something RLS refused); deleting is
 * optimistic and rolls back with a warm line.
 */
export function AnnouncementsSection({
  clubId,
  clubName,
  myId,
  canPost,
  initialAnnouncements,
  initialError,
}: {
  clubId: string;
  clubName: string;
  /** The viewer's `profiles.id` — decides which posts offer a delete. */
  myId: string;
  /** True for officers and owners, from `canPostAnnouncements`. */
  canPost: boolean;
  initialAnnouncements: ClubAnnouncement[];
  initialError: string | null;
}) {
  const [posts, setPosts] = useState<ClubAnnouncement[]>(initialAnnouncements);

  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);

  const openComposer = useCallback(() => {
    setPosted(false);
    setFormError(null);
    setComposing(true);
  }, []);

  // The confirmation gets a beat to be read, then gets out of the way.
  useEffect(() => {
    if (!posted) return;
    const timer = setTimeout(() => setPosted(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [posted]);

  const closeComposer = useCallback(() => {
    setComposing(false);
    setTitle("");
    setBody("");
    setFormError(null);
  }, []);

  /** Post to everyone. Not optimistic: the board waits for the real row. */
  const handlePost = useCallback(async () => {
    if (pending) return;
    setFormError(null);
    setPending(true);
    try {
      const created = await postAnnouncement({ clubId, title, body });
      setPosts((prev) => [created, ...prev].slice(0, ANNOUNCEMENTS_PREVIEW));
      setComposing(false);
      setTitle("");
      setBody("");
      setPosted(true);
    } catch (caught) {
      setFormError(
        caught instanceof ClubAnnouncementError
          ? caught.message
          : "We couldn't post that just now. Give it another go."
      );
    } finally {
      setPending(false);
    }
  }, [pending, clubId, title, body]);

  /**
   * Take a post down. Optimistic: the notice leaves the board immediately and
   * comes back with a warm note if the delete doesn't land.
   */
  const removePost = useCallback(
    (post: ClubAnnouncement) => {
      const previous = posts;
      setPostError(null);
      setConfirmingId(null);
      setPosts(previous.filter((row) => row.id !== post.id));
      void deleteAnnouncement(post.id).catch((caught: unknown) => {
        setPosts(previous);
        setPostError(
          caught instanceof ClubAnnouncementError
            ? caught.message
            : "We couldn't take that post down. Give it another go."
        );
      });
    },
    [posts]
  );

  const remaining = ANNOUNCEMENT_BODY_MAX - body.length;
  const showCount = body.length > COUNT_VISIBLE_FROM;
  const canSubmit = title.trim().length > 0 && body.trim().length > 0;

  return (
    <section className="mt-8" aria-label="Announcements">
      <SectionHeader title="Announcements" />

      {canPost && !composing ? (
        <div className="mt-3 flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={openComposer}>
            <Megaphone className="size-4" aria-hidden />
            Post
          </Button>
          {posted ? (
            <p className="text-xs font-medium text-accent" aria-live="polite">
              Posted — the club has it.
            </p>
          ) : null}
        </div>
      ) : null}

      {composing ? (
        <Card className="mt-3 animate-fade-up">
          <h3 className="font-bold tracking-tight">Post to {clubName}</h3>
          <p className="mt-1 text-sm text-muted text-pretty">
            Everyone in the club gets this once, in their notifications.
          </p>
          <form
            className="mt-4 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void handlePost();
            }}
          >
            <div>
              <Label htmlFor="announcement-title">Title</Label>
              <Input
                id="announcement-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (formError) setFormError(null);
                }}
                placeholder="Officer elections are Thursday"
                maxLength={ANNOUNCEMENT_TITLE_MAX}
                disabled={pending}
                autoFocus
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="announcement-body">What&apos;s happening</Label>
              <Textarea
                id="announcement-body"
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  if (formError) setFormError(null);
                }}
                placeholder="Where, when, and what to bring."
                maxLength={ANNOUNCEMENT_BODY_MAX}
                disabled={pending}
                className="mt-1.5 min-h-32"
              />
              {showCount ? (
                remaining > 0 ? (
                  <p className="mt-1.5 text-right text-xs text-muted">
                    {remaining} characters left
                  </p>
                ) : (
                  <p className="mt-1.5 text-right text-xs font-medium text-danger">
                    That&apos;s the full {ANNOUNCEMENT_BODY_MAX} characters —
                    trim something to add more.
                  </p>
                )
              ) : null}
            </div>

            {formError ? (
              <p role="alert" className="text-xs font-medium text-danger">
                {formError}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending || !canSubmit}>
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="size-4" aria-hidden />
                )}
                {pending ? "Posting…" : "Post to everyone"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={closeComposer}
              >
                <X className="size-4" aria-hidden />
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {postError ? (
        <p role="alert" className="mt-3 text-xs font-medium text-danger">
          {postError}
        </p>
      ) : null}

      {posts.length > 0 ? (
        <ul className="mt-3 overflow-hidden rounded-card border border-border bg-surface shadow-soft">
          {posts.map((post, index) => (
            <AnnouncementRow
              key={post.id}
              post={post}
              first={index === 0}
              mine={canDeleteAnnouncement(post, myId)}
              confirming={confirmingId === post.id}
              onAskDelete={() => {
                setPostError(null);
                setConfirmingId(post.id);
              }}
              onConfirmDelete={() => removePost(post)}
              onKeep={() => setConfirmingId(null)}
            />
          ))}
        </ul>
      ) : initialError ? (
        <Card className="mt-3 flex flex-col items-center gap-2.5 text-center">
          <CloudOff className="size-5 text-muted" aria-hidden />
          <p className="max-w-xs text-sm text-muted text-pretty">
            {initialError}
          </p>
        </Card>
      ) : (
        <div className="mt-3 rounded-card border border-dashed border-border">
          <EmptyState
            icon={Bell}
            title={canPost ? "Nothing posted yet" : "No announcements yet"}
            description={
              canPost
                ? "Tell the club what is happening — everyone gets it once, in their notifications."
                : "When an officer posts, it lands here and in your notifications."
            }
            action={
              canPost && !composing ? (
                <Button variant="soft" size="sm" onClick={openComposer}>
                  Write the first one
                </Button>
              ) : undefined
            }
            className="py-10"
          />
        </div>
      )}
    </section>
  );
}
