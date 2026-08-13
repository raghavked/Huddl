import { Platform, Share } from "react-native";
import { supabase } from "@/lib/supabase";

/* Take your data with you: the other half of the deletion promise.
 *
 * Migration 0035 added `export_my_data()`, a security-definer RPC that
 * returns the caller's whole record as one jsonb document. Every subquery in
 * it filters on `auth.uid()`, so there is no "whose data" argument here and
 * no way to ask for anyone else's: {@link requestExport} calls it, checks the
 * shape, and hands back both the parsed object and a pretty-printed copy.
 *
 * {@link summarize} turns that document into countable lines ("312
 * messages", "4 courses", "18 focus sessions") so a student can tell what
 * they are getting without reading a page of JSON. It is pure: same document
 * in, same lines out, no clock and no I/O.
 *
 * ## About the file
 *
 * There is no filesystem here. `expo-file-system`, `expo-sharing`, and
 * `expo-clipboard` are all absent from `mobile/package.json`, and this
 * feature is not worth a new dependency. So {@link saveAndShare} uses React
 * Native's core `Share` (already in the bundle) and passes the JSON as the
 * shared text, which the OS share sheet can drop into mail, notes, or a
 * files app. When that is not possible (web, a share sheet that refuses, or
 * a document too large to survive an Android intent) it says so in its
 * return value rather than throwing, and the caller falls back to showing
 * the JSON in a selectable block on screen. That fallback is the floor: a
 * student can always get their data out of this screen, on every platform,
 * with no dependency at all.
 *
 * If `expo-file-system` and `expo-sharing` ever land in the app for another
 * reason, {@link saveAndShare} is the one function to rewrite: write the
 * string to `documentDirectory + fileName`, share the URI, and keep the same
 * {@link ShareOutcome} contract so no screen has to change.
 *
 * No React in here. Screens own the states; this owns the data.
 */

/* ------------------------------ shapes ------------------------------ */

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
  /** The same thing, pretty-printed at two spaces. This is the file. */
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
 * Self-only by construction: `export_my_data()` reads `auth.uid()` and
 * takes no arguments, so there is nothing to pass and nothing to get wrong.
 * The call can take a second or two for someone with a semester behind them;
 * show an honest pending state rather than a spinner that implies speed.
 *
 * @throws {ExportError} When the RPC fails or returns something unreadable.
 */
export async function requestExport(): Promise<PreparedExport> {
  const { data, error } = await supabase.rpc("export_my_data");
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

/** The countable things in an export. One key per line the screen can draw. */
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
  /** Stable key. Use it for the row key and to pick an icon. */
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
 * Turn an export document into the countable lines a screen can list, so
 * nobody has to read JSON to know what they are about to walk away with.
 *
 * Empty categories are dropped rather than rendered as a column of zeros.
 * A first-week student should see the two things they have, not seven things
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
 * What to call the file: `huddl-data-2026-08-11.json`. Used as the share
 * sheet's title and subject so an emailed export arrives named, and shown on
 * screen so a student knows what they're looking for afterwards.
 */
export function exportFileName(at: Date = new Date()): string {
  const stamp = Number.isNaN(at.getTime())
    ? new Date().toISOString()
    : at.toISOString();
  return `huddl-data-${stamp.slice(0, 10)}.json`;
}

/* ------------------------------ handing it over ------------------------------ */

/**
 * Longest document we'll push through the share sheet, in characters.
 *
 * Android carries shared text in a Binder transaction with a hard ceiling
 * around a megabyte, and a payload anywhere near it takes the whole app down
 * with `TransactionTooLargeException`. 120k characters is a comfortable
 * fraction of that (several thousand messages), and anything larger takes
 * the on-screen fallback, which has no limit at all.
 */
export const SHARE_TEXT_LIMIT = 120_000;

/**
 * What happened when we tried to hand the export over.
 *
 * - `shared`: it went somewhere; the student picked a destination.
 * - `dismissed`: they backed out. Not a failure; say nothing.
 * - `too-large`: past {@link SHARE_TEXT_LIMIT}; show the JSON on screen.
 * - `unavailable`: no share sheet here (web, or the OS refused); same
 *   fallback, different sentence.
 */
export type ShareOutcome = "shared" | "dismissed" | "too-large" | "unavailable";

/**
 * Open the share sheet with the export in it, so a student can send it to
 * mail, notes, a files app, or wherever they keep things.
 *
 * Never throws: every way this can fail is a {@link ShareOutcome} the
 * caller can answer with a sentence and the on-screen fallback. See the
 * module note for why this shares text rather than a written file.
 *
 * @param json The pretty-printed document from {@link requestExport}.
 * @param at   When the export was made; only names the share sheet's title.
 */
export async function saveAndShare(
  json: string,
  at: Date = new Date()
): Promise<ShareOutcome> {
  if (json.length === 0) return "unavailable";
  if (json.length > SHARE_TEXT_LIMIT) return "too-large";
  // No native share sheet on web, and RN's shim throws rather than no-ops.
  if (Platform.OS === "web") return "unavailable";

  const name = exportFileName(at);
  try {
    const result = await Share.share(
      { title: name, message: json },
      { subject: name, dialogTitle: name }
    );
    return result.action === Share.sharedAction ? "shared" : "dismissed";
  } catch {
    return "unavailable";
  }
}
