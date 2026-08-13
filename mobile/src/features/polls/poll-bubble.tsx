import Feather from "@expo/vector-icons/Feather";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText, Card } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/** Props for {@link PollBubble}. */
export type PollBubbleProps = {
  /**
   * The poll's id, `messages.poll_id` on the carrying message. The bubble is
   * fully self-contained: it fetches the question, options, and votes itself,
   * handles voting/retracting/closing, and keeps results live over realtime.
   * The room only needs to render `<PollBubble pollId={message.poll_id} />`
   * inside the message row whenever a message carries a `poll_id`. It draws on
   * its own card surface, so it reads correctly on both own and other message
   * backgrounds. Render it in place of (or above) the plain text content.
   */
  pollId: string;
};

type PollRow = {
  id: string;
  question: string;
  closed_at: string | null;
  creator_id: string;
};

type OptionRow = {
  id: string;
  label: string;
  position: number;
};

type VoteRow = {
  option_id: string;
  user_id: string;
};

type Status = "loading" | "error" | "missing" | "ready";

/** A skeleton line while the poll loads: question-ish bar + option-ish bar. */
function GhostBar({ width, height }: { width: `${number}%`; height: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width,
        height,
        borderRadius: radius.control,
        backgroundColor: theme.surface2,
      }}
    />
  );
}

/**
 * A poll rendered as a chat-bubble body: question, tappable option rows with
 * live result bars, vote counts, and a creator-only "Close poll" action.
 *
 * Voting is single-choice and optimistic: tapping an option casts (or moves)
 * your vote; tapping your current pick takes it back. Failures roll back with
 * a warm inline error. One realtime channel per poll keeps counts moving and
 * flips to "Final results" the moment the creator closes it.
 */
export function PollBubble({ pollId }: PollBubbleProps) {
  const theme = useTheme();
  const { session } = useAuth();
  const userId = session?.user.id;

  const [status, setStatus] = useState<Status>("loading");
  const [poll, setPoll] = useState<PollRow | null>(null);
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [votes, setVotes] = useState<VoteRow[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  // Optimistic-mutation guards: while one of our writes is in flight we hold
  // realtime refetches (they'd briefly erase the optimistic vote), then run
  // one deferred refetch when the write settles.
  const busyRef = useRef(false);
  const deferredRefetchRef = useRef(false);
  const votesRef = useRef(votes);
  votesRef.current = votes;

  const refetchVotes = useCallback(async () => {
    const { data } = await supabase
      .from("poll_votes")
      .select("option_id, user_id")
      .eq("poll_id", pollId);
    if (data) setVotes(data as VoteRow[]);
  }, [pollId]);

  const refetchPoll = useCallback(async () => {
    const { data } = await supabase
      .from("polls")
      .select("id, question, closed_at, creator_id")
      .eq("id", pollId)
      .maybeSingle();
    if (data) setPoll(data as PollRow);
  }, [pollId]);

  const load = useCallback(async () => {
    const [pollRes, optionsRes, votesRes] = await Promise.all([
      supabase
        .from("polls")
        .select("id, question, closed_at, creator_id")
        .eq("id", pollId)
        .maybeSingle(),
      supabase
        .from("poll_options")
        .select("id, label, position")
        .eq("poll_id", pollId)
        .order("position", { ascending: true }),
      supabase
        .from("poll_votes")
        .select("option_id, user_id")
        .eq("poll_id", pollId),
    ]);
    if (pollRes.error || optionsRes.error || votesRes.error) {
      setStatus("error");
      return;
    }
    if (!pollRes.data) {
      setStatus("missing");
      return;
    }
    setPoll(pollRes.data as PollRow);
    setOptions((optionsRes.data ?? []) as OptionRow[]);
    setVotes((votesRes.data ?? []) as VoteRow[]);
    setStatus("ready");
  }, [pollId]);

  useEffect(() => {
    setStatus("loading");
    void load();
  }, [load]);

  // Live results: one channel per poll. Any vote movement triggers a cheap
  // votes refetch; a poll UPDATE (the creator closing it) refetches the poll.
  useEffect(() => {
    const onVotesChange = () => {
      if (busyRef.current) {
        deferredRefetchRef.current = true;
        return;
      }
      void refetchVotes();
    };
    const channel = supabase
      .channel(`poll:${pollId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "poll_votes",
          filter: `poll_id=eq.${pollId}`,
        },
        onVotesChange
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "poll_votes",
          filter: `poll_id=eq.${pollId}`,
        },
        onVotesChange
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "poll_votes",
          filter: `poll_id=eq.${pollId}`,
        },
        onVotesChange
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "polls",
          filter: `id=eq.${pollId}`,
        },
        () => void refetchPoll()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [pollId, refetchVotes, refetchPoll]);

  const endMutation = useCallback(() => {
    busyRef.current = false;
    if (deferredRefetchRef.current) {
      deferredRefetchRef.current = false;
      void refetchVotes();
    }
  }, [refetchVotes]);

  /** Cast, move, or (tapping the current pick) retract my single vote. */
  const handleVote = useCallback(
    async (optionId: string) => {
      if (!userId || !poll || poll.closed_at || busyRef.current) return;
      setActionError(null);
      const previous = votesRef.current;
      const mine = previous.find((v) => v.user_id === userId);
      busyRef.current = true;

      if (mine && mine.option_id === optionId) {
        // Tapping my current pick takes the vote back.
        setVotes(previous.filter((v) => v.user_id !== userId));
        const { error } = await supabase
          .from("poll_votes")
          .delete()
          .eq("poll_id", pollId)
          .eq("user_id", userId);
        endMutation();
        if (error) {
          setVotes(previous);
          setActionError("Couldn't take your vote back. Give it another try.");
        }
        return;
      }

      setVotes([
        ...previous.filter((v) => v.user_id !== userId),
        { option_id: optionId, user_id: userId },
      ]);
      const { error } = await supabase
        .from("poll_votes")
        .upsert(
          { poll_id: pollId, option_id: optionId, user_id: userId },
          { onConflict: "poll_id,user_id" }
        );
      endMutation();
      if (error) {
        setVotes(previous);
        setActionError("Couldn't save your vote. Give it another try.");
      }
    },
    [userId, poll, pollId, endMutation]
  );

  /** Creator-only: freeze the poll. Optimistic, with rollback. */
  const handleClosePoll = useCallback(async () => {
    if (!poll || poll.closed_at || busyRef.current) return;
    setActionError(null);
    const previous = poll;
    busyRef.current = true;
    const closedAt = new Date().toISOString();
    setPoll({ ...poll, closed_at: closedAt });
    const { error } = await supabase
      .from("polls")
      .update({ closed_at: closedAt })
      .eq("id", pollId);
    endMutation();
    if (error) {
      setPoll(previous);
      setActionError("Couldn't close the poll. Give it another try.");
    }
  }, [poll, pollId, endMutation]);

  /* --------------------------- shell + states --------------------------- */

  const shellStyle = {
    minWidth: 230,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  } as const;

  if (status === "loading") {
    return (
      <Card padded={false} style={shellStyle} accessibilityLabel="Loading poll">
        <GhostBar width="60%" height={14} />
        <GhostBar width="100%" height={44} />
      </Card>
    );
  }

  if (status === "missing") {
    return (
      <Card padded={false} style={shellStyle}>
        <AppText variant="caption" muted>
          This poll isn't around anymore.
        </AppText>
      </Card>
    );
  }

  if (status === "error" || !poll) {
    return (
      <Card padded={false} style={shellStyle}>
        <AppText variant="caption" style={{ color: theme.danger }}>
          We couldn't load this poll.
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try loading the poll again"
          hitSlop={12}
          onPress={() => {
            setStatus("loading");
            void load();
          }}
          style={({ pressed }) => ({
            alignSelf: "flex-start",
            minHeight: 20,
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <AppText variant="label" style={{ color: theme.brand }}>
            Try again
          </AppText>
        </Pressable>
      </Card>
    );
  }

  /* -------------------------------- ready ------------------------------- */

  const total = votes.length;
  const myOptionId = userId
    ? votes.find((v) => v.user_id === userId)?.option_id
    : undefined;
  const closed = poll.closed_at !== null;
  const isCreator = userId === poll.creator_id;

  return (
    <Card padded={false} style={shellStyle}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Feather name="bar-chart-2" size={12} color={theme.muted} />
        <AppText variant="label" muted>
          Poll
        </AppText>
      </View>

      <AppText variant="bodySemi">{poll.question}</AppText>

      <View style={{ gap: 6 }}>
        {options.map((option) => {
          const count = votes.filter((v) => v.option_id === option.id).length;
          const share = total > 0 ? count / total : 0;
          const mine = myOptionId === option.id;
          return (
            <Pressable
              key={option.id}
              disabled={closed}
              accessibilityRole="button"
              accessibilityState={{ selected: mine, disabled: closed }}
              accessibilityLabel={`${option.label}, ${count} ${
                count === 1 ? "vote" : "votes"
              }${mine ? ", your pick" : ""}`}
              accessibilityHint={
                closed
                  ? undefined
                  : mine
                    ? "Taps take your vote back"
                    : "Taps cast your vote here"
              }
              onPress={() => void handleVote(option.id)}
              style={({ pressed }) => ({
                minHeight: 44,
                borderRadius: radius.control,
                borderWidth: 1,
                borderColor: mine ? theme.brand : "transparent",
                backgroundColor: theme.surface2,
                overflow: "hidden",
                justifyContent: "center",
                opacity: pressed && !closed ? 0.8 : 1,
              })}
            >
              <View
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${share * 100}%`,
                  backgroundColor: theme.brandSoft,
                }}
              />
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                }}
              >
                {mine ? (
                  <Feather name="check" size={14} color={theme.brandInk} />
                ) : null}
                <AppText
                  variant="bodyMedium"
                  numberOfLines={2}
                  style={{
                    flex: 1,
                    color: mine ? theme.brandInk : theme.foreground,
                  }}
                >
                  {option.label}
                </AppText>
                <AppText
                  variant="label"
                  style={{ color: mine ? theme.brandInk : theme.muted }}
                >
                  {count}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </View>

      {actionError ? (
        <AppText variant="caption" style={{ color: theme.danger }}>
          {actionError}
        </AppText>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          minHeight: 20,
        }}
      >
        <AppText variant="caption" muted style={{ flex: 1 }}>
          {total === 1 ? "1 vote" : `${total} votes`}
          {closed ? " · Final results" : ""}
        </AppText>
        {!closed && isCreator ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close poll"
            accessibilityHint="Locks in the results for everyone"
            hitSlop={12}
            onPress={() => void handleClosePoll()}
            style={({ pressed }) => ({
              minHeight: 20,
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <AppText variant="label" style={{ color: theme.brand }}>
              Close poll
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}
