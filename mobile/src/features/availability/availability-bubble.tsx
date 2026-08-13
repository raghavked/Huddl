import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { Animated, Easing, Pressable, View } from "react-native";
import {
  AppText,
  Card,
  Chip,
  Skeleton,
  useReducedMotion,
} from "@/components/ui";
import { motion, radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  AvailabilityError,
  bestSlot,
  canManagePoll,
  canVote,
  clearVote,
  closePoll,
  fetchPoll,
  responseFor,
  subscribeToPoll,
  tally,
  vote,
  type AvailabilityPollDetail,
  type AvailabilityResponse,
  type AvailabilitySlot,
  type AvailabilityVote,
  type SlotTally,
} from "@/lib/availability";
import { tapLight, tapSuccess } from "@/lib/haptics";
import { useAuth } from "@/providers/auth-provider";

type FeatherName = ComponentProps<typeof Feather>["name"];

/** Props for {@link AvailabilityBubble}. */
export type AvailabilityBubbleProps = {
  /**
   * The poll's id, `availability_polls.id`. The bubble is fully
   * self-contained: it fetches the title, the candidate times, and everyone's
   * answers itself, handles answering / changing / withdrawing, closing, and
   * turning the winning time into a study session, and keeps the counts live
   * over realtime.
   *
   * It draws on its own card surface, so it reads correctly on both own and
   * other message backgrounds. Render it in place of (or above) the plain
   * text content, exactly like `PollBubble`.
   *
   * **Finding this id.** Unlike a regular poll, a `messages` row carries no
   * `availability_poll_id` column (migration 0033 posts a plain announcing
   * message reading `When can everyone meet? <title>`). The room resolves the
   * id itself: the cheap way is one query per channel,
   * `availability_polls` filtered by `channel_id`, matched to the announcing
   * message by creator plus `created_at` proximity, and
   * `AvailabilityComposer`'s `onCreated` hands you the id for the poll the
   * student just started.
   */
  pollId: string;
};

type Status = "loading" | "error" | "missing" | "ready";

/** The three answers, in the order they're drawn: can, might, can't. */
const ANSWERS: readonly {
  value: AvailabilityResponse;
  icon: FeatherName;
  word: string;
  hint: string;
}[] = [
  {
    value: "yes",
    icon: "check",
    word: "Yes",
    hint: "Taps say you can make it",
  },
  {
    // Feather has no tilde, so the dash carries "somewhere in between".
    value: "maybe",
    icon: "minus",
    word: "Maybe",
    hint: "Taps say you might make it",
  },
  {
    value: "no",
    icon: "slash",
    word: "No",
    hint: "Taps say you can't make it",
  },
];

/* Stable empties, so the memos below don't rebuild on every render while the
   poll is still loading. */
const NO_SLOTS: AvailabilitySlot[] = [];
const NO_VOTES: AvailabilityVote[] = [];

const LOAD_FAILED =
  "We couldn't load these times. Check your connection and give it another go.";
const SAVE_FAILED = "That answer didn't save. Give it another tap.";
const CLOSE_FAILED = "We couldn't close the poll. Give it another go.";

/** Past six days apart, a weekday on its own stops telling you enough. */
const WEEKDAY_ONLY_SPAN_MS = 6 * 24 * 60 * 60 * 1000;

/** Two digits, for the date and time params the event form reads back. */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** A local calendar day as "2026-10-14". Never `toISOString`: it hands back
    yesterday for anyone west of Greenwich in the evening. */
function toDateText(at: Date): string {
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
}

/** A local wall clock as "19:00", the shape the event form's time field takes. */
function toTimeText(at: Date): string {
  return `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}

/**
 * "Thu · 7:00 PM", or "Thu, Oct 15 · 7:00 PM" when the poll's times are
 * spread far enough apart that two of them could share a weekday.
 */
function slotLabel(iso: string, withDate: boolean): string {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return iso;
  const day = at.toLocaleDateString(
    undefined,
    withDate
      ? { weekday: "short", month: "short", day: "numeric" }
      : { weekday: "short" }
  );
  const time = at.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
}

/** Whether the candidate times reach across more than a week. */
function spansMoreThanAWeek(slots: readonly AvailabilitySlot[]): boolean {
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const slot of slots) {
    const ms = new Date(slot.starts_at).getTime();
    if (!Number.isFinite(ms)) continue;
    if (ms < earliest) earliest = ms;
    if (ms > latest) latest = ms;
  }
  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) return false;
  return latest - earliest > WEEKDAY_ONLY_SPAN_MS;
}

/** "3 free · 1 maybe": the parts that actually happened, nothing else. */
function countsSummary(counts: SlotTally): string | null {
  const parts: string[] = [];
  if (counts.yes > 0) parts.push(`${counts.yes} free`);
  if (counts.maybe > 0) parts.push(`${counts.maybe} maybe`);
  if (counts.no > 0) parts.push(`${counts.no} can't`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The fill and ink for an answer the student has picked. Fern for a yes (the
 * "this is handled" green), ember for a maybe, and a quiet neutral step for a
 * no. Declining a time isn't a danger state.
 */
function answerColors(
  response: AvailabilityResponse,
  theme: ReturnType<typeof useTheme>
): { fill: string; ink: string } {
  switch (response) {
    case "yes":
      return { fill: theme.accentSoft, ink: theme.accent };
    case "maybe":
      return { fill: theme.brandSoft, ink: theme.brandInk };
    default:
      return { fill: theme.surface3, ink: theme.foreground };
  }
}

/**
 * One candidate time: the day and hour, the three answer buttons with mine
 * filled, and a fill bar behind the whole row showing how well that time is
 * doing. The bar animates when a vote lands, the one moment on this row
 * worth reporting.
 */
function SlotRow({
  label,
  counts,
  share,
  mine,
  closed,
  winner,
  onAnswer,
}: {
  /** "Thu · 7:00 PM". */
  label: string;
  counts: SlotTally;
  /** 0-1: this slot's score against the number of people who've answered. */
  share: number;
  mine: AvailabilityResponse | null;
  closed: boolean;
  /** The chip's words when this time is out front, or null. */
  winner: string | null;
  onAnswer: (response: AvailabilityResponse) => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const grow = useRef(new Animated.Value(share)).current;

  useEffect(() => {
    Animated.timing(grow, {
      toValue: share,
      duration: reduceMotion ? motion.instant : motion.base,
      easing: Easing.out(Easing.cubic),
      // A width in percent can't ride the native driver.
      useNativeDriver: false,
    }).start();
  }, [share, grow, reduceMotion]);

  const summary = countsSummary(counts);

  return (
    <View
      style={{
        borderRadius: radius.control,
        backgroundColor: theme.surface2,
        overflow: "hidden",
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: grow.interpolate({
            inputRange: [0, 1],
            outputRange: ["0%", "100%"],
            extrapolate: "clamp",
          }),
          backgroundColor: theme.brandSoft,
        }}
      />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 10,
          paddingVertical: 6,
          minHeight: 52,
        }}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="bodyMedium" numberOfLines={2}>
            {label}
          </AppText>
          {/* The chip is the more useful of the two on a winning row, and
              only one line fits beside three buttons. */}
          {winner ? (
            <Chip label={winner} tone="accent" />
          ) : summary ? (
            <AppText variant="caption" muted numberOfLines={1}>
              {summary}
            </AppText>
          ) : null}
        </View>

        <View style={{ flexDirection: "row", gap: 4 }}>
          {ANSWERS.map((answer) => {
            const selected = mine === answer.value;
            const colors = answerColors(answer.value, theme);
            const count =
              answer.value === "yes"
                ? counts.yes
                : answer.value === "maybe"
                  ? counts.maybe
                  : counts.no;
            return (
              <Pressable
                key={answer.value}
                disabled={closed}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: closed }}
                accessibilityLabel={`${answer.word} for ${label}, ${count} so far${
                  selected ? ", your answer" : ""
                }`}
                accessibilityHint={
                  closed
                    ? undefined
                    : selected
                      ? "Taps take your answer back"
                      : answer.hint
                }
                // Drawn at 40 and grown to a 44px target with hitSlop. The 2px
                // of slop on each side exactly meets the 4px gap between
                // buttons, so no two targets ever overlap.
                hitSlop={2}
                onPress={() => onAnswer(answer.value)}
                style={({ pressed }) => ({
                  width: 40,
                  height: 40,
                  borderRadius: radius.full,
                  borderWidth: 1,
                  borderColor: selected ? colors.ink : theme.border,
                  // Unselected stays see-through so the fill bar reads
                  // straight through the button row.
                  backgroundColor: selected ? colors.fill : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed && !closed ? 0.7 : 1,
                })}
              >
                <Feather
                  name={answer.icon}
                  size={16}
                  color={selected ? colors.ink : theme.muted}
                />
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

/** A quiet text action: "Close", "Make it an event". */
function FooterAction({
  label,
  hint,
  onPress,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(hint ? { accessibilityHint: hint } : null)}
      hitSlop={12}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 20,
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <AppText variant="label" style={{ color: theme.brand }}>
        {label}
      </AppText>
    </Pressable>
  );
}

/**
 * An availability poll rendered as a chat-bubble body: the title, one row per
 * candidate time with yes / maybe / no and a fill bar behind it, a quiet
 * "Most people" chip on whichever time is winning, and a footer counting who
 * has answered.
 *
 * Answering is optimistic: the button fills, the row's bar moves, and the
 * write follows. Tapping the answer you already gave takes it back. Failures
 * roll back and explain themselves in a warm inline caption.
 *
 * The person who started the poll gets "Close" while it's open, and
 * "Make it an event" once it's closed, which routes to the event form with
 * the winning time filled in. One realtime subscription per poll keeps the
 * counts moving as classmates answer.
 */
export function AvailabilityBubble({ pollId }: AvailabilityBubbleProps) {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [status, setStatus] = useState<Status>("loading");
  const [detail, setDetail] = useState<AvailabilityPollDetail | null>(null);
  const [loadError, setLoadError] = useState<string>(LOAD_FAILED);
  const [actionError, setActionError] = useState<string | null>(null);

  /* Optimistic-write guards: while one of our writes is in flight we hold
     realtime refreshes (they'd briefly erase the optimistic answer), then run
     one deferred refresh when the write settles. */
  const busyRef = useRef(false);
  const deferredRefreshRef = useRef(false);
  /* Every fetch takes a token; only the newest one is allowed to land, so a
     slow first load can't overwrite a fresh refresh (or another poll's data
     after `pollId` changes). */
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const token = (requestRef.current += 1);
    try {
      const next = await fetchPoll(pollId);
      if (token !== requestRef.current) return;
      if (!next) {
        setDetail(null);
        setStatus("missing");
        return;
      }
      setDetail(next);
      setStatus("ready");
    } catch (caught) {
      if (token !== requestRef.current) return;
      setLoadError(
        caught instanceof AvailabilityError ? caught.message : LOAD_FAILED
      );
      setStatus("error");
    }
  }, [pollId]);

  /** A quiet re-read for realtime: a miss leaves the bubble exactly as it is. */
  const refresh = useCallback(async () => {
    const token = (requestRef.current += 1);
    try {
      const next = await fetchPoll(pollId);
      if (token !== requestRef.current || !next) return;
      setDetail(next);
      setStatus("ready");
    } catch {
      // Someone else's answer failing to arrive is not worth a red caption.
    }
  }, [pollId]);

  useEffect(() => {
    setStatus("loading");
    setDetail(null);
    setActionError(null);
    void load();
  }, [load]);

  // Live counts. The poll row itself isn't in the realtime publication, so a
  // close only shows up here on the next mount; the creator's own local
  // state covers the moment it happens.
  useEffect(() => {
    return subscribeToPoll(pollId, () => {
      if (busyRef.current) {
        deferredRefreshRef.current = true;
        return;
      }
      void refresh();
    });
  }, [pollId, refresh]);

  const endMutation = useCallback(() => {
    busyRef.current = false;
    if (deferredRefreshRef.current) {
      deferredRefreshRef.current = false;
      void refresh();
    }
  }, [refresh]);

  const slots = detail?.slots ?? NO_SLOTS;
  const votes = detail?.votes ?? NO_VOTES;

  const tallies = useMemo(() => tally(slots, votes), [slots, votes]);
  // Counts are looked up by slot id rather than by position, so a row can
  // never end up wearing its neighbour's numbers.
  const countsById = useMemo(
    () => new Map(tallies.map((one) => [one.slot_id, one])),
    [tallies]
  );
  const best = useMemo(() => bestSlot(tallies), [tallies]);
  const answered = useMemo(
    () => new Set(votes.map((one) => one.user_id)).size,
    [votes]
  );
  const withDate = useMemo(() => spansMoreThanAWeek(slots), [slots]);

  /** Swap in a new answer list, keeping the rest of the poll untouched. */
  const setVotes = useCallback((next: AvailabilityVote[]) => {
    setDetail((current) => (current ? { ...current, votes: next } : current));
  }, []);

  /** Answer a time, change my answer, or (tapping my answer) take it back. */
  const handleAnswer = useCallback(
    async (slotId: string, response: AvailabilityResponse) => {
      if (!userId || !detail || busyRef.current) return;
      if (!canVote(detail.poll)) return;

      const previous = detail.votes;
      const mine = responseFor(previous, slotId, userId);
      const takingBack = mine === response;
      const without = previous.filter(
        (one) => !(one.slot_id === slotId && one.user_id === userId)
      );

      setActionError(null);
      busyRef.current = true;
      setVotes(
        takingBack
          ? without
          : [
              ...without,
              {
                slot_id: slotId,
                user_id: userId,
                response,
                created_at: new Date().toISOString(),
                voter: null,
              },
            ]
      );

      try {
        if (takingBack) await clearVote(slotId);
        else await vote(slotId, response);
        tapLight();
      } catch (caught) {
        setVotes(previous);
        setActionError(
          caught instanceof AvailabilityError ? caught.message : SAVE_FAILED
        );
      } finally {
        endMutation();
      }
    },
    [userId, detail, setVotes, endMutation]
  );

  /** Creator only: no more answers, and the winning time reads as final. */
  const handleClose = useCallback(async () => {
    if (!detail || busyRef.current) return;
    if (detail.poll.closed_at !== null) return;

    const previous = detail.poll.closed_at;
    const setClosedAt = (closedAt: string | null) => {
      setDetail((current) =>
        current
          ? { ...current, poll: { ...current.poll, closed_at: closedAt } }
          : current
      );
    };

    setActionError(null);
    busyRef.current = true;
    setClosedAt(new Date().toISOString());
    try {
      setClosedAt(await closePoll(detail.poll.id));
      tapSuccess();
    } catch (caught) {
      setClosedAt(previous);
      setActionError(
        caught instanceof AvailabilityError ? caught.message : CLOSE_FAILED
      );
    } finally {
      endMutation();
    }
  }, [detail, endMutation]);

  /**
   * Hand the winning time to the event form. The form owns creating the
   * study session and, with `availabilityPollId` in hand, links it back to
   * this poll via `attachEvent` once the event exists.
   */
  const handleMakeEvent = useCallback(() => {
    if (!detail || !best) return;
    const start = new Date(best.slot.starts_at);
    if (!Number.isFinite(start.getTime())) return;
    router.push({
      pathname: "/event/new",
      params: {
        title: detail.poll.title,
        date: toDateText(start),
        startTime: toTimeText(start),
        channelId: detail.poll.channel_id,
        availabilityPollId: detail.poll.id,
      },
    });
  }, [detail, best, router]);

  /* --------------------------- shell + states --------------------------- */

  // 14 matches the poll bubble's shell, which in turn sits inside the chat
  // room's 16px message bubbles.
  const shellStyle = {
    minWidth: 250,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  } as const;

  if (status === "loading") {
    return (
      <Card
        padded={false}
        style={shellStyle}
        accessibilityLabel="Loading the times"
      >
        <Skeleton width="55%" height={14} radius={radius.full} />
        <Skeleton width="100%" height={52} />
        <Skeleton width="100%" height={52} />
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

  if (status === "error" || !detail) {
    return (
      <Card padded={false} style={shellStyle}>
        <AppText variant="caption" style={{ color: theme.danger }}>
          {loadError}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try loading the times again"
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

  const { poll } = detail;
  const closed = !canVote(poll);
  const isCreator = canManagePoll(poll, userId);
  // One person out front isn't a verdict; two is the start of a plan.
  const showWinner = answered >= 2 && best !== null;
  const winnerLabel = best?.clear ? "Most people" : "Tied for most";
  const winners = showWinner && best ? best.tied.map((one) => one.slot_id) : [];

  // Held in a const so the callback below narrows with the condition.
  const eventId = poll.event_id;
  const answeredText =
    answered === 0
      ? "No answers yet"
      : answered === 1
        ? "1 answered"
        : `${answered} answered`;

  return (
    <Card padded={false} style={shellStyle}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Feather name="calendar" size={12} color={theme.muted} />
        <AppText variant="label" muted>
          When are you free
        </AppText>
      </View>

      <AppText variant="bodySemi">{poll.title}</AppText>

      <View style={{ gap: 6 }}>
        {slots.map((slot) => {
          const counts = countsById.get(slot.id) ?? {
            slot_id: slot.id,
            starts_at: slot.starts_at,
            yes: 0,
            maybe: 0,
            no: 0,
            score: 0,
          };
          return (
            <SlotRow
              key={slot.id}
              label={slotLabel(slot.starts_at, withDate)}
              counts={counts}
              share={answered > 0 ? Math.min(1, counts.score / answered) : 0}
              mine={responseFor(votes, slot.id, userId)}
              closed={closed}
              winner={winners.includes(slot.id) ? winnerLabel : null}
              onAnswer={(response) => void handleAnswer(slot.id, response)}
            />
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
          flexWrap: "wrap",
        }}
      >
        <AppText variant="caption" muted style={{ flex: 1, minWidth: 90 }}>
          {answeredText}
          {closed ? " · Closed" : ""}
        </AppText>

        {eventId ? (
          <FooterAction
            label="Open the study session"
            hint="Opens the session this poll turned into"
            onPress={() => router.push(`/event/${eventId}`)}
          />
        ) : isCreator && !closed ? (
          <FooterAction
            label="Close"
            hint="Stops new answers and settles on a time"
            onPress={() => void handleClose()}
          />
        ) : isCreator && closed && best ? (
          <FooterAction
            label="Make it an event"
            hint="Starts a study session at the winning time"
            onPress={handleMakeEvent}
          />
        ) : null}
      </View>
    </Card>
  );
}
