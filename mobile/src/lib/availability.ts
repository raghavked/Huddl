import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/* Availability polls: "when can everyone meet?", as a data layer.
 *
 * A poll is a short title, two to eight candidate times, and a yes / maybe /
 * no from each classmate. Everyone in the channel can see it and answer it;
 * only the person who started it can close it or turn the winning time into a
 * real study session.
 *
 * Migration 0033 created the three tables. The shape matters here:
 *
 *   availability_polls   the question, plus closed_at and event_id
 *   availability_slots   one row per candidate time, ordered by `position`
 *   availability_votes   one row per (slot, person), the primary key
 *
 * Creating a poll goes through `create_availability_poll`, a security-definer
 * RPC that writes the poll, its slots, and the chat message announcing it in
 * one transaction, the same shape as `create_poll`, so the two feel like
 * siblings in the composer. Everything else is a plain query against
 * member-scoped RLS. `availability_votes` is in the realtime publication, so
 * {@link subscribeToPoll} works with no extra setup; the poll row itself is
 * NOT, which is why closing a poll doesn't arrive over the socket.
 *
 * No React, no theme, no navigation. The I/O functions read the clock; the
 * pure ones ({@link tally}, {@link bestSlot}, {@link suggestSlots}) take `now`
 * as an argument, so a ticking screen and a unit test get the same answers.
 * Failures arrive as an {@link AvailabilityError} whose message is warm,
 * specific, and safe to drop straight into an inline error.
 */

/* ------------------------------ shapes ------------------------------ */

/** How a student answered one candidate time. */
export type AvailabilityResponse = "yes" | "maybe" | "no";

/** Just enough of a person to render a byline or an avatar. */
export type AvailabilityPerson = {
  /** `profiles.id`. */
  id: string;
  /** Their display name, falling back to their handle if it's somehow blank. */
  display_name: string;
  /** Their handle, without the leading `@`. */
  handle: string;
  /** Their avatar, or null; fall back to initials via `@/components/avatar`. */
  avatar_url: string | null;
};

/** One `availability_polls` row, with the person who asked attached. */
export type AvailabilityPoll = {
  /** `availability_polls.id`. */
  id: string;
  /** The channel it lives in (`channels.id`). */
  channel_id: string;
  /** Who asked (`profiles.id`). Only they can close it or attach an event. */
  creator_id: string;
  /** The question, 1-120 characters, e.g. "ECS 36A midterm review". */
  title: string;
  /** ISO timestamp the poll was closed, or null while it's still open. */
  closed_at: string | null;
  /** The study session the winning time became (`events.id`), or null. */
  event_id: string | null;
  /** ISO timestamp the poll was created. */
  created_at: string;
  /**
   * The creator's profile, or null when they've left Hearth or their profile
   * isn't readable. Show a quiet fallback byline rather than hiding the poll.
   */
  creator: AvailabilityPerson | null;
};

/** One candidate time. Slots never change after the poll is created. */
export type AvailabilitySlot = {
  /** `availability_slots.id`: what {@link vote} and {@link clearVote} take. */
  id: string;
  /** Which poll it belongs to (`availability_polls.id`). */
  poll_id: string;
  /** ISO timestamp of the proposed start. */
  starts_at: string;
  /** The order the creator offered them in, from 0. */
  position: number;
};

/** One person's answer to one candidate time. */
export type AvailabilityVote = {
  /** Which time they answered (`availability_slots.id`). */
  slot_id: string;
  /** Who answered (`profiles.id`). */
  user_id: string;
  /** Their answer. */
  response: AvailabilityResponse;
  /** ISO timestamp they first answered this slot. */
  created_at: string;
  /**
   * The voter's profile, so "Ana, Ben and Cleo said yes" needs no second
   * query. Always null on a realtime payload; those are bare table rows with
   * nothing embedded. Refetch via {@link fetchPoll} when you need names.
   */
  voter: AvailabilityPerson | null;
};

/** Everything one poll screen needs, from a single query. */
export type AvailabilityPollDetail = {
  /** The poll itself. */
  poll: AvailabilityPoll;
  /** Its candidate times, in the order the creator offered them. */
  slots: AvailabilitySlot[];
  /** Every answer across every slot. Feed it straight to {@link tally}. */
  votes: AvailabilityVote[];
};

/** What {@link subscribeToPoll} hands its listener on every change. */
export type AvailabilityChange = {
  /** `"DELETE"` is someone taking their answer back. */
  event: "INSERT" | "UPDATE" | "DELETE";
  /** Which candidate time moved (`availability_slots.id`). */
  slot_id: string;
  /**
   * The vote as the database now has it, or null on a DELETE. Realtime rows
   * carry no embedded profile, so `voter` is always null here.
   */
  vote: AvailabilityVote | null;
};

/** One slot's counts, from {@link tally}. */
export type SlotTally = {
  /** Which slot these counts belong to (`availability_slots.id`). */
  slot_id: string;
  /** The slot's ISO start, carried through so a winner can render itself. */
  starts_at: string;
  /** How many said yes. */
  yes: number;
  /** How many said maybe. */
  maybe: number;
  /** How many said no. */
  no: number;
  /** `yes + maybe / 2`: a maybe is half a yes. Ranks the slots. */
  score: number;
};

/** What {@link bestSlot} hands back when a time is winning. */
export type BestSlot = {
  /** The winning slot. With a tie, the deterministic pick among the leaders. */
  slot: SlotTally;
  /** True when exactly one slot holds the top score, i.e. `tied.length === 1`. */
  clear: boolean;
  /**
   * Every slot sharing the top score, earliest first, including
   * {@link BestSlot.slot}. Length 1 on a clear win, 2+ on a tie, useful for
   * "Tuesday and Thursday are neck and neck".
   */
  tied: SlotTally[];
};

/* ------------------------------ limits ------------------------------ */

/** Fewest candidate times the RPC accepts. */
export const AVAILABILITY_SLOTS_MIN = 2;

/** Most candidate times the RPC accepts. */
export const AVAILABILITY_SLOTS_MAX = 8;

/** Shortest title the database accepts, after trimming. */
export const AVAILABILITY_TITLE_MIN = 1;

/** Longest title the database accepts. Cap your TextInput here. */
export const AVAILABILITY_TITLE_MAX = 120;

/** Columns every poll query selects, creator included. Keep selects consistent. */
export const AVAILABILITY_POLL_SELECT =
  "id, channel_id, creator_id, title, closed_at, event_id, created_at, creator:profiles(id, display_name, handle, avatar_url)";

/** Columns every vote query selects, voter included. */
export const AVAILABILITY_VOTE_SELECT =
  "slot_id, user_id, response, created_at, voter:profiles(id, display_name, handle, avatar_url)";

/**
 * The whole poll in one request: slots nested under the poll, votes nested
 * under their slot. PostgREST resolves both from the foreign keys 0033
 * declared, so there's no second round trip and no chance of reading slots
 * from one moment and votes from another.
 */
const AVAILABILITY_DETAIL_SELECT = `${AVAILABILITY_POLL_SELECT}, slots:availability_slots(id, poll_id, starts_at, position, votes:availability_votes(${AVAILABILITY_VOTE_SELECT}))`;

/* ----------------------------- failures ----------------------------- */

/**
 * An availability-poll failure with a message written for a person, not a
 * log. Show `err.message` directly in your inline error; it never leaks SQL,
 * ids, or PostgREST codes.
 */
export class AvailabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvailabilityError";
  }
}

/**
 * `create_availability_poll` raises plain lowercase sentences (`raise
 * exception 'offer 2-8 times'`). PostgREST hands those back verbatim as
 * `error.message`, so we match a distinctive fragment of each and swap in the
 * warm version. Same table-driven approach as `@/lib/group-dm`.
 */
const WARM_BY_FRAGMENT: readonly (readonly [string, string])[] = [
  ["not signed in", "Sign in again to ask when everyone's free."],
  [
    "join the channel first",
    "Join this channel before asking when everyone's free.",
  ],
  ["short title", "Give the poll a short title, like “midterm review”."],
  ["offer 2-8 times", "Offer between two and eight times."],
];

/** Map a raised database message to warm copy, or fall back to `fallback`. */
function warmMessage(raw: unknown, fallback: string): string {
  const message =
    typeof raw === "object" && raw !== null
      ? String((raw as { message?: unknown }).message ?? "")
      : typeof raw === "string"
        ? raw
        : "";
  const needle = message.toLowerCase();
  for (const [fragment, warm] of WARM_BY_FRAGMENT) {
    if (needle.includes(fragment)) return warm;
  }
  return fallback;
}

/** PostgREST hands RLS refusals back as 42501. */
function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

/* ---------------------------- narrowing ----------------------------- */

/**
 * The Supabase client here is untyped, and PostgREST hands an embedded
 * relation back as an object OR a one-element array depending on how it
 * resolves the relationship (and as null when there's nothing to embed).
 * Unwrap every shape to a plain record. Same defence as
 * `@/features/mentions/use-mention-suggestions` and `@/lib/focus`.
 */
function embedded(raw: unknown): Record<string, unknown> | null {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

/** A plain record, or null when the value isn't an object at all. */
function record(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null) return null;
  return raw as Record<string, unknown>;
}

/** Narrow an embedded `profiles` row; null when it's unreadable. */
function toPerson(raw: unknown): AvailabilityPerson | null {
  const row = embedded(raw);
  if (!row) return null;
  const id = row["id"];
  const handle = row["handle"];
  const displayName = row["display_name"];
  const avatarUrl = row["avatar_url"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof handle !== "string" || handle.length === 0) return null;
  return {
    id,
    handle,
    display_name:
      typeof displayName === "string" && displayName.length > 0
        ? displayName
        : handle,
    avatar_url: typeof avatarUrl === "string" ? avatarUrl : null,
  };
}

/** Narrow `availability_votes.response`; anything else isn't an answer. */
function toResponse(raw: unknown): AvailabilityResponse | null {
  if (raw === "yes" || raw === "maybe" || raw === "no") return raw;
  return null;
}

/**
 * Narrow one `availability_polls` row. Null when it's missing something we
 * promise callers. Better an honest null than a poll with no question on it.
 */
function toPoll(raw: unknown): AvailabilityPoll | null {
  const row = record(raw);
  if (!row) return null;
  const id = row["id"];
  const channelId = row["channel_id"];
  const creatorId = row["creator_id"];
  const title = row["title"];
  const createdAt = row["created_at"];
  const closedAt = row["closed_at"];
  const eventId = row["event_id"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof channelId !== "string" || channelId.length === 0) return null;
  if (typeof creatorId !== "string" || creatorId.length === 0) return null;
  if (typeof title !== "string" || title.length === 0) return null;
  if (typeof createdAt !== "string" || createdAt.length === 0) return null;
  return {
    id,
    channel_id: channelId,
    creator_id: creatorId,
    title,
    closed_at:
      typeof closedAt === "string" && closedAt.length > 0 ? closedAt : null,
    event_id: typeof eventId === "string" && eventId.length > 0 ? eventId : null,
    created_at: createdAt,
    creator: toPerson(row["creator"]),
  };
}

/** Narrow one `availability_slots` row; null when it has no usable time. */
function toSlot(raw: unknown, pollId: string): AvailabilitySlot | null {
  const row = record(raw);
  if (!row) return null;
  const id = row["id"];
  const startsAt = row["starts_at"];
  const position = row["position"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof startsAt !== "string" || startsAt.length === 0) return null;
  const ownPollId = row["poll_id"];
  return {
    id,
    poll_id:
      typeof ownPollId === "string" && ownPollId.length > 0
        ? ownPollId
        : pollId,
    starts_at: startsAt,
    position:
      typeof position === "number" && Number.isFinite(position) ? position : 0,
  };
}

/**
 * Narrow one `availability_votes` row, from a query or a realtime payload.
 * Null when the slot, the person, or the answer itself is unreadable.
 */
function toVote(raw: unknown): AvailabilityVote | null {
  const row = record(raw);
  if (!row) return null;
  const slotId = row["slot_id"];
  const userId = row["user_id"];
  const response = toResponse(row["response"]);
  const createdAt = row["created_at"];
  if (typeof slotId !== "string" || slotId.length === 0) return null;
  if (typeof userId !== "string" || userId.length === 0) return null;
  if (response === null) return null;
  return {
    slot_id: slotId,
    user_id: userId,
    response,
    created_at:
      typeof createdAt === "string" && createdAt.length > 0 ? createdAt : "",
    voter: toPerson(row["voter"]),
  };
}

/* ---------------------------- validation ---------------------------- */

/**
 * Trim a proposed title and check it against the same 1-120 window the
 * database enforces, so an empty or runaway title never costs a round trip.
 *
 * @returns The trimmed title, ready for the RPC.
 * @throws {AvailabilityError} With copy that's ready to render.
 */
function requireTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < AVAILABILITY_TITLE_MIN) {
    throw new AvailabilityError("Give this poll a title first.");
  }
  if (trimmed.length > AVAILABILITY_TITLE_MAX) {
    throw new AvailabilityError(
      `Titles stop at ${AVAILABILITY_TITLE_MAX} characters. Try a shorter one.`
    );
  }
  return trimmed;
}

/**
 * Turn the composer's `Date`s into the ISO strings the RPC's `timestamptz[]`
 * takes. Invalid dates and exact duplicates drop out first (two identical
 * times aren't a choice), and what's left is sorted earliest first, so the
 * slots' `position` always runs in chronological order no matter what order
 * the composer collected them in.
 *
 * @returns Between 2 and 8 ISO timestamps, earliest first.
 * @throws {AvailabilityError} With copy that's ready to render.
 */
function requireSlots(slots: readonly Date[]): string[] {
  const seen = new Set<number>();
  const times: number[] = [];
  for (const slot of slots) {
    const ms = slot instanceof Date ? slot.getTime() : Number.NaN;
    if (!Number.isFinite(ms) || seen.has(ms)) continue;
    seen.add(ms);
    times.push(ms);
  }
  times.sort((a, b) => a - b);
  if (
    times.length < AVAILABILITY_SLOTS_MIN ||
    times.length > AVAILABILITY_SLOTS_MAX
  ) {
    throw new AvailabilityError("Offer between two and eight times.");
  }
  return times.map((ms) => new Date(ms).toISOString());
}

/**
 * The caller's `profiles.id`, read from the stored session (no network hop:
 * supabase-js refreshes the token itself when it's stale).
 *
 * @throws {AvailabilityError} When nobody's signed in.
 */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (error || typeof id !== "string" || id.length === 0) {
    throw new AvailabilityError("Sign in again to answer this poll.");
  }
  return id;
}

/* ------------------------------ writes ------------------------------ */

/**
 * Ask a channel when everyone's free. One transaction writes the poll, its
 * candidate times, and the chat message announcing it, so the channel never
 * shows a poll message pointing at a poll that isn't there.
 *
 * Title and times are cleaned here first (trimmed, deduped, sorted, counted),
 * so the database's own checks stay a backstop rather than an error path
 * students see. Times in the past are allowed on purpose: "tonight at 7"
 * shouldn't stop working at 7:01.
 *
 * Not optimistic-friendly: wait for the id before navigating, so nobody lands
 * on a poll RLS refused to create.
 *
 * @param channelId The channel's `channels.id`. You have to be a member.
 * @param title     The question; trimmed, 1-120 characters.
 * @param slots     2-8 candidate times. Duplicates and invalid dates drop out
 *   before the count is checked.
 * @returns The new poll's `availability_polls.id`.
 * @throws {AvailabilityError} With copy that's ready to render.
 */
export async function createAvailabilityPoll(
  channelId: string,
  title: string,
  slots: readonly Date[]
): Promise<string> {
  const cleanTitle = requireTitle(title);
  const cleanSlots = requireSlots(slots);

  const { data, error } = await supabase.rpc("create_availability_poll", {
    p_channel_id: channelId,
    p_title: cleanTitle,
    p_slots: cleanSlots,
  });
  if (error) {
    throw new AvailabilityError(
      warmMessage(error, "We couldn't start that poll just now. Try again.")
    );
  }
  if (typeof data !== "string" || data.length === 0) {
    throw new AvailabilityError(
      "We couldn't start that poll just now. Try again."
    );
  }
  return data;
}

/**
 * Answer one candidate time, or change the answer you already gave: an
 * upsert on the `(slot_id, user_id)` primary key, so tapping "yes" twice is
 * the same as tapping it once.
 *
 * Safe to run optimistically: swap the chip's state, call this, and roll back
 * to the previous answer if it throws.
 *
 * The database only refuses NEW answers on a closed poll (the insert policy
 * checks `closed_at is null`; the update policy doesn't), so gate the whole
 * row on {@link canVote} rather than relying on this call to refuse.
 *
 * @param slotId   The candidate time's `availability_slots.id`.
 * @param response Their answer.
 * @returns The stored vote, voter attached. Use it to reconcile your
 *   optimistic state.
 * @throws {AvailabilityError} With copy that's ready to render.
 */
export async function vote(
  slotId: string,
  response: AvailabilityResponse
): Promise<AvailabilityVote> {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from("availability_votes")
    .upsert(
      { slot_id: slotId, user_id: userId, response },
      { onConflict: "slot_id,user_id" }
    )
    .select(AVAILABILITY_VOTE_SELECT)
    .single();

  if (error) {
    // 42501 is the RLS refusal: the poll has closed, or you've left the
    // channel it lives in.
    if (errorCode(error) === "42501") {
      throw new AvailabilityError(
        "This poll is closed, so the times are set. Ask whoever started it to open a new one."
      );
    }
    throw new AvailabilityError(
      "That answer didn't save. Give it another tap."
    );
  }

  const saved = toVote(data);
  if (!saved) {
    throw new AvailabilityError(
      "That answer didn't save. Give it another tap."
    );
  }
  return saved;
}

/**
 * Take your answer to one time back, leaving you unanswered on it rather than
 * on record as a no. Only ever removes your own row: the delete policy
 * matches on `auth.uid()` and we filter by it here too.
 *
 * Clearing an answer you never gave resolves quietly: the intent ("I have no
 * answer for this one") already holds. That makes it safe to run
 * optimistically.
 *
 * @param slotId The candidate time's `availability_slots.id`.
 * @throws {AvailabilityError} With copy that's ready to render.
 */
export async function clearVote(slotId: string): Promise<void> {
  const userId = await requireUserId();

  const { error } = await supabase
    .from("availability_votes")
    .delete()
    .eq("slot_id", slotId)
    .eq("user_id", userId);
  if (error) {
    throw new AvailabilityError(
      "We couldn't clear that answer. Give it another tap."
    );
  }
}

/**
 * Close the poll: stamp `closed_at` so no new answers come in and the winning
 * time can be read as final. Creator only: the update policy matches on
 * `creator_id`, so gate the button with {@link canManagePoll} and nobody taps
 * something the database will refuse.
 *
 * Closing a poll that's already closed just re-stamps the moment rather than
 * failing, so a double tap costs nothing.
 *
 * @param pollId The poll's `availability_polls.id`.
 * @returns The ISO `closed_at` now stored. Use it for your optimistic state.
 * @throws {AvailabilityError} With copy that's ready to render.
 */
export async function closePoll(pollId: string): Promise<string> {
  const closedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("availability_polls")
    .update({ closed_at: closedAt })
    .eq("id", pollId)
    .select("closed_at")
    .maybeSingle();
  if (error) {
    throw new AvailabilityError(
      "We couldn't close that poll just now. Give it another go."
    );
  }
  // Zero rows updated isn't an error to PostgREST, but it means the policy
  // didn't match; this poll belongs to someone else.
  if (!data) {
    throw new AvailabilityError(
      "Only the person who started this poll can close it."
    );
  }
  const stored = record(data)?.["closed_at"];
  return typeof stored === "string" && stored.length > 0 ? stored : closedAt;
}

/**
 * Point the poll at the study session that came out of it, so the poll can
 * say "this became Thursday's review" instead of sitting there answered and
 * unresolved. Creator only, same policy as {@link closePoll}.
 *
 * Create the event first (it has its own table and rules); this only records
 * the link. Passing an event the creator can't see still writes the id: RLS
 * guards who may write the poll row, not which event it names.
 *
 * @param pollId  The poll's `availability_polls.id`.
 * @param eventId The study session's `events.id`.
 * @throws {AvailabilityError} With copy that's ready to render.
 */
export async function attachEvent(
  pollId: string,
  eventId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("availability_polls")
    .update({ event_id: eventId })
    .eq("id", pollId)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new AvailabilityError(
      "We couldn't link that study session to the poll. Give it another go."
    );
  }
  if (!data) {
    throw new AvailabilityError(
      "Only the person who started this poll can turn it into a study session."
    );
  }
}

/* ------------------------------ reads ------------------------------- */

/**
 * One poll, its candidate times in order, and every answer on it, in a single
 * request, so the counts can never come from a different moment than the
 * times they're counting.
 *
 * Slots are sorted by `position`, then by start, then by id, so the order is
 * the creator's and it's stable. Votes come back flat across every slot,
 * oldest first, ready for {@link tally}.
 *
 * RLS is member-scoped, so null covers both "no such poll" and "you're not in
 * that channel". They look the same from here, and both mean the same thing
 * to the screen.
 *
 * @param pollId The poll's `availability_polls.id`.
 * @throws {AvailabilityError} With copy that's ready to render.
 */
export async function fetchPoll(
  pollId: string
): Promise<AvailabilityPollDetail | null> {
  const { data, error } = await supabase
    .from("availability_polls")
    .select(AVAILABILITY_DETAIL_SELECT)
    .eq("id", pollId)
    .maybeSingle();
  if (error) {
    throw new AvailabilityError(
      "We couldn't load this poll. Check your connection and give it another go."
    );
  }

  const poll = toPoll(data);
  if (!poll) return null;

  const rows = record(data)?.["slots"];
  const slots: AvailabilitySlot[] = [];
  const votes: AvailabilityVote[] = [];
  if (Array.isArray(rows)) {
    for (const raw of rows) {
      const slot = toSlot(raw, poll.id);
      if (!slot) continue;
      slots.push(slot);
      const voteRows = record(raw)?.["votes"];
      if (!Array.isArray(voteRows)) continue;
      for (const voteRow of voteRows) {
        const parsed = toVote(voteRow);
        if (parsed) votes.push(parsed);
      }
    }
  }

  slots.sort(
    (a, b) =>
      a.position - b.position ||
      a.starts_at.localeCompare(b.starts_at) ||
      a.id.localeCompare(b.id)
  );
  votes.sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) ||
      a.slot_id.localeCompare(b.slot_id) ||
      a.user_id.localeCompare(b.user_id)
  );

  return { poll, slots, votes };
}

/* ---------------------------- realtime ------------------------------ */

/** Channel topics must be unique per subscription, so number them. */
let channelSeq = 0;

/**
 * Watch a poll fill in. Fires `onChange` on every answer added, changed, or
 * withdrawn on this poll's slots. `availability_votes` is in the realtime
 * publication and its SELECT policy is member-scoped, so the socket only ever
 * delivers rows the caller could already read.
 *
 * Votes carry no `poll_id`, so the subscription can't be filtered server-side
 * by poll. Instead this reads the poll's slot ids once (they never change
 * after creation) and drops any payload for a slot that isn't one of them, so
 * every other poll in your channels stays out of the way.
 *
 * The poll row itself is NOT in the publication: closing a poll or attaching
 * an event won't arrive here. Refetch on focus, or trust the local state of
 * whoever pressed the button.
 *
 * The simplest correct listener refetches:
 *
 * ```ts
 * useEffect(() => subscribeToPoll(pollId, () => void refresh()), [pollId, refresh]);
 * ```
 *
 * @param pollId   The poll's `availability_polls.id`.
 * @param onChange Called with the event, the slot, and the row as it stands.
 * @returns An unsubscribe function. Return it straight from a `useEffect`.
 *   Safe to call before the slot lookup has finished.
 */
export function subscribeToPoll(
  pollId: string,
  onChange: (change: AvailabilityChange) => void
): () => void {
  channelSeq += 1;
  const topic = `availability-votes:${pollId}:${channelSeq}`;
  const slotIds = new Set<string>();
  let channel: RealtimeChannel | null = null;
  let cancelled = false;

  const handle = (
    event: "INSERT" | "UPDATE" | "DELETE",
    payload: RealtimePostgresChangesPayload<Record<string, unknown>>
  ): void => {
    // A DELETE payload carries only the primary key, (slot_id, user_id),
    // which is exactly enough to know which slot lost an answer.
    const row = record(event === "DELETE" ? payload.old : payload.new);
    const slotId = row?.["slot_id"];
    if (typeof slotId !== "string" || !slotIds.has(slotId)) return;
    onChange({
      event,
      slot_id: slotId,
      vote: event === "DELETE" ? null : toVote(row),
    });
  };

  void (async () => {
    const { data } = await supabase
      .from("availability_slots")
      .select("id")
      .eq("poll_id", pollId);
    if (cancelled) return;
    if (Array.isArray(data)) {
      for (const raw of data) {
        const id = record(raw)?.["id"];
        if (typeof id === "string" && id.length > 0) slotIds.add(id);
      }
    }
    // No readable slots means no poll to watch, so leave the socket alone.
    if (slotIds.size === 0) return;

    channel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "availability_votes" },
        (payload) => handle("INSERT", payload)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "availability_votes" },
        (payload) => handle("UPDATE", payload)
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "availability_votes" },
        (payload) => handle("DELETE", payload)
      )
      .subscribe();
  })();

  return () => {
    cancelled = true;
    if (channel) void supabase.removeChannel(channel);
    channel = null;
  };
}

/* --------------------------- pure helpers --------------------------- */

/** What a maybe is worth against a yes when ranking slots. */
const MAYBE_WEIGHT = 0.5;

/**
 * Count each candidate time: how many yes, maybe, and no, plus a `score` that
 * ranks them: a yes is worth 1, a maybe 0.5, a no nothing.
 *
 * Returns one entry per slot in the order the slots were given, including
 * slots nobody has answered (all zeros), so a list can map straight over it.
 *
 * A person only ever counts once per slot: the database's primary key
 * guarantees it server-side, and if the array holds two rows for the same
 * pair (an optimistic vote sitting in front of the fetched one), the LAST
 * one wins. Votes pointing at unknown slots are ignored.
 *
 * Pure: no I/O, no clock. Same inputs, same numbers, every time.
 *
 * @param slots The candidate times, from {@link fetchPoll}.
 * @param votes Every answer on the poll; order only matters for duplicates.
 */
export function tally(
  slots: readonly Pick<AvailabilitySlot, "id" | "starts_at">[],
  votes: readonly Pick<AvailabilityVote, "slot_id" | "user_id" | "response">[]
): SlotTally[] {
  const out: SlotTally[] = [];
  const counts = new Map<string, SlotTally>();
  for (const slot of slots) {
    // A slot listed twice shares one entry rather than double-counting.
    if (counts.has(slot.id)) continue;
    const entry: SlotTally = {
      slot_id: slot.id,
      starts_at: slot.starts_at,
      yes: 0,
      maybe: 0,
      no: 0,
      score: 0,
    };
    counts.set(slot.id, entry);
    out.push(entry);
  }

  // One answer per (slot, person), last one wins, so an optimistic vote can
  // be appended to the fetched list without inflating the counts.
  const latest = new Map<string, Map<string, AvailabilityResponse>>();
  for (const one of votes) {
    if (!counts.has(one.slot_id)) continue;
    const perSlot =
      latest.get(one.slot_id) ?? new Map<string, AvailabilityResponse>();
    perSlot.set(one.user_id, one.response);
    latest.set(one.slot_id, perSlot);
  }

  for (const entry of out) {
    const perSlot = latest.get(entry.slot_id);
    if (perSlot) {
      for (const response of perSlot.values()) {
        if (response === "yes") entry.yes += 1;
        else if (response === "maybe") entry.maybe += 1;
        else entry.no += 1;
      }
    }
    entry.score = entry.yes + entry.maybe * MAYBE_WEIGHT;
  }
  return out;
}

/**
 * The time that's winning, and whether it's winning outright.
 *
 * The top score takes it. Ties are broken by more definite yeses, then fewer
 * nos, then the earlier time, then the slot id. That order is deterministic,
 * so two devices never name different winners. `clear` is false whenever more
 * than one slot holds that top score, however the tie was broken, and `tied`
 * lists all of them earliest first.
 *
 * Returns null when there's nothing to declare: no slots, or a top score of 0
 * because nobody has said yes or maybe to anything yet. Say so in the UI
 * ("no time works for everyone yet") rather than crowning a slot full of nos.
 *
 * Pure: no I/O, no clock.
 *
 * @param tallies The counts from {@link tally}.
 */
export function bestSlot(tallies: readonly SlotTally[]): BestSlot | null {
  let top = 0;
  for (const entry of tallies) {
    if (entry.score > top) top = entry.score;
  }
  if (top <= 0) return null;

  const tied = tallies.filter((entry) => entry.score === top);
  if (tied.length === 0) return null;

  const ranked = [...tied].sort(
    (a, b) =>
      b.yes - a.yes ||
      a.no - b.no ||
      a.starts_at.localeCompare(b.starts_at) ||
      a.slot_id.localeCompare(b.slot_id)
  );
  const winner = ranked[0];
  if (!winner) return null;

  return {
    slot: winner,
    clear: tied.length === 1,
    tied: [...tied].sort(
      (a, b) =>
        a.starts_at.localeCompare(b.starts_at) ||
        a.slot_id.localeCompare(b.slot_id)
    ),
  };
}

/** How many times {@link suggestSlots} offers when you don't say. */
export const SUGGEST_SLOTS_DEFAULT = 4;

/** The hour a suggested weeknight slot lands on: after dinner, before late. */
export const SUGGEST_EVENING_HOUR = 19;

/** The hour a suggested weekend slot lands on. */
export const SUGGEST_AFTERNOON_HOUR = 14;

/**
 * How far out a suggestion has to be. A poll opened at 6:50pm shouldn't offer
 * tonight at 7. Nobody can answer in ten minutes.
 */
export const SUGGEST_LEAD_MINUTES = 60;

/** Whole minutes, in milliseconds. */
const MINUTE_MS = 60 * 1000;

/**
 * Sensible times to prefill the composer with: the next few evenings at 7pm
 * plus the next weekend afternoon at 2pm, earliest first.
 *
 * These are a STARTING POINT, not a recommendation. The composer shows them
 * as editable rows and most students will drag one or two around before they
 * post. The point is that the poll opens with something plausible in it
 * instead of an empty form.
 *
 * Everything is built in the device's local time zone, because "7pm" means the
 * student's 7pm. Anything sooner than {@link SUGGEST_LEAD_MINUTES} from now is
 * skipped, so the list is always answerable.
 *
 * Pure: pass `now` in, from state or a test. Never reads the clock.
 *
 * @param now   The current moment.
 * @param count How many times to offer; rounded and clamped to 2-8, the same
 *   window the database accepts. Defaults to 4.
 * @returns `count` distinct times, earliest first, or `[]` if `now` isn't a
 *   real date.
 */
export function suggestSlots(
  now: Date,
  count: number = SUGGEST_SLOTS_DEFAULT
): Date[] {
  const base = now.getTime();
  if (!Number.isFinite(base)) return [];

  const wanted = Number.isFinite(count)
    ? Math.min(
        Math.max(Math.round(count), AVAILABILITY_SLOTS_MIN),
        AVAILABILITY_SLOTS_MAX
      )
    : SUGGEST_SLOTS_DEFAULT;
  const earliest = base + SUGGEST_LEAD_MINUTES * MINUTE_MS;

  /** Local midnight `offset` days from today, moved to `hour`. */
  const at = (offset: number, hour: number): Date =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour);

  const picks: Date[] = [];

  // One weekend afternoon, whichever of Saturday or Sunday comes first.
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = at(offset, SUGGEST_AFTERNOON_HOUR);
    const weekday = day.getDay();
    if (weekday !== 0 && weekday !== 6) continue;
    if (day.getTime() < earliest) continue;
    picks.push(day);
    break;
  }

  // Then evenings, starting tonight if there's still time to answer.
  for (let offset = 0; offset <= 14 && picks.length < wanted; offset += 1) {
    const evening = at(offset, SUGGEST_EVENING_HOUR);
    if (evening.getTime() < earliest) continue;
    picks.push(evening);
  }

  picks.sort((a, b) => a.getTime() - b.getTime());
  return picks.slice(0, wanted);
}

/**
 * Whether this poll is still taking answers. The database only enforces it on
 * a first answer, not on changing one, so this is the rule the UI holds:
 * a closed poll shows its result and no chips.
 *
 * Pure.
 *
 * @param poll The poll's `closed_at`; a full {@link AvailabilityPoll} works.
 */
export function canVote(poll: Pick<AvailabilityPoll, "closed_at">): boolean {
  return poll.closed_at === null;
}

/**
 * Whether the signed-in person may close this poll or turn it into a study
 * session: the client-side twin of the "creators close their polls" policy.
 * Keep the rule here so a menu and an empty state can never disagree about
 * who's in charge of a poll.
 *
 * Pure.
 *
 * @param poll The poll in question.
 * @param myId Your own `profiles.id`, or null while the session resolves.
 */
export function canManagePoll(
  poll: Pick<AvailabilityPoll, "creator_id">,
  myId: string | null
): boolean {
  if (myId === null || myId.length === 0) return false;
  return poll.creator_id === myId;
}

/**
 * How one person answered one slot, or null if they haven't. Use it to light
 * up the chip a student already picked.
 *
 * Later rows win, matching {@link tally}, so an optimistic vote appended to
 * the fetched list reads back correctly.
 *
 * Pure.
 *
 * @param votes  Every answer on the poll.
 * @param slotId The candidate time in question.
 * @param userId Whose answer to look for; null while the session resolves.
 */
export function responseFor(
  votes: readonly Pick<AvailabilityVote, "slot_id" | "user_id" | "response">[],
  slotId: string,
  userId: string | null
): AvailabilityResponse | null {
  if (userId === null || userId.length === 0) return null;
  let found: AvailabilityResponse | null = null;
  for (const one of votes) {
    if (one.slot_id === slotId && one.user_id === userId) found = one.response;
  }
  return found;
}
