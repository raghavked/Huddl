import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_NOTE_CONTENT_TYPES,
  ACCEPTED_NOTE_EXTENSIONS,
  isAcceptedNote,
  noteContentType,
  noteExtension,
} from "./note-types";

/**
 * The note allow-list exists in three places and all three have to agree:
 * this module, its native twin, and the `notes` bucket's `allowed_mime_types`
 * in migration 0049.
 *
 * Two of the three drifting is how the gap 0049 closes came about in the
 * first place. Each client had its own extension list in the file picker and
 * the bucket had none at all, so the "allow-list" was a suggestion that a
 * direct call to the storage API walked straight past.
 */

const REPO = process.cwd();
const NATIVE = join(REPO, "mobile", "src", "lib", "note-types.ts");
const MIGRATION = join(
  REPO,
  "supabase",
  "migrations",
  "0049_notes_bucket_accepts_coursework_only.sql"
);

/** Everything after each copy's own header comment. */
const SHARED_FROM = "/**\n * Extension to content type";

function sharedPart(source: string): string {
  const at = source.indexOf(SHARED_FROM);
  if (at === -1) {
    throw new Error("Shared marker not found; update SHARED_FROM.");
  }
  return source.slice(at);
}

describe("note types", () => {
  it("is identical on native and web", () => {
    const native = readFileSync(NATIVE, "utf8");
    const web = readFileSync(join(REPO, "src", "lib", "note-types.ts"), "utf8");
    expect(sharedPart(web)).toBe(sharedPart(native));
  });

  it("matches the bucket the database actually enforces", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const open = sql.indexOf("allowed_mime_types = array[");
    const close = sql.indexOf("]\nwhere id = 'notes'");
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);

    const inSql = [...sql.slice(open, close).matchAll(/'([a-z]+\/[a-z0-9.+-]+)'/g)]
      .map((m) => m[1])
      .sort();

    expect(inSql).toEqual([...ACCEPTED_NOTE_CONTENT_TYPES]);
  });

  it("refuses the things a coursework bucket should refuse", () => {
    // Archives and anything executable, and SVG for the same reason
    // migration 0044 keeps it out of the avatar and chat buckets: an SVG
    // served from storage is a script.
    for (const name of [
      "lecture.zip",
      "notes.tar.gz",
      "helper.exe",
      "run.sh",
      "diagram.svg",
      "page.html",
      "macro.docm",
    ]) {
      expect(isAcceptedNote(name), name).toBe(false);
      expect(noteContentType(name), name).toBeNull();
    }
  });

  it("accepts the coursework a student actually has", () => {
    for (const name of [
      "week5.pdf",
      "slides.pptx",
      "data.xlsx",
      "notes.md",
      "whiteboard.HEIC",
      "scan.jpeg",
    ]) {
      expect(isAcceptedNote(name), name).toBe(true);
      expect(noteContentType(name), name).not.toBeNull();
    }
  });

  it("reads the extension the way a filename actually behaves", () => {
    expect(noteExtension("a.b.pdf")).toBe("pdf");
    expect(noteExtension("SHOUTING.PDF")).toBe("pdf");
    expect(noteExtension("no-extension")).toBe("");
    expect(noteExtension("trailing.")).toBe("");
    // A dotfile has no extension, it has a name that starts with a dot.
    expect(noteExtension(".pdf")).toBe("");
  });

  it("offers every extension it knows a type for", () => {
    for (const ext of ACCEPTED_NOTE_EXTENSIONS) {
      expect(noteContentType(`file.${ext}`), ext).not.toBeNull();
    }
  });
});
