"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Compass, Loader2, Plus, X } from "lucide-react";
import {
  Button,
  Card,
  FieldError,
  Hint,
  Input,
  Label,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/* What you're into, and what you're looking for.
 *
 * The two columns migration 0034 added to `profiles`, and the two that turn a
 * directory row into a person. Interests are chips because eight short words
 * scan in a second and a paragraph doesn't; looking_for is one line because
 * it is the sentence a classmate can actually answer.
 *
 * 0034's normalize trigger trims, lowercases, dedupes and keeps the first
 * eight, dropping anything outside 2-28 characters. We hold the same line up
 * front so a word never disappears on the way to the server — but we still
 * send exactly what the student typed and settle on their spelling until the
 * next load. */

const MAX_INTERESTS = 8;
const MIN_INTEREST_LENGTH = 2;
const MAX_INTEREST_LENGTH = 28;
const MAX_LOOKING_FOR_LENGTH = 140;

/** A campus-flavoured starting vocabulary — click one, or type your own. */
const INTEREST_SUGGESTIONS = [
  "study spots",
  "live music",
  "intramurals",
  "cooking",
  "hiking",
  "gaming",
  "film",
  "volunteering",
] as const;

/** How two interests are compared before the trigger has seen either. */
function interestKey(interest: string): string {
  return interest.trim().toLowerCase();
}

function hasInterest(list: readonly string[], interest: string): boolean {
  const key = interestKey(interest);
  return list.some((existing) => interestKey(existing) === key);
}

export function InterestsEditor({
  userId,
  initialInterests,
  initialLookingFor,
}: {
  /** The signed-in student's `profiles.id` — the update is owner-scoped. */
  userId: string;
  initialInterests: string[];
  initialLookingFor: string | null;
}) {
  const router = useRouter();
  const uid = useId();

  const [interests, setInterests] = useState<string[]>(initialInterests);
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [lookingFor, setLookingFor] = useState(initialLookingFor ?? "");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /** Put a word on. Shared by the add-field and the suggestion chips. */
  function addInterest(raw: string): boolean {
    const typed = raw.trim();
    if (typed.length === 0) return false;
    if (typed.length < MIN_INTEREST_LENGTH) {
      setHint(`Interests need at least ${MIN_INTEREST_LENGTH} characters.`);
      return false;
    }
    if (hasInterest(interests, typed)) {
      setHint(`"${typed}" is already on there.`);
      return false;
    }
    if (interests.length >= MAX_INTERESTS) {
      setHint(`That's ${MAX_INTERESTS} — take one off to add another.`);
      return false;
    }
    setInterests([...interests, typed]);
    setHint(null);
    return true;
  }

  function commitDraft() {
    if (addInterest(draft)) setDraft("");
  }

  function removeInterest(interest: string) {
    setHint(null);
    setInterests((current) =>
      current.filter(
        (existing) => interestKey(existing) !== interestKey(interest)
      )
    );
  }

  const openSuggestions = INTEREST_SUGGESTIONS.filter(
    (suggestion) => !hasInterest(interests, suggestion)
  );

  async function handleSave() {
    if (saving) return;

    /* A word still sitting in the add-field is one they meant to keep, so it
       goes in with the rest rather than vanishing on save. */
    const pending = draft.trim();
    const nextInterests =
      pending.length >= MIN_INTEREST_LENGTH &&
      !hasInterest(interests, pending) &&
      interests.length < MAX_INTERESTS
        ? [...interests, pending]
        : interests;

    setFormError(null);
    setSaving(true);
    setSaved(false);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("profiles")
        .update({
          // 0034's trigger trims, lowercases and dedupes — send what they typed.
          interests: nextInterests,
          looking_for: lookingFor.trim() || null,
        })
        .eq("id", userId);
      if (error) {
        setFormError("Couldn't save that just now. Please try again.");
        return;
      }
      if (nextInterests !== interests) {
        setInterests(nextInterests);
        setDraft("");
        setHint(null);
      }
      setSaved(true);
      router.refresh();
      window.setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      noValidate
      aria-label="Interests and what you're looking for"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
      className="space-y-6"
    >
      <Card>
        <h2 className="text-sm font-semibold">What you&apos;re into</h2>
        <p className="mt-1 text-xs text-muted text-pretty">
          Up to eight things. They sit on your profile so classmates can spot
          the overlap.
        </p>

        {interests.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-2">
            {interests.map((interest) => (
              <li key={interestKey(interest)}>
                <button
                  type="button"
                  onClick={() => removeInterest(interest)}
                  aria-label={`Remove ${interest}`}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-brand-soft px-3.5 text-sm font-semibold text-brand-ink transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  {interest}
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4 flex items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor={`${uid}-interest`}>Add an interest</Label>
            <Input
              id={`${uid}-interest`}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value.slice(0, MAX_INTEREST_LENGTH));
                if (hint) setHint(null);
              }}
              onKeyDown={(event) => {
                // Enter adds the word rather than saving the whole card —
                // the same thing the "done" key does on the phone.
                if (event.key !== "Enter") return;
                event.preventDefault();
                commitDraft();
              }}
              placeholder="board games"
              maxLength={MAX_INTEREST_LENGTH}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              disabled={saving}
              aria-describedby={`${uid}-interest-hint`}
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={saving || draft.trim().length === 0}
            onClick={commitDraft}
          >
            <Plus className="size-4" aria-hidden />
            Add
          </Button>
        </div>

        {hint ? (
          <p
            id={`${uid}-interest-hint`}
            aria-live="polite"
            className="mt-1.5 text-xs font-medium text-warning"
          >
            {hint}
          </p>
        ) : (
          <Hint id={`${uid}-interest-hint`} className="mt-1.5">
            {interests.length === 0
              ? `Optional, and up to ${MAX_INTERESTS}.`
              : `${interests.length} of ${MAX_INTERESTS} — click one to take it off.`}
          </Hint>
        )}

        {openSuggestions.length > 0 ? (
          /* Faded rather than gone at the cap: the word may still be true of
             them, it just can't fit until something comes off. */
          <div
            className={cn(
              "mt-5",
              interests.length >= MAX_INTERESTS && "opacity-50"
            )}
          >
            <p className="text-xs text-muted">Or start from one of these</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {openSuggestions.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => addInterest(suggestion)}
                    aria-label={`Add ${suggestion}`}
                    disabled={saving}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-sm font-semibold text-muted transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-60"
                  >
                    <Plus className="size-3.5" aria-hidden />
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-5 flex flex-col gap-1.5 border-t border-border pt-5">
          <Label htmlFor={`${uid}-looking`}>
            <span className="inline-flex items-center gap-1.5">
              <Compass className="size-4 text-brand" aria-hidden />
              Looking for{" "}
              <span className="font-normal text-muted">(optional)</span>
            </span>
          </Label>
          <Input
            id={`${uid}-looking`}
            value={lookingFor}
            onChange={(event) =>
              setLookingFor(event.target.value.slice(0, MAX_LOOKING_FOR_LENGTH))
            }
            maxLength={MAX_LOOKING_FOR_LENGTH}
            placeholder="A lab partner for BIS 2A"
            disabled={saving}
            aria-describedby={`${uid}-looking-hint`}
          />
          <Hint id={`${uid}-looking-hint`}>
            {lookingFor.trim().length === 0
              ? "One line near the top of your profile — people to run with, a study group for the midterm, a ride home for break."
              : `${lookingFor.length}/${MAX_LOOKING_FOR_LENGTH}`}
          </Hint>
        </div>
      </Card>

      {formError ? (
        <FieldError className="flex items-center gap-1 text-sm">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          {formError}
        </FieldError>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : null}
          {saving ? "Saving…" : "Save what you're into"}
        </Button>
        <span aria-live="polite">
          {saved ? (
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-success">
              <Check className="size-4" aria-hidden />
              Saved
            </span>
          ) : null}
        </span>
      </div>
    </form>
  );
}
