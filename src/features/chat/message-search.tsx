"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { controlClasses } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatMessageTime } from "@/lib/utils";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

type SearchResult = {
  id: string;
  content: string;
  created_at: string;
  author: { display_name: string } | null;
};

/** Literal `%`, `_`, and `\` in the query shouldn't act as ilike wildcards. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * In-channel message search. Renders a round icon trigger for the room header
 * plus an inline panel pinned below it. The panel positions against the
 * nearest `relative` ancestor — the room header — so it spans the header's
 * full width. Results are read-only rows for now; jumping to a message is a
 * follow-up.
 */
export function MessageSearch({ channelId }: { channelId: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);
  const panelId = useId();
  const inputId = useId();

  const runSearch = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      const seq = ++requestSeqRef.current;
      if (q.length < MIN_QUERY_LENGTH) {
        setLoading(false);
        setFailed(false);
        setSearched(false);
        setResults([]);
        return;
      }
      setLoading(true);
      setFailed(false);
      const supabase = createClient();
      // RLS already scopes messages to channels the student belongs to.
      const { data, error } = await supabase
        .from("messages")
        .select("id, content, created_at, author:profiles(display_name)")
        .eq("channel_id", channelId)
        .is("deleted_at", null)
        .ilike("content", `%${escapeLike(q)}%`)
        .order("created_at", { ascending: false })
        .limit(20);
      if (seq !== requestSeqRef.current) return; // a newer search superseded this one
      setLoading(false);
      if (error) {
        setFailed(true);
        return;
      }
      setResults((data ?? []) as unknown as SearchResult[]);
      setSearched(true);
    },
    [channelId]
  );

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Focus moves into the input on open; the previous query stays selected so
  // typing replaces it but reopening still shows the last results.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  // Escape and outside-click close the panel. The Escape listener runs in the
  // capture phase and stops the event so the chat room's own Escape handling
  // (thread close, edit cancel) never sees a key that was meant for us.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        panelRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      close(false);
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  // Never let a pending debounce or in-flight response land after unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      requestSeqRef.current += 1;
    };
  }, []);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void runSearch(value), DEBOUNCE_MS);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (timerRef.current) clearTimeout(timerRef.current);
    void runSearch(query);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Search messages"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close(true) : setOpen(true))}
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <Search className="size-4.5" aria-hidden />
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Search messages"
          className="absolute inset-x-0 top-full z-30 mt-2 animate-scale-in overflow-hidden rounded-card border border-border bg-surface shadow-lift"
        >
          <form onSubmit={handleSubmit} className="border-b border-border p-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <label htmlFor={inputId} className="sr-only">
                Search messages in this channel
              </label>
              <input
                ref={inputRef}
                id={inputId}
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={handleChange}
                placeholder="Search this channel"
                className={controlClasses("pl-10")}
              />
            </div>
          </form>
          <div className="max-h-72 overflow-y-auto p-2">
            {loading ? (
              <p
                role="status"
                className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted"
              >
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Searching&hellip;
              </p>
            ) : failed ? (
              <p
                role="alert"
                className="px-3 py-8 text-center text-sm font-medium text-danger"
              >
                Search hit a snag — try again.
              </p>
            ) : !searched ? (
              <p className="px-3 py-8 text-center text-sm text-muted">
                Type at least two letters to search this channel.
              </p>
            ) : results.length === 0 ? (
              <p role="status" className="px-3 py-8 text-center text-sm text-muted">
                Nothing matches — try another word.
              </p>
            ) : (
              <>
                <p role="status" className="sr-only">
                  {results.length === 1
                    ? "1 matching message"
                    : `${results.length} matching messages`}
                </p>
                <ul aria-label="Matching messages" className="flex flex-col gap-0.5">
                  {results.map((result) => (
                    <li key={result.id} className="rounded-xl px-3 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold">
                          {result.author?.display_name ?? "A classmate"}
                        </span>
                        <time
                          dateTime={result.created_at}
                          className="shrink-0 text-xs text-muted"
                        >
                          {formatMessageTime(result.created_at)}
                        </time>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted">
                        {result.content}
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
