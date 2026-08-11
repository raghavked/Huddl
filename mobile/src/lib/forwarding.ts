import { threadDisplay, type ThreadPerson } from "@/lib/group-dm";
import { supabase } from "@/lib/supabase";

/* Forwarding a message — the data layer.
 *
 * Forwarding is passing something along with its provenance intact: the new
 * room sees the words, plus a quiet line saying who wrote them and where they
 * came from. Migration 0033 gave both `messages` and `dm_messages` the same
 * pair of columns for that —
 *
 *   forwarded_author_id  the person who ACTUALLY wrote it (`profiles.id`)
 *   forwarded_from       a human label for the room it left ("#mat-21a")
 *
 * — denormalized on purpose, because a channel message can land in a DM and a
 * DM can land in a channel, and no single foreign key describes both.
 *
 * A forwarded message is otherwise an ordinary message: `author_id` is YOU
 * (you're the one putting it in this room, and RLS wouldn't let you claim
 * otherwise), it can be edited and deleted like anything else you send, and
 * the same insert policies apply. Nothing here needs an RPC.
 *
 * No React, no theme, no navigation — one read, one write, and pure helpers
 * for the copy. Failures arrive as a {@link ForwardError} whose message is
 * warm, specific, and safe to render straight into an inline error; the write
 * reports per-target so a partial send can be told honestly.
 */

/* ------------------------------ shapes ------------------------------ */

/**
 * Somewhere a message can be forwarded to. Discriminated on `kind` so one
 * picker can list channels and conversations together, and so
 * {@link forwardMessage} knows which table to write.
 */
export type ForwardTarget =
  | {
      kind: "channel";
      /** `channels.id`. */
      id: string;
      /** The channel's name as students see it — "MAT 21A", "Study group". */
      name: string;
      /**
       * The course this channel belongs to ("MAT 21A"), or null for a campus
       * or topic channel. Use it as the row's second line so two rooms named
       * "Study group" are tellable apart.
       */
      courseCode: string | null;
    }
  | {
      kind: "dm";
      /** `dm_threads.id`. */
      id: string;
      /**
       * The group's name, or the other person's — from `threadDisplay` in
       * `@/lib/group-dm`, so this row is named exactly as the messages list
       * names it.
       */
      label: string;
      /** True for a group of 3-16, false for a 1:1 — pick the row's glyph. */
      isGroup: boolean;
      /**
       * The other person on a 1:1 (`profiles.id`), null on a group. Present so
       * a picker can drop conversations with someone you've blocked, the same
       * filter the messages list runs — this module doesn't fetch your block
       * list, so that filtering is the caller's to do.
       */
      otherId: string | null;
    };

/**
 * The message being passed along, reduced to the four things a new room needs.
 *
 * Pull it off the row you're forwarding. If that row is ITSELF a forward, pass
 * its `forwarded_author_id` and `forwarded_from` through unchanged rather than
 * its `author_id` and this room's name — the trail should point at whoever
 * actually wrote the words, not at the last person to pass them on.
 */
export type ForwardSource = {
  /** The message text, 1-4000 characters. A photo-only message carries "Photo". */
  content: string;
  /**
   * The `chat-uploads` object path, or null. Forwards by PATH, never by copy —
   * see {@link forwardMessage} for what that means for the photo.
   */
  attachmentPath: string | null;
  /**
   * Who wrote it originally (`profiles.id`), or null if their account is gone.
   * Lands in `forwarded_author_id`.
   */
  authorId: string | null;
  /**
   * Where it came from, from {@link forwardLabelFor} — "#mat-21a", "a direct
   * message". Lands in `forwarded_from`.
   */
  fromLabel: string;
};

/** How one target went. One of these per target, in the order you gave them. */
export type ForwardOutcome = {
  /** The target this line is about. */
  target: ForwardTarget;
  /** True when the message landed. */
  sent: boolean;
  /** Warm one-liner when it didn't land; null when it did. */
  error: string | null;
};

/** What {@link summarizeForward} hands a toast or an inline caption. */
export type ForwardSummary = {
  /** How many targets took it. */
  sent: number;
  /** How many were tried. */
  total: number;
  /** True when every target took it. */
  complete: boolean;
  /** One warm sentence naming what actually happened. Safe to render. */
  message: string;
};

/* ------------------------------ limits ------------------------------ */

/** Longest message the tables accept — the same 1-4000 on both sides. */
export const FORWARD_CONTENT_MAX = 4000;

/** Longest `forwarded_from` label the check constraint allows. */
export const FORWARD_FROM_MAX = 80;

/** What a channel with no usable name in it reads as. */
const UNNAMED_CHANNEL = "a channel";

/** What every direct message reads as, group or 1:1 — see {@link forwardLabelFor}. */
const DM_LABEL = "a direct message";

/** Provenance for a source whose label came through blank. Never a bare null. */
const UNKNOWN_ROOM = "another room";

/* ----------------------------- failures ----------------------------- */

/**
 * A forwarding failure with a message written for a person, not a log. Show
 * `err.message` directly in your inline error — it never leaks SQL, ids, or
 * PostgREST codes.
 *
 * Only the things that stop the whole send throw: not signed in, nothing to
 * forward, nowhere to send it. A target that refuses on its own comes back in
 * its {@link ForwardOutcome} instead, so one closed door doesn't discard the
 * messages that did land.
 */
export class ForwardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForwardError";
  }
}

/** PostgREST hands RLS refusals back as 42501, check violations as 23514. */
function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

/* ---------------------------- narrowing ----------------------------- */

/**
 * An embedded relation comes back as an object OR a one-element array
 * depending on how PostgREST resolves it, and as null when there's nothing to
 * embed. Unwrap every shape to a plain record. Same defence as `@/lib/focus`
 * and `@/features/mentions/use-mention-suggestions`.
 */
function embedded(raw: unknown): Record<string, unknown> | null {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

/** A string field that's actually there, or null. */
function text(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** Narrow an embedded `profiles` row into the shape `threadDisplay` reads. */
function toPerson(raw: unknown): ThreadPerson | null {
  const record = embedded(raw);
  if (!record) return null;
  const id = text(record["id"]);
  const handle = text(record["handle"]);
  if (!id || !handle) return null;
  return {
    id,
    handle,
    display_name: text(record["display_name"]) ?? handle,
    avatar_url: text(record["avatar_url"]),
  };
}

/**
 * The caller's `profiles.id`, read from the stored session (no network hop —
 * supabase-js refreshes the token itself when it's stale).
 *
 * @throws {ForwardError} When nobody's signed in.
 */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (error || typeof id !== "string" || id.length === 0) {
    throw new ForwardError("Sign in again to pass that along.");
  }
  return id;
}

/* --------------------------- pure helpers --------------------------- */

/**
 * The label that goes into `forwarded_from`, so every surface that forwards
 * agrees on the wording:
 *
 * - a channel → `#` plus its name slugified — "MAT 21A" becomes "#mat-21a",
 *   matching how the database slugs a course room in `create_course_room`
 * - a direct message → the flat string "a direct message"
 *
 * A DM never names the person or the group, deliberately. The room receiving
 * a forward is entitled to know the words came from somewhere private; it is
 * not entitled to know who you were talking to.
 *
 * Pure. Pass the room you're forwarding OUT of — a {@link ForwardTarget} is
 * accepted as-is, so the room a picker lists and the room a label names can't
 * drift apart.
 *
 * @param room The source room: a channel with a name, or any DM.
 * @returns A label at most {@link FORWARD_FROM_MAX} characters, never blank.
 */
export function forwardLabelFor(
  room: { kind: "channel"; name: string } | { kind: "dm" }
): string {
  if (room.kind === "dm") return DM_LABEL;
  const slug = room.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length === 0) return UNNAMED_CHANNEL;
  // Trim to the column's 80 characters, then tidy a hyphen left at the cut.
  const body = slug.slice(0, FORWARD_FROM_MAX - 1).replace(/-+$/, "");
  return body.length === 0 ? UNNAMED_CHANNEL : `#${body}`;
}

/**
 * What to call a target in a sentence — a channel's name, a conversation's
 * label. One rule, so a picker row, a confirmation, and an error can't call
 * the same place three different things.
 *
 * Pure.
 */
export function targetName(target: ForwardTarget): string {
  return target.kind === "channel" ? target.name : target.label;
}

/** "Maya", "Maya and #mat-21a", "Maya and 3 others" — never a bare list. */
function joinNames(names: readonly string[]): string {
  const [first, second] = names;
  if (!first) return "nowhere";
  if (names.length === 1) return first;
  if (names.length === 2 && second) return `${first} and ${second}`;
  return `${first} and ${names.length - 1} others`;
}

/**
 * Turn the per-target outcomes into one sentence a student can act on.
 * Everything landed, some of it landed, or none of it did — each says so
 * plainly and names the places, because "Sent!" over a half-finished send is
 * a lie the student finds out about later.
 *
 * Pure. Feed it whatever {@link forwardMessage} returned.
 */
export function summarizeForward(
  outcomes: readonly ForwardOutcome[]
): ForwardSummary {
  const sentNames: string[] = [];
  const failedNames: string[] = [];
  for (const outcome of outcomes) {
    (outcome.sent ? sentNames : failedNames).push(targetName(outcome.target));
  }
  const sent = sentNames.length;
  const total = outcomes.length;

  if (total === 0) {
    return { sent: 0, total: 0, complete: false, message: "Nothing to send." };
  }
  if (sent === total) {
    return {
      sent,
      total,
      complete: true,
      message: `Sent to ${joinNames(sentNames)}.`,
    };
  }
  if (sent === 0) {
    return {
      sent,
      total,
      complete: false,
      message: "That didn't send anywhere. Check your connection and try again.",
    };
  }
  return {
    sent,
    total,
    complete: false,
    message: `Sent to ${sent} of ${total} — ${joinNames(failedNames)} didn't take it.`,
  };
}

/* ------------------------------- reads ------------------------------ */

/** My channels, with the course code where the channel has one. */
const CHANNEL_TARGET_SELECT =
  "channel_id, last_read_at, channel:channels(id, name, course:courses(code))";

/**
 * Every participant row of every thread I'm in — mine for the read time,
 * everyone else's for the name. The `dm_participants` SELECT policy is
 * `user_id = auth.uid() OR is_dm_participant(thread_id)`, so an unfiltered
 * query already returns exactly that and no more. That's what keeps the DM
 * side to a single round trip.
 */
const DM_TARGET_SELECT =
  "thread_id, user_id, last_read_at, thread:dm_threads(id, is_group, title), profile:profiles(id, display_name, handle, avatar_url)";

/** A target plus the moment used to rank it, before the two sides merge. */
type RankedTarget = { target: ForwardTarget; activityAt: number };

/** Milliseconds since the epoch, or 0 for a timestamp we can't read. */
function moment(iso: unknown): number {
  const value = typeof iso === "string" ? new Date(iso).getTime() : Number.NaN;
  return Number.isNaN(value) ? 0 : value;
}

/** My joined channels as targets, ranked by when I was last in each. */
async function fetchChannelTargets(userId: string): Promise<RankedTarget[]> {
  const { data, error } = await supabase
    .from("channel_members")
    .select(CHANNEL_TARGET_SELECT)
    .eq("user_id", userId);
  if (error) {
    throw new ForwardError("We couldn't load your channels. Give it another go.");
  }
  if (!Array.isArray(data)) return [];

  const out: RankedTarget[] = [];
  for (const row of data) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;
    const channel = embedded(record["channel"]);
    if (!channel) continue;
    const id = text(channel["id"]);
    const name = text(channel["name"]);
    if (!id || !name) continue;
    const course = embedded(channel["course"]);
    out.push({
      target: {
        kind: "channel",
        id,
        name,
        courseCode: course ? text(course["code"]) : null,
      },
      activityAt: moment(record["last_read_at"]),
    });
  }
  return out;
}

/** What one thread's rows add up to while the DM side is being folded. */
type ThreadDraft = {
  id: string;
  isGroup: boolean;
  title: string | null;
  people: ThreadPerson[];
  activityAt: number;
};

/** My conversations as targets, ranked by when I was last in each. */
async function fetchDmTargets(userId: string): Promise<RankedTarget[]> {
  const { data, error } = await supabase
    .from("dm_participants")
    .select(DM_TARGET_SELECT);
  if (error) {
    throw new ForwardError(
      "We couldn't load your conversations. Give it another go."
    );
  }
  if (!Array.isArray(data)) return [];

  // Fold the participant rows into one draft per thread: everyone in it, plus
  // my own row's last_read_at as the rank.
  const drafts = new Map<string, ThreadDraft>();
  for (const row of data) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;
    const threadId = text(record["thread_id"]);
    const thread = embedded(record["thread"]);
    if (!threadId || !thread) continue;

    let draft = drafts.get(threadId);
    if (!draft) {
      draft = {
        id: threadId,
        isGroup: thread["is_group"] === true,
        title: text(thread["title"]),
        people: [],
        activityAt: 0,
      };
      drafts.set(threadId, draft);
    }
    const person = toPerson(record["profile"]);
    if (person) draft.people.push(person);
    if (text(record["user_id"]) === userId) {
      draft.activityAt = moment(record["last_read_at"]);
    }
  }

  const out: RankedTarget[] = [];
  for (const draft of drafts.values()) {
    const others = draft.people.filter((person) => person.id !== userId);
    // A 1:1 whose other account is gone has nobody left to read it. A group
    // stands on its own name, so it stays.
    const other = draft.isGroup ? null : (others[0] ?? null);
    if (!draft.isGroup && !other) continue;
    const named = threadDisplay(
      { is_group: draft.isGroup, title: draft.title },
      draft.people,
      userId
    );
    out.push({
      target: {
        kind: "dm",
        id: draft.id,
        label: named.title,
        isGroup: draft.isGroup,
        otherId: other?.id ?? null,
      },
      activityAt: draft.activityAt,
    });
  }
  return out;
}

/**
 * Everywhere the signed-in student can forward something: every channel
 * they've joined and every conversation they're in, in one list.
 *
 * Two queries, one per side, merged and ranked here. "Recent" means when YOU
 * were last in the room — your own `last_read_at`, which the channel and DM
 * screens stamp on open — not when the room last said something. That's the
 * ordering a forward actually wants: you just backed out of a room to pass
 * something along, and it should be the first thing you see. It also costs two
 * round trips instead of one per room. A room you've never opened ranks by
 * when you joined it, which is the honest answer for a room with no history
 * between you and it.
 *
 * Kinds are interleaved rather than grouped. A picker that wants sections can
 * split on `kind` in one filter; a picker that wants "recent" can render the
 * list as it comes.
 *
 * Two things this deliberately does NOT do, both of which are the caller's:
 * drop conversations with someone you've blocked (filter on the dm variant's
 * `otherId` against `useBlockedIds`), and drop the room you're forwarding out
 * of (match on `kind` and `id`).
 *
 * @returns Targets newest-first. Empty only for a student in nothing at all.
 * @throws {ForwardError} With copy that's ready to render.
 */
export async function fetchForwardTargets(): Promise<ForwardTarget[]> {
  const userId = await requireUserId();
  const [channels, dms] = await Promise.all([
    fetchChannelTargets(userId),
    fetchDmTargets(userId),
  ]);
  return [...channels, ...dms]
    .sort((a, b) => b.activityAt - a.activityAt)
    .map((ranked) => ranked.target);
}

/* ------------------------------ writes ------------------------------ */

/** Trim the label to the column's 80 characters; blank becomes the fallback. */
function cleanLabel(fromLabel: string): string {
  const trimmed = fromLabel.trim().slice(0, FORWARD_FROM_MAX);
  return trimmed.length === 0 ? UNKNOWN_ROOM : trimmed;
}

/**
 * Trim the message to the 1-4000 window both tables enforce.
 *
 * @throws {ForwardError} When there are no words to forward.
 */
function requireContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new ForwardError("There's nothing in this message to pass along.");
  }
  return trimmed.slice(0, FORWARD_CONTENT_MAX);
}

/** Unique targets in the order given — the same room picked twice sends once. */
function uniqueTargets(targets: readonly ForwardTarget[]): ForwardTarget[] {
  const seen = new Set<string>();
  const out: ForwardTarget[] = [];
  for (const target of targets) {
    if (target.id.length === 0) continue;
    const key = `${target.kind}:${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

/** Warm copy for one target that refused, named so the student knows which. */
function outcomeError(target: ForwardTarget, error: unknown): string {
  const name = targetName(target);
  // 42501 is the RLS refusal: you've left that room, or never were in it.
  if (errorCode(error) === "42501") {
    return `You're not in ${name} anymore.`;
  }
  // 23514 is a length check — the only one reachable here is the 4000 cap.
  if (errorCode(error) === "23514") {
    return `That message is too long for ${name}.`;
  }
  return `We couldn't send it to ${name}. Give it another go.`;
}

/** Insert one forwarded row into whichever table the target lives in. */
async function forwardToTarget(
  target: ForwardTarget,
  row: {
    author_id: string;
    content: string;
    attachment_path: string | null;
    forwarded_author_id: string | null;
    forwarded_from: string;
  }
): Promise<ForwardOutcome> {
  const { error } =
    target.kind === "channel"
      ? await supabase.from("messages").insert({ channel_id: target.id, ...row })
      : await supabase
          .from("dm_messages")
          .insert({ thread_id: target.id, ...row });
  if (error) {
    return { target, sent: false, error: outcomeError(target, error) };
  }
  return { target, sent: true, error: null };
}

/**
 * Pass a message along to one or more rooms — one insert per target, into
 * `messages` for a channel and `dm_messages` for a conversation.
 *
 * Each row is an ordinary message authored by YOU, carrying two extra columns:
 * `forwarded_author_id` (whoever wrote it first) and `forwarded_from`
 * (`source.fromLabel`, from {@link forwardLabelFor}). A renderer shows those as
 * a quiet provenance line above the words. If the original author has since
 * deleted their account, pass null and the line reads as the room alone.
 *
 * **Attachments forward by path, not by copy.** The row points at the same
 * `chat-uploads` object the original did — no re-upload, no second file, and
 * the recipient's signed URL resolves because that bucket's read policy is
 * "any authenticated student". Say the tradeoff out loud in the confirm step
 * rather than burying it: forwarding a photo out of a room hands that photo to
 * the new room, and whoever is in the new room can then forward it onward.
 * That's true of a photo, and it's true of the words too — a forward carries a
 * private room's contents somewhere the original author didn't choose. The
 * mechanism is exactly this honest; there is nothing revocable behind it.
 *
 * Targets are deduped, then written in parallel with each failure caught on
 * its own, so a channel you quietly left doesn't discard the three sends that
 * worked. Read the returned outcomes — or hand them to
 * {@link summarizeForward} — and tell the student what actually happened.
 * Keep a selection to a handful; every target is its own insert.
 *
 * Not optimistic-friendly across rooms: there's no single row to roll back.
 * The one room worth being optimistic in is the room you're standing in, if it
 * happens to be a target — and even there, wait for the outcome.
 *
 * @param opts.source  The message being passed along.
 * @param opts.targets Where to send it; duplicates collapse.
 * @returns One {@link ForwardOutcome} per unique target, in the order given.
 * @throws {ForwardError} When nobody's signed in, there's nothing to forward,
 *   or nowhere to send it — the three failures that stop the whole send.
 */
export async function forwardMessage({
  source,
  targets,
}: {
  source: ForwardSource;
  targets: readonly ForwardTarget[];
}): Promise<ForwardOutcome[]> {
  const content = requireContent(source.content);
  const places = uniqueTargets(targets);
  if (places.length === 0) {
    throw new ForwardError("Pick somewhere to send it first.");
  }
  const userId = await requireUserId();

  const row = {
    author_id: userId,
    content,
    attachment_path: source.attachmentPath,
    forwarded_author_id: source.authorId,
    forwarded_from: cleanLabel(source.fromLabel),
  };
  return Promise.all(places.map((target) => forwardToTarget(target, row)));
}
