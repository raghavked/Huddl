import type { DmThread } from "@/lib/types";

/* Group DMs: the shared contract.
 *
 * Migration 0028 gave dm_threads two shapes that share one table: a 1:1
 * thread (is_group = false, no title) and a named group of 3-16 people
 * (is_group = true, title set, created_by set). create_dm_thread now skips
 * groups entirely, so find-or-create for a 1:1 can never land you in a group
 * that happens to hold both people.
 *
 * This module is the pure half: limits, warm failure copy, and the naming
 * and preview rules the thread list, the room header, and the group panel
 * all read from, so they can never drift apart. No React, no Supabase, no
 * clock, which means it runs unchanged in a server component, in the
 * browser, and under Vitest. Every write lives next door in
 * `./group-actions`, which needs the browser client.
 */

/* ------------------------------ shapes ------------------------------ */

/** One person in a thread: enough to render a row, a chip, or an avatar. */
export interface ThreadPerson {
  /** `profiles.id`. */
  id: string;
  /** Their display name, falling back to their handle if it's somehow blank. */
  display_name: string;
  /** Their handle, without the leading `@`. */
  handle: string;
  /** Their avatar, or null; the Avatar primitive falls back to initials. */
  avatar_url: string | null;
}

/** What {@link threadDisplay} hands a header or a list row. */
export interface ThreadDisplay {
  /** The name to show: the group's title, or the other person on a 1:1. */
  title: string;
  /** "6 people" under a group title; null on a 1:1, which needs no second line. */
  subtitle: string | null;
}

/** The thread columns naming needs. A full {@link DmThread} works too. */
export type NamedThread = Pick<DmThread, "is_group" | "title">;

/* ---------------------------- the limits ---------------------------- */

/** Smallest a group can be, counting you. Matches create_group_thread. */
export const GROUP_MIN_PEOPLE = 3;

/** Largest a group can be, counting you. Matches add_to_group_thread. */
export const GROUP_MAX_PEOPLE = 16;

/** Shortest a group name may be, after trimming. */
export const GROUP_TITLE_MIN = 2;

/** Longest a group name may be, after trimming. Cap your input here. */
export const GROUP_TITLE_MAX = 60;

/** Columns every screen needs off `dm_threads`. Keep selects consistent. */
export const GROUP_THREAD_SELECT = "id, created_at, is_group, title, created_by";

/* ----------------------------- failures ----------------------------- */

/**
 * A group-DM failure with a message written for a person, not a log. Show
 * `err.message` directly in your inline error; it never leaks SQL, ids, or
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
 * Fragment order matters only where two could both match, and they don't
 * today.
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

/**
 * Map a raised database message to warm copy, or fall back to `fallback`.
 * Accepts whatever PostgREST handed back: an error object, a string, or
 * nothing at all.
 */
export function warmGroupMessage(raw: unknown, fallback: string): string {
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
export function requireGroupTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < GROUP_TITLE_MIN || trimmed.length > GROUP_TITLE_MAX) {
    throw new GroupDmError("Group names run 2 to 60 characters.");
  }
  return trimmed;
}

/** Unique, non-empty ids in the order they were given. */
export function uniqueIds(userIds: readonly string[]): string[] {
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

/* ------------------------------ naming ------------------------------ */

/** Shown when a group somehow has no title. A group always deserves a name. */
const UNTITLED_GROUP = "Group chat";

/** Shown before `people` has loaded, when there's nothing honest to say yet. */
const UNKNOWN_THREAD = "Conversation";

/** Shown on a 1:1 whose other person has deleted their Hearth account. */
const DEPARTED_PERSON = "Someone who left";

/**
 * The naming rule, in one place: a group shows its title with "N people"
 * underneath; a 1:1 shows the other person's name and nothing underneath.
 * Use it for the thread header, the messages list row, and anywhere else a
 * thread needs a name, so they never drift apart.
 *
 * Pure: no I/O, no clock. Pass whatever you have and it degrades sensibly:
 * an empty `people` (still loading) yields a neutral placeholder rather than
 * a wrong name.
 *
 * @param thread The thread's `is_group` and `title`.
 * @param people Everyone in the thread, including you. Pass `[]` while it's
 *   loading.
 * @param myId   Your own `profiles.id`, so a 1:1 can find the other person.
 */
export function threadDisplay(
  thread: NamedThread,
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

/** "Maya Ortiz" -> "Maya", for chips and "Maya: see you at 6" previews. */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * The one line of preview text under a thread's name. A group says who
 * spoke ("Maya: see you at 6"); a 1:1 only marks your own last word
 * ("You: on my way"). Whitespace collapses so a pasted multi-line message
 * can't stretch the row.
 */
export function threadPreview(thread: {
  isGroup: boolean;
  latest: { content: string; deleted_at: string | null } | null;
  /** Whether the signed-in student wrote the latest message. */
  latestIsMine: boolean;
  /** Who wrote it, for a group: a first name, or null if they've left. */
  latestAuthorName: string | null;
}): string {
  if (!thread.latest) {
    return thread.isGroup
      ? "No messages yet. Get it started."
      : "No messages yet. Say hi.";
  }
  if (thread.latest.deleted_at) return "Message deleted";
  const body = thread.latest.content.replace(/\s+/g, " ").trim();
  const who = thread.latestIsMine
    ? "You"
    : thread.isGroup
      ? (thread.latestAuthorName ?? "Someone")
      : null;
  return who ? `${who}: ${body}` : body;
}
