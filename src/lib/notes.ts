import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/* Note tags — the data layer for the words a class files its notes under.
 *
 * Uploading and downloading a note already live in the notes feature
 * (`src/features/notes/note-upload.tsx` writes the row, `notes-section.tsx`
 * signs the URL). This module owns only what migration 0032 added on top:
 * `notes.tags`.
 *
 * THE DATABASE OWNS NORMALIZATION, AND THAT IS DELIBERATE.
 * 0032 put a BEFORE INSERT/UPDATE trigger on the column that trims,
 * lowercases, drops anything shorter than 2 or longer than 24 characters,
 * dedupes, and keeps the first five. Nothing here re-implements any of that.
 * We send what the student typed and read the saved row back, so the page
 * settles on the database's answer instead of guessing at it — "  Midterm 2 "
 * goes out, `midterm 2` comes home. The constants below exist so a composer
 * can cap the picker and the text field politely, not so it can pre-normalize.
 *
 * WHO MAY RETAG. 0006's "uploaders can manage own notes" policy scopes the
 * UPDATE to `uploader_id = auth.uid()`. A classmate's attempt matches zero
 * rows rather than erroring, which PostgREST reports as success with no data —
 * so {@link setNoteTags} treats "no row back" as the refusal it is.
 *
 * Reading is the other way round: anyone enrolled in the course sees the tags,
 * because a filter bar only works if the whole class shares the vocabulary.
 *
 * No React, no theme, no routing in here — two queries, some narrowing, and
 * one pure tally. Every failure arrives as a {@link NotesError} whose message
 * is warm, specific, and safe to drop straight into an inline error.
 *
 * The one web-only adjustment: every I/O function takes an optional trailing
 * {@link NotesCtx}. Browser callers omit it and get the shared browser client;
 * a server component passes its request-scoped client.
 */

/* ══════════════════════════════ shapes ══════════════════════════════ */

/** The Supabase client these queries run against — server or browser. */
type Db = SupabaseClient;

/**
 * How a caller tells this module which Supabase client to use.
 *
 * @property client Request-scoped server client. Omit in the browser.
 * @property userId The caller's `profiles.id` when it's already known. Not
 *   needed by anything here today — the policies do the scoping — but carried
 *   so this module's shape matches every other ported one.
 */
export type NotesCtx = {
  client?: Db;
  userId?: string | null;
};

/** One tag in use on a course's notes, and how many notes wear it. */
export type CourseTag = {
  /** The tag, exactly as stored: already trimmed and lowercased. */
  tag: string;
  /** How many notes carry it. Never zero — an unused tag isn't in the list. */
  count: number;
};

/* ══════════════════════════════ limits ══════════════════════════════ */

/** The trigger keeps the first five tags; don't let a student pick a sixth. */
export const MAX_NOTE_TAGS = 5;

/** A tag survives the trigger at 2–24 characters once trimmed. */
export const MIN_NOTE_TAG_LENGTH = 2;
export const MAX_NOTE_TAG_LENGTH = 24;

/**
 * A starter vocabulary for the composer to offer as chips — the words a class
 * actually files notes under. Not a whitelist: "discussion 2" or "orgo" are
 * just as welcome, so keep the free-text field next to the chips.
 */
export const SUGGESTED_TAGS: readonly string[] = [
  "lecture",
  "midterm",
  "final",
  "lab",
  "problem set",
  "cheatsheet",
  "reading",
];

/* ═════════════════════════════ failures ═════════════════════════════ */

/**
 * A notes failure with a message written for a person, not a log. Show
 * `err.message` directly in your inline error — it never leaks SQL, ids, or
 * PostgREST codes.
 */
export class NotesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotesError";
  }
}

/* ══════════════════════════════ client ══════════════════════════════ */

/** One browser client for the whole tab, made on first use. */
let browserDb: Db | null = null;

/** The client to run against: the caller's, or the shared browser one. */
function db(ctx?: NotesCtx): Db {
  if (ctx?.client) return ctx.client;
  browserDb ??= createClient();
  return browserDb;
}

/* ═══════════════════════════════ reads ══════════════════════════════ */

/**
 * Every tag in use on this course's notes, with a count each — busiest first,
 * alphabetical within a tie.
 *
 * That ordering is what makes a filter bar useful: "lecture · 18" sits where
 * the eye lands, and the long tail stays stable between refreshes instead of
 * shuffling.
 *
 * One query. The tallying happens here (see {@link tallyTags}) because a
 * course's notes number in the dozens, not the thousands, and a `select tags`
 * is cheaper than teaching the database a new RPC.
 *
 * A course with no tagged notes returns an empty array, not an error — the
 * filter bar simply doesn't appear yet.
 *
 * Prefer {@link tallyTags} directly when the page already has the notes in
 * hand: it counts off the list it is rendering, so an optimistic retag moves
 * the filter bar in the same paint. This is for callers that only want the
 * vocabulary.
 *
 * @throws {NotesError} With copy that's ready to render.
 */
export async function fetchCourseTags(
  courseId: string,
  ctx?: NotesCtx
): Promise<CourseTag[]> {
  const { data, error } = await db(ctx)
    .from("notes")
    .select("tags")
    .eq("course_id", courseId);
  if (error) {
    throw new NotesError("We couldn't load the tags for this course.");
  }
  if (!Array.isArray(data)) return [];

  const lists: string[][] = [];
  for (const row of data) {
    if (typeof row !== "object" || row === null) continue;
    lists.push(toTagList((row as Record<string, unknown>)["tags"]));
  }
  return tallyTags(lists);
}

/* ══════════════════════════════ writes ══════════════════════════════ */

/**
 * Replace a note's tags. Only the uploader may do this.
 *
 * Pass the whole set every time, not a delta: `[]` clears the note's tags.
 * The saved tags come back so the page can settle on the normalized version —
 * "  Midterm 2 " went out, `midterm 2` comes home, and a duplicate or a
 * one-letter typo quietly vanishes. Safe to run optimistically: show the tags
 * as typed, then replace them with what this resolves to, and roll back to the
 * old set if it throws.
 *
 * @param noteId The `notes.id` being retagged.
 * @param tags   What the student typed or clicked, in their order.
 * @returns The tags as the database now has them, normalized.
 * @throws {NotesError} With copy that's ready to render.
 */
export async function setNoteTags(
  noteId: string,
  tags: readonly string[],
  ctx?: NotesCtx
): Promise<string[]> {
  const { data, error } = await db(ctx)
    .from("notes")
    .update({ tags: [...tags] })
    .eq("id", noteId)
    .select("id, tags")
    .maybeSingle();
  if (error) {
    throw new NotesError("Those tags didn't save. Give it another try.");
  }
  // Zero rows updated isn't an error to PostgREST — it means the policy didn't
  // match: someone else shared this note, or it's been taken down since.
  if (typeof data !== "object" || data === null) {
    throw new NotesError("Only whoever shared this note can change its tags.");
  }
  return toTagList((data as Record<string, unknown>)["tags"]);
}

/* ═══════════════════ narrowing + pure helpers (no I/O) ══════════════ */

/**
 * A `text[]` off the wire, with the nulls and non-strings dropped.
 *
 * The column is `not null default '{}'`, so in practice this is always an
 * array — but it arrives through an untyped client, and a note that loses its
 * whole row to one bad element would be a worse outcome than a missing tag.
 */
export function toTagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const tag of value) {
    if (typeof tag === "string" && tag.length > 0) out.push(tag);
  }
  return out;
}

/**
 * Count how many notes wear each tag: busiest first, alphabetical within a
 * tie. Pure — hand it the tag arrays of any set of notes, including ones a
 * page already has in state, and no second round trip is needed.
 *
 * A note counts once per tag even if its array somehow repeats one, so the
 * count is always "notes", never "mentions".
 */
export function tallyTags(
  noteTags: readonly (readonly string[])[]
): CourseTag[] {
  const counts = new Map<string, number>();
  for (const tags of noteTags) {
    const seen = new Set<string>();
    for (const tag of tags) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
    byCountThenName
  );
}

/* Plain `<` rather than localeCompare: tags land lowercased by the trigger,
   and a comparison that doesn't depend on the engine's locale data keeps the
   filter bar in the same order for everyone. */
function byCountThenName(a: CourseTag, b: CourseTag): number {
  if (a.count !== b.count) return b.count - a.count;
  if (a.tag === b.tag) return 0;
  return a.tag < b.tag ? -1 : 1;
}

/**
 * How two tags are compared before either has been near the database.
 *
 * Saved tags arrive already trimmed and lowercased by 0032's trigger, so a
 * saved-to-saved comparison is plain equality. A tag the student just typed
 * hasn't been through any of that yet — "Midterm" and "midterm " are one tag
 * and only one of them should get a chip.
 */
export function tagKey(tag: string): string {
  return tag.trim().toLowerCase();
}

/** True when `tags` already carries `tag`, comparing by {@link tagKey}. */
export function hasTag(tags: readonly string[], tag: string): boolean {
  const key = tagKey(tag);
  return tags.some((existing) => tagKey(existing) === key);
}
