"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CircleAlert,
  Download,
  File as FileGeneric,
  FileImage,
  FileSpreadsheet,
  FileText,
  Heart,
  Loader2,
  Presentation,
  Tags,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { NotesScene } from "@/components/illustrations";
import { Button, buttonClasses, cardClasses } from "@/components/ui";
import { useBlockedIds } from "@/features/chat/blocks";
import { NoteUpload, type UploadedNote } from "@/features/notes/note-upload";
import { TagPicker } from "@/features/notes/tag-picker";
import {
  NotesError,
  noteUploaderName,
  setNoteTags,
  tallyTags,
  toTagList,
  type CourseTag,
} from "@/lib/notes";
import { createClient } from "@/lib/supabase/client";
import { cn, formatFileSize, formatMessageTime } from "@/lib/utils";
import type { Note, Profile } from "@/lib/types";

export type NoteWithUploader = Note & {
  uploader: Profile | null;
  /**
   * `notes.tags`, added by migration 0032 and not yet on the shared `Note`
   * type, so it arrives loose off a `select *`. Always read it through
   * `toTagList`, never straight.
   */
  tags?: string[] | null;
};

/** "3 notes", "1 note". */
function noteCount(count: number): string {
  return `${count} ${count === 1 ? "note" : "notes"}`;
}

/** Per-note gratitude: how many classmates said thanks, and whether I did. */
type ThanksEntry = { count: number; mine: boolean };

const NO_THANKS: ThanksEntry = { count: 0, mine: false };

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic"]);
const SHEET_EXTENSIONS = new Set(["xls", "xlsx", "csv"]);
const SLIDE_EXTENSIONS = new Set(["ppt", "pptx", "key"]);
const DOC_EXTENSIONS = new Set(["pdf", "doc", "docx", "txt", "md", "rtf"]);

function fileTypeIcon(mime: string | null, fileName: string): LucideIcon {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (mime?.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)) return FileImage;
  if (mime?.includes("spreadsheet") || mime === "text/csv" || SHEET_EXTENSIONS.has(ext)) {
    return FileSpreadsheet;
  }
  if (mime?.includes("presentation") || SLIDE_EXTENSIONS.has(ext)) {
    return Presentation;
  }
  if (mime === "application/pdf" || mime?.startsWith("text/") || DOC_EXTENSIONS.has(ext)) {
    return FileText;
  }
  return FileGeneric;
}

/**
 * Notes tab of a course page: upload affordance + the shared-notes list.
 * The server page passes the RLS-scoped notes; uploads are shown optimistically
 * (merged by id once router.refresh() brings the server copy back).
 *
 * An uploader who turned Public profile off is credited by their handle (see
 * {@link noteUploaderName}). Their note stays up and their avatar stays on it;
 * only the name goes.
 */
export function NotesSection({
  courseId,
  currentUser,
  notes,
}: {
  courseId: string;
  currentUser: Profile;
  notes: NoteWithUploader[];
}) {
  const router = useRouter();
  const [extraNotes, setExtraNotes] = useState<NoteWithUploader[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  /* Tags a student has just changed, held over the server copy until
     router.refresh() catches up. Keyed by note id; the value is always what
     the database settled on, never what was typed. */
  const [tagEdits, setTagEdits] = useState<Record<string, string[]>>({});
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);
  // Which tags the list is filtered by. Multi-select, and they AND together:
  // "midterm" plus "cheatsheet" means notes wearing both.
  const [selected, setSelected] = useState<string[]>([]);

  /* Blocking hides what a person writes, and a shared note is a thing they
     wrote. This is the same set the chat rooms filter through, so a classmate
     you blocked is not still handing you coursework on the course page, with
     their name, their avatar, and a working "Say thanks" button.

     Like every other block filter in the web client, it resolves a beat after
     the first paint: the notes arrive server-rendered and the block list is a
     client fetch, so a blocked uploader is visible for one frame and stays
     visible if that fetch fails. That is exactly what chat, threads and DMs
     do today. Making this one surface stricter than the room beside it would
     be a difference nobody could explain; if that window is ever worth
     closing, it should close for all of them at once, in
     features/chat/blocks.ts. */
  const { blockedIds } = useBlockedIds(currentUser.id);

  /* The filter belongs here rather than at the render, because the tag rail
     and the empty state are both counted off `visible`. Applied any later, a
     course whose only notes came from a blocked classmate would show
     "midterm · 3" above an empty list and would never reach its empty state. */
  const visible = useMemo(() => {
    const known = new Set(notes.map((note) => note.id));
    const removed = new Set(removedIds);
    return [...extraNotes.filter((note) => !known.has(note.id)), ...notes]
      .filter((note) => !removed.has(note.id))
      .filter(
        (note) =>
          note.uploader_id === currentUser.id ||
          !blockedIds.has(note.uploader_id)
      );
  }, [notes, extraNotes, removedIds, blockedIds, currentUser.id]);

  /** The tags one note is wearing right now. An unsaved edit wins. */
  const tagsOf = useMemo(() => {
    return (note: NoteWithUploader): string[] =>
      tagEdits[note.id] ?? toTagList(note.tags);
  }, [tagEdits]);

  /* Counted off the list being rendered rather than fetched separately, so an
     optimistic retag moves the filter bar in the same paint. */
  const courseTags: CourseTag[] = useMemo(
    () => tallyTags(visible.map(tagsOf)),
    [visible, tagsOf]
  );

  /* If the last note wearing a filtered tag gets retagged or taken down, that
     filter would strand the reader on an empty list. Drop it instead. */
  useEffect(() => {
    const live = new Set(courseTags.map((entry) => entry.tag));
    setSelected((current) => {
      const next = current.filter((tag) => live.has(tag));
      return next.length === current.length ? current : next;
    });
  }, [courseTags]);

  const shown = useMemo(() => {
    if (selected.length === 0) return visible;
    // Saved tags are already lowercased by the trigger, so this is exact.
    return visible.filter((note) => {
      const own = tagsOf(note);
      return selected.every((tag) => own.includes(tag));
    });
  }, [visible, selected, tagsOf]);

  const filtering = selected.length > 0;

  // Gratitude on the visible notes (migration 0026): one query, reduced to
  // {count, mine} per note. Keyed on the id set so toggles don't refetch.
  const [thanks, setThanks] = useState<Record<string, ThanksEntry>>({});
  const thanksInFlight = useRef<Set<string>>(new Set());
  const visibleIdsKey = useMemo(
    () => visible.map((note) => note.id).sort().join(","),
    [visible]
  );

  useEffect(() => {
    if (visibleIdsKey === "") {
      setThanks({});
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    void supabase
      .from("note_thanks")
      .select("note_id, user_id")
      .in("note_id", visibleIdsKey.split(","))
      .then(({ data, error: fetchError }) => {
        // Best effort: a hiccup keeps whatever we already had.
        if (cancelled || fetchError) return;
        const reduced: Record<string, ThanksEntry> = {};
        for (const row of (data ?? []) as { note_id: string; user_id: string }[]) {
          const current = reduced[row.note_id] ?? NO_THANKS;
          reduced[row.note_id] = {
            count: current.count + 1,
            mine: current.mine || row.user_id === currentUser.id,
          };
        }
        setThanks(reduced);
      });
    return () => {
      cancelled = true;
    };
  }, [visibleIdsKey, currentUser.id]);

  /** Give thanks, or take it back. Optimistic either way, rolled back on
   *  failure. The uploader hears about it through the server-side trigger. */
  async function toggleThanks(note: NoteWithUploader) {
    // You can't thank yourself. The server agrees, so don't even try.
    if (note.uploader_id === currentUser.id) return;
    if (thanksInFlight.current.has(note.id)) return;
    thanksInFlight.current.add(note.id);
    const previous = thanks[note.id] ?? NO_THANKS;
    const giving = !previous.mine;
    setError(null);
    setThanks((prev) => ({
      ...prev,
      [note.id]: giving
        ? { count: previous.count + 1, mine: true }
        : { count: Math.max(previous.count - 1, 0), mine: false },
    }));
    const supabase = createClient();
    try {
      if (giving) {
        const { error: insertError } = await supabase
          .from("note_thanks")
          .insert({ note_id: note.id, user_id: currentUser.id });
        // Already thanked from another tab? The heart is right as drawn.
        if (insertError && insertError.code !== "23505") throw insertError;
      } else {
        const { error: deleteError } = await supabase
          .from("note_thanks")
          .delete()
          .eq("note_id", note.id)
          .eq("user_id", currentUser.id);
        if (deleteError) throw deleteError;
      }
      setAnnouncement(
        giving
          ? `Thanks sent for "${note.title}".`
          : `Thanks taken back for "${note.title}".`
      );
    } catch {
      setThanks((prev) => ({ ...prev, [note.id]: previous }));
      setError(
        giving
          ? "Your thanks didn't make it through. Give it another try."
          : "Couldn't take that back just now. Give it another try."
      );
    } finally {
      thanksInFlight.current.delete(note.id);
    }
  }

  function handleUploaded(note: UploadedNote) {
    setExtraNotes((prev) => [{ ...note, uploader: currentUser }, ...prev]);
    setAnnouncement(`"${note.title}" was shared with the class.`);
    // If the seeded tags came back off before sharing, the note they just put
    // up would vanish behind the current filter. Clear it rather than hide it.
    if (
      selected.length > 0 &&
      !selected.every((tag) => note.tags.includes(tag))
    ) {
      setSelected([]);
    }
    router.refresh();
  }

  function startEditTags(note: NoteWithUploader) {
    setError(null);
    setEditingTagsId(note.id);
    setDraftTags([...tagsOf(note)]);
  }

  function cancelEditTags() {
    setEditingTagsId(null);
    setDraftTags([]);
  }

  /**
   * Save a note's tags. Optimistic: the chips change as the editor closes and
   * change back with an apology if the write doesn't land. What comes home is
   * the normalized set, so " Midterm 2 " settles as `midterm 2` on screen too.
   */
  async function handleSaveTags(note: NoteWithUploader) {
    if (savingTags) return;
    const previous = tagsOf(note);
    const next = [...draftTags];
    setSavingTags(true);
    setError(null);
    setTagEdits((prev) => ({ ...prev, [note.id]: next }));
    setEditingTagsId(null);
    setDraftTags([]);
    try {
      const saved = await setNoteTags(note.id, next);
      setTagEdits((prev) => ({ ...prev, [note.id]: saved }));
      setAnnouncement(
        saved.length === 0
          ? `Tags cleared on "${note.title}".`
          : `"${note.title}" is now tagged ${saved.join(", ")}.`
      );
      router.refresh();
    } catch (caught) {
      setTagEdits((prev) => ({ ...prev, [note.id]: previous }));
      setError(
        caught instanceof NotesError
          ? caught.message
          : "Those tags didn't save. Give it another try."
      );
    } finally {
      setSavingTags(false);
    }
  }

  function toggleFilter(tag: string) {
    setSelected((current) =>
      current.includes(tag)
        ? current.filter((existing) => existing !== tag)
        : [...current, tag]
    );
  }

  async function handleDownload(note: NoteWithUploader) {
    setError(null);
    setDownloadingId(note.id);
    try {
      const supabase = createClient();
      const { data, error: urlError } = await supabase.storage
        .from("notes")
        .createSignedUrl(note.storage_path, 60, { download: note.file_name });
      if (urlError || !data?.signedUrl) {
        throw urlError ?? new Error("No signed URL returned");
      }
      // The signed URL carries a content-disposition: attachment, so this
      // triggers a download without navigating away.
      const link = document.createElement("a");
      link.href = data.signedUrl;
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
    } catch {
      setError("Couldn't prepare that download. Give it another try.");
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleDelete(note: NoteWithUploader) {
    setError(null);
    setDeletingId(note.id);
    const supabase = createClient();
    // Best effort on the file itself. If it's already gone we still want the
    // row removed. RLS limits both calls to the uploader's own note.
    await supabase.storage.from("notes").remove([note.storage_path]);
    const { error: deleteError } = await supabase
      .from("notes")
      .delete()
      .eq("id", note.id)
      .eq("uploader_id", currentUser.id);
    setDeletingId(null);
    if (deleteError) {
      setError("Couldn't delete that note. Give it another try.");
      return;
    }
    setConfirmingId(null);
    setRemovedIds((prev) => [...prev, note.id]);
    setAnnouncement(`"${note.title}" was deleted.`);
    router.refresh();
  }

  return (
    <div>
      <NoteUpload
        courseId={courseId}
        userId={currentUser.id}
        courseTags={courseTags.slice(0, 6).map((entry) => entry.tag)}
        seedTags={selected}
        onUploaded={handleUploaded}
      />

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* The filter rail. It bleeds to both gutters so a long list of tags
          runs off the edge instead of stopping short of it. It isn't drawn
          at all until the class has actually tagged something. The rail
          scrolls, never the page. */}
      {courseTags.length > 0 ? (
        <div className="mt-4">
          <div
            role="group"
            aria-label="Filter notes by tag"
            className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
          >
            <button
              type="button"
              onClick={() => setSelected([])}
              aria-pressed={!filtering}
              aria-label={`All notes, ${noteCount(visible.length)}`}
              className={cn(
                "inline-flex h-11 shrink-0 items-center rounded-full border px-4 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                filtering
                  ? "border-border bg-surface text-muted hover:text-foreground"
                  : "border-transparent bg-brand-soft text-brand-ink"
              )}
            >
              All
            </button>
            {courseTags.map((entry) => {
              const on = selected.includes(entry.tag);
              return (
                <button
                  key={entry.tag}
                  type="button"
                  onClick={() => toggleFilter(entry.tag)}
                  aria-pressed={on}
                  aria-label={`${entry.tag}, ${noteCount(entry.count)}`}
                  className={cn(
                    "inline-flex h-11 shrink-0 items-center rounded-full border px-4 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                    on
                      ? "border-transparent bg-brand-soft text-brand-ink"
                      : "border-border bg-surface text-muted hover:text-foreground"
                  )}
                >
                  {/* "lecture · 12", never "lecture 12": plenty of real tags
                      end in a number ("week 5"), and the middot is what keeps
                      the count from reading as part of the word. */}
                  {entry.tag} · {entry.count}
                </button>
              );
            })}
          </div>
          {filtering ? (
            <p className="mt-1.5 text-xs text-muted">
              {selected.length === 1
                ? `${noteCount(shown.length)} tagged “${selected[0]}”.`
                : `${noteCount(shown.length)} with all ${selected.length} of these tags.`}
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          illustration={<NotesScene />}
          icon={FileText}
          title="No notes yet"
          description="Be the first to share lecture notes, a study guide or slides with your class."
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="Nothing under those tags yet"
          description="Nobody's filed a note this way so far. Take a tag off, or be the one who shares it."
          action={
            <button
              type="button"
              onClick={() => setSelected([])}
              className={buttonClasses({ variant: "soft", size: "sm" })}
            >
              Show every note
            </button>
          }
        />
      ) : (
        <ul className="mt-4 flex flex-col gap-2.5">
          {shown.map((note) => {
            const TypeIcon = fileTypeIcon(note.mime_type, note.file_name);
            const noteTags = tagsOf(note);
            const editingTags = editingTagsId === note.id;
            const mine = note.uploader_id === currentUser.id;
            /* Also what the avatar's initials come from, so a private
               uploader's row doesn't spell out the name the byline withholds. */
            const uploaderName = noteUploaderName(note.uploader, currentUser.id);
            const thanksEntry = thanks[note.id] ?? NO_THANKS;
            return (
              <li
                key={note.id}
                className={cardClasses({
                  padding: "sm",
                  className: "flex flex-col",
                })}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"
                    title={note.file_name}
                  >
                    <TypeIcon className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{note.title}</p>
                    {note.description ? (
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted">
                        {note.description}
                      </p>
                    ) : null}
                    {noteTags.length > 0 ? (
                      /* Clickable, because a tag on a note is the fastest way
                         to say "more like this one". */
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {noteTags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => toggleFilter(tag)}
                            aria-pressed={selected.includes(tag)}
                            aria-label={
                              selected.includes(tag)
                                ? `Stop filtering by ${tag}`
                                : `Show only notes tagged ${tag}`
                            }
                            className={cn(
                              "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                              selected.includes(tag)
                                ? "bg-brand-soft text-brand-ink"
                                : "bg-surface-2 text-muted hover:text-foreground"
                            )}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
                      <Avatar
                        name={uploaderName}
                        src={note.uploader?.avatar_url}
                        size="xs"
                      />
                      <span className="font-medium text-foreground">
                        {mine ? "You" : uploaderName}
                      </span>
                      <span aria-hidden>·</span>
                      <span>{formatFileSize(note.file_size)}</span>
                      <span aria-hidden>·</span>
                      <span>{formatMessageTime(note.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {confirmingId === note.id ? (
                      <>
                        <span className="text-xs font-medium text-muted">
                          Delete?
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDelete(note)}
                          disabled={deletingId === note.id}
                          className={buttonClasses({
                            variant: "danger",
                            size: "sm",
                          })}
                        >
                          {deletingId === note.id ? (
                            <Loader2
                              className="size-3.5 animate-spin"
                              aria-hidden
                            />
                          ) : null}
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          disabled={deletingId === note.id}
                          aria-label="Keep this note"
                          className="rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                        >
                          <X className="size-4" aria-hidden />
                        </button>
                      </>
                    ) : (
                      <>
                        {mine ? (
                          /* Your own notes: the warmth just shows. You can't
                             thank yourself, and the server agrees. */
                          <span
                            className="flex items-center gap-1 p-2 text-xs font-semibold text-muted"
                            aria-hidden={thanksEntry.count === 0}
                            title={
                              thanksEntry.count > 0
                                ? thanksEntry.count === 1
                                  ? "1 classmate said thanks"
                                  : `${thanksEntry.count} classmates said thanks`
                                : undefined
                            }
                          >
                            <Heart className="size-4" aria-hidden />
                            {thanksEntry.count > 0 ? (
                              <>
                                <span aria-hidden>{thanksEntry.count}</span>
                                <span className="sr-only">
                                  {thanksEntry.count === 1
                                    ? "1 classmate said thanks"
                                    : `${thanksEntry.count} classmates said thanks`}
                                </span>
                              </>
                            ) : null}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void toggleThanks(note)}
                            aria-pressed={thanksEntry.mine}
                            aria-label={
                              thanksEntry.mine
                                ? `Take back your thanks for ${note.title}`
                                : `Say thanks for ${note.title}`
                            }
                            title={thanksEntry.mine ? "Take back your thanks" : "Say thanks"}
                            className={cn(
                              "flex items-center gap-1 rounded-full p-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                              thanksEntry.mine
                                ? "bg-brand-soft text-brand"
                                : "text-muted hover:bg-brand-soft hover:text-brand-ink"
                            )}
                          >
                            <Heart
                              className="size-4"
                              fill={thanksEntry.mine ? "currentColor" : "none"}
                              aria-hidden
                            />
                            {thanksEntry.count > 0 ? (
                              <span
                                className={
                                  thanksEntry.mine ? "text-brand-ink" : undefined
                                }
                              >
                                {thanksEntry.count}
                              </span>
                            ) : null}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDownload(note)}
                          disabled={downloadingId === note.id}
                          aria-label={`Download ${note.title}`}
                          title="Download"
                          className="rounded-full p-2 text-muted transition-colors hover:bg-brand-soft hover:text-brand-ink disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                        >
                          {downloadingId === note.id ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                          ) : (
                            <Download className="size-4" aria-hidden />
                          )}
                        </button>
                        {mine ? (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                editingTags
                                  ? cancelEditTags()
                                  : startEditTags(note)
                              }
                              aria-expanded={editingTags}
                              aria-label={`Change the tags on ${note.title}`}
                              title="Change tags"
                              className={cn(
                                "rounded-full p-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                                editingTags
                                  ? "bg-brand-soft text-brand"
                                  : "text-muted hover:bg-brand-soft hover:text-brand-ink"
                              )}
                            >
                              <Tags className="size-4" aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setError(null);
                                setConfirmingId(note.id);
                              }}
                              aria-label={`Delete ${note.title}`}
                              title="Delete"
                              className="rounded-full p-2 text-muted transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </button>
                          </>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>

                {/* Retagging is the uploader's alone: 0006's policy scopes
                    the update to them, so nobody else is offered the door. */}
                {editingTags ? (
                  <div className="mt-4 border-t border-border pt-4">
                    <TagPicker
                      value={draftTags}
                      onChange={setDraftTags}
                      suggestions={courseTags.map((entry) => entry.tag)}
                      disabled={savingTags}
                    />
                    <div className="mt-4 flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={cancelEditTags}
                        disabled={savingTags}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void handleSaveTags(note)}
                        disabled={savingTags}
                      >
                        {savingTags ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : null}
                        Save tags
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
