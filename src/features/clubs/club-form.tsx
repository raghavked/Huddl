"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { disbandClub, updateClub } from "@/features/clubs/actions";
import { categoryLabel, ConfirmDialog } from "@/features/clubs/club-card";
import { createClient } from "@/lib/supabase/client";
import type { Club, ClubCategory } from "@/lib/types";

export const CLUB_CATEGORIES: readonly ClubCategory[] = [
  "academic",
  "professional",
  "cultural",
  "sports",
  "social",
  "service",
  "other",
];

/** "Chess & Go Club!" -> "chess-go-club" (lowercase, dashes, alnum only). */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
}

const FIELD =
  "mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30";

function CategorySelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: ClubCategory;
  onChange: (value: ClubCategory) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as ClubCategory)}
      className={FIELD}
    >
      {CLUB_CATEGORIES.map((category) => (
        <option key={category} value={category}>
          {categoryLabel(category)}
        </option>
      ))}
    </select>
  );
}

/**
 * Founding form. Inserts the clubs row directly (RLS: created_by must be the
 * signed-in student at their own university) — DB triggers then create the
 * chat channel and add the founder as owner.
 */
export function ClubForm({
  universityId,
  universityName,
  userId,
}: {
  universityId: string;
  universityName: string;
  userId: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ClubCategory>("other");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const slug = slugify(name);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 3) {
      setError("Give your club a name of at least 3 characters.");
      return;
    }
    if (!slug) {
      setError("The name needs at least one letter or number.");
      return;
    }

    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { data, error: insertError } = await supabase
      .from("clubs")
      .insert({
        university_id: universityId,
        created_by: userId,
        name: trimmed,
        slug,
        category,
        description: description.trim() || null,
      })
      .select("id")
      .single();

    if (insertError || !data) {
      setSubmitting(false);
      setError(
        insertError?.code === "23505"
          ? `"${trimmed}" is already taken at ${universityName} — try a more specific name.`
          : "Something went wrong founding the club. Please try again."
      );
      return;
    }

    router.push(`/clubs/${data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      <div>
        <label htmlFor="club-name" className="block text-sm font-medium">
          Club name
        </label>
        <input
          id="club-name"
          type="text"
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Astronomy Society"
          className={FIELD}
        />
        <p className="mt-1.5 text-xs text-muted">
          Chat channel:{" "}
          <span className="font-mono text-foreground">
            #club-{slug || "your-club"}
          </span>
        </p>
      </div>

      <div>
        <label htmlFor="club-category" className="block text-sm font-medium">
          Category
        </label>
        <CategorySelect
          id="club-category"
          value={category}
          onChange={setCategory}
        />
      </div>

      <div>
        <label htmlFor="club-description" className="block text-sm font-medium">
          Description{" "}
          <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id="club-description"
          rows={4}
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's your club about? Who should join?"
          className={FIELD}
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-brand-fg transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Founding…
          </>
        ) : (
          "Found this club"
        )}
      </button>
    </form>
  );
}

/**
 * Officer-only inline editor: an "Edit" toggle that expands into a compact
 * name / category / description form backed by the updateClub server action.
 */
export function ClubEditor({ club }: { club: Club }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(club.name);
  const [category, setCategory] = useState<ClubCategory>(club.category);
  const [description, setDescription] = useState(club.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setName(club.name);
          setCategory(club.category);
          setDescription(club.description ?? "");
          setError(null);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-2"
      >
        <Pencil className="size-4" aria-hidden />
        Edit
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await updateClub(club.id, {
            name,
            category,
            description,
          });
          if (result.error) {
            setError(result.error);
          } else {
            setOpen(false);
          }
        });
      }}
      className="w-full rounded-card border border-border bg-surface p-4"
      aria-label="Edit club details"
    >
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="edit-club-name" className="block text-sm font-medium">
            Club name
          </label>
          <input
            id="edit-club-name"
            type="text"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={FIELD}
          />
        </div>
        <div>
          <label
            htmlFor="edit-club-category"
            className="block text-sm font-medium"
          >
            Category
          </label>
          <CategorySelect
            id="edit-club-category"
            value={category}
            onChange={setCategory}
          />
        </div>
        <div>
          <label
            htmlFor="edit-club-description"
            className="block text-sm font-medium"
          >
            Description
          </label>
          <textarea
            id="edit-club-description"
            rows={3}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={FIELD}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={isPending}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-fg transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            Save changes
          </button>
        </div>
      </div>
    </form>
  );
}

/** Owner-only: confirm dialog, then delete + redirect (handled server-side). */
export function DisbandClubButton({
  clubId,
  clubName,
}: {
  clubId: string;
  clubName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-surface-2"
      >
        <Trash2 className="size-4" aria-hidden />
        Disband club
      </button>
      <ConfirmDialog
        open={confirming}
        title={`Disband ${clubName}?`}
        body="This permanently deletes the club, its chat channel and its events for everyone. This can't be undone."
        confirmLabel="Disband"
        pending={isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          startTransition(async () => {
            const result = await disbandClub(clubId);
            // On success the server action redirects to /clubs.
            if (result?.error) {
              setError(result.error);
              setConfirming(false);
            }
          });
        }}
      />
      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </>
  );
}
