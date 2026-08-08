"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Poll, PollOption, PollVote } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * A live poll, rendered in place of the chat message that carries it.
 * One vote per student — tapping another option moves the vote, tapping
 * your own retracts it — until the creator closes the poll, after which
 * the bars read as final results. Votes and the close travel live over
 * realtime, so every open room sees the same numbers.
 */
export function PollBubble({
  pollId,
  userId,
  className,
}: {
  pollId: string;
  userId: string;
  className?: string;
}) {
  const [poll, setPoll] = useState<Poll | null>(null);
  const [options, setOptions] = useState<PollOption[]>([]);
  const [votes, setVotes] = useState<PollVote[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [voting, setVoting] = useState(false);
  const [closing, setClosing] = useState(false);

  const refreshVotes = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("poll_votes")
      .select("*")
      .eq("poll_id", pollId);
    if (data) setVotes(data as PollVote[]);
  }, [pollId]);

  const load = useCallback(async () => {
    setFailed(false);
    setLoading(true);
    const supabase = createClient();
    const [pollRes, optionsRes, votesRes] = await Promise.all([
      supabase.from("polls").select("*").eq("id", pollId).maybeSingle(),
      supabase
        .from("poll_options")
        .select("*")
        .eq("poll_id", pollId)
        .order("position", { ascending: true }),
      supabase.from("poll_votes").select("*").eq("poll_id", pollId),
    ]);
    setLoading(false);
    if (pollRes.error || optionsRes.error || votesRes.error || !pollRes.data) {
      setFailed(true);
      return;
    }
    setPoll(pollRes.data as Poll);
    setOptions((optionsRes.data ?? []) as PollOption[]);
    setVotes((votesRes.data ?? []) as PollVote[]);
  }, [pollId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live layer: any vote change refetches the (tiny) vote list; a close on
  // the poll row lands directly. One channel per bubble, keyed by poll id.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`poll:${pollId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "poll_votes",
          filter: `poll_id=eq.${pollId}`,
        },
        () => {
          void refreshVotes();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "polls",
          filter: `id=eq.${pollId}`,
        },
        (payload) => {
          setPoll((prev) =>
            prev ? { ...prev, ...(payload.new as Partial<Poll>) } : prev
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [pollId, refreshVotes]);

  const isClosed = Boolean(poll?.closed_at);
  const isCreator = poll?.creator_id === userId;
  const myVote = votes.find((v) => v.user_id === userId);
  const totalVotes = votes.length;

  async function vote(optionId: string) {
    if (!poll || isClosed || voting) return;
    const retract = myVote?.option_id === optionId;
    setVoting(true);
    // Optimistic: the bar moves the moment you tap.
    setVotes((prev) => {
      const others = prev.filter((v) => v.user_id !== userId);
      return retract
        ? others
        : [
            ...others,
            {
              poll_id: pollId,
              option_id: optionId,
              user_id: userId,
              created_at: new Date().toISOString(),
            },
          ];
    });
    const supabase = createClient();
    const { error } = retract
      ? await supabase
          .from("poll_votes")
          .delete()
          .eq("poll_id", pollId)
          .eq("user_id", userId)
      : await supabase.from("poll_votes").upsert(
          { poll_id: pollId, option_id: optionId, user_id: userId },
          { onConflict: "poll_id,user_id" }
        );
    setVoting(false);
    // Rollback path: server truth wins (also covers voting on a poll that
    // closed a beat ago).
    if (error) void refreshVotes();
  }

  async function closePoll() {
    if (!poll || !isCreator || isClosed || closing) return;
    if (
      !window.confirm("Close this poll? Voting ends and results become final.")
    ) {
      return;
    }
    setClosing(true);
    const closedAt = new Date().toISOString();
    const supabase = createClient();
    const { error } = await supabase
      .from("polls")
      .update({ closed_at: closedAt })
      .eq("id", pollId)
      .eq("creator_id", userId);
    setClosing(false);
    if (!error) {
      setPoll((prev) => (prev ? { ...prev, closed_at: closedAt } : prev));
    }
  }

  if (failed) {
    return (
      <div
        className={cn(
          "w-fit rounded-2xl border border-dashed border-border px-3.5 py-2 text-sm text-muted",
          className
        )}
      >
        This poll couldn&rsquo;t load.{" "}
        <button
          type="button"
          onClick={() => void load()}
          className="font-semibold text-brand hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (loading || !poll) {
    return (
      <div
        role="status"
        aria-label="Loading poll"
        className={cn(
          "w-full max-w-sm animate-pulse rounded-2xl border border-border bg-surface-2 p-3.5",
          className
        )}
      >
        <span className="block h-4 w-2/3 rounded bg-surface-3" />
        <span className="mt-3 block h-8 rounded-lg bg-surface-3/70" />
        <span className="mt-1.5 block h-8 rounded-lg bg-surface-3/70" />
      </div>
    );
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "w-full max-w-sm rounded-2xl border border-border bg-surface p-3.5 shadow-soft",
        className
      )}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted">
        <BarChart3 className="size-3.5 text-brand" aria-hidden />
        {isClosed ? "Poll · Final results" : "Poll"}
      </p>
      <p className="mt-1 text-sm font-semibold leading-snug">{poll.question}</p>

      <div className="mt-2.5 flex flex-col gap-1.5" role="group" aria-label="Poll options">
        {options.map((option) => {
          const count = votes.filter((v) => v.option_id === option.id).length;
          const share = totalVotes > 0 ? count / totalVotes : 0;
          const mine = myVote?.option_id === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => void vote(option.id)}
              disabled={isClosed || voting}
              aria-pressed={mine}
              aria-label={`${option.label} — ${count} ${
                count === 1 ? "vote" : "votes"
              }${mine ? ", your vote" : ""}`}
              className={cn(
                "relative overflow-hidden rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
                mine
                  ? "border-brand/50 bg-surface"
                  : "border-border bg-surface",
                !isClosed && "hover:border-brand/40",
                isClosed && "cursor-default"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-0 left-0 transition-all duration-300",
                  mine ? "bg-brand-soft" : "bg-surface-2"
                )}
                style={{ width: `${Math.round(share * 100)}%` }}
              />
              <span className="relative flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-1.5">
                  {mine ? (
                    <Check className="size-3.5 shrink-0 text-brand" aria-hidden />
                  ) : null}
                  <span className={cn("truncate", mine && "font-semibold")}>
                    {option.label}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-medium tabular-nums text-muted">
                  {totalVotes > 0 ? `${Math.round(share * 100)}%` : count}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-xs text-muted" aria-live="polite">
          {totalVotes === 1 ? "1 vote" : `${totalVotes} votes`}
          {!isClosed && myVote ? " · tap your choice to retract" : ""}
        </p>
        {isCreator && !isClosed ? (
          <button
            type="button"
            onClick={() => void closePoll()}
            disabled={closing}
            className="flex items-center gap-1 text-xs font-semibold text-brand hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand disabled:opacity-60"
          >
            {closing ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : null}
            Close poll
          </button>
        ) : null}
      </div>
    </div>
  );
}
