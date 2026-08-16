import Feather from "@expo/vector-icons/Feather";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RoomTile } from "@/components/room-tile";
import { AppText, Button, Card, Field } from "@/components/ui";
import { palettes, radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { roomKindLabel } from "@/lib/room-identity";
import {
  fetchForwardTargets,
  ForwardError,
  forwardMessage,
  summarizeForward,
  targetName,
  type ForwardSource,
  type ForwardTarget,
} from "@/lib/forwarding";
import { tapSuccess } from "@/lib/haptics";

/** How many rooms one forward carries. Five is a handful, not a broadcast. */
export const FORWARD_MAX_TARGETS = 5;

/**
 * How many places it takes before the picker offers a search field. A list of
 * five is already on screen whole, and a field plus the keyboard it raises
 * would cost more room than the scrolling it saves. Past that (a student in
 * twenty rooms), typing beats scrolling.
 */
const SEARCH_FROM_ROOMS = 6;

/** A target's identity inside the picker's selection. */
function targetKey(target: ForwardTarget): string {
  return `${target.kind}:${target.id}`;
}

export type ForwardPickerProps = {
  /** Open state. The picker returns null when closed and resets when reopened. */
  visible: boolean;
  /** The message being passed along, or null while nothing is selected. */
  source: ForwardSource | null;
  /** The room we're forwarding out of, never a place to forward to. */
  exclude: { kind: "channel" | "dm"; id: string } | null;
  /** Blocked classmates aren't places; same gate the messages list runs. */
  blocked: Set<string>;
  /** False when an ancestor already lifts for the keyboard (the DM room). */
  liftForKeyboard: boolean;
  /** Dismiss without sending: the scrim, the close button, and a clean send. */
  onClose: () => void;
  /** A complete send, with the sentence to show the student. */
  onFinished: (message: string) => void;
};

/**
 * The forward target picker: every channel and conversation you're in,
 * searchable, up to five at a time, with the message you're passing along
 * quoted at the top.
 *
 * Drawn as an in-tree overlay rather than a `Sheet`, for exactly the reason
 * the composer's action menu is: it opens in the same tick the long-press
 * `Sheet`'s Modal is dismissing, and a Modal presented underneath another one
 * on its way out is how you get a picker that never appears.
 */
export function ForwardPicker({
  visible,
  source,
  exclude,
  blocked,
  liftForKeyboard,
  onClose,
  onFinished,
}: ForwardPickerProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<"loading" | "error" | "ready">(
    "loading"
  );
  const [targets, setTargets] = useState<ForwardTarget[]>([]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ForwardTarget[]>([]);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      setTargets(await fetchForwardTargets());
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  // Each opening is a fresh decision: no leftover ticks from last time.
  useEffect(() => {
    if (!visible) return;
    setQuery("");
    setPicked([]);
    setProblem(null);
    void load();
  }, [visible, load]);

  // Everywhere this message could actually go: the whole list, before
  // anything is typed. Counted on its own because whether the search field is
  // worth its space depends on how many rooms there are, not on what's left
  // after a query narrows them.
  const candidates = useMemo(
    () =>
      targets.filter((target) => {
        if (
          exclude &&
          target.kind === exclude.kind &&
          target.id === exclude.id
        ) {
          return false;
        }
        if (
          target.kind === "dm" &&
          target.otherId !== null &&
          blocked.has(target.otherId)
        ) {
          return false;
        }
        return true;
      }),
    [targets, exclude, blocked]
  );

  const searchable = candidates.length >= SEARCH_FROM_ROOMS;

  // Filters what's already loaded: no second query, no waiting. A channel
  // matches on its name or its course code, so "ecs 36a" finds the room called
  // "Study group" under ECS 36A; a conversation matches on the name the
  // messages list gives it.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return candidates;
    return candidates.filter((target) => {
      const second = target.kind === "channel" ? (target.courseCode ?? "") : "";
      return (
        targetName(target).toLowerCase().includes(q) ||
        second.toLowerCase().includes(q)
      );
    });
  }, [candidates, query]);

  const pickedKeys = useMemo(() => new Set(picked.map(targetKey)), [picked]);
  const atLimit = picked.length >= FORWARD_MAX_TARGETS;

  const toggle = useCallback((target: ForwardTarget) => {
    const key = targetKey(target);
    setProblem(null);
    setPicked((prev) => {
      if (prev.some((p) => targetKey(p) === key)) {
        return prev.filter((p) => targetKey(p) !== key);
      }
      if (prev.length >= FORWARD_MAX_TARGETS) return prev;
      return [...prev, target];
    });
  }, []);

  const send = useCallback(async () => {
    if (!source || picked.length === 0 || sending) return;
    setSending(true);
    setProblem(null);
    try {
      const outcomes = await forwardMessage({ source, targets: picked });
      const summary = summarizeForward(outcomes);
      if (summary.sent > 0) tapSuccess();
      if (summary.complete) {
        onFinished(summary.message);
        onClose();
        return;
      }
      // Partial: hold only the rooms that refused, so "Send" retries exactly
      // those instead of doubling up on the ones that took it.
      setPicked(outcomes.filter((o) => !o.sent).map((o) => o.target));
      setProblem(summary.message);
    } catch (err) {
      setProblem(
        err instanceof ForwardError
          ? err.message
          : "We couldn't pass that along. Give it another go."
      );
    } finally {
      setSending(false);
    }
  }, [source, picked, sending, onClose, onFinished]);

  if (!visible) return null;

  const sendLabel =
    picked.length === 0
      ? "Pick somewhere first"
      : picked.length === 1
        ? `Send to ${targetName(picked[0])}`
        : `Send to ${picked.length} rooms`;

  const card = (
    <Card
      elevation="floating"
      padded={false}
      style={{
        marginHorizontal: 12,
        marginBottom: Math.max(insets.bottom, 12),
        padding: 14,
        gap: 10,
        maxHeight: "85%",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <AppText variant="title" numberOfLines={1} style={{ flex: 1 }}>
          Pass it along
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            marginRight: -10,
            marginVertical: -10,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="x" size={18} color={theme.muted} />
        </Pressable>
      </View>

      <View
        style={{
          padding: 10,
          borderRadius: radius.control,
          backgroundColor: theme.surface2,
        }}
      >
        <AppText variant="caption" muted numberOfLines={3}>
          {source?.content ?? ""}
        </AppText>
      </View>
      <AppText variant="caption" muted>
        Everyone in the rooms you pick can read it, photo included, and pass
        it on again. There's no taking it back.
      </AppText>

      {searchable ? (
        <Field
          label="Search your rooms"
          value={query}
          onChangeText={setQuery}
          placeholder="Channel or person"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          // Recessed against the card it sits on, and 44 tall either way.
          style={{ minHeight: 44, backgroundColor: theme.background }}
        />
      ) : null}

      {status === "loading" ? (
        <View style={{ paddingVertical: 24, alignItems: "center" }}>
          <ActivityIndicator size="small" color={theme.brand} />
        </View>
      ) : status === "error" ? (
        <View style={{ paddingVertical: 16, alignItems: "center", gap: 8 }}>
          <Feather name="wifi-off" size={20} color={theme.brand} />
          <AppText muted style={{ textAlign: "center", maxWidth: 260 }}>
            We couldn't load your rooms. Give it another go.
          </AppText>
          <Button
            label="Try again"
            variant="soft"
            size="sm"
            onPress={() => void load()}
          />
        </View>
      ) : rows.length === 0 ? (
        <View style={{ paddingVertical: 16, alignItems: "center" }}>
          <AppText muted style={{ textAlign: "center", maxWidth: 260 }}>
            {query.trim() === ""
              ? "There's nowhere else to send this yet. Join a channel or start a chat."
              : "No room by that name."}
          </AppText>
        </View>
      ) : (
        <ScrollView
          style={{ flexGrow: 0, flexShrink: 1 }}
          contentContainerStyle={{ paddingBottom: 4 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {rows.map((target) => {
            const checked = pickedKeys.has(targetKey(target));
            return (
              <Pressable
                key={targetKey(target)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={targetName(target)}
                onPress={() => toggle(target)}
                style={({ pressed }) => ({
                  minHeight: 44,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingHorizontal: 4,
                  borderRadius: radius.control,
                  backgroundColor: pressed ? theme.surface2 : "transparent",
                })}
              >
                {target.kind === "channel" ? (
                  <RoomTile
                    kind={target.roomKind}
                    name={target.name}
                    slug={target.slug}
                    size={32}
                  />
                ) : (
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: radius.control,
                      backgroundColor: theme.brandSoft,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Feather
                      name={target.isGroup ? "users" : "user"}
                      size={15}
                      color={theme.brand}
                    />
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <AppText variant="bodySemi" numberOfLines={1}>
                    {targetName(target)}
                  </AppText>
                  {target.kind === "channel" ? (
                    <AppText variant="caption" muted numberOfLines={1}>
                      {target.courseCode ?? roomKindLabel(target.roomKind)}
                    </AppText>
                  ) : null}
                </View>
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: radius.full,
                    borderWidth: 1,
                    borderColor: checked ? theme.brand : theme.border,
                    backgroundColor: checked ? theme.brand : "transparent",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {checked ? (
                    <Feather name="check" size={13} color={theme.brandFg} />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {atLimit ? (
        <AppText variant="caption" muted>
          That's five rooms, as many as one forward carries.
        </AppText>
      ) : null}
      {problem ? (
        <AppText variant="caption" style={{ color: theme.danger }}>
          {problem}
        </AppText>
      ) : null}
      <Button
        label={sendLabel}
        pending={sending}
        disabled={picked.length === 0 || sending}
        onPress={() => void send()}
      />
    </Card>
  );

  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          // The scrim stays candle-dark in both appearances.
          backgroundColor: palettes.dark.background,
          opacity: 0.55,
        }}
      />
      {liftForKeyboard ? (
        <KeyboardAvoidingView
          pointerEvents="box-none"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1, justifyContent: "flex-end" }}
        >
          {card}
        </KeyboardAvoidingView>
      ) : (
        <View
          pointerEvents="box-none"
          style={{ flex: 1, justifyContent: "flex-end" }}
        >
          {card}
        </View>
      )}
    </View>
  );
}
