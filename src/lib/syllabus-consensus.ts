import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/* Syllabus consensus: the data layer.
 *
 * Since 0018 any classmate could paste the syllabus, and since 0061 a second
 * paste no longer doubles every due date. Each imported calendar item carries
 * its `import_id`; classmates endorse the import that matches their own copy
 * ("This matches my syllabus"); and the calendar's own read policy shows only
 * the winning import's items, most endorsements first, earliest import as the
 * tiebreak. THE FILTERING LIVES IN THE DATABASE. No caller of this module
 * should ever compare items against {@link winningImportId} to decide what to
 * draw: every existing calendar, plan, and home query already comes back
 * filtered. The rpc exists for the one honest question left to a screen,
 * which version is the class seeing right now, so the versions list can say
 * so out loud.
 *
 * The other verbs are small: endorse, take it back, and withdraw your own
 * import entirely (its items cascade away, and any check-offs and reminders
 * hanging off them go too, which is exactly what the confirm sheet warns).
 * Importing auto-endorses your own version via trigger, so a fresh import
 * always starts with one vote: yours.
 *
 * No React, no theme, no navigation in here: queries, narrowing, and the
 * shared copy both clients repeat word for word. Failures arrive as a
 * {@link SyllabusConsensusError} whose message is warm, specific, and safe to
 * drop straight into an inline error.
 *
 * The one web-only adjustment, the same one `@/lib/moderation` makes: there
 * is no module-level Supabase singleton here the way there is in the native
 * app. Every I/O function takes an optional trailing {@link ConsensusCtx}.
 * Browser callers omit it and get the shared browser client; a server
 * component passes its request-scoped client (and the user id it already
 * resolved) so nothing has to read the session cookie twice.
 */

/* ═══════════════════════════ the shared copy ═════════════════════════ */

/**
 * The import screen's heads-up when the course already has at least one
 * import. Word-identical on both clients; the parity test holds it there.
 */
export const IMPORT_ANYWAY_NOTE =
  "This class already has a syllabus calendar. Import yours anyway and Hearth shows whichever version more classmates confirm.";

/** The endorse button before you've pressed it. */
export const ENDORSE_LABEL = "This matches my syllabus";

/** The endorse button once you have. Pressing it again takes it back. */
export const ENDORSED_LABEL = "Matches your syllabus";

/** The withdraw action on your own import. */
export const WITHDRAW_LABEL = "Withdraw my import";

/** What the withdraw confirm says is about to happen. All of it is true. */
export const WITHDRAW_CONFIRM_BODY =
  "Its dates come off the class calendar, along with anything classmates checked off or set reminders on.";

/**
 * The calendar's banner when two or more versions exist. Below two there is
 * nothing to explain, so callers only ask with 2+.
 */
export function versionsBanner(count: number): string {
  return `${count} syllabus versions were imported. Hearth shows the one most classmates confirm.`;
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
export type ConsensusCtx = {
  client?: Db;
  userId?: string | null;
};

/** Just enough of the importer to draw an avatar and a name beside it. */
export type SyllabusImporter = {
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
 * One syllabus version, as the versions list draws it: who brought it in,
 * how big it is, how many classmates say it matches, and where the caller
 * stands on it.
 */
export type SyllabusImportSummary = {
  /** `syllabus_imports.id`: the list key, and what the verbs below take. */
  id: string;
  /** The course it belongs to. */
  course_id: string;
  /** How many dates it put on the calendar when it landed. */
  item_count: number;
  /** ISO timestamp it was imported. Earliest wins ties. */
  created_at: string;
  /** Who imported it, or null when their profile isn't readable. */
  importer: SyllabusImporter | null;
  /** How many classmates confirm it, the importer's automatic vote included. */
  endorsement_count: number;
  /** Whether the caller is one of them. */
  endorsed_by_me: boolean;
  /** Whether the caller imported it, which is what unlocks withdrawing. */
  mine: boolean;
};

/* ═════════════════════════════ failures ══════════════════════════════ */

/**
 * A consensus failure with a message written for a person, not a log. Show
 * `err.message` directly in your inline error; it never leaks SQL, ids, or
 * PostgREST codes.
 */
export class SyllabusConsensusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyllabusConsensusError";
  }
}

/* ══════════════════════════════ client ═══════════════════════════════ */

/** One browser client for the whole tab, made on first use. */
let browserDb: Db | null = null;

/** The client to run against: the caller's, or the shared browser one. */
function db(ctx?: ConsensusCtx): Db {
  if (ctx?.client) return ctx.client;
  if (typeof window === "undefined") {
    // A developer mistake rather than a student's problem, so say what's
    // missing.
    throw new Error(
      "@/lib/syllabus-consensus: on the server, pass { client } from @/lib/supabase/server."
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
 * Unwrap every shape to a plain record. Same defence as `@/lib/moderation`.
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

/** Narrow the embedded `profiles` row; null when there's no usable person. */
function toImporter(raw: unknown): SyllabusImporter | null {
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

/** The endorsers' user ids off the embedded `syllabus_endorsements` rows. */
function toEndorserIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const row of raw) {
    const record = embedded(row);
    const id = record ? text(record["user_id"]) : null;
    if (id !== null) ids.push(id);
  }
  return ids;
}

/**
 * Narrow one joined `syllabus_imports` row. A row with no id or no filing
 * time isn't a version we can render honestly, so it's dropped rather than
 * drawn as a blank card.
 */
function toSummary(
  raw: unknown,
  callerId: string | null
): SyllabusImportSummary | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = text(record["id"]);
  const courseId = text(record["course_id"]);
  const createdAt = text(record["created_at"]);
  if (id === null || courseId === null || createdAt === null) return null;
  const itemCount = record["item_count"];
  const userId = text(record["user_id"]);
  const endorsers = toEndorserIds(record["endorsements"]);
  return {
    id,
    course_id: courseId,
    item_count: typeof itemCount === "number" ? itemCount : 0,
    created_at: createdAt,
    importer: toImporter(record["importer"]),
    endorsement_count: endorsers.length,
    endorsed_by_me: callerId !== null && endorsers.includes(callerId),
    mine: callerId !== null && userId === callerId,
  };
}

/* ═══════════════════════════════ reads ═══════════════════════════════ */

/**
 * The caller's `profiles.id`: theirs if they handed one over, otherwise read
 * from the stored session. Null rather than a throw when nobody is signed in:
 * every caller here has a warmer answer for that than an error.
 */
async function currentUserId(ctx?: ConsensusCtx): Promise<string | null> {
  const given = ctx?.userId;
  if (typeof given === "string" && given.length > 0) return given;
  const { data } = await db(ctx).auth.getSession();
  const id = data.session?.user.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Every syllabus version this course has, with its endorsement count, who
 * imported it, and where the caller stands on each: already endorsed, and
 * theirs to withdraw.
 *
 * Sorted the way the database picks the winner, most endorsements first and
 * the earliest import breaking ties, so with 2+ versions the first row is
 * the one the class calendar is showing. When the exact winning id matters
 * (it can shift under a screen between reads), ask {@link winningImportId}
 * rather than trusting an index.
 *
 * RLS scopes the list to enrolled classmates; anyone else gets an empty
 * array, not an error.
 *
 * @throws {SyllabusConsensusError} With copy that's ready to render.
 */
export async function listSyllabusImports(
  courseId: string,
  ctx?: ConsensusCtx
): Promise<SyllabusImportSummary[]> {
  const callerId = await currentUserId(ctx);
  const { data, error } = await db(ctx)
    .from("syllabus_imports")
    .select(
      "id, course_id, user_id, item_count, created_at, " +
        "importer:profiles(id, handle, display_name, avatar_url), " +
        "endorsements:syllabus_endorsements(user_id)"
    )
    .eq("course_id", courseId);
  if (error) {
    throw new SyllabusConsensusError(
      "We couldn't load the syllabus versions. Check your connection and give it another go."
    );
  }
  if (!Array.isArray(data)) return [];

  const out: SyllabusImportSummary[] = [];
  for (const row of data) {
    const summary = toSummary(row, callerId);
    if (summary) out.push(summary);
  }
  out.sort((a, b) => {
    if (a.endorsement_count !== b.endorsement_count) {
      return b.endorsement_count - a.endorsement_count;
    }
    if (a.created_at !== b.created_at) {
      return a.created_at < b.created_at ? -1 : 1;
    }
    return a.id < b.id ? -1 : 1;
  });
  return out;
}

/**
 * Which import the class calendar is showing right now, via the same
 * `winning_syllabus_import` function the read policy itself calls, so the
 * answer can never disagree with the rows. Null when the course has no
 * imports at all.
 *
 * @throws {SyllabusConsensusError} With copy that's ready to render.
 */
export async function winningImportId(
  courseId: string,
  ctx?: ConsensusCtx
): Promise<string | null> {
  const { data, error } = await db(ctx).rpc("winning_syllabus_import", {
    p_course_id: courseId,
  });
  if (error) {
    throw new SyllabusConsensusError(
      "We couldn't check which version the class is seeing. Give it another go."
    );
  }
  return text(data);
}

/* ══════════════════════════════ writes ═══════════════════════════════ */

/**
 * Say a version matches your own copy of the syllabus. One endorsement per
 * classmate per import, enforced by the primary key; endorsing twice is a
 * quiet no-op rather than an error, so a double-click never scolds anyone.
 *
 * RLS insists you're enrolled in the import's course. If enough classmates
 * agree with you, the class calendar switches to this version on its own:
 * refetch the items after this settles.
 *
 * @param importId The version's `syllabus_imports.id`.
 * @throws {SyllabusConsensusError} With copy that's ready to render.
 */
export async function endorseImport(
  importId: string,
  ctx?: ConsensusCtx
): Promise<void> {
  const userId = await currentUserId(ctx);
  if (userId === null) {
    throw new SyllabusConsensusError(
      "You're signed out, so that vote has nobody to belong to. Sign back in first."
    );
  }
  const { error } = await db(ctx)
    .from("syllabus_endorsements")
    .upsert(
      { import_id: importId, user_id: userId },
      { onConflict: "import_id,user_id", ignoreDuplicates: true }
    );
  if (error) {
    throw new SyllabusConsensusError(
      "That didn't save. Give it another go in a moment."
    );
  }
}

/**
 * Take an endorsement back. Yours only, and taking back one you never gave
 * is a quiet no-op. The importer's automatic vote is an ordinary row, so an
 * importer can even un-endorse their own version if a classmate's turns out
 * to be the right one.
 *
 * @param importId The version's `syllabus_imports.id`.
 * @throws {SyllabusConsensusError} With copy that's ready to render.
 */
export async function unendorseImport(
  importId: string,
  ctx?: ConsensusCtx
): Promise<void> {
  const userId = await currentUserId(ctx);
  if (userId === null) {
    throw new SyllabusConsensusError(
      "You're signed out, so there's no endorsement here to take back. Sign back in first."
    );
  }
  const { error } = await db(ctx)
    .from("syllabus_endorsements")
    .delete()
    .eq("import_id", importId)
    .eq("user_id", userId);
  if (error) {
    throw new SyllabusConsensusError(
      "That didn't save. Give it another go in a moment."
    );
  }
}

/**
 * Withdraw an import entirely. The delete policy scopes this to your own,
 * and the cascade does the rest: its calendar items go, and every check-off
 * and reminder hanging off them goes too. That's exactly what
 * {@link WITHDRAW_CONFIRM_BODY} warns, so show it before calling this.
 *
 * A row that RLS refuses (someone else's import) comes back with nothing
 * deleted rather than an error code, so this asks for the id back and treats
 * an empty result as a failure. Silence is the one outcome a destructive
 * action can't afford.
 *
 * @param importId The version's `syllabus_imports.id`.
 * @throws {SyllabusConsensusError} With copy that's ready to render.
 */
export async function withdrawImport(
  importId: string,
  ctx?: ConsensusCtx
): Promise<void> {
  const { data, error } = await db(ctx)
    .from("syllabus_imports")
    .delete()
    .eq("id", importId)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new SyllabusConsensusError(
      "That import didn't come off. Give it another go in a moment."
    );
  }
  if (typeof data !== "object" || data === null) {
    throw new SyllabusConsensusError(
      "Only the classmate who imported a version can withdraw it, and this one isn't yours."
    );
  }
}
