"use client";

import { useEffect, useState } from "react";
import { BarChart3, Loader2, Plus, X } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

const MAX_OPTIONS = 8;
const MAX_QUESTION_LENGTH = 300;
const MAX_OPTION_LENGTH = 100;

/**
 * Modal for starting a poll in a channel. Calls the `create_poll` RPC
 * (migration 0019), which writes the poll, its options, and the carrying
 * chat message atomically and returns the message id.
 */
export function PollComposer({
  channelId,
  onClose,
  onCreated,
}: {
  channelId: string;
  onClose: () => void;
  /** Fires with the new message id so the room can append it right away. */
  onCreated: (messageId: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape closes the modal, captured so nothing underneath reacts too.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const filledOptions = options.map((o) => o.trim()).filter(Boolean);
  const canSubmit =
    question.trim().length > 0 &&
    question.trim().length <= MAX_QUESTION_LENGTH &&
    filledOptions.length >= 2 &&
    filledOptions.every((o) => o.length <= MAX_OPTION_LENGTH);

  function setOption(index: number, value: string) {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  }

  function removeOption(index: number) {
    setOptions((prev) =>
      prev.length > 2 ? prev.filter((_, i) => i !== index) : prev
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || pending) return;
    setError(null);
    setPending(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_poll", {
      p_channel_id: channelId,
      p_question: question.trim(),
      p_options: filledOptions,
    });
    setPending(false);
    if (rpcError || typeof data !== "string") {
      setError("Couldn't start the poll. Check your connection and try again.");
      return;
    }
    onCreated(data);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Start a poll"
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/40 p-4"
    >
      <button
        type="button"
        aria-label="Close poll composer"
        onClick={onClose}
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
      />
      <div className="relative w-full max-w-md animate-scale-in rounded-card border border-border bg-surface p-5 shadow-lift">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <BarChart3 className="size-4.5" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-bold tracking-tight">
                Start a poll
              </h2>
              <p className="text-xs text-muted">
                One vote each, changeable until you close it.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <X className="size-4.5" aria-hidden />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4">
          <Label htmlFor="poll-question">Question</Label>
          <Input
            id="poll-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={MAX_QUESTION_LENGTH}
            placeholder="What should we ask?"
            autoFocus
            className="mt-1"
          />

          <fieldset className="mt-4">
            <legend className="text-sm font-semibold">Options</legend>
            <div className="mt-1 flex flex-col gap-2">
              {options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={option}
                    onChange={(e) => setOption(index, e.target.value)}
                    maxLength={MAX_OPTION_LENGTH}
                    placeholder={`Option ${index + 1}`}
                    aria-label={`Option ${index + 1}`}
                  />
                  {options.length > 2 ? (
                    <button
                      type="button"
                      onClick={() => removeOption(index)}
                      aria-label={`Remove option ${index + 1}`}
                      className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            {options.length < MAX_OPTIONS ? (
              <button
                type="button"
                onClick={() => setOptions((prev) => [...prev, ""])}
                className="mt-2 flex items-center gap-1 text-xs font-semibold text-brand hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
              >
                <Plus className="size-3.5" aria-hidden />
                Add an option
              </button>
            ) : (
              <p className="mt-2 text-xs text-muted">
                Eight options is the max. Keep it snappy.
              </p>
            )}
          </fieldset>

          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit || pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              {pending ? "Starting…" : "Start poll"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
