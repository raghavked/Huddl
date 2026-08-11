"use client";

import { useId, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Hint, Input } from "@/components/ui";
import {
  MAX_NOTE_TAGS,
  MAX_NOTE_TAG_LENGTH,
  MIN_NOTE_TAG_LENGTH,
  SUGGESTED_TAGS,
  hasTag,
  tagKey,
} from "@/lib/notes";
import { cn } from "@/lib/utils";

/** Stable empty default, so the options memo below doesn't churn per render. */
const NO_SUGGESTIONS: readonly string[] = [];

/**
 * The chip editor both tag flows share: click a word to put it on, click it
 * again to take it off, or type your own.
 *
 * It offers the starter vocabulary from `SUGGESTED_TAGS` first, then the words
 * this course is already filing notes under (so a class converges on "problem
 * set" instead of drifting into four spellings of it), then anything the
 * student typed themselves. The order never changes as chips are clicked — a
 * list that re-sorts under the cursor is how you click the wrong thing.
 *
 * Nothing here normalizes: the database trigger owns trimming, lowercasing and
 * deduping, and the caller settles on the saved row. The caps this does
 * enforce (`MAX_NOTE_TAGS`, and the field's `maxLength`) exist so a tag never
 * gets silently dropped for being too long or one too many.
 */
export function TagPicker({
  value,
  onChange,
  suggestions = NO_SUGGESTIONS,
  disabled = false,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** Tags this course already uses, offered after the starter vocabulary. */
  suggestions?: readonly string[];
  disabled?: boolean;
}) {
  const fieldId = useId();
  const [input, setInput] = useState("");
  const [hint, setHint] = useState<string | null>(null);

  const atCap = value.length >= MAX_NOTE_TAGS;

  const options = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const tag of [...SUGGESTED_TAGS, ...suggestions, ...value]) {
      const key = tagKey(tag);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
    return out;
  }, [suggestions, value]);

  function toggle(tag: string) {
    if (disabled) return;
    if (hasTag(value, tag)) {
      setHint(null);
      onChange(value.filter((existing) => tagKey(existing) !== tagKey(tag)));
      return;
    }
    if (atCap) {
      setHint(`That's ${MAX_NOTE_TAGS} — take one off to add another.`);
      return;
    }
    setHint(null);
    onChange([...value, tag]);
  }

  function commitTyped() {
    if (disabled) return;
    const typed = input.trim();
    if (typed.length === 0) return;
    if (typed.length < MIN_NOTE_TAG_LENGTH) {
      setHint(`Tags need at least ${MIN_NOTE_TAG_LENGTH} characters.`);
      return;
    }
    if (hasTag(value, typed)) {
      setInput("");
      setHint(`"${typed}" is already on there.`);
      return;
    }
    if (atCap) {
      setHint(`That's ${MAX_NOTE_TAGS} — take one off to add another.`);
      return;
    }
    onChange([...value, typed]);
    setInput("");
    setHint(null);
  }

  return (
    <div className="flex flex-col gap-2">
      {/* A heading, not a <label>: the control below has its own, and a label
          pointing at a group of buttons is a lie to a screen reader. */}
      <p id={`${fieldId}-heading`} className="text-sm font-semibold">
        Tags
      </p>

      <div
        role="group"
        aria-labelledby={`${fieldId}-heading`}
        className="flex flex-wrap gap-2"
      >
        {options.map((tag) => {
          const on = hasTag(value, tag);
          return (
            <button
              key={tagKey(tag)}
              type="button"
              onClick={() => toggle(tag)}
              disabled={disabled}
              aria-pressed={on}
              aria-label={on ? `Remove the tag ${tag}` : `Tag this note ${tag}`}
              className={cn(
                "inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-xs font-semibold transition-colors disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                on
                  ? "border-transparent bg-brand-soft text-brand-ink"
                  : "border-border bg-surface text-muted hover:text-foreground",
                // Faded rather than gone at the cap: the word is still true of
                // this note, it just can't fit until something comes off.
                !on && atCap && "opacity-50"
              )}
            >
              {tag}
              {/* The × only shows on the ones already chosen — an unselected
                  chip is an invitation, not a thing to dismiss. */}
              {on ? <X className="size-3.5" aria-hidden /> : null}
            </button>
          );
        })}
      </div>

      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label
            htmlFor={`${fieldId}-input`}
            className="block text-xs font-semibold text-muted"
          >
            Add your own
          </label>
          <Input
            id={`${fieldId}-input`}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              if (hint) setHint(null);
            }}
            onKeyDown={(event) => {
              // Enter adds the tag; it must not submit the form around us.
              if (event.key === "Enter") {
                event.preventDefault();
                commitTyped();
              }
            }}
            placeholder="week 5"
            maxLength={MAX_NOTE_TAG_LENGTH}
            autoComplete="off"
            disabled={disabled}
          />
        </div>
        <button
          type="button"
          onClick={commitTyped}
          disabled={disabled || input.trim().length === 0}
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-xs font-semibold shadow-soft transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <Plus className="size-3.5" aria-hidden />
          Add
        </button>
      </div>

      {hint ? (
        <p className="text-xs font-medium text-warning">{hint}</p>
      ) : (
        <Hint>
          {value.length === 0
            ? `Optional, and up to ${MAX_NOTE_TAGS} — they're how classmates find this later.`
            : `${value.length} of ${MAX_NOTE_TAGS} tags.`}
        </Hint>
      )}
    </div>
  );
}
