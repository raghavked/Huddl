"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { controlClasses } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatMessageTime } from "@/lib/utils";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

/**
 * `is_public` rides along because nothing in the database withholds a private
 * student's name. See {@link authorName}, which is the whole of the
 * redaction on this surface.
 */
const RESULT_SELECT =
  "id, content, created_at, author:profiles!messages_author_id_fkey(id, handle, display_name, is_public)";

type SearchResult = {
  id: string;
  content: string;
  created_at: string;
  author: {
    id: string;
    handle: string;
    display_name: string;
    is_public: boolean;
  } | null;
};

/** Literal `%`, `_`, and `\` in the query shouldn't act as ilike wildcards. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * What to call whoever wrote the hit. A classmate with Public profile off
 * stands under their handle here, the same way the board, the people
 * directory and the command palette read them, and it fails closed:
 * anything other than an explicit `is_public: true` counts as private, so a
 * select that loses the column redacts rather than leaks.
 *
 * You always see yourself in full, which is what `viewerId` is for. It comes
 * down as a prop from the channel page, which already has it. Resolving it
 * here with a second `auth.getUser()` would cost a round trip per mount and
 * would redact a private student's own name back at them until it landed.
 */
function authorName(
  author: SearchResult["author"],
  viewerId: string
): string {
  if (!author) return "A classmate";
  const locked = author.id !== viewerId && author.is_public !== true;
  return locked ? author.handle : author.display_name || author.handle;
}

/**
 * In-channel message search. Renders a round icon trigger for the room header
 * plus an inline panel pinned below it. The panel positions against the
 * nearest `relative` ancestor (the room header), so it spans the header's
 * full width. Results are read-only rows for now; jumping to a message is a
 * follow-up.
 */
export function MessageSearch({
  channelId,
  viewerId,
}: {
  channelId: string;
  /** The signed-in student, so the redaction can spare them their own name. */
  viewerId: string;
}) {
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
  const blockedRef = useRef<Promise<string[]> | null>(null);
  const panelId = useId();
  const inputId = useId();

  /**
   * Everyone the student has blocked, read once and shared by every search in
   * this panel. RLS pins `blocks` to the caller, so there is no id to pass.
   * A rejection is deliberately not cached: the next search retries instead of
   * being stuck failing for the life of the page.
   */
  const loadBlockedIds = useCallback(async (): Promise<string[]> => {
    if (!blockedRef.current) {
      blockedRef.current = (async () => {
        const { data, error } = await createClient()
          .from("blocks")
          .select("blocked_id");
        if (error) throw error;
        const rows = (data ?? []) as { blocked_id: string }[];
        return rows.map((r) => r.blocked_id);
      })().catch((err: unknown) => {
        blockedRef.current = null;
        throw err;
      });
    }
    return blockedRef.current;
  }, []);

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

      // The block list has to be in hand before the query goes out, because
      // the exclusion belongs in the query: a blocked classmate's messages
      // would otherwise eat into the 20 we ask for and the panel would report
      // fewer hits than the channel holds. Searching is also the one place
      // someone could go looking for exactly what the room won't show them,
      // so a list we couldn't read fails the search rather than running it
      // unfiltered.
      let hidden: string[];
      try {
        hidden = await loadBlockedIds();
      } catch {
        if (seq !== requestSeqRef.current) return;
        setLoading(false);
        setFailed(true);
        return;
      }
      if (seq !== requestSeqRef.current) return;

      const supabase = createClient();
      // RLS already scopes messages to channels the student belongs to.
      let query = supabase
        .from("messages")
        .select(RESULT_SELECT)
        .eq("channel_id", channelId)
        .is("deleted_at", null)
        .ilike("content", `%${escapeLike(q)}%`);
      // `not.in.()` is not a filter PostgREST will take, so an empty block
      // list simply doesn't add one.
      if (hidden.length > 0) {
        query = query.not("author_id", "in", `(${hidden.join(",")})`);
      }
      const { data, error } = await query
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
    [channelId, loadBlockedIds]
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
                Search hit a snag. Try again.
              </p>
            ) : !searched ? (
              <p className="px-3 py-8 text-center text-sm text-muted">
                Type at least two letters to search this channel.
              </p>
            ) : results.length === 0 ? (
              <p role="status" className="px-3 py-8 text-center text-sm text-muted">
                Nothing matches. Try another word.
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
                          {authorName(result.author, viewerId)}
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
