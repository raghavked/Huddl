import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/* Take your data with you — the other half of the deletion promise.
 *
 * Migration 0035 added `export_my_data()`, a security-definer RPC that
 * returns the caller's whole record as one jsonb document. Every subquery in
 * it filters on `auth.uid()`, so there is no "whose data" argument here and
 * no way to ask for anyone else's: {@link requestExport} calls it, checks the
 * shape, and hands back both the parsed object and a pretty-printed copy.
 *
 * {@link summarize} turns that document into countable lines — "312
 * messages", "4 courses", "18 focus sessions" — so a student can tell what
 * they are getting without reading a page of JSON. It is pure: same document
 * in, same lines out, no clock and no I/O.
 *
 * ## About the file
 *
 * The web has a real answer where the native app had to improvise. A browser
 * can write a file on its own: {@link downloadExport} wraps the JSON in a
 * `Blob`, points an object URL at it, clicks a link, and revokes the URL a
 * beat later. No dependency, no server round trip, and the bytes never leave
 * the tab. When that is not possible — a document with nothing in it, or a
 * browser without `URL.createObjectURL` — it says so in its return value
 * rather than throwing, and the caller falls back to showing the JSON in a
 * selectable block on screen. That fallback is the floor: a student can
 * always get their data out of this page.
 *
 * No React in here. Pages own the states; this owns the data. The one
 * web-only adjustment, the same one `@/lib/focus` makes: every I/O function
 * takes an optional trailing {@link ExportCtx}, so a server component can
 * pass its request-scoped client while a browser caller gets a lazy shared
 * one.
 */

/* ------------------------------ shapes ------------------------------ */

/** The Supabase client this RPC runs against — server or browser. */
type Db = SupabaseClient;

/**
 * How a caller tells this module which Supabase client to use.
 *
 * @property client Request-scoped server client. Omit in the browser.
 * @property userId Unused by the RPC — `export_my_data()` reads `auth.uid()`
 *   itself — but accepted so every ported data layer takes the same ctx.
 */
export type ExportCtx = {
  client?: Db;
  userId?: string | null;
};

/**
 * The parsed export document, exactly as `export_my_data()` built it. Keys
 * are the server's (`profile`, `courses`, `messages`, …) and values are
 * whatever jsonb held, so everything is read defensively.
 */
export type DataExport = Record<string, unknown>;

/** A finished export: the document, plus the copy we hand a person. */
export type PreparedExport = {
  /** The parsed document. */
  data: DataExport;
  /** The same thing, pretty-printed at two spaces — this is the file. */
  json: string;
};

/**
 * An export failure with a message written for a person, not a log. Show
 * `err.message` directly in an inline error: it never leaks SQL, ids, or
 * PostgREST codes.
 */
export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportError";
  }
}

/* ------------------------------ client ------------------------------ */

/** One browser client for the whole tab, made on first use. */
let browserDb: Db | null = null;

/** The client to run against: the caller's, or the shared browser one. */
function db(ctx?: ExportCtx): Db {
  if (ctx?.client) return ctx.client;
  if (typeof window === "undefined") {
    // A developer mistake, not a student's problem — say what's missing.
    throw new Error(
      "@/lib/data-export: on the server, pass { client } from @/lib/supabase/server."
    );
  }
  browserDb ??= createClient();
  return browserDb;
}

/* ------------------------------ fetching ------------------------------ */

/** Narrow the RPC's return value; null when it isn't a jsonb object. */
function asDocument(raw: unknown): DataExport | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  return raw as DataExport;
}

/**
 * Ask the server for everything it holds about the signed-in student.
 *
 * Self-only by construction — `export_my_data()` reads `auth.uid()` and
 * takes no arguments, so there is nothing to pass and nothing to get wrong.
 * The call can take a second or two for someone with a semester behind them;
 * show an honest pending state rather than a spinner that implies speed.
 *
 * @throws {ExportError} When the RPC fails or returns something unreadable.
 */
export async function requestExport(ctx?: ExportCtx): Promise<PreparedExport> {
  const { data, error } = await db(ctx).rpc("export_my_data");
  if (error) {
    throw new ExportError(
      "We couldn't gather your data just now. Check your connection and give it another go."
    );
  }
  const document = asDocument(data);
  if (!document) {
    throw new ExportError(
      "Your data came back in a shape we couldn't read. Give it another go in a minute."
    );
  }
  return { data: document, json: JSON.stringify(document, null, 2) };
}

/* ----------------------------- summarizing ----------------------------- */

/** The countable things in an export. One key per line the page can draw. */
export type SummaryKey =
  | "messages"
  | "direct_messages"
  | "courses"
  | "notes"
  | "focus_sessions"
  | "grade_entries"
  | "calendar_checkoffs"
  | "board_posts"
  | "events_created";

/** One "312 messages" line, pre-counted and pre-pluralized. */
export type SummaryLine = {
  /** Stable key — use it for the row key and to pick an icon. */
  key: SummaryKey;
  /** How many. Always 1 or more; empty categories never become lines. */
  count: number;
  /** The noun alone, already pluralized: "messages", "grade entries". */
  noun: string;
  /** The whole line, ready to render: "312 messages". */
  label: string;
};

type LineSpec = {
  key: SummaryKey;
  /** Where the count lives in the document. */
  field: string;
  one: string;
  many: string;
  /** Present for counts that aren't just an array length. */
  count?: (value: unknown) => number;
};

/** How many entries sit under every grade category, added up. */
function countGradeEntries(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.reduce<number>((sum, category) => {
    if (typeof category !== "object" || category === null) return sum;
    const entries = (category as Record<string, unknown>)["entries"];
    return sum + (Array.isArray(entries) ? entries.length : 0);
  }, 0);
}

/** A jsonb number the server already aggregated (`calendar_checkoffs`). */
function countNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/**
 * The lines, in the order a student cares about them: the things they wrote
 * first, then the classes those things belong to, then the quieter records.
 */
const LINE_SPECS: readonly LineSpec[] = [
  { key: "messages", field: "messages", one: "message", many: "messages" },
  {
    key: "direct_messages",
    field: "direct_messages",
    one: "direct message",
    many: "direct messages",
  },
  { key: "courses", field: "courses", one: "course", many: "courses" },
  { key: "notes", field: "notes", one: "note", many: "notes" },
  {
    key: "focus_sessions",
    field: "focus_sessions",
    one: "focus session",
    many: "focus sessions",
  },
  {
    key: "grade_entries",
    field: "grades",
    one: "grade entry",
    many: "grade entries",
    count: countGradeEntries,
  },
  {
    key: "calendar_checkoffs",
    field: "calendar_checkoffs",
    one: "assignment checked off",
    many: "assignments checked off",
    count: countNumber,
  },
  {
    key: "board_posts",
    field: "board_posts",
    one: "board post",
    many: "board posts",
  },
  {
    key: "events_created",
    field: "events_created",
    one: "event you created",
    many: "events you created",
  },
];

/**
 * Turn an export document into the countable lines a page can list, so
 * nobody has to read JSON to know what they are about to walk away with.
 *
 * Empty categories are dropped rather than rendered as a column of zeros —
 * a first-week student should see the two things they have, not seven things
 * they don't. An export with nothing countable in it returns `[]`, which is
 * a real answer: their profile and settings are still in the file.
 *
 * Pure and defensive. Anything missing or the wrong type counts as zero
 * instead of throwing; a summary is never worth losing the export over.
 */
export function summarize(data: DataExport): SummaryLine[] {
  const lines: SummaryLine[] = [];
  for (const spec of LINE_SPECS) {
    const value = data[spec.field];
    const count = spec.count
      ? spec.count(value)
      : Array.isArray(value)
        ? value.length
        : 0;
    if (count < 1) continue;
    const noun = count === 1 ? spec.one : spec.many;
    lines.push({ key: spec.key, count, noun, label: `${count} ${noun}` });
  }
  return lines;
}

/** When the server built this export, or null if it didn't say. */
export function exportedAt(data: DataExport): Date | null {
  const raw = data["exported_at"];
  if (typeof raw !== "string" || raw.length === 0) return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * What to call the file — `huddl-data-2026-08-11.json`. It is the download's
 * name, and it is shown on screen too so a student knows what they're looking
 * for in their downloads folder afterwards.
 */
export function exportFileName(at: Date = new Date()): string {
  const stamp = Number.isNaN(at.getTime())
    ? new Date().toISOString()
    : at.toISOString();
  return `huddl-data-${stamp.slice(0, 10)}.json`;
}

/**
 * A rough, honest size for the thing they're about to take: "about 84 KB".
 * Measured in characters, which is close enough for plain JSON and doesn't
 * need a `Blob` to answer.
 *
 * Pure.
 */
export function sizeLabel(json: string): string {
  const kb = json.length / 1024;
  if (kb < 1) return `${json.length} characters`;
  if (kb < 1024) return `about ${Math.round(kb)} KB`;
  return `about ${(kb / 1024).toFixed(1)} MB`;
}

/* ------------------------------ handing it over ------------------------------ */

/**
 * What happened when we tried to hand the export over.
 *
 * - `saved` — the browser took the file; it's in their downloads.
 * - `empty` — there was nothing to write. Nothing was offered.
 * - `unavailable` — this browser can't build a file URL; show the JSON on
 *   screen instead.
 */
export type DownloadOutcome = "saved" | "empty" | "unavailable";

/** How long the object URL stays alive before it's revoked, in ms. */
const REVOKE_AFTER_MS = 60_000;

/**
 * Save the export as a `.json` file, using nothing but the browser.
 *
 * The document becomes a `Blob`, an object URL points at it, a detached
 * anchor with a `download` attribute is clicked, and the URL is revoked a
 * minute later — long enough for even a slow "where do you want this?"
 * dialog, short enough that the tab doesn't hold the bytes forever.
 *
 * Never throws: every way this can fail is a {@link DownloadOutcome} the
 * caller can answer with a sentence and the on-screen fallback.
 *
 * Browser only — it touches `document`. Calling it during a render on the
 * server returns `unavailable` rather than blowing up.
 *
 * @param json The pretty-printed document from {@link requestExport}.
 * @param at   When the export was made; only names the file.
 */
export function downloadExport(
  json: string,
  at: Date = new Date()
): DownloadOutcome {
  if (json.length === 0) return "empty";
  if (typeof window === "undefined" || typeof document === "undefined") {
    return "unavailable";
  }
  if (typeof URL?.createObjectURL !== "function") return "unavailable";

  try {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFileName(at);
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
    return "saved";
  } catch {
    return "unavailable";
  }
}
