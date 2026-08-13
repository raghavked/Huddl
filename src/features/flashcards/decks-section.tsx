"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ChevronRight,
  CircleAlert,
  Layers,
  Loader2,
  Pencil,
  Plus,
  PlusCircle,
  Trash2,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  Button,
  Card,
  FieldError,
  Input,
  Label,
  buttonClasses,
  cardClasses,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

/** Serializable deck row the decks page passes down. */
export type DeckRow = {
  id: string;
  title: string;
  created_by: string | null;
  created_at: string;
};

/** Per-deck counts, computed server-side with the shared SRS queue. */
export type DeckMeta = { total: number; due: number };

/** "12 cards · 4 due": the shelf line under each deck title. */
function countsLabel(meta: DeckMeta | undefined): string {
  if (!meta || meta.total === 0) return "No cards yet. Add the first one";
  const cards = meta.total === 1 ? "1 card" : `${meta.total} cards`;
  return meta.due > 0 ? `${cards} · ${meta.due} due` : `${cards} · all rested`;
}

/**
 * The course's deck shelf: every shared flashcard deck for this class, with
 * card counts and how many are due for YOU. Anyone can start a deck; deck
 * creators can rename or retire theirs from the row. Renames and deletes are
 * optimistic and roll back if the write fails.
 */
export function DecksSection({
  courseId,
  userId,
  initialDecks,
  initialMeta,
}: {
  courseId: string;
  userId: string;
  initialDecks: DeckRow[];
  initialMeta: Record<string, DeckMeta>;
}) {
  const router = useRouter();
  const [decks, setDecks] = useState<DeckRow[]>(initialDecks);
  const [actionError, setActionError] = useState<string | null>(null);

  // Renaming one of your decks, inline where the row was.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  // Retiring one of your decks: inline confirm, no modal.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // The new-deck form.
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  /* -------------------- rename / delete (yours only) -------------------- */

  function startRename(deck: DeckRow) {
    setConfirmingId(null);
    setRenamingId(deck.id);
    setRenameValue(deck.title);
    setRenameError(null);
  }

  function closeRename() {
    setRenamingId(null);
    setRenameValue("");
    setRenameError(null);
  }

  async function saveRename(deck: DeckRow) {
    const nextTitle = renameValue.trim();
    if (nextTitle.length < 1 || nextTitle.length > 120) {
      setRenameError("Deck titles run 1–120 characters.");
      return;
    }
    // Optimistic: the shelf updates now, and reverts if the server minds.
    const before = decks;
    setDecks((prev) =>
      prev.map((row) => (row.id === deck.id ? { ...row, title: nextTitle } : row))
    );
    closeRename();
    const supabase = createClient();
    const { error } = await supabase
      .from("decks")
      .update({ title: nextTitle })
      .eq("id", deck.id);
    if (error) {
      setDecks(before);
      setActionError("That rename didn't stick. Give it another try.");
    }
  }

  async function deleteDeck(deck: DeckRow) {
    setActionError(null);
    setDeletingId(deck.id);
    const before = decks;
    setDecks((prev) => prev.filter((row) => row.id !== deck.id));
    const supabase = createClient();
    const { error } = await supabase.from("decks").delete().eq("id", deck.id);
    setDeletingId(null);
    setConfirmingId(null);
    if (error) {
      setDecks(before);
      setActionError("We couldn't delete that deck. Give it another try.");
    }
  }

  /* ------------------------------ new deck ------------------------------ */

  const trimmedTitle = title.trim();

  async function handleCreate() {
    if (creating) return;
    if (trimmedTitle.length < 1 || trimmedTitle.length > 120) {
      setCreateError("Deck titles run 1–120 characters.");
      return;
    }
    setCreateError(null);
    setCreating(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("decks")
      .insert({ course_id: courseId, created_by: userId, title: trimmedTitle })
      .select("id, title, created_by, created_at")
      .single();
    setCreating(false);
    if (error || !data) {
      setCreateError(
        error?.message.includes("row-level security")
          ? "Decks are for classmates. Add this course to your classes first."
          : "We couldn't start that deck just now. Give it another try."
      );
      return;
    }
    const row = data as unknown as DeckRow;
    setDecks((prev) => [...prev, row]);
    setTitle("");
    router.push(`/decks/${row.id}`);
  }

  /* ------------------------------ render ------------------------------ */

  return (
    <div>
      {actionError ? (
        <p
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {actionError}
        </p>
      ) : null}

      {decks.length === 0 ? (
        <div className="rounded-card border border-dashed border-border">
          <EmptyState
            icon={Layers}
            title="No decks yet"
            description="Start one and the whole class can pile in."
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {decks.map((deck) => {
            if (renamingId === deck.id) {
              return (
                <li key={deck.id}>
                  <Card className="animate-fade-up">
                    <h2 className="font-bold tracking-tight">Rename deck</h2>
                    <form
                      className="mt-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveRename(deck);
                      }}
                    >
                      <Label htmlFor={`rename-${deck.id}`}>Deck title</Label>
                      <Input
                        id={`rename-${deck.id}`}
                        value={renameValue}
                        onChange={(e) => {
                          setRenameValue(e.target.value);
                          if (renameError) setRenameError(null);
                        }}
                        placeholder="Midterm 1 vocab"
                        maxLength={120}
                        autoFocus
                        aria-describedby={
                          renameError ? `rename-${deck.id}-error` : undefined
                        }
                        className="mt-1.5"
                      />
                      {renameError ? (
                        <FieldError
                          id={`rename-${deck.id}-error`}
                          className="mt-1.5"
                        >
                          {renameError}
                        </FieldError>
                      ) : null}
                      <div className="mt-4 flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={closeRename}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          size="sm"
                          disabled={renameValue.trim().length === 0}
                        >
                          Save
                        </Button>
                      </div>
                    </form>
                  </Card>
                </li>
              );
            }
            const meta = initialMeta[deck.id];
            const mine = deck.created_by === userId;
            return (
              <li
                key={deck.id}
                className={cardClasses({
                  padding: "none",
                  className: "flex items-center gap-2 py-3 pl-4 pr-2",
                })}
              >
                <Link
                  href={`/decks/${deck.id}`}
                  aria-label={`Open ${deck.title}, ${countsLabel(meta)}`}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <Layers className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {deck.title}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {countsLabel(meta)}
                    </span>
                  </span>
                  {(meta?.due ?? 0) > 0 ? (
                    <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-ink">
                      {meta?.due} due
                    </span>
                  ) : null}
                </Link>
                {mine ? (
                  confirmingId === deck.id ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="text-xs font-medium text-muted">
                        Delete for the class?
                      </span>
                      <button
                        type="button"
                        onClick={() => void deleteDeck(deck)}
                        disabled={deletingId === deck.id}
                        className={buttonClasses({
                          variant: "danger",
                          size: "sm",
                        })}
                      >
                        {deletingId === deck.id ? (
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
                        disabled={deletingId === deck.id}
                        aria-label="Keep this deck"
                        className="rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center">
                      <button
                        type="button"
                        onClick={() => startRename(deck)}
                        aria-label={`Rename ${deck.title}`}
                        title="Rename"
                        className="rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      >
                        <Pencil className="size-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActionError(null);
                          setConfirmingId(deck.id);
                        }}
                        aria-label={`Delete ${deck.title} for the class`}
                        title="Delete"
                        className="rounded-full p-2 text-muted transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </span>
                  )
                ) : null}
                <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
              </li>
            );
          })}
        </ul>
      )}

      <Card className="mt-6">
        <h2 className="flex items-center gap-2 font-bold tracking-tight">
          <PlusCircle className="size-4 text-brand" aria-hidden />
          New deck
        </h2>
        <p className="mt-1.5 text-sm text-muted">
          One topic per deck works best: a chapter, a lecture, a pile of
          formulas.
        </p>
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
        >
          <Label htmlFor="deck-title">Deck title</Label>
          <Input
            id="deck-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (createError) setCreateError(null);
            }}
            placeholder="Midterm 1 vocab"
            maxLength={120}
            disabled={creating}
            aria-describedby={createError ? "deck-title-error" : undefined}
            className="mt-1.5"
          />
          {createError ? (
            <FieldError id="deck-title-error" className="mt-1.5">
              {createError}
            </FieldError>
          ) : null}
          <Button
            type="submit"
            className="mt-4"
            disabled={creating || trimmedTitle.length === 0}
          >
            {creating ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="size-4" aria-hidden />
            )}
            Create deck
          </Button>
        </form>
      </Card>
    </div>
  );
}
