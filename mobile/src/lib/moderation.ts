import {
  asBoardCategory,
  categoryInfo,
  type BoardCategory,
} from "@/lib/board";
import { roomTitle } from "@/lib/room-identity";
import { supabase } from "@/lib/supabase";

/* The moderation queue: the data layer.
 *
 * Reports have existed since migration 0015: a student flags a message, a
 * classmate, or (since 0034) a post on the campus board, and (since 0070) a
 * community post or a comment under one, and the row lands in
 * `public.reports` with a category, a reason in their own words, and a status
 * of `open`. What 0015 did NOT give anyone was a way to act on one. Triage
 * lived with the service role, so the queue filled up and nothing emptied it.
 *
 * Migration 0034 gives it a front door. It adds `profiles.is_moderator`, the
 * `is_moderator()` helper, and two policies:
 *
 *   select  public.is_moderator()   lets a moderator read the whole queue
 *   update  public.is_moderator()   lets them move a report's status
 *
 * (The reporter-scoped policies from 0015 are still there, so a student can
 * always see the reports they filed themselves.) `is_moderator` is deliberately
 * missing from the `authenticated` update grant, so nobody can hand themselves
 * the badge. {@link amIModerator} is a read, never a claim.
 *
 * THE JOINS ARE ALL NULLABLE, AND THAT IS THE POINT. A report keeps its
 * subject long after the subject stops being readable:
 *
 *   · `message_id` and `board_post_id` are `on delete set null`, so a
 *     hard-deleted subject leaves the report standing with nothing attached.
 *   · Messages are readable only to members of their channel
 *     (`is_channel_member`), and moderators get no exemption, so a report
 *     about a channel you never joined arrives with `message: null` even though the
 *     message is alive and well.
 *   · A message the author "deleted" is a soft delete: `deleted_at` is stamped
 *     and the content stays. Moderation is exactly the place that should still
 *     read it, so this module hands the content over and flags the deletion.
 *
 * So every screen has to be able to say "this isn't here" instead of drawing a
 * blank card. {@link reportSubject} decides which of those cases a report is
 * in, once, and hands back either the thing itself or a sentence explaining
 * where it went, so the row's title, its quoted well, and its tap target can
 * never disagree with each other.
 *
 * No React, no theme, no navigation in here: queries, narrowing, and pure
 * helpers that take `now` as an argument so a ticking screen and a unit test
 * get the same answers. Failures arrive as a {@link ModerationError} whose
 * message is warm, specific, and safe to drop straight into an inline error.
 */

/* ═══════════════════════════ the vocabulary ══════════════════════════ */

/**
 * Where a report sits in triage, exactly as `reports.status` stores it.
 * `open` is where every report starts; the other two are both endings, and
 * the difference between them is only ever "did this need doing something
 * about". Neither is a punishment and neither is permanent. {@link setStatus}
 * moves a report in any direction.
 */
export type ReportStatus = "open" | "reviewed" | "dismissed";

/** The three queues, in the order the filter chips render them. */
export const STATUSES: readonly ReportStatus[] = [
  "open",
  "reviewed",
  "dismissed",
];

/**
 * What the reporter picked from the list on the report screen, exactly as
 * `reports.category` stores it (0020). `other` is the column default, so an
 * unrecognised value reads as `other` rather than as a broken row.
 */
export type ReportCategory =
  | "harassment"
  | "spam"
  | "hate"
  | "impersonation"
  | "sexual_content"
  | "self_harm"
  | "academic_dishonesty"
  | "other";

/* The reporter picks these words on `src/app/report.tsx`; a moderator has to
   read the same words back or the two screens are describing different
   things. Kept in step with that list by hand: if a category is added to the
   check constraint, it goes in both places. */
const CATEGORY_LABELS: Record<ReportCategory, string> = {
  harassment: "Harassment or bullying",
  spam: "Spam",
  hate: "Hate or discrimination",
  impersonation: "Impersonation",
  sexual_content: "Sexual content",
  self_harm: "Self-harm concern",
  academic_dishonesty: "Academic dishonesty",
  other: "Something else",
};

/* ══════════════════════════════ shapes ═══════════════════════════════ */

/** Just enough of a person to draw an avatar and a name beside it. */
export type ReportPerson = {
  /** `profiles.id`. */
  id: string;
  /** Their handle, without the leading `@`. This is what `/u/<handle>` takes. */
  handle: string;
  /** Their display name, falling back to their handle if it's somehow blank. */
  display_name: string;
  /** Their avatar, or null. Fall back to initials via `@/components/avatar`. */
  avatar_url: string | null;
};

/**
 * The reported student. Same as {@link ReportPerson} plus their bio, because
 * on a profile report the bio is usually the thing being reported.
 */
export type ReportedProfile = ReportPerson & {
  /** Their bio, or null. On a profile report, read this before deciding. */
  bio: string | null;
};

/** The room a reported message was said in. */
export type ReportedChannel = {
  /** `channels.id`. Push `/channel/<id>` with it. */
  id: string;
  /** The room's display name through `roomTitle`, e.g. "MAT 21A discussion". */
  name: string;
  /** The room's slug, e.g. `mat-21a`. An id for links, never copy. */
  slug: string;
};

/** A reported message, with the room it was said in when that's readable. */
export type ReportedMessage = {
  /** `messages.id`. */
  id: string;
  /** What was actually said. Never truncated on the way through here. */
  content: string;
  /** ISO timestamp it was posted. */
  created_at: string;
  /**
   * Set if the author has taken it down since. The content is still here: a
   * soft delete hides a message from the room, not from triage.
   */
  deleted_at: string | null;
  /** Its channel, or null when the row isn't readable from here. */
  channel: ReportedChannel | null;
};

/**
 * A reported post in a community feed (0070). Unlike a board post it can be
 * folded by downvotes (`hidden_at`) or taken down (`deleted_at`), and the
 * select policy admits moderators to both states on purpose: the queue is
 * exactly the place that should still read them.
 */
export type ReportedCommunityPost = {
  /** `community_posts.id`. */
  id: string;
  /** The community it lives in. The route needs both ids. */
  community_id: string;
  /** The headline. */
  title: string;
  /** The details, or null. */
  body: string | null;
  /** Set while the herd's downvotes have it folded. Still readable here. */
  hidden_at: string | null;
  /** Set once someone took it down. The content stays for triage. */
  deleted_at: string | null;
};

/**
 * A reported comment under a community post (0070). The community id rides
 * along through the comment's own post embed, because the route to look at a
 * comment in place is the post's screen.
 */
export type ReportedPostComment = {
  /** `post_comments.id`. */
  id: string;
  /** The post it sits under. */
  post_id: string;
  /** The community that post lives in, or null when the post isn't readable. */
  community_id: string | null;
  /** What was actually said. Never truncated on the way through here. */
  body: string;
  /** Set once someone took it down. The content stays for triage. */
  deleted_at: string | null;
};

/** A reported post on the campus board. */
export type ReportedBoardPost = {
  /** `board_posts.id`. Push `/board/<id>` with it. */
  id: string;
  /** The headline. */
  title: string;
  /** The details, or null. */
  body: string | null;
  /** Which board it's on, or null if it's a category this client can't draw. */
  category: BoardCategory | null;
  /** Set once the author marked it sorted. A closed post is still readable. */
  closed_at: string | null;
};

/**
 * One row of the queue, with everything a moderator needs to decide without
 * leaving the screen. Every join is nullable; see the module note.
 */
export type ModerationReport = {
  /** `reports.id`: your list key, and what {@link setStatus} takes. */
  id: string;
  /** Where it sits in triage right now. */
  status: ReportStatus;
  /** What the reporter said it was. */
  category: ReportCategory;
  /** The reporter's own words, 1-500 characters. Render it in full. */
  reason: string;
  /** ISO timestamp it was filed. The queue is newest-first. */
  created_at: string;
  /** Who filed it, or null if they've since deleted their account. */
  reporter: ReportPerson | null;
  /** The reported student, or null. Message reports set this too. */
  reported: ReportedProfile | null;
  /** The reported message, or null. See the module note before trusting it. */
  message: ReportedMessage | null;
  /** The reported board post, or null. */
  post: ReportedBoardPost | null;
  /**
   * The reported community post (0070), or null. Unlike a DM this one embeds:
   * the select policy admits moderators to hidden and removed rows, so the
   * queue reads the post straight from `community_posts`.
   */
  community_post: ReportedCommunityPost | null;
  /** The reported comment (0070), or null. Embeds for the same reason. */
  post_comment: ReportedPostComment | null;
  /** Raw `reports.message_id`. Non-null with a null `message` means unreadable. */
  message_id: string | null;
  /** Raw `reports.board_post_id`. Same story as `message_id`. */
  board_post_id: string | null;
  /** Raw `reports.community_post_id`. Same story again. */
  community_post_id: string | null;
  /** Raw `reports.post_comment_id`. Same story again. */
  post_comment_id: string | null;
  /**
   * Raw `reports.dm_message_id` (migration 0038). There is deliberately NO
   * embedded `dm_message` beside it: `dm_messages` is readable only to the
   * two people in the thread, and a moderator is by definition not one of
   * them. A reported DM resolves through {@link fetchReportedContent}, which
   * is the only path to those words and is scoped to this one report.
   */
  dm_message_id: string | null;
  /**
   * Raw `reports.club_announcement_id` (migration 0060), set by the slur
   * auto-flag when a club announcement trips it. Like a DM there is
   * deliberately NO embed beside it: the announcements table's RLS doesn't
   * open up for the queue, so the words come from
   * {@link fetchReportedContent}, one report at a time.
   */
  club_announcement_id: string | null;
  /** Raw `reports.reported_user_id`. */
  reported_user_id: string | null;
};

/**
 * What a report is actually about, resolved once so the title, the quoted
 * well, and the tap target can't drift apart.
 *
 * `gone` isn't a failure: it's the honest answer for a report whose
 * subject has been deleted, or whose message lives in a channel this
 * moderator never joined. Its `note` is a finished sentence: render it where
 * the quote would have gone.
 */
export type ReportSubject =
  | { kind: "message"; message: ReportedMessage }
  | { kind: "post"; post: ReportedBoardPost }
  | { kind: "community_post"; post: ReportedCommunityPost }
  | { kind: "comment"; comment: ReportedPostComment }
  | { kind: "profile"; profile: ReportedProfile }
  | {
      kind: "gone";
      /** What it used to point at, as far as the columns still say. */
      was:
        | "message"
        | "announcement"
        | "post"
        | "community_post"
        | "comment"
        | "profile"
        | "unknown";
      /** A finished sentence for the reader. Never a code, never blank. */
      note: string;
    };

/* ══════════════════════════════ limits ═══════════════════════════════ */

/**
 * Most rows one {@link fetchQueue} call will ever return, per status. A queue
 * deeper than this needs more moderators, not more scroll.
 */
export const QUEUE_LIMIT = 100;

/** Columns every queue query selects. Keep selects consistent. */
export const REPORT_SELECT =
  "id, status, category, reason, created_at, message_id, dm_message_id, club_announcement_id, board_post_id, community_post_id, post_comment_id, reported_user_id, " +
  // Two foreign keys point at `profiles`, so both embeds need naming.
  "reporter:profiles!reports_reporter_id_fkey(id, handle, display_name, avatar_url), " +
  "reported:profiles!reports_reported_user_id_fkey(id, handle, display_name, avatar_url, bio), " +
  "message:messages(id, content, created_at, deleted_at, channel:channels(id, name, slug)), " +
  "post:board_posts(id, title, body, category, closed_at), " +
  // Both community embeds are bare: one foreign key each, no naming needed.
  // The comment brings its post along for the community id the route wants.
  "community_post:community_posts(id, community_id, title, body, hidden_at, deleted_at), " +
  "post_comment:post_comments(id, post_id, body, deleted_at, post:community_posts(community_id))";

/* ═════════════════════════════ failures ══════════════════════════════ */

/**
 * A moderation failure with a message written for a person, not a log. Show
 * `err.message` directly in your inline error; it never leaks SQL, ids, or
 * PostgREST codes.
 */
export class ModerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModerationError";
  }
}

/* ════════════════════════════ narrowing ══════════════════════════════ */

/**
 * The Supabase client here is untyped, and PostgREST hands an embedded
 * relation back as an object OR a one-element array depending on how it
 * resolves the relationship (and as null when there's nothing to embed).
 * Unwrap every shape to a plain record. Same defence as
 * `@/features/mentions/use-mention-suggestions`, `@/lib/focus`, and
 * `@/lib/club-announcements`.
 */
function embedded(raw: unknown): Record<string, unknown> | null {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

/** A non-empty string, or null. The shape most of this file needs. */
function text(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** Narrow `reports.status`; anything unexpected reads as still open. */
function toStatus(raw: unknown): ReportStatus {
  if (raw === "reviewed" || raw === "dismissed") return raw;
  return "open";
}

/** Narrow `reports.category`; anything unexpected reads as `other`, like the column default. */
function toCategory(raw: unknown): ReportCategory {
  if (typeof raw !== "string") return "other";
  return Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, raw)
    ? (raw as ReportCategory)
    : "other";
}

/** Narrow an embedded `profiles` row; null when there's no usable person on it. */
function toPerson(raw: unknown): ReportPerson | null {
  const record = embedded(raw);
  if (!record) return null;
  const id = text(record["id"]);
  const handle = text(record["handle"]);
  if (id === null || handle === null) return null;
  return {
    id,
    handle,
    display_name: text(record["display_name"]) ?? handle,
    avatar_url: text(record["avatar_url"]),
  };
}

/** {@link toPerson} plus the bio, for the person a report is actually about. */
function toReportedProfile(raw: unknown): ReportedProfile | null {
  const person = toPerson(raw);
  if (!person) return null;
  const record = embedded(raw);
  return { ...person, bio: text(record?.["bio"]) };
}

/** Narrow an embedded `channels` row; null when it isn't readable. */
function toChannel(raw: unknown): ReportedChannel | null {
  const record = embedded(raw);
  if (!record) return null;
  const id = text(record["id"]);
  const slug = text(record["slug"]);
  if (id === null || slug === null) return null;
  return { id, name: roomTitle(text(record["name"]), slug), slug };
}

/**
 * Narrow an embedded `messages` row. A message with no content left in it is
 * dropped (there's nothing to moderate), but a soft-deleted one is kept,
 * `deleted_at` and all, because "they took it down after being reported" is
 * information a moderator wants.
 */
function toMessage(raw: unknown): ReportedMessage | null {
  const record = embedded(raw);
  if (!record) return null;
  const id = text(record["id"]);
  const content = text(record["content"]);
  const createdAt = text(record["created_at"]);
  if (id === null || content === null || createdAt === null) return null;
  return {
    id,
    content,
    created_at: createdAt,
    deleted_at: text(record["deleted_at"]),
    channel: toChannel(record["channel"]),
  };
}

/** Narrow an embedded `board_posts` row; null when it isn't readable. */
function toPost(raw: unknown): ReportedBoardPost | null {
  const record = embedded(raw);
  if (!record) return null;
  const id = text(record["id"]);
  const title = text(record["title"]);
  if (id === null || title === null) return null;
  return {
    id,
    title,
    body: text(record["body"]),
    category: asBoardCategory(record["category"]),
    closed_at: text(record["closed_at"]),
  };
}

/**
 * Narrow an embedded `community_posts` row; null when it isn't readable. A
 * folded or removed post is kept, stamps and all, for the same reason a
 * soft-deleted message is: what happened to it since is part of the story.
 */
function toCommunityPost(raw: unknown): ReportedCommunityPost | null {
  const record = embedded(raw);
  if (!record) return null;
  const id = text(record["id"]);
  const communityId = text(record["community_id"]);
  const title = text(record["title"]);
  if (id === null || communityId === null || title === null) return null;
  return {
    id,
    community_id: communityId,
    title,
    body: text(record["body"]),
    hidden_at: text(record["hidden_at"]),
    deleted_at: text(record["deleted_at"]),
  };
}

/** Narrow an embedded `post_comments` row; null when it isn't readable. */
function toPostComment(raw: unknown): ReportedPostComment | null {
  const record = embedded(raw);
  if (!record) return null;
  const id = text(record["id"]);
  const postId = text(record["post_id"]);
  const body = text(record["body"]);
  if (id === null || postId === null || body === null) return null;
  const post = embedded(record["post"]);
  return {
    id,
    post_id: postId,
    community_id: text(post?.["community_id"]),
    body,
    deleted_at: text(record["deleted_at"]),
  };
}

/**
 * Narrow one joined queue row. A report with no id, no reason, or no filing
 * time isn't a report we can render honestly, so it's dropped rather than
 * shown as a blank card. Everything else, every single join, is allowed to be
 * null.
 */
function toReport(raw: unknown): ModerationReport | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = text(record["id"]);
  const reason = text(record["reason"]);
  const createdAt = text(record["created_at"]);
  if (id === null || reason === null || createdAt === null) return null;
  return {
    id,
    status: toStatus(record["status"]),
    category: toCategory(record["category"]),
    reason,
    created_at: createdAt,
    reporter: toPerson(record["reporter"]),
    reported: toReportedProfile(record["reported"]),
    message: toMessage(record["message"]),
    post: toPost(record["post"]),
    community_post: toCommunityPost(record["community_post"]),
    post_comment: toPostComment(record["post_comment"]),
    message_id: text(record["message_id"]),
    board_post_id: text(record["board_post_id"]),
    community_post_id: text(record["community_post_id"]),
    post_comment_id: text(record["post_comment_id"]),
    dm_message_id: text(record["dm_message_id"]),
    club_announcement_id: text(record["club_announcement_id"]),
    reported_user_id: text(record["reported_user_id"]),
  };
}

/* ═══════════════════════════════ reads ═══════════════════════════════ */

/**
 * Whether the signed-in student is a campus moderator.
 *
 * This is a plain read of your own `profiles.is_moderator`, which the
 * `authenticated` update grant deliberately leaves out: the flag is set by an
 * admin through the service role and there is no way to write it from the app.
 * Call it before drawing the queue and show a warm "this one's not for you"
 * instead of letting RLS return an empty list that looks like a clear queue.
 *
 * A signed-out caller isn't a moderator: false, not an error.
 *
 * @throws {ModerationError} When the profile can't be read at all.
 */
export async function amIModerator(): Promise<boolean> {
  const { data: auth } = await supabase.auth.getSession();
  const userId = auth.session?.user.id;
  if (typeof userId !== "string" || userId.length === 0) return false;

  const { data, error } = await supabase
    .from("profiles")
    .select("is_moderator")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    throw new ModerationError(
      "We couldn't check your account just now. Give it another go."
    );
  }
  if (typeof data !== "object" || data === null) return false;
  return (data as Record<string, unknown>)["is_moderator"] === true;
}

/**
 * One status's worth of the queue, newest first, capped at
 * {@link QUEUE_LIMIT}, with the reporter, the reported student, the reported
 * message and its channel, and the reported board post all attached.
 *
 * Every one of those joins can come back null, and a null is never an error.
 * Read the module note, and hand each row to {@link reportSubject} rather than
 * testing the embeds yourself.
 *
 * RLS does the gatekeeping: a moderator gets the whole campus queue, and
 * anyone else gets only the reports they filed themselves. That second case is
 * why {@link amIModerator} exists: an ordinary student calling this doesn't
 * get an error, they get their own small pile, which would be a confusing
 * thing to render under the word "Reports".
 *
 * @param status Which pile to read: `open`, `reviewed`, or `dismissed`.
 * @throws {ModerationError} With copy that's ready to render.
 */
export async function fetchQueue(
  status: ReportStatus
): Promise<ModerationReport[]> {
  const { data, error } = await supabase
    .from("reports")
    .select(REPORT_SELECT)
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(QUEUE_LIMIT);
  if (error) {
    throw new ModerationError(
      "We couldn't load the queue. Check your connection and give it another go."
    );
  }
  if (!Array.isArray(data)) return [];

  const out: ModerationReport[] = [];
  for (const row of data) {
    const report = toReport(row);
    if (report) out.push(report);
  }
  return out;
}

/**
 * How many reports are sitting in each pile, for the filter chips, so a
 * moderator can see there's nothing waiting without tapping through.
 *
 * These are `head` counts, not rows, so they're cheap and they aren't capped
 * by {@link QUEUE_LIMIT}: a queue of 140 open reports honestly says 140 even
 * though only the first hundred are fetched.
 *
 * @throws {ModerationError} With copy that's ready to render.
 */
export async function fetchQueueCounts(): Promise<Record<ReportStatus, number>> {
  const pairs = await Promise.all(
    STATUSES.map(async (status): Promise<[ReportStatus, number]> => {
      const { count, error } = await supabase
        .from("reports")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      if (error) {
        throw new ModerationError(
          "We couldn't count what's waiting. Give it another go."
        );
      }
      return [status, typeof count === "number" ? count : 0];
    })
  );

  const counts: Record<ReportStatus, number> = {
    open: 0,
    reviewed: 0,
    dismissed: 0,
  };
  for (const [status, count] of pairs) counts[status] = count;
  return counts;
}

/* ══════════════════════════════ writes ═══════════════════════════════ */

/**
 * Move a report from one pile to another. Moderators only: the update policy
 * checks `is_moderator()`, and this is the only column a moderator may change.
 *
 * Nothing here is one-way: a report dismissed at 1am can be marked reviewed in
 * the morning, and either can go back to `open`. That's deliberate, so a tired
 * tap is never a decision anybody has to live with.
 *
 * Safe to run optimistically: start the row leaving, call this, and roll it
 * back only if it throws. A row that RLS refuses (the badge was taken away
 * mid-session) comes back with nothing updated rather than an error code, so
 * this asks for the id back and treats an empty result as a failure. Silence
 * is the one outcome a queue can't afford.
 *
 * @param reportId The report's `reports.id`.
 * @param status   Where it should sit now.
 * @throws {ModerationError} With copy that's ready to render.
 */
export async function setStatus(
  reportId: string,
  status: ReportStatus
): Promise<void> {
  const { data, error } = await supabase
    .from("reports")
    .update({ status })
    .eq("id", reportId)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new ModerationError(
      "That didn't save. Give it another tap in a moment."
    );
  }
  if (typeof data !== "object" || data === null) {
    throw new ModerationError(
      "That one didn't move. Pull down to refresh and see where it landed."
    );
  }
}

/* ═══════════════════════════ pure helpers ════════════════════════════ */

/** What a pile is called, for a chip or a heading. Pure. */
export function statusLabel(status: ReportStatus): string {
  if (status === "reviewed") return "Reviewed";
  if (status === "dismissed") return "Dismissed";
  return "Open";
}

/** What the reporter picked, in the same words they picked it. Pure. */
export function categoryLabel(category: ReportCategory): string {
  return CATEGORY_LABELS[category];
}

/**
 * The two moves available from where a report is now, never the status it
 * already has, so a row can't offer a button that does nothing.
 *
 * From `open` that's the pair the queue is built around ("Mark reviewed" and
 * "Dismiss"). From either ending it's the other ending plus a way back, because
 * nothing in triage should be a trapdoor.
 *
 * Pure.
 */
export function triageActions(
  status: ReportStatus
): readonly { status: ReportStatus; label: string }[] {
  const moves: Record<ReportStatus, string> = {
    open: "Put it back",
    reviewed: "Mark reviewed",
    dismissed: "Dismiss",
  };
  return STATUSES.filter((candidate) => candidate !== status).map(
    (candidate) => ({ status: candidate, label: moves[candidate] })
  );
}

/**
 * What a report is about, and whether it's still there to look at.
 *
 * Precedence runs message, then board post, then community post, then
 * comment, then profile, which matches how reports are filed: a content
 * report also records its author (so the report keeps a subject after the
 * content goes), and the content is the more specific of the two. A report
 * whose subject columns have all nulled out still resolves to `gone`, with a
 * sentence saying so.
 *
 * Pure.
 */
export function reportSubject(report: ModerationReport): ReportSubject {
  if (report.message !== null) {
    return { kind: "message", message: report.message };
  }
  if (report.message_id !== null) {
    return {
      kind: "gone",
      was: "message",
      note: "That message is in a channel you haven't joined, so it isn't loaded with the queue.",
    };
  }
  if (report.dm_message_id !== null) {
    return {
      kind: "gone",
      was: "message",
      note: "A direct message, so the words aren't loaded with the queue.",
    };
  }
  if (report.club_announcement_id !== null) {
    return {
      kind: "gone",
      was: "announcement",
      note: "A club announcement, so the words aren't loaded with the queue.",
    };
  }
  if (report.post !== null) return { kind: "post", post: report.post };
  if (report.board_post_id !== null) {
    return {
      kind: "gone",
      was: "post",
      note: "We couldn't pull that board post up just now.",
    };
  }
  if (report.community_post !== null) {
    return { kind: "community_post", post: report.community_post };
  }
  if (report.community_post_id !== null) {
    return {
      kind: "gone",
      was: "community_post",
      note: "We couldn't pull that community post up just now.",
    };
  }
  if (report.post_comment !== null) {
    return { kind: "comment", comment: report.post_comment };
  }
  if (report.post_comment_id !== null) {
    return {
      kind: "gone",
      was: "comment",
      note: "We couldn't pull that comment up just now.",
    };
  }
  if (report.reported !== null) {
    return { kind: "profile", profile: report.reported };
  }
  if (report.reported_user_id !== null) {
    return {
      kind: "gone",
      was: "profile",
      note: "That account isn't readable from here.",
    };
  }
  return {
    kind: "gone",
    was: "unknown",
    note: "Everything this report pointed at has since been deleted. The report is all that's left.",
  };
}

/**
 * The name a person goes by in one word: "Maya Chen" reads as "Maya". Falls
 * back to the whole string when there's nothing to split.
 */
function firstName(person: ReportPerson): string {
  const parts = person.display_name.trim().split(/\s+/).filter(Boolean);
  return parts[0] ?? person.display_name;
}

/**
 * One line saying what got reported: "A message in MAT 21A", "Maya's
 * profile", "A board post: couch, free".
 *
 * This is the row's title, so it names the *thing*, never the accusation. The
 * reporter's words go underneath in full, and they're the part worth reading
 * slowly. When the subject can't be shown, this still names its kind and, when
 * we know it, the person it was about ("A message from Maya"), so a row is
 * never a shrug.
 *
 * Pure.
 */
export function summarize(report: ModerationReport): string {
  const subject = reportSubject(report);
  const who = report.reported;

  switch (subject.kind) {
    case "message": {
      const channel = subject.message.channel;
      if (channel !== null) return `A message in ${channel.name}`;
      return who !== null ? `A message from ${firstName(who)}` : "A message";
    }
    case "post": {
      const category = subject.post.category;
      const board =
        category !== null ? categoryInfo(category).label.toLowerCase() : null;
      return board !== null
        ? `A board post: ${subject.post.title}, ${board}`
        : `A board post: ${subject.post.title}`;
    }
    case "community_post":
      return `A community post: ${subject.post.title}`;
    case "comment":
      return who !== null ? `A comment from ${firstName(who)}` : "A comment";
    case "profile":
      return `${firstName(subject.profile)}'s profile`;
    default:
      break;
  }

  switch (subject.was) {
    case "message":
      return who !== null ? `A message from ${firstName(who)}` : "A message";
    case "announcement":
      return "A club announcement";
    case "post":
      return "A board post";
    case "community_post":
      return "A community post";
    case "comment":
      return who !== null ? `A comment from ${firstName(who)}` : "A comment";
    case "profile":
      return "A profile";
    default:
      return "Something that's since been deleted";
  }
}

/** Milliseconds in a minute, for the arithmetic below. */
const MINUTE_MS = 60 * 1000;

/**
 * When a report was filed, as a person would say it: "Just now", "12m ago",
 * "3h ago", "2d ago", then a plain date once it's been sitting a week.
 *
 * A report filed a moment in the future (a phone clock that's drifted behind
 * the server) reads "Just now" rather than a negative number.
 *
 * Pure: pass the moment in, from a state tick or a test.
 */
export function filedAgo(
  report: Pick<ModerationReport, "created_at">,
  now: Date
): string {
  const filed = new Date(report.created_at);
  const filedMs = filed.getTime();
  if (Number.isNaN(filedMs)) return "Some time ago";

  const minutes = Math.floor((now.getTime() - filedMs) / MINUTE_MS);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return filed.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * The counts after a report moves from one pile to another, so the filter
 * chips settle at the same moment the row does instead of waiting for a
 * refetch. Clamped at zero, since a count that's drifted can't go negative.
 *
 * Pure. Moving a report to the pile it's already in is a no-op.
 */
export function moveCount(
  counts: Record<ReportStatus, number>,
  from: ReportStatus,
  to: ReportStatus
): Record<ReportStatus, number> {
  if (from === to) return counts;
  return {
    ...counts,
    [from]: Math.max(0, counts[from] - 1),
    [to]: counts[to] + 1,
  };
}

/* ═════════════════════════ the words behind it ═══════════════════════ */

/**
 * The reported message itself, for the one report a moderator has open.
 *
 * This exists because triage was blind. `messages` is readable only to
 * channel members and `dm_messages` only to the two people in the thread.
 * Both correct, and both meaning a moderator was being asked to judge words
 * they could not read. Migration 0038 added `reported_content()`, a
 * security-definer function that returns the text of the ONE message a given
 * report names, for a moderator on that report's own campus.
 *
 * It is deliberately not part of {@link REPORT_SELECT}. One call per opened
 * report, never one per row: a queue screen should not be pulling a hundred
 * private messages out of the database to draw a list.
 *
 * @param reportId The report being triaged.
 * @returns The words and who said them, or null when the subject is a person
 *   or a board post (both already readable), or when the message has since
 *   been hard-deleted, in which case the report stands on its own.
 * @throws {ModerationError} With copy that's ready to render.
 */
export async function fetchReportedContent(
  reportId: string
): Promise<ReportedContent | null> {
  const { data, error } = await supabase.rpc("reported_content", {
    p_report_id: reportId,
  });
  if (error) {
    if (error.message.includes("not a moderator")) {
      throw new ModerationError(
        "You're not a moderator any more, so this report isn't yours to read."
      );
    }
    if (error.message.includes("not your campus")) {
      throw new ModerationError("That report belongs to another campus.");
    }
    throw new ModerationError(
      "We couldn't load what was reported. Give it another go."
    );
  }
  const record = embedded(data);
  if (!record) return null;
  const content = text(record["content"]);
  if (content === null) return null;
  const kind = text(record["kind"]);
  return {
    kind: kind === "direct" || kind === "announcement" ? kind : "channel",
    content,
    author_id: text(record["author_id"]),
    created_at: text(record["created_at"]),
    deleted_at: text(record["deleted_at"]),
  };
}

/** What {@link fetchReportedContent} hands back. */
export type ReportedContent = {
  /** Which surface it was said on: a room, a one-to-one thread, or a club
   * announcement. For an announcement, `content` is the title and the body
   * with a newline between them. */
  kind: "channel" | "direct" | "announcement";
  /** The words. Never truncated on the way through here. */
  content: string;
  /** Who said them, or null if the row no longer names an author. */
  author_id: string | null;
  /** ISO timestamp it was sent, or null. */
  created_at: string | null;
  /**
   * Set if it has been taken down since. The content is still here: a soft
   * delete hides a message from the room, not from triage.
   */
  deleted_at: string | null;
};
