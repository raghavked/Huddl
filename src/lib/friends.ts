import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Friendship } from "@/lib/types";

/* Friends and presence: the data layer.
 *
 * A friendship is ONE row, whoever asked first. `friendships` keys on
 * (requester_id, addressee_id), starts `pending`, and there is never a mirror
 * row for the other direction, so "are we friends" is one lookup and the
 * answer depends on which side of the row you're standing on.
 * {@link edgeState} does that standing-on once, pure, so a button and a unit
 * test read the same edge the same way.
 *
 * The policies do most of the arguing for us:
 *
 *   insert  only as yourself, only starting `pending`, never toward someone
 *           in a blocked pair. Asking is the one move everyone has.
 *   update  only by the addressee, only to `accepted`. `responded_at` is
 *           stamped by a trigger, never by a client, so nobody can accept on
 *           someone else's behalf or backdate an answer.
 *   delete  by either end. Cancel, decline, ignore and unfriend are all the
 *           same delete, which is why {@link removeEdge} is one function: the
 *           row goes away and nobody is told which word you used.
 *   select  both ends can read the edge, and the `friend` notification
 *           arrives from a DB trigger, so nothing here writes notifications.
 *
 * Presence is deliberately vaguer than the column under it.
 * `profiles.last_seen_at` is written ONLY through the `touch_last_seen()`
 * RPC: no arguments, throttled server-side, silent while sharing is off.
 * {@link touchPresence} adds a client-side throttle on top and swallows every
 * failure, because presence is ambience, not an errand, and no screen should
 * ever show an error about it. On the way out, {@link presenceLabel} rounds a
 * timestamp down to one of three phrases or to nothing at all: a classmate
 * learns "Active now", never "last seen 02:47". Turning `share_last_seen` off
 * erases `last_seen_at` server-side, so a row that still carries a timestamp
 * is a row whose owner is sharing it.
 *
 * No React, no theme, no navigation in here: queries, narrowing, and pure
 * helpers that take `now` as an argument so a ticking screen and a unit test
 * get the same answers. Failures arrive as a {@link FriendsError} whose
 * message is warm, specific, and safe to drop straight into an inline error.
 *
 * The one web-only adjustment, the same one `@/lib/focus` and
 * `@/lib/moderation` make: there is no module-level Supabase singleton here
 * the way there is in the native app. Every I/O function takes an optional
 * trailing {@link FriendsCtx}. Browser callers omit it and get the shared
 * browser client; a server component passes its request-scoped client (and
 * the user id it already resolved) so nothing has to read the session cookie
 * twice.
 */

/* ═══════════════════════════ the vocabulary ══════════════════════════ */

/**
 * Where you and one other person stand, from where YOU are standing. The
 * same `pending` row reads `outgoing` to the one who asked and `incoming` to
 * the one being asked, which is exactly the difference between a "Request
 * sent" button and an "Accept request" one.
 */
export type FriendState = "none" | "outgoing" | "incoming" | "friends";

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
export type FriendsCtx = {
  client?: Db;
  userId?: string | null;
};

/**
 * Just enough of a person to draw a friends row: an avatar, a name, and the
 * quiet "Active now" line under it.
 */
export type FriendPerson = {
  /** `profiles.id`. */
  id: string;
  /** Their handle, without the leading `@`. This is what `/u/<handle>` takes. */
  handle: string;
  /** Their display name, falling back to their handle if it's somehow blank. */
  display_name: string;
  /** Their avatar, or null. Fall back to initials via `@/components/avatar`. */
  avatar_url: string | null;
  /**
   * When they were last active, or null. Already null whenever they aren't
   * sharing (the narrowing enforces what the server also guarantees), so
   * hand it straight to {@link presenceLabel} without checking the toggle.
   */
  last_seen_at: string | null;
  /** Whether they share the "Active now" line at all. */
  share_last_seen: boolean;
};

/**
 * One `friendships` row with both ends' profiles embedded. Either embed can
 * be null when that profile isn't readable; {@link splitFriendships} keeps
 * only rows where the OTHER person survived, because a friends row with
 * nobody on it isn't a row anyone can render.
 */
export type FriendEdgeRow = Friendship & {
  /** The asker's profile, or null when it isn't readable. */
  requester: FriendPerson | null;
  /** The asked's profile, or null when it isn't readable. */
  addressee: FriendPerson | null;
};

/** One renderable line of the friends screen: the edge, and the other person. */
export type FriendListItem = {
  /** The raw edge, for {@link edgeState} and for keys. */
  edge: Friendship;
  /** The person across the edge from you. */
  person: FriendPerson;
};

/** The friends screen's three sections, in the order they render. */
export type FriendSections = {
  /** Pending edges pointed AT you: people waiting on your answer. */
  requests: FriendListItem[];
  /** Pending edges you sent: people you're waiting on. */
  sent: FriendListItem[];
  /** Accepted edges, whoever asked first. */
  friends: FriendListItem[];
};

/* ══════════════════════════════ limits ═══════════════════════════════ */

/** The columns of a bare edge, for the state check on a profile. */
const EDGE_COLUMNS =
  "requester_id, addressee_id, status, created_at, responded_at";

/** Columns of an embedded profile. Keep the two embeds identical. */
const PERSON_COLUMNS =
  "id, handle, display_name, avatar_url, last_seen_at, share_last_seen";

/** Columns every friends-list query selects. Keep selects consistent. */
export const FRIEND_SELECT =
  `${EDGE_COLUMNS}, ` +
  // Two foreign keys point at `profiles`, so both embeds need naming.
  `requester:profiles!friendships_requester_id_fkey(${PERSON_COLUMNS}), ` +
  `addressee:profiles!friendships_addressee_id_fkey(${PERSON_COLUMNS})`;

/**
 * How long {@link touchPresence} stays quiet after a touch, in milliseconds.
 * The server throttles too; this just keeps a chatty screen from paying for
 * round trips the server would shrug at anyway.
 */
const TOUCH_QUIET_MS = 60 * 1000;

/* ═════════════════════════════ failures ══════════════════════════════ */

/**
 * A friends failure with a message written for a person, not a log. Show
 * `err.message` directly in your inline error; it never leaks SQL, ids, or
 * PostgREST codes.
 */
export class FriendsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FriendsError";
  }
}

/* ══════════════════════════════ client ═══════════════════════════════ */

/** One browser client for the whole tab, made on first use. */
let browserDb: Db | null = null;

/** The client to run against: the caller's, or the shared browser one. */
function db(ctx?: FriendsCtx): Db {
  if (ctx?.client) return ctx.client;
  if (typeof window === "undefined") {
    // A developer mistake rather than a student's problem, so say what's
    // missing.
    throw new Error(
      "@/lib/friends: on the server, pass { client } from @/lib/supabase/server."
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
 * Unwrap every shape to a plain record. Same defence as `@/lib/moderation`
 * and `@/lib/focus`.
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

/**
 * Narrow an embedded `profiles` row; null when there's no usable person on
 * it. When they aren't sharing, `last_seen_at` reads as null HERE TOO: the
 * server already erases it, and this narrowing makes sure a stale cache or a
 * clock race can never leak a timestamp its owner switched off.
 */
function toFriendPerson(raw: unknown): FriendPerson | null {
  const record = embedded(raw);
  if (!record) return null;
  const id = text(record["id"]);
  const handle = text(record["handle"]);
  if (id === null || handle === null) return null;
  const sharing = record["share_last_seen"] === true;
  return {
    id,
    handle,
    display_name: text(record["display_name"]) ?? handle,
    avatar_url: text(record["avatar_url"]),
    last_seen_at: sharing ? text(record["last_seen_at"]) : null,
    share_last_seen: sharing,
  };
}

/**
 * Narrow one `friendships` row. A row missing either end or its filing time
 * isn't an edge we can reason about, so it's dropped rather than guessed at.
 * An unexpected status reads as `pending`, the column's starting value.
 */
function toEdge(raw: unknown): Friendship | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const requesterId = text(record["requester_id"]);
  const addresseeId = text(record["addressee_id"]);
  const createdAt = text(record["created_at"]);
  if (requesterId === null || addresseeId === null || createdAt === null) {
    return null;
  }
  return {
    requester_id: requesterId,
    addressee_id: addresseeId,
    status: record["status"] === "accepted" ? "accepted" : "pending",
    created_at: createdAt,
    responded_at: text(record["responded_at"]),
  };
}

/** {@link toEdge} plus both embedded profiles, for the friends list. */
function toEdgeRow(raw: unknown): FriendEdgeRow | null {
  const edge = toEdge(raw);
  if (!edge) return null;
  const record = raw as Record<string, unknown>;
  return {
    ...edge,
    requester: toFriendPerson(record["requester"]),
    addressee: toFriendPerson(record["addressee"]),
  };
}

/* ═══════════════════════════════ reads ═══════════════════════════════ */

/**
 * The caller's `profiles.id`: theirs if they handed one over, otherwise read
 * from the stored session. Null rather than a throw when nobody is signed in:
 * every caller here has a warmer answer for that than an error.
 */
async function currentUserId(ctx?: FriendsCtx): Promise<string | null> {
  const given = ctx?.userId;
  if (typeof given === "string" && given.length > 0) return given;
  const { data } = await db(ctx).auth.getSession();
  const id = data.session?.user.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * The one PostgREST filter that finds the edge between you and one other
 * person, whichever of you asked first.
 */
function pairFilter(myId: string, otherId: string): string {
  return (
    `and(requester_id.eq.${myId},addressee_id.eq.${otherId}),` +
    `and(requester_id.eq.${otherId},addressee_id.eq.${myId})`
  );
}

/**
 * The raw edge between you and one other person, or null when there isn't
 * one (which includes being signed out: no session, no edges). RLS only
 * shows edges you're on, so null honestly means "nothing between you".
 *
 * Most screens want {@link fetchFriendState} instead; this exists for the
 * moment a button needs the row itself, e.g. to know when a request was sent.
 *
 * @throws {FriendsError} With copy that's ready to render.
 */
export async function fetchFriendEdge(
  otherId: string,
  ctx?: FriendsCtx
): Promise<Friendship | null> {
  const myId = await currentUserId(ctx);
  if (myId === null) return null;

  // limit(1) rather than maybeSingle(): the pair key makes a second row
  // impossible in one direction, and if the other direction ever slipped in,
  // one edge rendered honestly beats an error nobody can act on.
  const { data, error } = await db(ctx)
    .from("friendships")
    .select(EDGE_COLUMNS)
    .or(pairFilter(myId, otherId))
    .limit(1);
  if (error) {
    throw new FriendsError(
      "We couldn't check where you two stand. Give it another go."
    );
  }
  return Array.isArray(data) && data.length > 0 ? toEdge(data[0]) : null;
}

/**
 * Where you and one other person stand: {@link fetchFriendEdge} plus
 * {@link edgeState}, for the profile screen's one button.
 *
 * @throws {FriendsError} With copy that's ready to render.
 */
export async function fetchFriendState(
  myId: string,
  otherId: string,
  ctx?: FriendsCtx
): Promise<FriendState> {
  const edge = await fetchFriendEdge(otherId, { ...ctx, userId: myId });
  return edgeState(edge, myId);
}

/**
 * Every edge you're on, both pendings and accepted, with both ends' profiles
 * embedded. RLS already scopes the table to your own edges; the filter here
 * repeats that on purpose so the query still says what it means when it's
 * read on its own.
 *
 * A signed-out caller gets an empty list, not an error: the screen behind
 * this has a sign-in story of its own.
 *
 * Hand the rows to {@link splitFriendships} rather than sorting them here:
 * the sections and their order are the screen's contract, and a pure split
 * is the part a test can hold still.
 *
 * @throws {FriendsError} With copy that's ready to render.
 */
export async function listFriendships(
  ctx?: FriendsCtx
): Promise<FriendEdgeRow[]> {
  const myId = await currentUserId(ctx);
  if (myId === null) return [];

  const { data, error } = await db(ctx)
    .from("friendships")
    .select(FRIEND_SELECT)
    .or(`requester_id.eq.${myId},addressee_id.eq.${myId}`);
  if (error) {
    throw new FriendsError(
      "We couldn't load your friends. Check your connection and give it another go."
    );
  }
  if (!Array.isArray(data)) return [];

  const out: FriendEdgeRow[] = [];
  for (const row of data) {
    const edge = toEdgeRow(row);
    if (edge) out.push(edge);
  }
  return out;
}

/* ══════════════════════════════ writes ═══════════════════════════════ */

/**
 * Ask someone to be friends. The row starts `pending` (the insert policy
 * insists), the other person hears about it through the DB trigger's
 * `friend` notification, and nothing else happens until they answer.
 *
 * Safe to run optimistically: flip the button to "Request sent", call this,
 * and flip it back only if it throws.
 *
 * @param otherId The other student's `profiles.id`.
 * @throws {FriendsError} With copy that's ready to render.
 */
export async function sendRequest(
  otherId: string,
  ctx?: FriendsCtx
): Promise<void> {
  const myId = await currentUserId(ctx);
  if (myId === null) {
    throw new FriendsError("You're signed out. Sign in and ask them again.");
  }
  if (myId === otherId) {
    // The UI never offers this button on your own profile, so reaching here
    // is a caller bug, but the sentence should still make sense to a person.
    throw new FriendsError("That's you. Pick a classmate to ask.");
  }

  const { error } = await db(ctx)
    .from("friendships")
    .insert({ requester_id: myId, addressee_id: otherId });
  if (error) {
    // 23505 is the pair key: an edge already exists in one direction or the
    // other, so the honest fix is to look, not to retry.
    if (error.code === "23505") {
      throw new FriendsError(
        "There's already something between you two. Refresh to see where it stands."
      );
    }
    throw new FriendsError(
      "That request didn't send. Give it another go in a moment."
    );
  }
}

/**
 * Say yes to a request someone sent you. Only the addressee can do this and
 * only to `accepted` (the update policy insists), and `responded_at` arrives
 * from the trigger, not from here.
 *
 * A request that isn't there any more (they cancelled it, or you answered on
 * another device) comes back with nothing updated rather than an error code,
 * so this asks for the row back and treats an empty result as a failure.
 * Silence is the one outcome a button can't afford.
 *
 * @param otherId The requester's `profiles.id`.
 * @throws {FriendsError} With copy that's ready to render.
 */
export async function acceptRequest(
  otherId: string,
  ctx?: FriendsCtx
): Promise<void> {
  const myId = await currentUserId(ctx);
  if (myId === null) {
    throw new FriendsError("You're signed out. Sign in and try that again.");
  }

  const { data, error } = await db(ctx)
    .from("friendships")
    .update({ status: "accepted" })
    .eq("requester_id", otherId)
    .eq("addressee_id", myId)
    .eq("status", "pending")
    .select("requester_id")
    .maybeSingle();
  if (error) {
    throw new FriendsError(
      "That didn't save. Give it another go in a moment."
    );
  }
  if (typeof data !== "object" || data === null) {
    throw new FriendsError(
      "That request isn't waiting any more. Refresh and see where things stand."
    );
  }
}

/**
 * Take the edge away, whichever direction it points. Cancel a request you
 * sent, ignore one you got, or unfriend: the database makes no distinction
 * and neither does this, which is exactly what keeps "Ignore" quiet, since
 * the other person's edge simply stops existing, the same way a cancelled
 * one does.
 *
 * Deleting an edge that's already gone is a quiet success, not an error:
 * whatever you wanted not to exist doesn't.
 *
 * @param otherId The other student's `profiles.id`.
 * @throws {FriendsError} With copy that's ready to render.
 */
export async function removeEdge(
  otherId: string,
  ctx?: FriendsCtx
): Promise<void> {
  const myId = await currentUserId(ctx);
  if (myId === null) {
    throw new FriendsError("You're signed out. Sign in and try that again.");
  }

  const { error } = await db(ctx)
    .from("friendships")
    .delete()
    .or(pairFilter(myId, otherId));
  if (error) {
    throw new FriendsError(
      "That didn't go through. Give it another go in a moment."
    );
  }
}

/* ════════════════════════════ presence ═══════════════════════════════ */

/** When {@link touchPresence} last actually called the server, epoch ms. */
let lastTouchMs = 0;

/**
 * Tell the server you're here. Fire and forget from anywhere a student is
 * plainly active (opening the app, sending a message): the server throttles,
 * stays silent while sharing is off, and this wrapper adds a client-side
 * quiet period of {@link TOUCH_QUIET_MS} so a busy screen isn't paying for
 * round trips the server would shrug at anyway.
 *
 * NEVER throws and never returns anything to check. Presence is ambience:
 * there is no version of "we couldn't note that you're around" worth
 * interrupting anyone with, so every failure is swallowed here, on purpose.
 */
export async function touchPresence(ctx?: FriendsCtx): Promise<void> {
  const nowMs = Date.now();
  if (nowMs - lastTouchMs < TOUCH_QUIET_MS) return;
  lastTouchMs = nowMs;
  try {
    await db(ctx).rpc("touch_last_seen");
  } catch {
    // Swallowed, see above. The next quiet period ends soon enough.
  }
}

/* ═══════════════════════════ pure helpers ════════════════════════════ */

/**
 * Which side of an edge you're on, as a state the profile button can render:
 * `none`, `outgoing` ("Request sent"), `incoming` ("Accept request"), or
 * `friends`.
 *
 * An edge that doesn't include `myId` at all reads as `none`. RLS makes that
 * impossible to fetch, but a pure function shouldn't have to trust that.
 *
 * Pure.
 */
export function edgeState(edge: Friendship | null, myId: string): FriendState {
  if (edge === null) return "none";
  const mine = edge.requester_id === myId || edge.addressee_id === myId;
  if (!mine) return "none";
  if (edge.status === "accepted") return "friends";
  return edge.requester_id === myId ? "outgoing" : "incoming";
}

/** An ISO timestamp as epoch ms, or 0 when it won't parse. For sorting only. */
function stampMs(iso: string | null): number {
  if (iso === null) return 0;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * The friends screen's three sections from one pile of edges: `requests`
 * (pending, pointed at you), `sent` (pending, from you), `friends`
 * (accepted, either direction). Each section is newest first: pendings by
 * when they were asked, friendships by when they were answered.
 *
 * Rows whose other person isn't readable are dropped rather than rendered as
 * a blank card, and an edge that doesn't include `myId` is dropped too, for
 * the same reason {@link edgeState} checks.
 *
 * Pure.
 */
export function splitFriendships(
  rows: FriendEdgeRow[],
  myId: string
): FriendSections {
  const requests: FriendListItem[] = [];
  const sent: FriendListItem[] = [];
  const friends: FriendListItem[] = [];

  for (const row of rows) {
    const state = edgeState(row, myId);
    if (state === "none") continue;
    const person = row.requester_id === myId ? row.addressee : row.requester;
    if (person === null) continue;

    const item: FriendListItem = {
      // The bare edge, embeds left behind: a list row shouldn't be carrying
      // a copy of your own profile around.
      edge: {
        requester_id: row.requester_id,
        addressee_id: row.addressee_id,
        status: row.status,
        created_at: row.created_at,
        responded_at: row.responded_at,
      },
      person,
    };
    if (state === "incoming") requests.push(item);
    else if (state === "outgoing") sent.push(item);
    else friends.push(item);
  }

  const byAsked = (a: FriendListItem, b: FriendListItem) =>
    stampMs(b.edge.created_at) - stampMs(a.edge.created_at);
  requests.sort(byAsked);
  sent.sort(byAsked);
  friends.sort(
    (a, b) =>
      stampMs(b.edge.responded_at ?? b.edge.created_at) -
      stampMs(a.edge.responded_at ?? a.edge.created_at)
  );

  return { requests, sent, friends };
}

/** Milliseconds in a minute, for the arithmetic below. */
const MINUTE_MS = 60 * 1000;

/**
 * A timestamp as the three phrases presence is allowed to say, or null for
 * "say nothing": "Active now" under five minutes, "Active recently" under an
 * hour, "Active today" for the same local calendar day, and after that the
 * line simply isn't drawn. Never a raw timestamp, and never a fourth phrase.
 *
 * A `last_seen_at` a moment in the future (a clock that's drifted behind the
 * server) reads "Active now" rather than nothing: the server just heard from
 * them, which is the very thing the phrase means.
 *
 * Callers pass null when sharing is off; {@link toFriendPerson} has already
 * done that for anything it narrowed.
 *
 * Pure: pass the moment in, from a state tick or a test.
 */
export function presenceLabel(
  lastSeenIso: string | null,
  now: Date
): string | null {
  if (lastSeenIso === null) return null;
  const seenMs = new Date(lastSeenIso).getTime();
  if (Number.isNaN(seenMs)) return null;

  const elapsedMs = now.getTime() - seenMs;
  if (elapsedMs < 5 * MINUTE_MS) return "Active now";
  if (elapsedMs < 60 * MINUTE_MS) return "Active recently";

  const seen = new Date(seenMs);
  const sameLocalDay =
    seen.getFullYear() === now.getFullYear() &&
    seen.getMonth() === now.getMonth() &&
    seen.getDate() === now.getDate();
  return sameLocalDay ? "Active today" : null;
}
