"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CircleAlert, Loader2, Paperclip, Upload, X } from "lucide-react";
import {
  Button,
  Hint,
  Label,
  cardClasses,
  controlClasses,
} from "@/components/ui";
import { TagPicker } from "@/features/notes/tag-picker";
import {
  ACCEPTED_NOTE_EXTENSIONS,
  isAcceptedNote,
  noteContentType,
} from "@/lib/note-types";
import { MAX_NOTE_TAGS, toTagList } from "@/lib/notes";
import { createClient } from "@/lib/supabase/client";
import { formatFileSize } from "@/lib/utils";
import type { Note } from "@/lib/types";

/**
 * A freshly shared note. `tags` comes back normalized by 0032's trigger: the
 * words the database settled on, not the words that were sent. That lets the
 * list above render the saved truth without a refetch.
 */
export type UploadedNote = Note & { tags: string[] };

const MAX_FILE_BYTES = 25 * 1024 * 1024;

const ACCEPT_ATTR = ACCEPTED_NOTE_EXTENSIONS.map((ext) => `.${ext}`).join(",");

/** Keep the original name readable but safe for a storage key. */
function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+/, "");
  return (cleaned || "file").slice(-100);
}

/**
 * Collapsed "Share your notes" affordance that expands into the upload form.
 * Uploads to the notes bucket under the uploader's folder, then inserts the
 * notes row (rolling the file back if the insert fails).
 */
export function NoteUpload({
  courseId,
  userId,
  courseTags,
  seedTags,
  onUploaded,
}: {
  courseId: string;
  userId: string;
  /** Words this course already files notes under, offered in the picker. */
  courseTags?: readonly string[];
  /**
   * Tags to start the composer with: whatever the list is filtered by, which
   * is almost always what this note is too. Taking them back off is one click.
   */
  seedTags?: readonly string[];
  onUploaded: (note: UploadedNote) => void;
}) {
  const formId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  function openForm() {
    setTags((seedTags ?? []).slice(0, MAX_NOTE_TAGS));
    setOpen(true);
  }

  function close() {
    setTitle("");
    setDescription("");
    setTags([]);
    setFile(null);
    setError(null);
    setOpen(false);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setError(null);
    if (selected && !title.trim()) {
      const base = selected.name
        .replace(/\.[^.]+$/, "")
        .replace(/[-_]+/g, " ")
        .trim();
      if (base) setTitle(base.slice(0, 120));
    }
  }

  function validate(): string | null {
    if (!title.trim()) return "Give your note a title.";
    if (!file) return "Choose a file to share.";
    if (file.size > MAX_FILE_BYTES) {
      return `That file is ${formatFileSize(file.size)}. The limit is 25 MB.`;
    }
    if (!isAcceptedNote(file.name)) {
      return "That file type isn't supported. Share a document, slides, spreadsheet or image.";
    }
    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    if (!file) return;

    setPending(true);
    setError(null);
    const supabase = createClient();
    const storagePath = `${userId}/${crypto.randomUUID()}-${sanitizeFileName(
      file.name
    )}`;

    /* From the extension, not from file.type. The bucket checks the type
       now (0049), and a browser that reports an empty type for a .md file
       would otherwise have a good upload refused. */
    const contentType = noteContentType(file.name);
    if (contentType === null) {
      setError("Huddl can't take that kind of file.");
      setPending(false);
      return;
    }
    const { error: uploadError } = await supabase.storage
      .from("notes")
      .upload(storagePath, file, { contentType, upsert: false });
    if (uploadError) {
      setError("Upload failed. Check your connection and try again.");
      setPending(false);
      return;
    }

    const { data: note, error: insertError } = await supabase
      .from("notes")
      .insert({
        course_id: courseId,
        uploader_id: userId,
        title: title.trim().slice(0, 120),
        description: description.trim().slice(0, 500) || null,
        storage_path: storagePath,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || null,
        // Sent exactly as typed. 0032's trigger does the trimming,
        // lowercasing and capping, and the row that comes back carries its
        // answer rather than ours.
        tags,
      })
      .select("*")
      .single();

    if (insertError || !note) {
      // Roll back the orphaned file so storage stays tidy.
      await supabase.storage.from("notes").remove([storagePath]);
      setError("Couldn't save your note. Please try again.");
      setPending(false);
      return;
    }

    const saved = note as Note & { tags?: unknown };
    onUploaded({ ...saved, tags: toTagList(saved.tags) });
    setPending(false);
    close();
  }

  if (!open) {
    return (
      <Button
        variant="secondary"
        onClick={openForm}
        aria-expanded={false}
        className="w-full"
      >
        <Upload className="size-4 text-brand" aria-hidden />
        Share your notes
      </Button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Share a note"
      className={cardClasses({ padding: "sm" })}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold tracking-tight">Share a note</h2>
        <button
          type="button"
          onClick={close}
          disabled={pending}
          aria-label="Close the note form"
          className="rounded-full p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-title`}>Title</Label>
          <input
            ref={titleRef}
            id={`${formId}-title`}
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            required
            placeholder="Week 5 lecture notes"
            className={controlClasses()}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-description`}>
            Description <span className="font-normal text-muted">(optional)</span>
          </Label>
          <textarea
            id={`${formId}-description`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            maxLength={500}
            placeholder="What's covered, which lecture, anything classmates should know…"
            className={controlClasses("resize-none")}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-file`}>File</Label>
          <input
            id={`${formId}-file`}
            type="file"
            accept={ACCEPT_ATTR}
            onChange={handleFileChange}
            required
            aria-describedby={`${formId}-file-hint`}
            className="block w-full rounded-xl text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-brand-soft file:px-3.5 file:py-2 file:text-sm file:font-semibold file:text-brand-ink hover:file:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          />
          <Hint id={`${formId}-file-hint`}>
            {file ? (
              <>
                <Paperclip
                  className="mr-1 inline size-3.5 align-[-2px]"
                  aria-hidden
                />
                {file.name} · {formatFileSize(file.size)}
              </>
            ) : (
              "PDF, Word, PowerPoint, Excel, text or image files up to 25 MB."
            )}
          </Hint>
        </div>

        <TagPicker
          value={tags}
          onChange={setTags}
          suggestions={courseTags}
          disabled={pending}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-4" aria-hidden />
          )}
          {pending ? "Sharing…" : "Share note"}
        </Button>
      </div>
    </form>
  );
}
