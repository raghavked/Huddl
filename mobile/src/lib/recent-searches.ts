import AsyncStorage from "@react-native-async-storage/async-storage";

/* Recent searches — the data layer.
 *
 * The search box's short memory: the last handful of things a student
 * actually found something with, so opening search on a Tuesday night starts
 * from "ECS 36A" and "farmers market" rather than a blank box.
 *
 * It lives on the device, in one AsyncStorage key, and nowhere else. Nothing
 * here is sent to the server, so a search history is never something a
 * classmate, a moderator, or a future employer can read — signing out or
 * switching phones simply starts the list over. That is the right trade for a
 * convenience: it is a shortcut, not a record of anyone.
 *
 * **Nothing in here ever throws.** A phone with unreadable or unwritable
 * storage just has no history: `fetchRecents` resolves `[]`, the writes are
 * quiet no-ops, and search itself carries on exactly as before. A search box
 * that refuses to search because it couldn't remember the last search would be
 * absurd.
 *
 * No React, no theme, no navigation — one key, four calls, and three pure
 * helpers at the bottom that the calls are built from. Screens can use those
 * helpers to move their own state optimistically (see `withRecent`), which is
 * what keeps the list feeling instant even when the write is still in flight.
 */

/* ------------------------------ limits ------------------------------ */

/**
 * How many queries we keep. Eight is about a screen's worth under the lantern
 * on the idle search screen — long enough to hold a week of classes, short
 * enough that the list never needs its own scroll or a "see all".
 */
export const RECENT_SEARCHES_MAX = 8;

/**
 * Longest query we'll store, in characters. Anything past this is a paste, not
 * a search worth offering again, and it would push the row into an ellipsis
 * anyway.
 */
export const RECENT_QUERY_MAX = 80;

/**
 * The one key. Namespaced like `huddl.firstRun.welcomeSeen` so everything
 * Huddl keeps on the device sorts together and nothing else can collide.
 */
const KEY = "huddl.search.recents";

/* ------------------------------ storage ----------------------------- */

/**
 * Every query the student has searched successfully on this device, most
 * recent first, deduped case-insensitively and capped at
 * {@link RECENT_SEARCHES_MAX}.
 *
 * **Never throws.** Unreadable storage, a value written by an older build, or
 * outright garbage all resolve to `[]` — an empty history is always a safe
 * answer, and the idle screen already knows how to say "search your campus".
 *
 * @returns The remembered queries, newest first. Safe to render directly.
 */
export async function fetchRecents(): Promise<string[]> {
  try {
    return parseRecents(await AsyncStorage.getItem(KEY));
  } catch {
    // No history is a fine history. Search still works.
    return [];
  }
}

/**
 * Remember a query, moving it to the front if it's already there.
 *
 * Call it when a search **found something**, not on every keystroke — a
 * history full of "ec", "ecs", "ecs 3" is noise, and offering back a query
 * that returned nothing is a shortcut to a dead end.
 *
 * The stored list is re-read, updated, and written back, so two screens can
 * never clobber each other's history. When nothing would change (the query is
 * already at the front, or it's blank) no write goes out at all.
 *
 * **Never throws.** A failed write costs the student one forgotten search.
 *
 * @param query What they typed. Trimmed and whitespace-collapsed here; blank
 *   is quietly ignored.
 * @returns The list as it now stands, newest first — hand it straight to
 *   `setState` rather than calling {@link fetchRecents} again.
 */
export async function pushRecent(query: string): Promise<string[]> {
  const current = await fetchRecents();
  const next = withRecent(current, query);
  if (!sameList(current, next)) await write(next);
  return next;
}

/**
 * Forget one query — the `x` on a recent row.
 *
 * Matching is case-insensitive and whitespace-tolerant, so tapping the `x` on
 * "Farmers Market" removes it however it was capitalized when it went in.
 * Forgetting something that isn't there resolves quietly: the intent ("this
 * shouldn't be in my history") already holds.
 *
 * **Never throws.**
 *
 * @param query The row's text.
 * @returns The list as it now stands, newest first.
 */
export async function removeRecent(query: string): Promise<string[]> {
  const current = await fetchRecents();
  const next = withoutRecent(current, query);
  if (!sameList(current, next)) await write(next);
  return next;
}

/**
 * Forget the whole history — the "Clear" action above the list.
 *
 * Removes the key rather than writing an empty array, so a student who clears
 * their searches leaves nothing behind on the device.
 *
 * **Never throws.** Flip your own state to `[]` when you call this instead of
 * re-reading, so the list empties instantly even if the delete quietly failed.
 */
export async function clearRecents(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Cleared for this run; it may reappear on the next launch.
  }
}

/** Write the list back as JSON. Quiet on failure, like everything here. */
async function write(recents: readonly string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(recents));
  } catch {
    // The list is correct in memory; it just won't survive a relaunch.
  }
}

/**
 * Read whatever is in the key back into a clean list: not-a-string, not-JSON,
 * not-an-array, and arrays holding numbers or nulls all fall back to `[]`,
 * and a list that somehow grew past the cap or picked up duplicates is
 * normalized on the way out rather than trusted.
 */
function parseRecents(raw: string | null): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: unknown[] = parsed;

  const out: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const clean = normalizeQuery(entry);
    if (clean.length === 0) continue;
    if (out.some((kept) => sameQuery(kept, clean))) continue;
    out.push(clean);
    if (out.length >= RECENT_SEARCHES_MAX) break;
  }
  return out;
}

/* --------------------------- pure helpers --------------------------- */

/**
 * A query as we store and compare it: trimmed, internal whitespace collapsed
 * to single spaces, and cut to {@link RECENT_QUERY_MAX} characters. Case is
 * left exactly as the student typed it — "ECS 36A" should come back shouting
 * the way a course code does.
 *
 * Pure.
 */
export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").slice(0, RECENT_QUERY_MAX).trim();
}

/**
 * Whether two queries are the same search. Case-insensitive after
 * {@link normalizeQuery}, so "ecs 36a" and "ECS 36A" are one entry rather
 * than two rows that do the same thing.
 *
 * Pure.
 */
export function sameQuery(a: string, b: string): boolean {
  return normalizeQuery(a).toLowerCase() === normalizeQuery(b).toLowerCase();
}

/**
 * The list with `query` at the front: any earlier copy of the same search is
 * removed first, and the tail is cut to {@link RECENT_SEARCHES_MAX}. A blank
 * query returns the list unchanged (still capped and deduped).
 *
 * Pure, and exported on purpose — a screen can move its own state with this
 * the moment a search lands and let {@link pushRecent} catch up behind it, so
 * the history is right even on a device whose storage is broken.
 */
export function withRecent(
  recents: readonly string[],
  query: string
): string[] {
  const clean = normalizeQuery(query);
  const kept = recents.filter((entry) => !sameQuery(entry, clean));
  const next = clean.length === 0 ? kept : [clean, ...kept];
  return next.slice(0, RECENT_SEARCHES_MAX);
}

/**
 * The list without `query`, compared case-insensitively. The twin of
 * {@link withRecent} for the same optimistic reason.
 *
 * Pure.
 */
export function withoutRecent(
  recents: readonly string[],
  query: string
): string[] {
  return recents.filter((entry) => !sameQuery(entry, query));
}

/** Whether two lists hold the same queries in the same order — skips a write. */
function sameList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((entry, index) => entry === b[index]);
}
