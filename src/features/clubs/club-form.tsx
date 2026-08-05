"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import {
  Button,
  FieldError,
  Hint,
  Input,
  Label,
  Select,
  Textarea,
  cardClasses,
} from "@/components/ui";
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
    <Select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as ClubCategory)}
    >
      {CLUB_CATEGORIES.map((category) => (
        <option key={category} value={category}>
          {categoryLabel(category)}
        </option>
      ))}
    </Select>
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
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="club-name">Club name</Label>
        <Input
          id="club-name"
          type="text"
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Astronomy Society"
        />
        <Hint>
          Chat channel:{" "}
          <span className="font-mono text-foreground">
            #club-{slug || "your-club"}
          </span>
        </Hint>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="club-category">Category</Label>
        <CategorySelect
          id="club-category"
          value={category}
          onChange={setCategory}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="club-description">
          Description <span className="font-normal text-muted">(optional)</span>
        </Label>
        <Textarea
          id="club-description"
          rows={4}
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's your club about? Who should join?"
        />
      </div>

      {error ? <FieldError className="text-sm">{error}</FieldError> : null}

      <Button type="submit" disabled={submitting}>
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Founding…
          </>
        ) : (
          "Found this club"
        )}
      </Button>
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
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setName(club.name);
          setCategory(club.category);
          setDescription(club.description ?? "");
          setError(null);
          setOpen(true);
        }}
      >
        <Pencil className="size-4" aria-hidden />
        Edit
      </Button>
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
      className={cardClasses({ padding: "sm", className: "w-full" })}
      aria-label="Edit club details"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-club-name">Club name</Label>
          <Input
            id="edit-club-name"
            type="text"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-club-category">Category</Label>
          <CategorySelect
            id="edit-club-category"
            value={category}
            onChange={setCategory}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-club-description">Description</Label>
          <Textarea
            id="edit-club-description"
            rows={3}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {error ? <FieldError className="text-sm">{error}</FieldError> : null}
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            Save changes
          </Button>
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
      <Button
        variant="danger-ghost"
        size="sm"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        <Trash2 className="size-4" aria-hidden />
        Disband club
      </Button>
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
        <p role="alert" className="mt-2 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </>
  );
}
