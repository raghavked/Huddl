import { supabase } from "@/lib/supabase";

/* Group DMs — the data layer.
 *
 * Migration 0028 gave dm_threads two shapes that share one table: a 1:1
 * thread (is_group = false, no title) and a named group of 3-16 people
 * (is_group = true, title set, created_by set). create_dm_thread now skips
 * groups entirely, so find-or-create for a 1:1 can never land you in a group
 * that happens to hold both people.
 *
 * Every group write goes through a security-definer RPC, because dm_threads
 * and dm_participants still carry no INSERT policies. The one exception is
 * the title: 0028 added a policy letting any participant UPDATE their own
 * group's name, so renameGroupThread is a plain update.
 *
 * This module is the single place that knows those rules. No React, no
 * theme, no navigation — just queries, validation, and one pure naming
 * function. Every failure arrives as a {@link GroupDmError} whose message is
 * warm, specific, and safe to render straight into an inline error.
 */

/* ------------------------------ shapes ------------------------------ */

/**
 * A `dm_threads` row with the group columns 0028 added. 1:1 threads come
 * back through the same shape with `is_group: false`, `title: null`, and
 * `created_by: null`, so a list screen can hold both without branching on
 * the query.
 */
export type GroupThreadRow = {
  /** `dm_threads.id` — the thread id used everywhere else (`/dm/<id>`). */
  id: string;
  /** ISO timestamp the thread was opened. */
  created_at: string;
  /** True for a named group of 3+; false for a 1:1. */
  is_group: boolean;
  /** The group's name, 2-60 characters. Always null on a 1:1. */
  title: string | null;
  /** Who started the group (`profiles.id`), or null if they've left Huddl. */
  created_by: string | null;
};

/** One person in a thread — enough to render a row or an avatar stack. */
export type ThreadPerson = {
  /** `profiles.id`. */
  id: string;
  /** Their display name, falling back to their handle if it's somehow blank. */
  display_name: string;
  /** Their handle, without the leading `@`. */
  handle: string;
  /** Their avatar, or null — fall back to initials via `@/components/avatar`. */
  avatar_url: string | null;
};

/** What {@link threadDisplay} hands a header or a list row. */
export type ThreadDisplay = {
  /** The name to show: the group's title, or the other person on a 1:1. */
  title: string;
  /** "6 people" under a group title; null on a 1:1, which needs no second line. */
  subtitle: string | null;
};

/* ---------------------------- the limits ---------------------------- */

/** Smallest a group can be, counting you — matches create_group_thread. */
export const GROUP_MIN_PEOPLE = 3;

/** Largest a group can be, counting you — matches add_to_group_thread. */
export const GROUP_MAX_PEOPLE = 16;

/** Shortest a group name may be, after trimming. */
export const GROUP_TITLE_MIN = 2;

/** Longest a group name may be, after trimming — cap your TextInput here. */
export const GROUP_TITLE_MAX = 60;

/** Columns every screen needs off `dm_threads`. Keep selects consistent. */
export const GROUP_THREAD_SELECT = "id, created_at, is_group, title, created_by";

/* ----------------------------- failures ----------------------------- */

/**
 * A group-DM failure with a message written for a person, not a log. Show
 * `err.message` directly in your inline error — it never leaks SQL, ids, or
 * PostgREST codes.
 */
export class GroupDmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroupDmError";
  }
}

/**
 * The RPCs raise plain lowercase sentences (`raise exception 'this group is
 * full at 16'`). PostgREST hands those back verbatim as `error.message`, so
 * we match on a distinctive fragment of each and swap in the warm version.
 * Fragment order matters only where two could both match — they don't today.
 */
const WARM_BY_FRAGMENT: readonly (readonly [string, string])[] = [
  ["group names run", "Group names run 2 to 60 characters."],
  ["groups hold", "Groups hold 3 to 16 people including you."],
  ["on your campus", "Everyone in a group has to be on your campus."],
  ["full at 16", "This group is full at 16."],
  ["someone in that list", "Someone on that list can't be added."],
  ["that person can't be added", "That person can't be added."],
  ["you're not in this group", "You're not in this group anymore."],
  ["only groups take more people", "You can only add people to a group."],
  ["you can only leave a group", "You can only leave a group chat."],
  ["not signed in", "Sign in again to pick this back up."],
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

/* ---------------------------- validation ---------------------------- */

/**
 * Trim a proposed group name and check it against the same 2-60 window the
 * database enforces, so the composer can fail fast without a round trip.
 * Throws {@link GroupDmError} with the warm copy; returns the trimmed title.
 */
function requireTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < GROUP_TITLE_MIN || trimmed.length > GROUP_TITLE_MAX) {
    throw new GroupDmError("Group names run 2 to 60 characters.");
  }
  return trimmed;
}

/** Unique, non-empty ids in the order they were given. */
function uniqueIds(userIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of userIds) {
    const trimmed = id.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/* ------------------------------ writes ------------------------------ */

/**
 * Start a named group with the given classmates and land the caller in it.
 *
 * `userIds` are the OTHER people — don't include your own id. The database
 * dedupes the list and drops you from it anyway, then requires 2-15 people
 * left over (3-16 counting you), all on your campus and none blocked either
 * way. The same 2-15 window is checked here first so an obviously-wrong
 * roster never leaves the phone.
 *
 * @param title   The group's name; trimmed, 2-60 characters.
 * @param userIds `profiles.id` for each classmate to invite.
 * @returns The new thread's id — push `/dm/<id>` with it.
 * @throws {GroupDmError} With copy that's ready to render.
 */
export async function createGroupThread(
  title: string,
  userIds: readonly string[]
): Promise<string> {
  const cleanTitle = requireTitle(title);
  const people = uniqueIds(userIds);
  if (
    people.length < GROUP_MIN_PEOPLE - 1 ||
    people.length > GROUP_MAX_PEOPLE - 1
  ) {
    throw new GroupDmError("Groups hold 3 to 16 people including you.");
  }

  const { data, error } = await supabase.rpc("create_group_thread", {
    p_title: cleanTitle,
    p_user_ids: people,
  });
  if (error) {
    throw new GroupDmError(
      warmMessage(error, "We couldn't start that group just now. Try again.")
    );
  }
  if (typeof data !== "string" || data.length === 0) {
    throw new GroupDmError(
      "We couldn't start that group just now. Try again."
    );
  }
  return data;
}

/**
 * Add one more classmate to a group you're already in. The database checks
 * that the thread really is a group, that you're in it, that it isn't
 * already at 16, that they share your campus, and that neither of you has
 * blocked the other. Adding someone twice is a no-op, not an error.
 *
 * @param threadId The group's `dm_threads.id`.
 * @param userId   The classmate's `profiles.id`.
 * @throws {GroupDmError} With copy that's ready to render.
 */
export async function addToGroupThread(
  threadId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase.rpc("add_to_group_thread", {
    p_thread_id: threadId,
    p_user_id: userId,
  });
  if (error) {
    throw new GroupDmError(
      warmMessage(error, "We couldn't add them just now. Try again.")
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
 * Navigate away after this resolves — RLS will hide the thread from you the
 * moment the row is gone.
 *
 * @param threadId The group's `dm_threads.id`.
 * @throws {GroupDmError} With copy that's ready to render.
 */
export async function leaveGroupThread(threadId: string): Promise<void> {
  const { error } = await supabase.rpc("leave_group_thread", {
    p_thread_id: threadId,
  });
  if (error) {
    throw new GroupDmError(
      warmMessage(error, "We couldn't leave that group just now. Try again.")
    );
  }
}

/**
 * Rename a group. Unlike the rest of this module this is a direct UPDATE on
 * `dm_threads.title` — 0028's "participants can rename their group" policy
 * allows exactly that, for groups only. The 2-60 window is checked here
 * first, and the `is_group` filter keeps a stray 1:1 id from being renamed.
 *
 * Safe to run optimistically: set the new title in state, call this, and
 * roll back to the old one if it throws.
 *
 * @param threadId The group's `dm_threads.id`.
 * @param title    The new name; trimmed, 2-60 characters.
 * @returns The trimmed title as saved — use it for your optimistic state.
 * @throws {GroupDmError} With copy that's ready to render.
 */
export async function renameGroupThread(
  threadId: string,
  title: string
): Promise<string> {
  const cleanTitle = requireTitle(title);

  const { data, error } = await supabase
    .from("dm_threads")
    .update({ title: cleanTitle })
    .eq("id", threadId)
    .eq("is_group", true)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new GroupDmError(
      warmMessage(error, "We couldn't rename that group just now. Try again.")
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
 * untyped — accept both, and drop any row missing an id or handle. Same
 * defence as `@/features/mentions/use-mention-suggestions`.
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

/**
 * Everyone in a thread — you included — sorted by display name. Works for
 * both shapes: a 1:1 returns two people, a group returns 3-16.
 *
 * RLS only lets you read `dm_participants` for threads you're in, so an
 * empty array means either the thread isn't yours or you've just left it.
 * Sorting happens on the client (PostgREST can't reliably order parent rows
 * by an embedded column), using locale-aware comparison with the handle as
 * a tiebreak so the order is stable.
 *
 * @param threadId The thread's `dm_threads.id`.
 * @throws {GroupDmError} With copy that's ready to render.
 */
export async function fetchThreadPeople(
  threadId: string
): Promise<ThreadPerson[]> {
  const { data, error } = await supabase
    .from("dm_participants")
    .select("user_id, profile:profiles(id, display_name, handle, avatar_url)")
    .eq("thread_id", threadId);
  if (error) {
    throw new GroupDmError("We couldn't load who's in this conversation.");
  }
  return normalizePeople(data).sort(
    (a, b) =>
      a.display_name.localeCompare(b.display_name) ||
      a.handle.localeCompare(b.handle)
  );
}

/**
 * One thread row with its group columns, or null when the id is unknown or
 * isn't yours (RLS hides other people's threads, so both look the same).
 *
 * @param threadId The thread's `dm_threads.id`.
 * @throws {GroupDmError} With copy that's ready to render.
 */
export async function fetchThread(
  threadId: string
): Promise<GroupThreadRow | null> {
  const { data, error } = await supabase
    .from("dm_threads")
    .select(GROUP_THREAD_SELECT)
    .eq("id", threadId)
    .maybeSingle();
  if (error) {
    throw new GroupDmError("We couldn't load this conversation.");
  }
  return (data as GroupThreadRow | null) ?? null;
}

/* ------------------------------ naming ------------------------------ */

/** Shown when a group somehow has no title — a group always deserves a name. */
const UNTITLED_GROUP = "Group chat";

/** Shown before `people` has loaded, when there's nothing honest to say yet. */
const UNKNOWN_THREAD = "Conversation";

/** Shown on a 1:1 whose other person has deleted their Huddl account. */
const DEPARTED_PERSON = "Someone who left";

/**
 * The naming rule, in one place: a group shows its title with "N people"
 * underneath; a 1:1 shows the other person's name and nothing underneath.
 * Use it for the thread header, the messages list row, and anywhere else a
 * thread needs a name — so they never drift apart.
 *
 * Pure: no I/O, no clock, no theme. Pass whatever you have and it degrades
 * sensibly — an empty `people` (still loading) yields a neutral placeholder
 * rather than a wrong name.
 *
 * @param thread The thread's `is_group` and `title`; a full
 *   {@link GroupThreadRow} works too.
 * @param people Everyone in the thread, including you, from
 *   {@link fetchThreadPeople}. Pass `[]` while it's loading.
 * @param myId   Your own `profiles.id`, so a 1:1 can find the other person.
 *   Null while the session is resolving.
 */
export function threadDisplay(
  thread: Pick<GroupThreadRow, "is_group" | "title">,
  people: readonly ThreadPerson[],
  myId: string | null
): ThreadDisplay {
  if (thread.is_group) {
    const name = thread.title?.trim();
    return {
      title: name && name.length > 0 ? name : UNTITLED_GROUP,
      subtitle:
        people.length === 0
          ? null
          : `${people.length} ${people.length === 1 ? "person" : "people"}`,
    };
  }

  // A 1:1 is named after whoever isn't you.
  if (people.length === 0) return { title: UNKNOWN_THREAD, subtitle: null };
  const other = people.find((person) => person.id !== myId);
  return {
    title: other ? other.display_name : DEPARTED_PERSON,
    subtitle: null,
  };
}
