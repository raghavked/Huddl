"use client";

import { useCallback, useState } from "react";
import {
  CircleAlert,
  CloudOff,
  Loader2,
  Pencil,
  Percent,
  Plus,
  PlusCircle,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  FieldError,
  Input,
  Label,
  SectionHeader,
} from "@/components/ui";
import {
  CATEGORY_NAME_MAX,
  ENTRY_TITLE_MAX,
  categoryScore,
  createCategory,
  createEntry,
  deleteCategory,
  deleteEntry,
  fetchGradeBook,
  updateCategory,
  updateEntry,
  type GradeCategory,
  type GradeEntry,
} from "@/lib/grades";
import { cn } from "@/lib/utils";
import { EstimateCard } from "./estimate-card";
import { WhatIfPanel } from "./what-if-panel";
import {
  checkCategory,
  checkEntry,
  draftId,
  isDraft,
  itemsText,
  messageFor,
  parseNumber,
  pctText,
  pointsText,
  shortDate,
  sumWeights,
  type CategoryDraft,
  type EntryDraft,
} from "./format";

/* Your grades: the private one.
 *
 * Every number here is the student's own arithmetic on their own scores.
 * Nothing is shared, nothing is compared against a classmate, and the page
 * says so once, plainly, above this section. The math is entirely
 * `@/lib/grades`: this file parses text into numbers, hands them over, and
 * renders sentences the module wrote.
 *
 * Every write is optimistic. The row lands, the estimate moves, and only a
 * server refusal puts it back with a warm line underneath the form. Rows that
 * haven't met the server yet carry a draft id, and anything that would send
 * that id back to Supabase stays shut until the insert settles.
 */

/* ------------------------------ small parts ----------------------------- */

/** One warm line of red under a card or a form. */
function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs font-medium text-danger">
      {message}
    </p>
  );
}

/** The banner for a failure that belongs to the page, not to one form. */
function ActionError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

/**
 * A round icon button at the full 44px target: the category header's rename
 * and delete affordances.
 */
function IconButton({
  label,
  danger = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors disabled:pointer-events-none disabled:opacity-50",
        danger
          ? "hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
          : "hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      )}
    >
      {children}
    </button>
  );
}

/* --------------------------------- forms -------------------------------- */

/** The three fields a score is made of, shared by the add and edit forms. */
function EntryFields({
  idPrefix,
  draft,
  onChange,
  disabled,
  autoFocus = false,
}: {
  idPrefix: string;
  draft: EntryDraft;
  onChange: (next: EntryDraft) => void;
  disabled: boolean;
  autoFocus?: boolean;
}) {
  const earned = parseNumber(draft.earned);
  const possible = parseNumber(draft.possible);
  const extra =
    earned !== null && possible !== null && possible > 0 && earned > possible;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor={`${idPrefix}-title`}>What was it?</Label>
        <Input
          id={`${idPrefix}-title`}
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
          placeholder="Problem set 3"
          maxLength={ENTRY_TITLE_MAX}
          disabled={disabled}
          autoFocus={autoFocus}
          className="mt-1.5"
        />
      </div>
      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          <Label htmlFor={`${idPrefix}-earned`}>You got</Label>
          <Input
            id={`${idPrefix}-earned`}
            value={draft.earned}
            onChange={(e) => onChange({ ...draft, earned: e.target.value })}
            placeholder="18"
            inputMode="decimal"
            maxLength={9}
            disabled={disabled}
            className="mt-1.5"
          />
        </div>
        <div className="min-w-0 flex-1">
          <Label htmlFor={`${idPrefix}-possible`}>Out of</Label>
          <Input
            id={`${idPrefix}-possible`}
            value={draft.possible}
            onChange={(e) => onChange({ ...draft, possible: e.target.value })}
            placeholder="20"
            inputMode="decimal"
            maxLength={9}
            disabled={disabled}
            className="mt-1.5"
          />
        </div>
      </div>
      {extra ? (
        <p className="text-xs text-accent">
          Above the max. That&apos;s extra credit, and it counts. Keep it.
        </p>
      ) : null}
    </div>
  );
}

const EMPTY_ENTRY: EntryDraft = { title: "", earned: "", possible: "" };

/** The add-a-score form, opened from inside a category card. */
function AddEntryForm({
  categoryId,
  onSubmit,
  onCancel,
}: {
  categoryId: string;
  /** Resolves to an error message, or null when the score landed. */
  onSubmit: (draft: EntryDraft) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<EntryDraft>(EMPTY_ENTRY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async () => {
    if (saving) return;
    const checked = checkEntry(draft);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setError(null);
    setSaving(true);
    const failure = await onSubmit(draft);
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    setDraft(EMPTY_ENTRY);
  }, [draft, onSubmit, saving]);

  return (
    <form
      className="flex flex-col gap-3 rounded-xl bg-surface-2 p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <EntryFields
        idPrefix={`add-entry-${categoryId}`}
        draft={draft}
        onChange={(next) => {
          setDraft(next);
          if (error) setError(null);
        }}
        disabled={saving}
        autoFocus
      />
      <InlineError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Plus className="size-3.5" aria-hidden />
          )}
          Add score
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Fixing a score that's already logged, in place of its row. Delete lives
 * here rather than on the row: it's the one destructive thing in the card,
 * and it belongs behind the deliberate act of opening the score.
 */
function EditEntryForm({
  entry,
  onSubmit,
  onCancel,
  onDelete,
}: {
  entry: GradeEntry;
  onSubmit: (draft: EntryDraft) => Promise<string | null>;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<EntryDraft>(() => ({
    title: entry.title,
    earned: pointsText(entry.points_earned),
    possible: pointsText(entry.points_possible),
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async () => {
    if (saving) return;
    const checked = checkEntry(draft);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setError(null);
    setSaving(true);
    const failure = await onSubmit(draft);
    setSaving(false);
    if (failure) setError(failure);
  }, [draft, onSubmit, saving]);

  return (
    <form
      className="flex flex-col gap-3 rounded-xl bg-surface-2 p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-xs font-semibold text-muted">Fixing this score</p>
      <EntryFields
        idPrefix={`edit-entry-${entry.id}`}
        draft={draft}
        onChange={(next) => {
          setDraft(next);
          if (error) setError(null);
        }}
        disabled={saving}
        autoFocus
      />
      <InlineError message={error} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : null}
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger-ghost"
          size="sm"
          disabled={saving}
          onClick={onDelete}
          className="ml-auto"
        >
          <Trash2 className="size-3.5" aria-hidden />
          Delete score
        </Button>
      </div>
    </form>
  );
}

/** Renaming a bucket or changing what it's worth. */
function EditCategoryForm({
  category,
  onSubmit,
  onCancel,
}: {
  category: GradeCategory;
  onSubmit: (draft: CategoryDraft) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<CategoryDraft>(() => ({
    name: category.name,
    weight: pointsText(category.weight),
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async () => {
    if (saving) return;
    const checked = checkCategory(draft);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setError(null);
    setSaving(true);
    const failure = await onSubmit(draft);
    setSaving(false);
    if (failure) setError(failure);
  }, [draft, onSubmit, saving]);

  return (
    <form
      className="flex flex-col gap-3 rounded-xl bg-surface-2 p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div>
        <Label htmlFor={`edit-category-${category.id}-name`}>Category</Label>
        <Input
          id={`edit-category-${category.id}-name`}
          value={draft.name}
          onChange={(e) => {
            setDraft((current) => ({ ...current, name: e.target.value }));
            if (error) setError(null);
          }}
          placeholder="Homework"
          maxLength={CATEGORY_NAME_MAX}
          disabled={saving}
          autoFocus
          className="mt-1.5"
        />
      </div>
      <div>
        <Label htmlFor={`edit-category-${category.id}-weight`}>Weight (%)</Label>
        <Input
          id={`edit-category-${category.id}-weight`}
          value={draft.weight}
          onChange={(e) => {
            setDraft((current) => ({ ...current, weight: e.target.value }));
            if (error) setError(null);
          }}
          placeholder="20"
          inputMode="decimal"
          maxLength={6}
          disabled={saving}
          className="mt-1.5"
        />
      </div>
      <InlineError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : null}
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------- one bucket ----------------------------- */

/**
 * One score inside a bucket: what it was, when, and the fraction. The whole
 * row is the target. Tapping it opens the editor, which is also where
 * deleting lives.
 */
function EntryRow({ entry, onEdit }: { entry: GradeEntry; onEdit: () => void }) {
  const pending = isDraft(entry.id);
  const extra = entry.points_earned > entry.points_possible;
  const when = pending ? "Saving…" : shortDate(entry.recorded_at);

  return (
    <li>
      <button
        type="button"
        disabled={pending}
        onClick={onEdit}
        aria-label={`${entry.title}, ${pointsText(
          entry.points_earned
        )} out of ${pointsText(entry.points_possible)}. Edit or delete it.`}
        className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 text-left transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {entry.title}
          </span>
          {when ? (
            <span className="mt-0.5 block text-xs text-muted">{when}</span>
          ) : null}
        </span>
        <span
          className={cn(
            "shrink-0 text-sm font-semibold tabular-nums",
            extra && "text-accent"
          )}
        >
          {pointsText(entry.points_earned)}/{pointsText(entry.points_possible)}
        </span>
      </button>
    </li>
  );
}

/** One weighted bucket off the syllabus, with its scores under it. */
function CategoryCard({
  category,
  entries,
  editing,
  editingEntryId,
  confirmingDelete,
  deleting,
  onStartEdit,
  onCancelEdit,
  onSaveCategory,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
  onStartEntryEdit,
  onCancelEntryEdit,
  onAddEntry,
  onSaveEntry,
  onDeleteEntry,
}: {
  category: GradeCategory;
  entries: GradeEntry[];
  editing: boolean;
  editingEntryId: string | null;
  confirmingDelete: boolean;
  deleting: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveCategory: (draft: CategoryDraft) => Promise<string | null>;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onStartEntryEdit: (entry: GradeEntry) => void;
  onCancelEntryEdit: () => void;
  onAddEntry: (draft: EntryDraft) => Promise<string | null>;
  onSaveEntry: (entry: GradeEntry, draft: EntryDraft) => Promise<string | null>;
  onDeleteEntry: (entry: GradeEntry) => void;
}) {
  const [adding, setAdding] = useState(false);
  const score = categoryScore(entries);
  // Still in flight: its id is a local draft, so nothing here may be sent on.
  const pending = isDraft(category.id);

  // Name what leaves with it: deleting a category cascades its scores.
  const stakes =
    entries.length === 0
      ? "The category goes, and the estimate recalculates without its weight."
      : entries.length === 1
        ? "Its one score goes with it, and the estimate recalculates without it."
        : `Its ${entries.length} scores go with it, and the estimate recalculates without them.`;

  return (
    <li>
      <Card className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 font-bold tracking-tight break-words">
                {category.name}
              </span>
              <Badge tone="brand">{pointsText(category.weight)}%</Badge>
            </p>
            <p className="mt-1 text-xs text-muted">
              {score
                ? `${pctText(score.pct)}% · ${itemsText(entries.length)}`
                : "Nothing scored in here yet"}
            </p>
          </div>
          {pending || confirmingDelete ? null : (
            <span className="-mr-3 -mt-3 flex shrink-0 items-center">
              <IconButton
                label={`Edit ${category.name}`}
                onClick={onStartEdit}
              >
                <Pencil className="size-4" aria-hidden />
              </IconButton>
              <IconButton
                label={`Delete ${category.name}`}
                danger
                onClick={onAskDelete}
              >
                <Trash2 className="size-4" aria-hidden />
              </IconButton>
            </span>
          )}
        </div>

        {confirmingDelete ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3.5">
            <p className="text-sm font-semibold break-words">
              Delete {category.name}?
            </p>
            {/* Espresso, not muted: this well is a danger-tinted surface,
                and grey text on a colored fill is the one thing §1 rule 3
                forbids outright. */}
            <p className="mt-1 text-xs leading-relaxed text-foreground">
              {stakes} This can&apos;t be undone.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="danger"
                size="sm"
                disabled={deleting}
                onClick={onConfirmDelete}
              >
                {deleting ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : null}
                Delete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={deleting}
                onClick={onCancelDelete}
              >
                Keep it
              </Button>
            </div>
          </div>
        ) : null}

        {editing ? (
          <EditCategoryForm
            category={category}
            onSubmit={onSaveCategory}
            onCancel={onCancelEdit}
          />
        ) : null}

        {entries.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border border-t border-border pt-1">
            {entries.map((entry) =>
              editingEntryId === entry.id ? (
                <li key={entry.id} className="py-2">
                  <EditEntryForm
                    entry={entry}
                    onSubmit={(draft) => onSaveEntry(entry, draft)}
                    onCancel={onCancelEntryEdit}
                    onDelete={() => onDeleteEntry(entry)}
                  />
                </li>
              ) : (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  onEdit={() => onStartEntryEdit(entry)}
                />
              )
            )}
          </ul>
        ) : null}

        {pending ? (
          <p className="text-xs text-muted">Saving this category…</p>
        ) : adding ? (
          <AddEntryForm
            categoryId={category.id}
            onSubmit={onAddEntry}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            aria-label={`Add a score to ${category.name}`}
            className="-my-2 inline-flex min-h-11 items-center gap-1.5 self-start rounded-full text-xs font-semibold text-brand transition-colors hover:text-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Plus className="size-4" aria-hidden />
            Add a score
          </button>
        )}
      </Card>
    </li>
  );
}

/* -------------------------------- section ------------------------------- */

/**
 * The whole tracker below the page title: the estimate, every category with
 * its scores, the add-a-category form with its live weight total, and the
 * what-if panel. Optimistic throughout, and honest about a refusal.
 */
export function GradesSection({
  courseId,
  courseCode,
  userId,
  initialCategories,
  initialEntries,
  initialError,
}: {
  courseId: string;
  /** e.g. "ECS 36A". Only used in copy. */
  courseCode: string;
  /** The viewer's `profiles.id`, so an optimistic row is a real row. */
  userId: string;
  initialCategories: GradeCategory[];
  initialEntries: Record<string, GradeEntry[]>;
  initialError: string | null;
}) {
  const [categories, setCategories] =
    useState<GradeCategory[]>(initialCategories);
  const [entriesByCategory, setEntriesByCategory] =
    useState<Record<string, GradeEntry[]>>(initialEntries);

  const [error, setError] = useState<string | null>(initialError);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // The add-a-category form at the bottom.
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft>({
    name: "",
    weight: "",
  });
  const [categoryFormError, setCategoryFormError] = useState<string | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);

  /** The retry behind the error state, and the way back from a stale page. */
  const reload = useCallback(async () => {
    setReloading(true);
    try {
      const book = await fetchGradeBook(courseId);
      setCategories(book.categories);
      setEntriesByCategory(book.entriesByCategory);
      setError(null);
    } catch (caught) {
      setError(
        messageFor(caught, "We couldn't load your grades for this class.")
      );
    } finally {
      setReloading(false);
    }
  }, [courseId]);

  /* --------------------------- category writes -------------------------- */

  const handleAddCategory = useCallback(async () => {
    if (savingCategory) return;
    const checked = checkCategory(categoryDraft);
    if (!checked.ok) {
      setCategoryFormError(checked.message);
      return;
    }
    const { name, weight } = checked.value;
    setCategoryFormError(null);
    setSavingCategory(true);

    // Optimistic: the bucket appears, and the estimate re-reads without it
    // only if the server turns it down.
    const optimistic: GradeCategory = {
      id: draftId("category"),
      user_id: userId,
      course_id: courseId,
      name,
      weight,
      position: categories.length,
      created_at: new Date().toISOString(),
    };
    setCategories((current) => [...current, optimistic]);
    setEntriesByCategory((current) => ({ ...current, [optimistic.id]: [] }));

    try {
      const saved = await createCategory({
        courseId,
        name,
        weight,
        position: categories.length,
      });
      setCategories((current) =>
        current.map((row) => (row.id === optimistic.id ? saved : row))
      );
      setEntriesByCategory((current) => {
        const next = { ...current };
        delete next[optimistic.id];
        next[saved.id] = next[saved.id] ?? [];
        return next;
      });
      setCategoryDraft({ name: "", weight: "" });
    } catch (caught) {
      setCategories((current) =>
        current.filter((row) => row.id !== optimistic.id)
      );
      setEntriesByCategory((current) => {
        const next = { ...current };
        delete next[optimistic.id];
        return next;
      });
      setCategoryFormError(
        messageFor(caught, "We couldn't save that category. Give it another go.")
      );
    } finally {
      setSavingCategory(false);
    }
  }, [savingCategory, categoryDraft, categories.length, courseId, userId]);

  const handleSaveCategory = useCallback(
    async (category: GradeCategory, draft: CategoryDraft) => {
      const checked = checkCategory(draft);
      if (!checked.ok) return checked.message;
      const { name, weight } = checked.value;

      setCategories((current) =>
        current.map((row) =>
          row.id === category.id ? { ...row, name, weight } : row
        )
      );
      try {
        const saved = await updateCategory(category.id, { name, weight });
        setCategories((current) =>
          current.map((row) => (row.id === category.id ? saved : row))
        );
        setEditingCategoryId(null);
        return null;
      } catch (caught) {
        setCategories((current) =>
          current.map((row) => (row.id === category.id ? category : row))
        );
        return messageFor(
          caught,
          "We couldn't save that change. Give it another go."
        );
      }
    },
    []
  );

  const handleDeleteCategory = useCallback(
    async (category: GradeCategory) => {
      const previousCategories = categories;
      const previousEntries = entriesByCategory;

      setActionError(null);
      setDeletingId(category.id);
      setEditingCategoryId(null);
      setCategories((current) =>
        current.filter((row) => row.id !== category.id)
      );
      setEntriesByCategory((current) => {
        const next = { ...current };
        delete next[category.id];
        return next;
      });

      try {
        await deleteCategory(category.id);
        setConfirmingId(null);
      } catch (caught) {
        setCategories(previousCategories);
        setEntriesByCategory(previousEntries);
        setActionError(
          messageFor(
            caught,
            "We couldn't delete that category. Give it another go."
          )
        );
      } finally {
        setDeletingId(null);
      }
    },
    [categories, entriesByCategory]
  );

  /* ----------------------------- entry writes --------------------------- */

  const handleAddEntry = useCallback(
    async (category: GradeCategory, draft: EntryDraft) => {
      const checked = checkEntry(draft);
      if (!checked.ok) return checked.message;
      const { title, earned, possible } = checked.value;

      const optimistic: GradeEntry = {
        id: draftId("entry"),
        user_id: userId,
        category_id: category.id,
        title,
        points_earned: earned,
        points_possible: possible,
        recorded_at: new Date().toISOString(),
      };
      setEntriesByCategory((current) => ({
        ...current,
        [category.id]: [...(current[category.id] ?? []), optimistic],
      }));

      try {
        const saved = await createEntry({
          categoryId: category.id,
          title,
          pointsEarned: earned,
          pointsPossible: possible,
        });
        setEntriesByCategory((current) => ({
          ...current,
          [category.id]: (current[category.id] ?? []).map((row) =>
            row.id === optimistic.id ? saved : row
          ),
        }));
        return null;
      } catch (caught) {
        setEntriesByCategory((current) => ({
          ...current,
          [category.id]: (current[category.id] ?? []).filter(
            (row) => row.id !== optimistic.id
          ),
        }));
        return messageFor(
          caught,
          "We couldn't save that score. Give it another go."
        );
      }
    },
    [userId]
  );

  const handleSaveEntry = useCallback(
    async (entry: GradeEntry, draft: EntryDraft) => {
      const checked = checkEntry(draft);
      if (!checked.ok) return checked.message;
      const { title, earned, possible } = checked.value;

      setEntriesByCategory((current) => ({
        ...current,
        [entry.category_id]: (current[entry.category_id] ?? []).map((row) =>
          row.id === entry.id
            ? { ...row, title, points_earned: earned, points_possible: possible }
            : row
        ),
      }));

      try {
        const saved = await updateEntry(entry.id, {
          title,
          pointsEarned: earned,
          pointsPossible: possible,
        });
        setEntriesByCategory((current) => ({
          ...current,
          [entry.category_id]: (current[entry.category_id] ?? []).map((row) =>
            row.id === entry.id ? saved : row
          ),
        }));
        setEditingEntryId(null);
        return null;
      } catch (caught) {
        setEntriesByCategory((current) => ({
          ...current,
          [entry.category_id]: (current[entry.category_id] ?? []).map((row) =>
            row.id === entry.id ? entry : row
          ),
        }));
        return messageFor(
          caught,
          "We couldn't save that change. Give it another go."
        );
      }
    },
    []
  );

  const handleDeleteEntry = useCallback((entry: GradeEntry) => {
    const previous = entriesByCategory[entry.category_id] ?? [];
    setActionError(null);
    setEditingEntryId((current) => (current === entry.id ? null : current));
    setEntriesByCategory((current) => ({
      ...current,
      [entry.category_id]: (current[entry.category_id] ?? []).filter(
        (row) => row.id !== entry.id
      ),
    }));
    void deleteEntry(entry.id).catch((caught: unknown) => {
      setEntriesByCategory((current) => ({
        ...current,
        [entry.category_id]: previous,
      }));
      setActionError(
        messageFor(caught, "We couldn't delete that score. Give it another go.")
      );
    });
  }, [entriesByCategory]);

  /* -------------------------------- render ------------------------------ */

  // Nothing loaded at all: the whole section is the error and its retry.
  if (error && categories.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2.5 px-6 py-16 text-center">
        <CloudOff className="size-7 text-muted" aria-hidden />
        <p className="font-bold tracking-tight">Your grades didn&apos;t load</p>
        <p className="max-w-xs text-sm text-muted text-pretty">
          {error} Check your connection and give it another go.
        </p>
        <Button
          variant="soft"
          size="sm"
          disabled={reloading}
          onClick={() => void reload()}
          className="mt-1"
        >
          {reloading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : null}
          Try again
        </Button>
      </div>
    );
  }

  const weightsSoFar = sumWeights(categories);
  const draftWeight = parseNumber(categoryDraft.weight);
  const weightsCaption =
    draftWeight !== null && draftWeight >= 0 && draftWeight <= 100
      ? `Weights so far: ${pctText(weightsSoFar)}%, and this one takes it to ${pctText(
          weightsSoFar + draftWeight
        )}%.`
      : `Weights so far: ${pctText(weightsSoFar)}%.`;

  return (
    <div className="flex flex-col gap-6">
      {error ? <ActionError message={error} /> : null}
      {actionError ? <ActionError message={actionError} /> : null}

      <EstimateCard
        categories={categories}
        entriesByCategory={entriesByCategory}
      />

      <section aria-label="Categories">
        <SectionHeader title="Categories" />

        {categories.length === 0 ? (
          <p className="mt-3 px-1 text-sm leading-relaxed text-muted text-pretty">
            Your syllabus lists these: homework 20%, midterm 30%, final 50%.
            Add them below and your scores slot in underneath.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {categories.map((category) => (
              <CategoryCard
                key={category.id}
                category={category}
                entries={entriesByCategory[category.id] ?? []}
                editing={editingCategoryId === category.id}
                editingEntryId={editingEntryId}
                confirmingDelete={confirmingId === category.id}
                deleting={deletingId === category.id}
                onStartEdit={() => {
                  setConfirmingId(null);
                  setEditingCategoryId(category.id);
                }}
                onCancelEdit={() => setEditingCategoryId(null)}
                onSaveCategory={(draft) => handleSaveCategory(category, draft)}
                onAskDelete={() => {
                  setActionError(null);
                  setEditingCategoryId(null);
                  setConfirmingId(category.id);
                }}
                onCancelDelete={() => setConfirmingId(null)}
                onConfirmDelete={() => void handleDeleteCategory(category)}
                onStartEntryEdit={(entry) => setEditingEntryId(entry.id)}
                onCancelEntryEdit={() => setEditingEntryId(null)}
                onAddEntry={(draft) => handleAddEntry(category, draft)}
                onSaveEntry={handleSaveEntry}
                onDeleteEntry={handleDeleteEntry}
              />
            ))}
          </ul>
        )}
      </section>

      <Card>
        <h2 className="flex items-center gap-2 font-bold tracking-tight">
          <PlusCircle className="size-4 text-brand" aria-hidden />
          Add a category
        </h2>
        <p className="mt-1.5 text-sm text-muted text-pretty">
          One bucket per line on your syllabus, with the percentage it carries.
        </p>
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void handleAddCategory();
          }}
        >
          <div>
            <Label htmlFor="new-category-name">Category</Label>
            <Input
              id="new-category-name"
              value={categoryDraft.name}
              onChange={(e) => {
                const name = e.target.value;
                setCategoryDraft((current) => ({ ...current, name }));
                if (categoryFormError) setCategoryFormError(null);
              }}
              placeholder="Homework"
              maxLength={CATEGORY_NAME_MAX}
              disabled={savingCategory}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="new-category-weight">Weight (%)</Label>
            <Input
              id="new-category-weight"
              value={categoryDraft.weight}
              onChange={(e) => {
                const weight = e.target.value;
                setCategoryDraft((current) => ({ ...current, weight }));
                if (categoryFormError) setCategoryFormError(null);
              }}
              placeholder="20"
              inputMode="decimal"
              maxLength={6}
              disabled={savingCategory}
              aria-describedby="new-category-weights-so-far"
              className="mt-1.5"
            />
          </div>
          <p
            id="new-category-weights-so-far"
            aria-live="polite"
            className="flex items-center gap-1.5 text-xs text-muted"
          >
            <Percent className="size-3.5 shrink-0" aria-hidden />
            {weightsCaption}
          </p>
          {categoryFormError ? (
            <FieldError>{categoryFormError}</FieldError>
          ) : null}
          <Button
            type="submit"
            size="sm"
            className="self-start"
            disabled={savingCategory}
          >
            {savingCategory ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Plus className="size-3.5" aria-hidden />
            )}
            Add category
          </Button>
        </form>
      </Card>

      {categories.length > 0 ? (
        <section aria-label="Looking ahead">
          <SectionHeader title="Looking ahead" />
          <div className="mt-3">
            <WhatIfPanel
              categories={categories}
              entriesByCategory={entriesByCategory}
            />
          </div>
        </section>
      ) : (
        <p className="px-1 text-xs leading-relaxed text-muted">
          Once {courseCode} has a category or two, you can work out what the
          rest of the quarter needs to average.
        </p>
      )}
    </div>
  );
}
