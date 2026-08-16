import type { SupabaseClient } from "@supabase/supabase-js";
import {
  asBoardCategory,
  categoryInfo,
  type BoardCategory,
} from "@/lib/board";
import { roomTitle } from "@/lib/room-identity";
import { createClient } from "@/lib/supabase/client";

/* The moderation queue: the data layer.
 *
 * Reports have existed since migration 0015: a student flags a message, a
 * classmate, or (since 0034) a post on the campus board, and the row lands in
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
 *   · A reported direct message never has an embed at all. `dm_messages` is
 *     readable only to the two people in the thread and a moderator is never
 *     one of them, so `dm_message_id` arrives on its own and the words come
 *     from {@link fetchReportedContent}, one report at a time.
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
 *
 * The one web-only adjustment, the same one `@/lib/focus` makes: there is no
 * module-level Supabase singleton here the way there is in the native app.
 * Every I/O function takes an optional trailing {@link ModerationCtx}. Browser
 * callers omit it and get the shared browser client; a server component passes
 * its request-scoped client (and the user id it already resolved) so nothing
 * has to read the session cookie twice.
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

/* The reporter picks these words when they file a report; a moderator has to
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

/**
 * The eight categories in the order a reporter is offered them: worst first,
 * "Something else" last, matching the native report screen.
 *
 * Exported because every picker needs it, and each one that keeps its own
 * copy is another place to forget when the check constraint changes. There
 * were four such copies before this: the constraint in 0020, the two
 * CATEGORY_LABELS maps, and a hand-written array in the chat report popover,
 * each with a comment claiming it was one of two.
 */
export const REPORT_CATEGORIES: readonly ReportCategory[] = [
  "harassment",
  "hate",
  "sexual_content",
  "self_harm",
  "impersonation",
  "spam",
  "academic_dishonesty",
  "other",
];

/**
 * Whether an arbitrary string is one of the eight.
 *
 * `hasOwnProperty` rather than a truthiness check on the label, because a
 * server action is an HTTP endpoint and the `ReportCategory` type is only a
 * caller's promise. A hand-rolled POST sending `"constructor"`, `"toString"`
 * or `"__proto__"` reads a truthy value straight off Object.prototype, so a
 * guard written as `if (!categoryLabel(c))` waves it through, and the
 * student who tripped it gets told to try again, about the one failure
 * retrying can never fix.
 */
export function isReportCategory(raw: unknown): raw is ReportCategory {
  return (
    typeof raw === "string" &&
    Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, raw)
  );
}

/* ══════════════════════════════ shapes ═══════════════════════════════ */

/** The Supabase client these queries run against: server or browser. */
type Db = SupabaseClient;

/**
 * How a caller tells this module which Supabase client to use.
 *
 * @property client Request-scoped server client. Omit in the browser.
 * @property userId The caller's `profiles.id` when it's already known.
 *   Server components have it from `getCurrentUser()`, and passing it keeps
 *   this module off `auth.getSession()` on the server.
 */
export type ModerationCtx = {
  client?: Db;
  userId?: string | null;
};

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
  /** `channels.id`. Link to `/channels/<id>` with it. */
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

/** A reported post on the campus board. */
export type ReportedBoardPost = {
  /** `board_posts.id`. Link to `/board/<id>` with it. */
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
  /** Raw `reports.message_id`. Non-null with a null `message` means unreadable. */
  message_id: string | null;
  /** Raw `reports.board_post_id`. Same story as `message_id`. */
  board_post_id: string | null;
  /**
   * Raw `reports.dm_message_id` (migration 0038). There is deliberately NO
   * embedded `dm_message` beside it: `dm_messages` is readable only to the
   * two people in the thread, and a moderator is by definition not one of
   * them. A reported DM resolves through {@link fetchReportedContent}, which
   * is the only path to those words and is scoped to this one report.
   */
  dm_message_id: string | null;
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
  | { kind: "profile"; profile: ReportedProfile }
  | {
      kind: "gone";
      /** What it used to point at, as far as the columns still say. */
      was: "message" | "post" | "profile" | "unknown";
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
  "id, status, category, reason, created_at, message_id, dm_message_id, board_post_id, reported_user_id, " +
  // Two foreign keys point at `profiles`, so both embeds need naming.
  "reporter:profiles!reports_reporter_id_fkey(id, handle, display_name, avatar_url), " +
  "reported:profiles!reports_reported_user_id_fkey(id, handle, display_name, avatar_url, bio), " +
  "message:messages(id, content, created_at, deleted_at, channel:channels(id, name, slug)), " +
  "post:board_posts(id, title, body, category, closed_at)";

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

/* ══════════════════════════════ client ═══════════════════════════════ */

/** One browser client for the whole tab, made on first use. */
let browserDb: Db | null = null;

/** The client to run against: the caller's, or the shared browser one. */
function db(ctx?: ModerationCtx): Db {
  if (ctx?.client) return ctx.client;
  if (typeof window === "undefined") {
    // A developer mistake rather than a student's problem, so say what's
    // missing.
    throw new Error(
      "@/lib/moderation: on the server, pass { client } from @/lib/supabase/server."
    );
  }
  browserDb ??= createClient();
  return browserDb;
}

/* ════════════════════════════ narrowing ══════════════════════════════ */

/**
 * The Supabase client here is untyped, and PostgREST hands an embedded
 * relation back as an object OR a one-element array depending on how it
 * resolves the relationship (and as null when there's nothing to embed).
 * Unwrap every shape to a plain record. Same defence as `@/lib/focus` and
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
    message_id: text(record["message_id"]),
    board_post_id: text(record["board_post_id"]),
    dm_message_id: text(record["dm_message_id"]),
    reported_user_id: text(record["reported_user_id"]),
  };
}

/* ═══════════════════════════════ reads ═══════════════════════════════ */

/**
 * The caller's `profiles.id`: theirs if they handed one over, otherwise read
 * from the stored session. Null rather than a throw when nobody is signed in:
 * every caller here has a warmer answer for that than an error.
 */
async function currentUserId(ctx?: ModerationCtx): Promise<string | null> {
  const given = ctx?.userId;
  if (typeof given === "string" && given.length > 0) return given;
  const { data } = await db(ctx).auth.getSession();
  const id = data.session?.user.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

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
export async function amIModerator(ctx?: ModerationCtx): Promise<boolean> {
  const userId = await currentUserId(ctx);
  if (userId === null) return false;

  const { data, error } = await db(ctx)
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
  status: ReportStatus,
  ctx?: ModerationCtx
): Promise<ModerationReport[]> {
  const { data, error } = await db(ctx)
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
 * moderator can see there's nothing waiting without clicking through.
 *
 * These are `head` counts, not rows, so they're cheap and they aren't capped
 * by {@link QUEUE_LIMIT}: a queue of 140 open reports honestly says 140 even
 * though only the first hundred are fetched.
 *
 * @throws {ModerationError} With copy that's ready to render.
 */
export async function fetchQueueCounts(
  ctx?: ModerationCtx
): Promise<Record<ReportStatus, number>> {
  const pairs = await Promise.all(
    STATUSES.map(async (status): Promise<[ReportStatus, number]> => {
      const { count, error } = await db(ctx)
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
 * click is never a decision anybody has to live with.
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
  status: ReportStatus,
  ctx?: ModerationCtx
): Promise<void> {
  const { data, error } = await db(ctx)
    .from("reports")
    .update({ status })
    .eq("id", reportId)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new ModerationError(
      "That didn't save. Give it another go in a moment."
    );
  }
  if (typeof data !== "object" || data === null) {
    throw new ModerationError(
      "That one didn't move. Refresh the queue and see where it landed."
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

/**
 * What the reporter picked, in the same words they picked it. Pure.
 *
 * Own-property read, for the same reason {@link isReportCategory} exists: a
 * bare index returns an inherited function for `"toString"` and friends, and
 * this label ends up in a moderator's queue.
 */
export function categoryLabel(category: ReportCategory): string {
  return Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, category)
    ? CATEGORY_LABELS[category]
    : CATEGORY_LABELS.other;
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
 * Precedence is message → direct message → board post → profile, which matches
 * how reports are filed: a message report also records its author (so the
 * report keeps a subject after the message goes), and the message is the more
 * specific of the two. A report whose subject columns have all nulled out still
 * resolves to `gone`, with a sentence saying so.
 *
 * A reported DM always resolves to `gone` with `was: "message"`, because there
 * is no embed to resolve it to. Its words come from
 * {@link fetchReportedContent} and only when a moderator asks for them.
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
  if (report.post !== null) return { kind: "post", post: report.post };
  if (report.board_post_id !== null) {
    return {
      kind: "gone",
      was: "post",
      note: "We couldn't pull that board post up just now.",
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
    case "profile":
      return `${firstName(subject.profile)}'s profile`;
    default:
      break;
  }

  switch (subject.was) {
    case "message":
      return who !== null ? `A message from ${firstName(who)}` : "A message";
    case "post":
      return "A board post";
    case "profile":
      return "A profile";
    default:
      return "Something that's since been deleted";
  }
}

/**
 * Where clicking a report should take you: the room it happened in, the board
 * post, or the person. A report whose message sits in a channel this moderator
 * hasn't joined still leads somewhere useful (the reported student's profile),
 * so a row is only inert when there is genuinely nothing left to look at.
 *
 * Pure. Returns a path for `<Link href>`, or null for "nothing to open".
 */
export function subjectHref(report: ModerationReport): string | null {
  const subject = reportSubject(report);
  if (subject.kind === "message" && subject.message.channel !== null) {
    return `/channels/${subject.message.channel.id}`;
  }
  if (subject.kind === "post") return `/board/${subject.post.id}`;
  if (subject.kind === "profile") return `/u/${subject.profile.handle}`;
  if (report.reported !== null) return `/u/${report.reported.handle}`;
  return null;
}

/** Milliseconds in a minute, for the arithmetic below. */
const MINUTE_MS = 60 * 1000;

/**
 * When a report was filed, as a person would say it: "Just now", "12m ago",
 * "3h ago", "2d ago", then a plain date once it's been sitting a week.
 *
 * A report filed a moment in the future (a clock that's drifted behind the
 * server) reads "Just now" rather than a negative number.
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

/** What {@link fetchReportedContent} hands back. */
export type ReportedContent = {
  /** Which surface it was said on: a room, or a one-to-one thread. */
  kind: "channel" | "direct";
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
  reportId: string,
  ctx?: ModerationCtx
): Promise<ReportedContent | null> {
  const { data, error } = await db(ctx).rpc("reported_content", {
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
    kind: kind === "direct" ? "direct" : "channel",
    content,
    author_id: text(record["author_id"]),
    created_at: text(record["created_at"]),
    deleted_at: text(record["deleted_at"]),
  };
}
