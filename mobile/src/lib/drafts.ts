import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";

/* Drafts and the send queue: the data layer for words that haven't landed yet.
 *
 * Two jobs live here because they're the same promise made twice: *nothing a
 * student typed should disappear because the app closed or the bars ran out.*
 *
 *   1. DRAFTS. What you typed and didn't send, one entry per conversation,
 *      written to the device so it survives a swipe-kill, a crash, or a phone
 *      that ran out of battery on the bus. Read it back when the composer
 *      mounts and the sentence is still sitting there.
 *
 *   2. THE SEND QUEUE. What you did send, with no connection to send it over.
 *      The message goes into a persisted, ordered list; {@link flushQueue}
 *      walks that list oldest-first whenever there's a reason to think the
 *      network is back, and rows leave the queue as they land.
 *
 * The two halves never mix: a draft is text you're still writing, a queued
 * message is text you already committed to. Moving between them is the
 * caller's call. A composer typically clears the draft the moment it enqueues.
 *
 * No React in here, no theme, no navigation: AsyncStorage, one insert, and a
 * handful of pure functions. Every export is safe to call before anyone signs
 * in: the draft half never touches auth at all, and a signed-out
 * {@link flushQueue} is a deliberate no-op that spends no attempts.
 */

/* ------------------------------ shapes ------------------------------ */

/**
 * The three kinds of place a message can be composed: a channel, a direct
 * message thread, or a thread hanging off one channel message.
 */
export type ConversationKind = "channel" | "dm" | "thread";

/**
 * A conversation's identity as a single string: `"channel:<id>"`,
 * `"dm:<threadId>"`, or `"thread:<parentMessageId>"`.
 *
 * Build one with {@link keyFor} and never by hand: the type is a template
 * literal so a typo won't compile, but only {@link keyFor} guarantees the
 * shape the rest of this module (and any future clear-all) expects.
 */
export type ConversationKey =
  | `channel:${string}`
  | `dm:${string}`
  | `thread:${string}`;

/** A conversation key taken apart again. See {@link parseConversationKey}. */
export type ParsedConversationKey = {
  /** Which kind of conversation the key points at. */
  kind: ConversationKind;
  /** The id: a `channels.id`, a `dm_threads.id`, or a parent `messages.id`. */
  id: string;
};

/**
 * The two tables the queue can insert into. A channel message and a thread
 * reply are both `messages` rows. The difference is `parent_id` in the
 * payload, not a different table.
 */
export type QueuedTable = "messages" | "dm_messages";

/**
 * The row to insert, column by column. Strings and nulls only, because the
 * queue round-trips through JSON and every column these two tables take from
 * a client is text or a uuid: `content`, `channel_id`, `thread_id`,
 * `author_id`, `parent_id`, `attachment_path`, `forwarded_author_id`,
 * `forwarded_from`.
 *
 * Leave `id` out. The queue assigns it (see {@link QueuedMessage.id}).
 */
export type QueuedPayload = Record<string, string | null>;

/** What {@link enqueue} takes: where it's going, and what goes in the row. */
export type QueueRequest = {
  /** The conversation it belongs to, from {@link keyFor}. */
  key: ConversationKey;
  /** Which table the row is destined for. */
  table: QueuedTable;
  /**
   * The insert body. Must carry `content` (1-4000 characters), `author_id`,
   * and the conversation's own column: `channel_id` for `messages`,
   * `thread_id` for `dm_messages`. Anything else the table accepts may ride
   * along.
   */
  payload: QueuedPayload;
};

/** One message waiting its turn, exactly as the queue stores it. */
export type QueuedMessage = {
  /**
   * The message's id: assigned here, before it's ever sent, and inserted as
   * the row's primary key when it lands.
   *
   * That's the whole duplicate-protection story: if a send succeeds but the
   * app dies before the queue is updated, the retry hits a unique violation
   * instead of posting the message twice, and the queue reads that violation
   * as "it already landed". It also means an optimistic bubble keyed on this
   * id matches the real row when realtime delivers it.
   */
  id: string;
  /** Which conversation it belongs to: what {@link peekQueue} filters on. */
  key: ConversationKey;
  /** Which table it's destined for. */
  table: QueuedTable;
  /** The insert body, `id` included. */
  payload: QueuedPayload;
  /** ISO timestamp of when it was composed: the queue's running order. */
  created_at: string;
  /**
   * How many times a server actually answered "no" to this row. Failing to
   * reach the server at all doesn't count. See {@link flushQueue}.
   */
  attempts: number;
  /**
   * True once {@link MAX_SEND_ATTEMPTS} answered rejections have piled up.
   * A stuck row is never attempted again; it sits in the queue so the person
   * can see it and decide, via {@link dropQueued}.
   */
  stuck: boolean;
  /**
   * Warm, renderable copy explaining the last refusal, or null if it hasn't
   * been refused yet. Safe to show next to the message.
   */
  last_error: string | null;
};

/** What one pass of {@link flushQueue} did. */
export type FlushResult = {
  /**
   * Rows that landed and left the queue, oldest first. Drop the matching
   * pending bubbles, or do nothing if realtime is already going to deliver
   * them under the same ids.
   */
  sent: QueuedMessage[];
  /**
   * Rows that hit {@link MAX_SEND_ATTEMPTS} on this pass and are now stuck,
   * carrying the `last_error` that finished them off. These are the ones
   * worth putting in front of the person: nothing else will retry them.
   */
  stuck: QueuedMessage[];
  /**
   * Rows the server refused that are still under the ceiling. They stay
   * queued and the next flush tries again.
   */
  failed: QueuedMessage[];
  /** How many rows are still queued afterwards, stuck ones included. */
  remaining: number;
  /**
   * Our best guess at the connection once the pass finished, the same value
   * {@link isOnline} now returns. False means the walk stopped early because
   * the network went away mid-flush.
   */
  online: boolean;
};

/** A connectivity listener. Called with `true` for online, `false` for off. */
export type ConnectivityListener = (online: boolean) => void;

/* ------------------------------ storage ----------------------------- */

/**
 * The prefix every draft key sits behind, namespaced like
 * `hearth.display.mode` and `hearth.firstRun.welcomeSeen` so everything Hearth
 * keeps on the device sorts together.
 *
 * A draft lives at `` `${DRAFT_KEY_PREFIX}${conversationKey}` ``: one storage
 * key per conversation, so a debounced write touches one small entry instead
 * of rewriting a blob of every draft you have. Exported so a clear-all (on
 * sign-out, or a "forget my drafts" control) can find them all with
 * `getAllKeys()` without knowing this module's internals.
 */
export const DRAFT_KEY_PREFIX = "hearth.draft.";

/**
 * The single key the send queue lives under, holding a JSON array in send
 * order. Versioned: a future change to {@link QueuedMessage} that old rows
 * can't satisfy should bump the suffix rather than try to migrate messages
 * nobody can see.
 */
export const QUEUE_STORAGE_KEY = "hearth.sendQueue.v1";

/**
 * Longest draft we'll keep, matching the 1-4000 character window both
 * `messages.content` and `dm_messages.content` enforce. Cap your composer's
 * TextInput here too, so the cap is something the person sees rather than
 * something that silently eats the end of a paragraph.
 */
export const DRAFT_MAX_LENGTH = 4000;

/**
 * How many times the server may refuse a queued message before we stop
 * trying. Five is enough to ride out a flaky tunnel and few enough that a
 * message the server will never accept (a rate limit, a channel that's been
 * deleted, a club you were removed from) stops burning battery within a
 * minute of tries and starts being a thing the person can see instead.
 */
export const MAX_SEND_ATTEMPTS = 5;

/* ----------------------------- failures ----------------------------- */

/**
 * A drafts-or-queue failure with a message written for a person, not a log.
 * Show `err.message` directly in an inline error. It never leaks SQL, ids,
 * or PostgREST codes.
 */
export class DraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftError";
  }
}

/** What a queued row's `last_error` says when the server just said no. */
const REFUSED = "That message didn't go through. We'll keep trying.";

/** And what it says once we've stopped trying. */
const GAVE_UP =
  "We couldn't send this one. Tap it to try again, or discard it.";

/* ---------------------------- conversation keys --------------------- */

/**
 * Build the key for a conversation. The one sanctioned way to name a
 * conversation in storage. Hand-built strings drift, and a drifted key is a
 * draft nobody can find again.
 *
 * ```ts
 * const key = keyFor("channel", channelId);
 * const replyKey = keyFor("thread", parentMessageId);
 * ```
 *
 * Pure.
 *
 * @param kind Which kind of conversation this is.
 * @param id   The `channels.id`, `dm_threads.id`, or parent `messages.id`.
 */
export function keyFor(kind: ConversationKind, id: string): ConversationKey {
  return `${kind}:${id}`;
}

/**
 * Take a conversation key apart again, for a screen that lists every draft
 * and needs somewhere to send each row.
 *
 * Pure. Returns null for anything that isn't a key {@link keyFor} would have
 * produced (an unknown kind, a missing id), so a stray storage entry from an
 * older build reads as "not ours" rather than as a broken route.
 *
 * @param raw Any string, including one read back out of storage.
 */
export function parseConversationKey(raw: string): ParsedConversationKey | null {
  const split = raw.indexOf(":");
  if (split <= 0) return null;
  const kind = raw.slice(0, split);
  const id = raw.slice(split + 1);
  if (id.length === 0) return null;
  if (kind !== "channel" && kind !== "dm" && kind !== "thread") return null;
  return { kind, id };
}

/** The storage key a draft for this conversation lives at. */
function draftStorageKey(key: ConversationKey): string {
  return `${DRAFT_KEY_PREFIX}${key}`;
}

/* ------------------------------ drafts ------------------------------ */

/**
 * Keep what someone typed but hasn't sent.
 *
 * **Don't call this on every keystroke.** AsyncStorage is a round trip to
 * native and a fast typist would queue dozens a second. Debounce it (around
 * half a second of quiet is plenty) and write once more when the composer
 * loses focus or unmounts, so the last word typed before backgrounding is the
 * one that gets kept:
 *
 * ```ts
 * const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
 * const onChangeText = (next: string) => {
 *   setText(next);
 *   if (timer.current) clearTimeout(timer.current);
 *   timer.current = setTimeout(() => void saveDraft(key, next), 500);
 * };
 * useEffect(() => () => void saveDraft(key, textRef.current), [key]);
 * ```
 *
 * Whitespace-only text isn't a draft. Passing it clears the entry instead of
 * storing a blank one, so an emptied composer doesn't leave a "draft" chip
 * behind on a list screen. Everything else is stored verbatim, trailing
 * newlines and all: it's what the person typed. Text past
 * {@link DRAFT_MAX_LENGTH} is trimmed to fit, since a longer one could never
 * be sent anyway.
 *
 * **Never throws.** A draft that failed to save costs a sentence on a
 * relaunch, which is not worth an error in someone's face mid-typing, and
 * there's nowhere to put one in a debounced handler anyway.
 *
 * @param key  The conversation, from {@link keyFor}.
 * @param text What's in the composer right now.
 */
export async function saveDraft(
  key: ConversationKey,
  text: string
): Promise<void> {
  if (!parseConversationKey(key)) return;
  if (text.trim().length === 0) {
    await clearDraft(key);
    return;
  }
  try {
    await AsyncStorage.setItem(
      draftStorageKey(key),
      text.slice(0, DRAFT_MAX_LENGTH)
    );
  } catch {
    // The composer still holds the text for this run; it just won't survive.
  }
}

/**
 * Read back the draft for one conversation, or null when there isn't one.
 * Call it once when the composer mounts and seed your TextInput with it.
 *
 * **Never throws.** Unreadable storage reads as "no draft", which is the
 * honest answer: we genuinely can't tell you what you typed.
 *
 * @param key The conversation, from {@link keyFor}.
 */
export async function loadDraft(key: ConversationKey): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(draftStorageKey(key));
    return raw !== null && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Forget the draft for one conversation. Call it the moment a message is sent
 * or queued. The text has moved on, and a stale draft reappearing under a
 * message you already sent is worse than no draft at all.
 *
 * **Never throws.** A failed delete leaves a draft that will be overwritten
 * by the next save anyway.
 *
 * @param key The conversation, from {@link keyFor}.
 */
export async function clearDraft(key: ConversationKey): Promise<void> {
  try {
    await AsyncStorage.removeItem(draftStorageKey(key));
  } catch {
    // Nothing to tell anyone: the stale draft is invisible until they return.
  }
}

/**
 * Every draft on the device, as a Map from conversation key to text, for a
 * list of chats that wants to mark the rows you left mid-sentence:
 *
 * ```ts
 * const drafts = await loadAllDrafts();
 * const hasDraft = drafts.has(keyFor("channel", channel.id));
 * ```
 *
 * One pass over the device's keys, so call it when a list screen loads rather
 * than per row. Entries that aren't recognisable conversation keys are
 * skipped, and so are blank ones.
 *
 * **Never throws.** Unreadable storage gives back an empty Map: no chips,
 * rather than a broken list.
 */
export async function loadAllDrafts(): Promise<Map<ConversationKey, string>> {
  const out = new Map<ConversationKey, string>();
  try {
    const all = await AsyncStorage.getAllKeys();
    const mine = all.filter((k) => k.startsWith(DRAFT_KEY_PREFIX));
    if (mine.length === 0) return out;

    const entries = await AsyncStorage.getMany(mine);
    for (const storageKey of mine) {
      const value = entries[storageKey];
      if (typeof value !== "string" || value.length === 0) continue;
      const bare = storageKey.slice(DRAFT_KEY_PREFIX.length);
      const parsed = parseConversationKey(bare);
      if (!parsed) continue;
      out.set(keyFor(parsed.kind, parsed.id), value);
    }
  } catch {
    // An empty Map is the safe read: no draft chips anywhere.
  }
  return out;
}

/**
 * Forget every draft on the device.
 *
 * The one call sign-out should make. Drafts are stored per device, not per
 * account, so on a shared laptop-in-the-library phone the next person must
 * not find half a sentence you were writing to your section.
 *
 * **Never throws.** Finds its keys by {@link DRAFT_KEY_PREFIX} and touches
 * nothing else Hearth stores.
 */
export async function clearAllDrafts(): Promise<void> {
  try {
    const all = await AsyncStorage.getAllKeys();
    const mine = all.filter((k) => k.startsWith(DRAFT_KEY_PREFIX));
    if (mine.length > 0) await AsyncStorage.removeMany(mine);
  } catch {
    // Nothing actionable, and nothing worth interrupting a sign-out for.
  }
}

/* --------------------------- connectivity --------------------------- */

/*
 * A note on how this is built, because it's a deliberate compromise.
 *
 * `@react-native-community/netinfo` is NOT a dependency of this app, and this
 * feature isn't worth adding one for. So there is no radio-level truth here:
 * the signal below is inferred entirely from requests we already make. We
 * learn we're offline when a send fails to reach the server, and we learn
 * we're back when one reaches it. Success or refusal, either proves a server
 * answered.
 *
 * Two honest consequences:
 *
 *   - We start optimistic. Before anything has been attempted, {@link isOnline}
 *     says true. It is a guess, not a reading.
 *   - We only learn we're back by trying. Nothing here notices Wi-Fi
 *     reconnecting on its own. Call {@link flushQueue} when the app returns to
 *     the foreground and when a chat screen gains focus, and the signal
 *     corrects itself within one request.
 *
 * If netinfo is ever added to the app, this is the only place that changes:
 * call {@link noteConnectivity} from its listener and every consumer of
 * {@link subscribeToConnectivity} gets the real thing for free.
 */

/** Optimistic until something proves otherwise. See the note above. */
let online = true;

const connectivityListeners = new Set<ConnectivityListener>();

/**
 * Our current best guess at whether the network is reachable, read
 * synchronously, for a render that just needs to decide between "Send" and
 * "Send when you're back".
 *
 * Inferred, not measured. See {@link subscribeToConnectivity}.
 */
export function isOnline(): boolean {
  return online;
}

/**
 * Feed the connectivity signal from a request you made yourself, so a
 * composer that sends directly (rather than through the queue) teaches the
 * rest of the app what it learned:
 *
 * ```ts
 * const { error } = await supabase.from("messages").insert(row);
 * noteConnectivity(!isLikelyOffline(error));
 * ```
 *
 * Idempotent: passing the value we already hold notifies nobody, so this is
 * safe to call on every request.
 *
 * @param next True when a server answered you, false when you couldn't reach
 *   one. A refusal still counts as online: the server was there to refuse.
 */
export function noteConnectivity(next: boolean): void {
  if (online === next) return;
  online = next;
  // Copy first: a listener that unsubscribes itself mustn't break the loop.
  for (const listener of [...connectivityListeners]) {
    try {
      listener(next);
    } catch {
      // One bad listener must not wedge connectivity for everything else.
    }
  }
}

/**
 * Watch the connection. Your listener fires once with the current guess
 * before this returns (so a badge renders immediately without a second read)
 * and again on every change.
 *
 * ```ts
 * useEffect(() => subscribeToConnectivity(setOnline), []);
 * ```
 *
 * Read the note above {@link isOnline} first: this is inferred from requests
 * we make, not read from the radio, so it goes stale until something tries.
 *
 * @param onChange Called with true for online, false for off.
 * @returns An unsubscribe function. Return it straight from a `useEffect`.
 */
export function subscribeToConnectivity(
  onChange: ConnectivityListener
): () => void {
  connectivityListeners.add(onChange);
  try {
    onChange(online);
  } catch {
    // Same rule as above: a throwing listener is its own problem.
  }
  return () => {
    connectivityListeners.delete(onChange);
  };
}

/**
 * Whether a failed request looks like "no connection" rather than "the server
 * said no".
 *
 * A heuristic, and it says so: supabase-js hands back a network failure as an
 * error object with an empty `code` and a message from `fetch` itself, while
 * anything PostgREST decided carries a real code (`42501` for an RLS refusal,
 * `23514` for a check violation, `PGRST116` for no rows). So: a code means the
 * server answered; no code plus a message that reads like a transport failure
 * means it didn't. Anything else is treated as *online*, because guessing
 * "offline" wrongly would park a message the server actually rejected.
 *
 * Pure.
 *
 * @param error Whatever came back in a `{ error }`, or a caught throw.
 */
export function isLikelyOffline(error: unknown): boolean {
  if (error === null || error === undefined) return false;
  if (typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  const code = typeof record.code === "string" ? record.code : "";
  if (code.length > 0) return false;
  const message = typeof record.message === "string" ? record.message : "";
  return /network|fetch|timeout|timed out|offline|connection|econn|enotfound|socket|dns/i.test(
    message
  );
}

/* --------------------------- queue storage -------------------------- */

/**
 * All queue reads and writes run through this chain, one at a time, so an
 * {@link enqueue} landing mid-flush can't be clobbered by the flush writing
 * back a snapshot taken before it existed. Each critical section is a read
 * and a write with no network in between; {@link flushQueue} takes the lock
 * once per row rather than holding it for the whole walk.
 */
let queueLock: Promise<unknown> = Promise.resolve();

/** Run `task` after everything already queued on the lock, failures included. */
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queueLock.then(task, task);
  queueLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** Narrow a stored payload: strings and nulls only, everything else dropped. */
function toPayload(raw: unknown): QueuedPayload | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const out: QueuedPayload = {};
  for (const [column, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null) {
      out[column] = null;
    } else if (typeof value === "string") {
      out[column] = value;
    }
  }
  return out;
}

/**
 * Narrow one stored row into a {@link QueuedMessage}, or null if it's missing
 * something we promise callers. A row we can't read is dropped on the next
 * write rather than kept forever: an unreadable entry from an older build
 * would otherwise sit at the head of the queue blocking real messages, and
 * nobody can see it to drop it by hand.
 */
function toQueuedMessage(raw: unknown): QueuedMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = record["id"];
  const key = record["key"];
  const table = record["table"];
  const createdAt = record["created_at"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof key !== "string" || !parseConversationKey(key)) return null;
  if (table !== "messages" && table !== "dm_messages") return null;
  if (typeof createdAt !== "string" || createdAt.length === 0) return null;
  const payload = toPayload(record["payload"]);
  if (!payload) return null;
  const content = payload["content"];
  if (typeof content !== "string" || content.length === 0) return null;
  const attempts = record["attempts"];
  const lastError = record["last_error"];
  return {
    id,
    key: key as ConversationKey,
    table,
    payload,
    created_at: createdAt,
    attempts:
      typeof attempts === "number" && Number.isFinite(attempts) && attempts > 0
        ? Math.trunc(attempts)
        : 0,
    stuck: record["stuck"] === true,
    last_error:
      typeof lastError === "string" && lastError.length > 0 ? lastError : null,
  };
}

/** Read the queue in send order. Corrupt or unreadable storage reads as empty. */
async function readQueue(): Promise<QueuedMessage[]> {
  const raw = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
  if (raw === null || raw.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Truncated JSON: a kill mid-write. Nothing here is recoverable.
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: QueuedMessage[] = [];
  for (const row of parsed) {
    const message = toQueuedMessage(row);
    if (message) out.push(message);
  }
  return out;
}

/** Write the queue back, or remove the key entirely when it's empty. */
async function writeQueue(queue: readonly QueuedMessage[]): Promise<void> {
  if (queue.length === 0) {
    await AsyncStorage.removeItem(QUEUE_STORAGE_KEY);
    return;
  }
  await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

/**
 * Read the queue, hand it to `apply`, and write back whatever `apply` returns
 * as `next`, all inside the lock, so no two mutations can interleave.
 * Returning `next: null` means "read only, change nothing".
 */
function mutateQueue<T>(
  apply: (queue: QueuedMessage[]) => {
    next: QueuedMessage[] | null;
    value: T;
  }
): Promise<T> {
  return serialize(async () => {
    const queue = await readQueue();
    const { next, value } = apply(queue);
    if (next !== null) await writeQueue(next);
    return value;
  });
}

/* ---------------------------- queue ids ----------------------------- */

/**
 * A version-4 uuid for a message that hasn't been sent yet, built from
 * `Math.random` because neither `crypto.randomUUID` nor `expo-crypto` is
 * available here and this doesn't warrant a dependency.
 *
 * Not cryptographically strong, and it must never be used for anything that
 * needs to be unguessable. It's fine for a row id: 122 random bits make a
 * collision with another student's message vanishingly unlikely, and the
 * primary key would reject the second one anyway, which is exactly the
 * behaviour {@link flushQueue} leans on.
 */
function newMessageId(): string {
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      out += "-";
    } else if (i === 14) {
      out += "4"; // version
    } else {
      const r = Math.floor(Math.random() * 16);
      out += i === 19 ? hex.charAt((r & 0x3) | 0x8) : hex.charAt(r); // variant
    }
  }
  return out;
}

/* ------------------------------ enqueue ----------------------------- */

/** The column that names the conversation, per table. */
function parentColumn(table: QueuedTable): string {
  return table === "messages" ? "channel_id" : "thread_id";
}

/**
 * Put a message in the queue. Returns immediately once it's on disk. It does
 * not attempt a send, so a composer can clear itself and show a pending
 * bubble without waiting on the network.
 *
 * The usual shape of a send becomes: enqueue, clear the draft, render the
 * pending bubble, then call {@link flushQueue}. Online, the flush finishes in
 * a beat and the row is gone before anyone notices it was queued. Offline,
 * the message waits (through a backgrounded app, through a kill, through a
 * flight) and goes out on the first flush that reaches a server.
 *
 * The returned message's `id` is the id the row will have when it lands, so
 * key your pending bubble on it and realtime will line up with it later.
 *
 * Validated here rather than five attempts from now: a message with no
 * content, no author, or no conversation is one the database would refuse
 * every time, and it should never make it into the queue at all.
 *
 * @param request Where it's going and what goes in the row.
 * @returns The queued message, ready to render as pending.
 * @throws {DraftError} With copy that's ready to render, including when the
 *   device can't persist it, which the caller must know about *before* it
 *   clears the composer.
 */
export async function enqueue(request: QueueRequest): Promise<QueuedMessage> {
  const { key, table, payload } = request;
  if (!parseConversationKey(key)) {
    throw new DraftError("We couldn't work out where that was going.");
  }

  const content = payload["content"];
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new DraftError("Type something first.");
  }
  if (content.length > DRAFT_MAX_LENGTH) {
    throw new DraftError(
      `Messages stop at ${DRAFT_MAX_LENGTH} characters. Trim it a little.`
    );
  }
  const author = payload["author_id"];
  const parent = payload[parentColumn(table)];
  if (typeof author !== "string" || author.length === 0) {
    throw new DraftError("Sign in again to send that.");
  }
  if (typeof parent !== "string" || parent.length === 0) {
    throw new DraftError("We couldn't work out where that was going.");
  }

  const id = newMessageId();
  const message: QueuedMessage = {
    id,
    key,
    table,
    // Our id wins: it's what makes a retry safe. See QueuedMessage.id.
    payload: { ...payload, id },
    created_at: new Date().toISOString(),
    attempts: 0,
    stuck: false,
    last_error: null,
  };

  try {
    await mutateQueue((queue) => ({
      next: [...queue, message],
      value: null,
    }));
  } catch {
    throw new DraftError(
      "We couldn't hold on to that message. Give it another go."
    );
  }
  return message;
}

/* ------------------------------ reading ----------------------------- */

/**
 * How many messages are waiting, stuck ones included: the number for a
 * global "3 unsent" badge.
 *
 * **Never throws.** Unreadable storage counts as 0: no badge is better than a
 * badge that can't be acted on.
 */
export async function queueLength(): Promise<number> {
  try {
    return await mutateQueue((queue) => ({ next: null, value: queue.length }));
  } catch {
    return 0;
  }
}

/**
 * The messages waiting in one conversation, oldest first, for the pending
 * bubbles at the bottom of a chat, and for a per-room badge on a list screen.
 *
 * Stuck rows are included and flagged: they're the ones a person most needs
 * to see, since nothing will retry them. Offer each a "try again" (which
 * means `dropQueued` then `enqueue` afresh) or a "discard".
 *
 * **Never throws.** Unreadable storage gives back an empty array.
 *
 * @param key The conversation, from {@link keyFor}.
 */
export async function peekQueue(
  key: ConversationKey
): Promise<QueuedMessage[]> {
  try {
    return await mutateQueue((queue) => ({
      next: null,
      value: queue.filter((message) => message.key === key),
    }));
  } catch {
    return [];
  }
}

/* ----------------------------- removing ----------------------------- */

/**
 * Abandon one queued message. The way out of a stuck row, and the way a
 * "delete" on a pending bubble works.
 *
 * Safe to call twice: a message that already sent, or that someone dropped on
 * another screen, resolves false rather than throwing. The intent ("this
 * shouldn't be waiting anymore") already holds either way.
 *
 * **Never throws.**
 *
 * @param id The message's `id`, from {@link enqueue} or {@link peekQueue}.
 * @returns True if something was actually removed.
 */
export async function dropQueued(id: string): Promise<boolean> {
  try {
    return await mutateQueue((queue) => {
      const next = queue.filter((message) => message.id !== id);
      if (next.length === queue.length) return { next: null, value: false };
      return { next, value: true };
    });
  } catch {
    return false;
  }
}

/**
 * Empty the queue.
 *
 * The other call sign-out should make: every queued row carries the signed-in
 * student's `author_id`, and RLS would refuse it for whoever signs in next
 * anyway. Pair it with {@link clearAllDrafts}.
 *
 * **Never throws.**
 */
export async function clearQueue(): Promise<void> {
  try {
    await mutateQueue(() => ({ next: [], value: null }));
  } catch {
    // Nothing worth interrupting a sign-out for; RLS refuses the rows anyway.
  }
}

/* ------------------------------ flushing ---------------------------- */

/** PostgREST hands unique violations back as 23505. */
function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

/** Is anyone signed in? No network hop: supabase-js refreshes stale tokens. */
async function hasSession(): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return false;
    const id = data.session?.user.id;
    return typeof id === "string" && id.length > 0;
  } catch {
    return false;
  }
}

/** One insert. Distinguishes "the server said no" from "no server answered". */
type SendOutcome =
  | { kind: "sent" }
  | { kind: "refused" }
  | { kind: "unreachable" };

async function attemptSend(message: QueuedMessage): Promise<SendOutcome> {
  let error: unknown;
  try {
    const result = await supabase.from(message.table).insert(message.payload);
    error = result.error;
  } catch (thrown) {
    error = thrown;
  }
  if (!error) return { kind: "sent" };
  // 23505: this exact id is already in the table, so a previous attempt landed
  // and we were killed before the queue caught up. That's a send, not a
  // failure. See QueuedMessage.id.
  if (errorCode(error) === "23505") return { kind: "sent" };
  return isLikelyOffline(error) ? { kind: "unreachable" } : { kind: "refused" };
}

/** Only one walk at a time. See {@link flushQueue}. */
let inFlight: Promise<FlushResult> | null = null;

/**
 * Send everything that's waiting, oldest first.
 *
 * Call it when the app comes back to the foreground, when a chat screen gains
 * focus, right after {@link enqueue}, and behind a "try again" in whatever UI
 * shows the backlog. It is cheap when the queue is empty and it is safe to
 * call from several places at once: overlapping calls all get the same
 * in-flight pass rather than sending anything twice.
 *
 * **How the walk handles trouble**, in the order it matters:
 *
 *   - **The network is gone.** The walk stops right there, immediately.
 *     Nothing else would land either, and hammering a dead connection costs
 *     battery. The remaining rows keep their place and their attempt counts.
 *   - **The server refused a row.** It answered, so we're online, but this
 *     conversation is now blocked for the rest of the pass and the rows
 *     behind it in the *same* conversation are skipped untouched, because a
 *     reply must never arrive before the message it answers. Other
 *     conversations carry on: a deleted club channel shouldn't hold up your
 *     DMs.
 *   - **A row is already stuck.** Skipped without an attempt, and it blocks
 *     its own conversation the same way. It stays in the queue so a person
 *     can see it and use {@link dropQueued}.
 *
 * **Only answered refusals count toward {@link MAX_SEND_ATTEMPTS}.** Being
 * unreachable is not the message's fault, so a weekend with no signal can't
 * quietly burn through five attempts and strand everything you wrote.
 *
 * **Signed out, this does nothing.** No inserts, no attempts spent. The rows
 * wait for whoever the queue belongs to to come back.
 *
 * @returns What the pass did: the rows that landed, the ones that just gave
 *   up, the ones that will be tried again, how many are left, and the
 *   connection guess afterwards.
 * @throws {DraftError} Only when the queue itself can't be read or written.
 *   Send failures are never thrown; they're in the result. A background
 *   flush can safely `.catch(() => {})`; a "try again" button should show it.
 */
export function flushQueue(): Promise<FlushResult> {
  if (inFlight) return inFlight;
  const run = walkQueue();
  inFlight = run;
  // Registered after the assignment, and `then` is always async, so the slot
  // can never be cleared before it's filled: a stale pass would otherwise be
  // handed to every caller forever.
  const release = (): void => {
    inFlight = null;
  };
  run.then(release, release);
  return run;
}

async function walkQueue(): Promise<FlushResult> {
  const sent: QueuedMessage[] = [];
  const stuck: QueuedMessage[] = [];
  const failed: QueuedMessage[] = [];

  let snapshot: QueuedMessage[];
  try {
    snapshot = await mutateQueue((queue) => ({ next: null, value: queue }));
  } catch {
    throw new DraftError(
      "We couldn't check your unsent messages. Give it another go."
    );
  }
  if (snapshot.length === 0) {
    // An empty queue teaches us nothing about the connection, so don't guess.
    return { sent, stuck, failed, remaining: 0, online };
  }
  if (!(await hasSession())) {
    return { sent, stuck, failed, remaining: snapshot.length, online };
  }

  /** Conversations that hit trouble this pass. Order holds within each one. */
  const blocked = new Set<ConversationKey>();

  for (const message of snapshot) {
    if (blocked.has(message.key)) continue;
    if (message.stuck) {
      blocked.add(message.key);
      continue;
    }

    const outcome = await attemptSend(message);

    if (outcome.kind === "unreachable") {
      noteConnectivity(false);
      break; // Nothing behind this would land either.
    }
    noteConnectivity(true);

    if (outcome.kind === "sent") {
      try {
        await mutateQueue((queue) => ({
          next: queue.filter((row) => row.id !== message.id),
          value: null,
        }));
      } catch {
        // It landed but we couldn't record that. The retry hits 23505 and
        // reads as sent, so the worst case is one wasted round trip.
      }
      sent.push(message);
      continue;
    }

    // Refused. Count it, and stop this conversation for the rest of the pass.
    const attempts = message.attempts + 1;
    const isStuck = attempts >= MAX_SEND_ATTEMPTS;
    const patched: QueuedMessage = {
      ...message,
      attempts,
      stuck: isStuck,
      last_error: isStuck ? GAVE_UP : REFUSED,
    };
    try {
      await mutateQueue((queue) => ({
        next: queue.map((row) => (row.id === message.id ? patched : row)),
        value: null,
      }));
    } catch {
      // The count didn't persist; this row gets a fresh five next launch.
    }
    if (isStuck) stuck.push(patched);
    else failed.push(patched);
    blocked.add(message.key);
  }

  let remaining = snapshot.length - sent.length;
  try {
    remaining = await mutateQueue((queue) => ({
      next: null,
      value: queue.length,
    }));
  } catch {
    // Fall back to the arithmetic above rather than failing a pass that worked.
  }

  return { sent, stuck, failed, remaining, online };
}
