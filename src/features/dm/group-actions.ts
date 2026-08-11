"use client";

import { createClient } from "@/lib/supabase/client";
import {
  GROUP_MAX_PEOPLE,
  GROUP_MIN_PEOPLE,
  GroupDmError,
  requireGroupTitle,
  uniqueIds,
  warmGroupMessage,
  type ThreadPerson,
} from "@/features/dm/group-dm";

/* Group DMs — the writes, from the browser.
 *
 * Every group write goes through a security-definer RPC, because dm_threads
 * and dm_participants still carry no INSERT policies. The one exception is
 * the title: migration 0028 added a policy letting any participant UPDATE
 * their own group's name, so renameGroupThread is a plain update.
 *
 * Failures arrive as a {@link GroupDmError} whose message is warm, specific,
 * and safe to render straight into an inline error.
 */

/* ------------------------------ writes ------------------------------ */

/**
 * Start a named group with the given classmates and land the caller in it.
 *
 * `userIds` are the OTHER people — don't include your own id. The database
 * dedupes the list and drops you from it anyway, then requires 2-15 people
 * left over (3-16 counting you), all on your campus and none blocked either
 * way. The same window is checked here first so an obviously-wrong roster
 * never leaves the browser.
 *
 * @param title   The group's name; trimmed, 2-60 characters.
 * @param userIds `profiles.id` for each classmate to invite.
 * @returns The new thread's id — route to `/messages/<id>` with it.
 * @throws {GroupDmError} With copy that's ready to render.
 */
export async function createGroupThread(
  title: string,
  userIds: readonly string[]
): Promise<string> {
  const cleanTitle = requireGroupTitle(title);
  const people = uniqueIds(userIds);
  if (
    people.length < GROUP_MIN_PEOPLE - 1 ||
    people.length > GROUP_MAX_PEOPLE - 1
  ) {
    throw new GroupDmError("Groups hold 3 to 16 people including you.");
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_group_thread", {
    p_title: cleanTitle,
    p_user_ids: people,
  });
  if (error) {
    throw new GroupDmError(
      warmGroupMessage(error, "We couldn't start that group just now. Try again.")
    );
  }
  if (typeof data !== "string" || data.length === 0) {
    throw new GroupDmError("We couldn't start that group just now. Try again.");
  }
  return data;
}

/**
 * Add one more classmate to a group you're already in. The database checks
 * that the thread really is a group, that you're in it, that it isn't
 * already at 16, that they share your campus, and that neither of you has
 * blocked the other. Adding someone twice is a no-op, not an error.
 *
 * @throws {GroupDmError} With copy that's ready to render.
 */
export async function addToGroupThread(
  threadId: string,
  userId: string
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("add_to_group_thread", {
    p_thread_id: threadId,
    p_user_id: userId,
  });
  if (error) {
    throw new GroupDmError(
      warmGroupMessage(error, "We couldn't add them just now. Try again.")
    );
  }
}

/**
 * Slip out of a group. Removes only your own participant row — the thread
 * and everyone else's history stay put, and you stop receiving its messages
 * and notifications. Leaving a thread you're not in quietly succeeds; the
 * database only refuses if the thread isn't a group (you can't leave a 1:1,
 * you block or delete instead).
 *
 * Navigate away once this resolves — RLS hides the thread from you the
 * moment the row is gone.
 *
 * @throws {GroupDmError} With copy that's ready to render.
 */
export async function leaveGroupThread(threadId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("leave_group_thread", {
    p_thread_id: threadId,
  });
  if (error) {
    throw new GroupDmError(
      warmGroupMessage(error, "We couldn't leave that group just now. Try again.")
    );
  }
}

/**
 * Rename a group. Unlike the rest of this module this is a direct UPDATE on
 * `dm_threads.title` — 0028's "participants can rename their group" policy
 * allows exactly that, for groups only. The 2-60 window is checked here
 * first, and the `is_group` filter keeps a stray 1:1 id from being renamed.
 *
 * Safe to run optimistically: show the new title, call this, and roll back
 * to the old one if it throws.
 *
 * @returns The trimmed title as saved — use it for your optimistic state.
 * @throws {GroupDmError} With copy that's ready to render.
 */
export async function renameGroupThread(
  threadId: string,
  title: string
): Promise<string> {
  const cleanTitle = requireGroupTitle(title);

  const supabase = createClient();
  const { data, error } = await supabase
    .from("dm_threads")
    .update({ title: cleanTitle })
    .eq("id", threadId)
    .eq("is_group", true)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new GroupDmError(
      warmGroupMessage(error, "We couldn't rename that group just now. Try again.")
    );
  }
  // Zero rows updated isn't an error to PostgREST, but it means the policy
  // didn't match — you've left the group, or this id isn't a group at all.
  if (!data) {
    throw new GroupDmError("Only people in a group can rename it.");
  }
  return cleanTitle;
}

/* ------------------------------ reads ------------------------------- */

/**
 * The embedded profile comes back as an object OR a one-element array
 * depending on how PostgREST resolves the relationship, and the client is
 * untyped — accept both, and drop any row missing an id or handle.
 */
function normalizePeople(rows: unknown): ThreadPerson[] {
  if (!Array.isArray(rows)) return [];
  const out: ThreadPerson[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const embedded = (row as { profile?: unknown }).profile;
    const profile: unknown = Array.isArray(embedded) ? embedded[0] : embedded;
    if (typeof profile !== "object" || profile === null) continue;
    const record = profile as Record<string, unknown>;
    const id = record["id"];
    const handle = record["handle"];
    const displayName = record["display_name"];
    const avatarUrl = record["avatar_url"];
    if (typeof id !== "string" || id.length === 0) continue;
    if (typeof handle !== "string" || handle.length === 0) continue;
    out.push({
      id,
      handle,
      display_name:
        typeof displayName === "string" && displayName.length > 0
          ? displayName
          : handle,
      avatar_url: typeof avatarUrl === "string" ? avatarUrl : null,
    });
  }
  return out;
}

/** Everyone in a thread, sorted the way the roster renders them. */
export function sortPeople(people: readonly ThreadPerson[]): ThreadPerson[] {
  return [...people].sort(
    (a, b) =>
      a.display_name.localeCompare(b.display_name) ||
      a.handle.localeCompare(b.handle)
  );
}

/**
 * Everyone in a thread — you included — sorted by display name. Works for
 * both shapes: a 1:1 returns two people, a group returns 3-16.
 *
 * RLS only lets you read `dm_participants` for threads you're in, so an
 * empty array means either the thread isn't yours or you've just left it.
 *
 * @throws {GroupDmError} With copy that's ready to render.
 */
export async function fetchThreadPeople(
  threadId: string
): Promise<ThreadPerson[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("dm_participants")
    .select("user_id, profile:profiles(id, display_name, handle, avatar_url)")
    .eq("thread_id", threadId);
  if (error) {
    throw new GroupDmError("We couldn't load who's in this conversation.");
  }
  return sortPeople(normalizePeople(data));
}

/* --------------------------- campus search --------------------------- */

/** A classmate as the picker shows them — private profiles keep their name back. */
export interface CampusCandidate extends ThreadPerson {
  /** True when the profile is private: only the handle is ours to show. */
  locked: boolean;
}

type CandidateRow = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  is_public: boolean;
};

/** Literal `%`, `_`, and `\` in the query shouldn't act as ilike wildcards. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * An `or=` filter matching any of `columns`. The pattern rides inside a
 * double-quoted PostgREST string (backslashes and quotes escaped) so
 * free-typed commas, parens, and quotes can't break the filter syntax.
 */
function orIlike(columns: string[], raw: string): string {
  const quoted = `%${escapeLike(raw)}%`
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  return columns.map((column) => `${column}.ilike."${quoted}"`).join(",");
}

/** The signed-in student's university, for scoping the picker's search. */
export async function fetchMyUniversityId(userId: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("university_id")
    .eq("id", userId)
    .maybeSingle();
  const universityId = (data as { university_id?: unknown } | null)
    ?.university_id;
  if (error || typeof universityId !== "string") {
    throw new GroupDmError("We couldn't reach your campus directory.");
  }
  return universityId;
}

/**
 * Classmates at your university matching `query`, alphabetically. An empty
 * query lists the first slice of campus, so the picker has something warm to
 * show before anyone types. You are never in your own results; private
 * profiles come back as a locked handle — enough to invite someone you
 * already know without exposing their name.
 *
 * A group can only hold people from your campus, which is why the search
 * never leaves it.
 *
 * @throws {GroupDmError} With copy that's ready to render.
 */
export async function searchCampusPeople({
  universityId,
  excludeId,
  query,
  limit = 30,
}: {
  universityId: string;
  /** Your own id — you can't add yourself to a group you're in. */
  excludeId: string;
  query: string;
  limit?: number;
}): Promise<CampusCandidate[]> {
  const supabase = createClient();
  const base = supabase
    .from("profiles")
    .select("id, handle, display_name, avatar_url, is_public")
    .eq("university_id", universityId)
    .neq("id", excludeId);
  const trimmed = query.trim();
  const filtered =
    trimmed.length > 0
      ? base.or(orIlike(["display_name", "handle"], trimmed))
      : base;
  const { data, error } = await filtered
    .order("display_name", { ascending: true })
    .limit(limit);
  if (error) {
    throw new GroupDmError("We couldn't reach your campus directory.");
  }
  return ((data ?? []) as unknown as CandidateRow[]).map((row) => ({
    id: row.id,
    handle: row.handle,
    // A private classmate is only ever their handle to us.
    display_name: row.is_public ? row.display_name || row.handle : row.handle,
    avatar_url: row.avatar_url,
    locked: !row.is_public,
  }));
}
