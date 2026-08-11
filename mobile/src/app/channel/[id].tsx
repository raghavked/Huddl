import Feather from "@expo/vector-icons/Feather";
import type {
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
} from "@supabase/supabase-js";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card, Sheet } from "@/components/ui";
import { fonts, palettes, radius } from "@/constants/theme";
import { AvailabilityBubble, AvailabilityComposer } from "@/features/availability";
import { MentionText, useMentionSuggestions } from "@/features/mentions";
import { PollBubble, PollComposer } from "@/features/polls";
import { useBlockedIds } from "@/hooks/use-blocked";
import { useTheme } from "@/hooks/use-theme";
import { typingLabel, useTyping } from "@/hooks/use-typing";
import {
  clearDraft,
  DraftError,
  dropQueued,
  enqueue,
  flushQueue,
  isLikelyOffline,
  keyFor,
  loadDraft,
  noteConnectivity,
  peekQueue,
  saveDraft,
  type QueuedMessage,
} from "@/lib/drafts";
import {
  fetchForwardTargets,
  ForwardError,
  forwardLabelFor,
  forwardMessage,
  summarizeForward,
  targetName,
  type ForwardSource,
  type ForwardTarget,
} from "@/lib/forwarding";
import { tapLight, tapSuccess } from "@/lib/haptics";
import { setMessagePinned } from "@/lib/pins";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

type FeatherName = ComponentProps<typeof Feather>["name"];

type ChannelKind = "campus" | "course" | "topic" | "club";

/** Minimal local row shapes — the web app's types live outside this tsconfig. */
type ChannelRow = {
  id: string;
  kind: ChannelKind;
  name: string;
  slug: string;
  description: string | null;
  course: { id: string; code: string; title: string } | null;
};

type Author = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
};

type MessageRow = {
  id: string;
  channel_id: string;
  author_id: string;
  parent_id: string | null;
  content: string;
  attachment_path: string | null;
  poll_id: string | null;
  pinned_at: string | null;
  pinned_by: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  /** Where a forwarded message came from ("#mat-21a"), null on an original. */
  forwarded_from: string | null;
  /** Who wrote it first, null on an original or a deleted account. */
  forwarded_author_id: string | null;
  author: Author | null;
};

/** Raw realtime payload row — no joined author. */
type RawMessageRow = {
  id: string;
  channel_id: string;
  author_id: string;
  parent_id: string | null;
  content: string;
  attachment_path: string | null;
  poll_id: string | null;
  pinned_at: string | null;
  pinned_by: string | null;
  edited_at: string | null;
  created_at: string;
  deleted_at: string | null;
  forwarded_from: string | null;
  forwarded_author_id: string | null;
};

/** One open "when can everyone meet?" poll in this channel. */
type OpenPoll = {
  id: string;
  title: string;
  created_at: string;
};

/** One row of message_reactions — same shape the web app reads. */
type ReactionRow = {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

type Status = "loading" | "error" | "notFound" | "notMember" | "ready";

const PAGE_SIZE = 50;
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const MESSAGE_SELECT =
  "id, channel_id, author_id, parent_id, content, attachment_path, poll_id, pinned_at, pinned_by, edited_at, deleted_at, created_at, forwarded_from, forwarded_author_id, author:profiles(id, handle, display_name, avatar_url)";

/** How many rooms one forward carries. Five is a handful, not a broadcast. */
const FORWARD_MAX_TARGETS = 5;

/** Quiet time in the composer before the draft is written to the device. */
const DRAFT_SAVE_MS = 500;

/** The opening words `create_availability_poll` posts to announce a poll.
    Used ONLY as a hint that a poll may have just appeared and the strip is
    worth refetching — never to bind a poll to a message. See the strip. */
const AVAILABILITY_ANNOUNCE = "When can everyone meet? ";

/** The message-body text style — MentionText needs it spelled out. */
const BODY_TEXT = {
  fontFamily: fonts.body,
  fontSize: 15,
  lineHeight: 21,
} as const;

/** The quick-react set for the long-press sheet. Pills still render any emoji
    web users send (their picker is wider), so nothing gets lost cross-client. */
const REACTION_EMOJI = ["👍", "❤️", "😂", "🎉"] as const;

/** Group raw reaction rows into ordered pills — quick-react emoji first (in
    canonical order), anything else after, mirroring the web's grouping. */
function groupReactions(
  rows: ReactionRow[] | undefined,
  userId: string | undefined
): [string, { count: number; mine: boolean }][] {
  if (!rows || rows.length === 0) return [];
  const map = new Map<string, { count: number; mine: boolean }>();
  for (const emoji of REACTION_EMOJI) {
    if (rows.some((r) => r.emoji === emoji)) {
      map.set(emoji, { count: 0, mine: false });
    }
  }
  for (const r of rows) {
    const group = map.get(r.emoji) ?? { count: 0, mine: false };
    group.count += 1;
    if (userId && r.user_id === userId) group.mine = true;
    map.set(r.emoji, group);
  }
  return [...map.entries()];
}

const KIND_ICONS: Record<ChannelKind, FeatherName> = {
  campus: "volume-2",
  course: "book-open",
  topic: "hash",
  club: "users",
};

function channelTitle(channel: ChannelRow): string {
  if (channel.kind === "course") return channel.course?.code ?? channel.name;
  if (channel.kind === "club") return channel.name;
  return `#${channel.slug}`;
}

function channelSubtitle(channel: ChannelRow): string | null {
  if (channel.kind === "course") {
    return channel.course?.title ?? channel.description;
  }
  return channel.description;
}

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "5m ago" / "2h ago" style stamps for the pinned list. */
function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Tiny avatar stand-in: two initials on a warm circle, tinted by name hash. */
function Initials({ name, size = 28 }: { name: string; size?: number }) {
  const theme = useTheme();
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const pair =
    hash % 2 === 0
      ? { bg: theme.brandSoft, fg: theme.brandInk }
      : { bg: theme.accentSoft, fg: theme.accent };
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1] ?? "" : "";
  const initials =
    `${first.charAt(0)}${last ? last.charAt(0) : first.charAt(1)}`.toUpperCase() ||
    "?";
  return (
    <View
      accessibilityElementsHidden
      style={{
        width: size,
        height: size,
        borderRadius: radius.full,
        backgroundColor: pair.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <AppText
        variant="label"
        style={{ color: pair.fg, fontSize: size * 0.36, lineHeight: size * 0.5 }}
      >
        {initials}
      </AppText>
    </View>
  );
}

function DaySeparator({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="none"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginTop: 18,
        marginBottom: 4,
      }}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
      <AppText variant="label" muted>
        {label}
      </AppText>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
    </View>
  );
}

function BackChevron({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Feather name="chevron-left" size={26} color={theme.foreground} />
    </Pressable>
  );
}

/** A chat image at thumb size — resolves its signed URL through the room's
    per-path cache, then taps open the full-screen viewer. */
function AttachmentImage({
  path,
  resolve,
  onOpen,
}: {
  path: string;
  resolve: (path: string) => Promise<string | null>;
  onOpen: (url: string) => void;
}) {
  const theme = useTheme();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void resolve(path).then((signed) => {
      if (!cancelled) setUrl(signed);
    });
    return () => {
      cancelled = true;
    };
  }, [path, resolve]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="View photo full screen"
      disabled={!url}
      onPress={() => {
        if (url) onOpen(url);
      }}
      style={({ pressed }) => ({
        width: 220,
        height: 160,
        borderRadius: radius.control,
        overflow: "hidden",
        backgroundColor: theme.surface2,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {url ? (
        <Image
          source={{ uri: url }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator size="small" color={theme.muted} />
        </View>
      )}
    </Pressable>
  );
}

/** A target's identity inside the picker's selection. */
function targetKey(target: ForwardTarget): string {
  return `${target.kind}:${target.id}`;
}

/** The quiet provenance line above a forwarded message's words. */
function ForwardedFrom({
  from,
  who,
  own,
}: {
  from: string;
  who: string | null;
  own: boolean;
}) {
  const theme = useTheme();
  // Secondary text on the own-message clay takes its tint from that clay;
  // on the neutral fill it's the usual muted.
  const tint = own ? theme.brandInk : theme.muted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Feather name="corner-up-right" size={11} color={tint} />
      <AppText
        variant="caption"
        numberOfLines={1}
        style={{ color: tint, flex: 1 }}
      >
        {who ? `Forwarded from ${from} · ${who}` : `Forwarded from ${from}`}
      </AppText>
    </View>
  );
}

/** A message the send queue is holding: the words stay in the room, a quiet
    caption says why, and a tap tries again. A stuck one also offers a way out. */
function PendingBubble({
  message,
  onRetry,
  onDiscard,
}: {
  message: QueuedMessage;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const theme = useTheme();
  const content = message.payload["content"] ?? "";
  const caption = message.stuck
    ? (message.last_error ?? "We couldn't send this one.")
    : "Waiting to send";
  return (
    <View style={{ marginTop: 10, alignItems: "flex-end" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${caption}. Tap to try again.`}
        onPress={onRetry}
        hitSlop={6}
        style={({ pressed }) => ({
          maxWidth: "80%",
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Card
          padded={false}
          style={{
            backgroundColor: theme.surface2,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: message.stuck ? theme.danger : theme.border,
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <AppText style={{ color: theme.foreground }}>{content}</AppText>
        </Card>
      </Pressable>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          marginTop: 3,
          paddingHorizontal: 4,
        }}
      >
        <Feather
          name={message.stuck ? "alert-circle" : "clock"}
          size={11}
          color={message.stuck ? theme.danger : theme.muted}
        />
        <AppText
          variant="caption"
          style={{ color: message.stuck ? theme.danger : theme.muted }}
        >
          {caption}
        </AppText>
        {message.stuck ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Discard this message"
            onPress={onDiscard}
            hitSlop={14}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <AppText variant="label" style={{ color: theme.brandInk }}>
              Discard
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

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
function ForwardPicker({
  visible,
  source,
  exclude,
  blocked,
  liftForKeyboard,
  onClose,
  onFinished,
}: {
  visible: boolean;
  source: ForwardSource | null;
  /** The room we're forwarding out of — never a place to forward to. */
  exclude: { kind: "channel" | "dm"; id: string } | null;
  /** Blocked classmates aren't places; same gate the messages list runs. */
  blocked: Set<string>;
  /** False when an ancestor already lifts for the keyboard (the DM room). */
  liftForKeyboard: boolean;
  onClose: () => void;
  onFinished: (message: string) => void;
}) {
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

  // Each opening is a fresh decision — no leftover ticks from last time.
  useEffect(() => {
    if (!visible) return;
    setQuery("");
    setPicked([]);
    setProblem(null);
    void load();
  }, [visible, load]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return targets.filter((target) => {
      if (exclude && target.kind === exclude.kind && target.id === exclude.id) {
        return false;
      }
      if (
        target.kind === "dm" &&
        target.otherId !== null &&
        blocked.has(target.otherId)
      ) {
        return false;
      }
      if (q === "") return true;
      const second = target.kind === "channel" ? (target.courseCode ?? "") : "";
      return (
        targetName(target).toLowerCase().includes(q) ||
        second.toLowerCase().includes(q)
      );
    });
  }, [targets, query, exclude, blocked]);

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
        Everyone in the rooms you pick can read it, photo included — and pass
        it on again. There's no taking it back.
      </AppText>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search your rooms"
        placeholderTextColor={theme.muted}
        accessibilityLabel="Search your rooms"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        cursorColor={theme.brand}
        selectionColor={theme.brandSoft}
        style={{
          minHeight: 44,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: radius.control,
          backgroundColor: theme.background,
          paddingHorizontal: 14,
          fontFamily: fonts.body,
          fontSize: 15,
          color: theme.foreground,
        }}
      />

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
              ? "There's nowhere else to send this yet — join a channel or start a chat."
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
                    name={
                      target.kind === "channel"
                        ? "hash"
                        : target.isGroup
                          ? "users"
                          : "user"
                    }
                    size={15}
                    color={theme.brand}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <AppText variant="bodySemi" numberOfLines={1}>
                    {targetName(target)}
                  </AppText>
                  {target.kind === "channel" && target.courseCode ? (
                    <AppText variant="caption" muted numberOfLines={1}>
                      {target.courseCode}
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
          That's five rooms — as many as one forward carries.
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

export default function ChannelRoomScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id;
  const { id } = useLocalSearchParams<{ id: string }>();
  const channelId = id ?? "";

  const [status, setStatus] = useState<Status>("loading");
  const [channel, setChannel] = useState<ChannelRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Chat depth: reactions, reply counts, the long-press action sheet, typing.
  const [reactionsByMessage, setReactionsByMessage] = useState<
    Record<string, ReactionRow[]>
  >({});
  const reactionsRef = useRef(reactionsByMessage);
  reactionsRef.current = reactionsByMessage;
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const countedRepliesRef = useRef(new Set<string>());
  const [actionsFor, setActionsFor] = useState<MessageRow | null>(null);
  const [selfName, setSelfName] = useState<string | null>(null);

  // Saved messages: my private bookmarks among the loaded rows, so the
  // long-press menu can tell "Save message" from "Remove from saved".
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  // Power layer: attachments, editing, pins, polls, viewer, composer menu.
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<MessageRow | null>(null);
  const draftBeforeEditRef = useRef("");
  const [pinned, setPinned] = useState<MessageRow[]>([]);
  const pinnedIdsRef = useRef<Set<string>>(new Set());
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [askWhenOpen, setAskWhenOpen] = useState(false);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const { blocked } = useBlockedIds();

  // Drafts and the send queue. One key names this conversation everywhere.
  const conversationKey = useMemo(() => keyFor("channel", channelId), [channelId]);
  const [pending, setPending] = useState<QueuedMessage[]>([]);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const editingRef = useRef(false);
  editingRef.current = editing !== null;
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Forwarding: the message being passed along, and the sentence that says
  // where it actually landed.
  const [forwardFor, setForwardFor] = useState<MessageRow | null>(null);
  const [forwardNote, setForwardNote] = useState<string | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Display names behind forwarded_author_id, fetched in one batch per page
  // rather than embedded — `messages` has two foreign keys into `profiles`,
  // and a mis-hinted embed would take the whole room's query down with it.
  const [forwardedNames, setForwardedNames] = useState<Record<string, string>>(
    {}
  );
  const forwardedNamesRef = useRef(forwardedNames);
  forwardedNamesRef.current = forwardedNames;

  // Availability polls. They do NOT hang off messages.poll_id, so the room
  // carries them as their own strip above the composer — see the strip.
  const [openPolls, setOpenPolls] = useState<OpenPoll[]>([]);
  const [pollsExpanded, setPollsExpanded] = useState(false);

  // In-room search — a reading surface over this channel's history.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MessageRow[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    pinnedIdsRef.current = new Set(pinned.map((p) => p.id));
  }, [pinned]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/channels");
  }, [router]);

  const markRead = useCallback(() => {
    if (!channelId || !userId) return;
    // PostgrestBuilder only runs once awaited/then'd — fire and forget.
    void supabase
      .from("channel_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("channel_id", channelId)
      .eq("user_id", userId)
      .then(() => undefined);
  }, [channelId, userId]);

  /** Signed URLs for chat images, cached per path for the screen's lifetime
      (they outlive the hour only across remounts, which refetch anyway). */
  const signedUrlsRef = useRef(new Map<string, Promise<string | null>>());
  const resolveAttachmentUrl = useCallback(
    (path: string): Promise<string | null> => {
      const cached = signedUrlsRef.current.get(path);
      if (cached) return cached;
      const promise = supabase.storage
        .from("chat-uploads")
        .createSignedUrl(path, 3600)
        .then(({ data }) => data?.signedUrl ?? null)
        .catch(() => null);
      signedUrlsRef.current.set(path, promise);
      return promise;
    },
    []
  );

  /** One batched fetch of reactions for a page of messages — web's pattern. */
  const loadReactions = useCallback(async (messageIds: string[]) => {
    if (messageIds.length === 0) return;
    const { data } = await supabase
      .from("message_reactions")
      .select("*")
      .in("message_id", messageIds);
    if (!data) return;
    setReactionsByMessage((prev) => {
      const next = { ...prev };
      for (const id of messageIds) next[id] = [];
      for (const row of data as ReactionRow[]) {
        (next[row.message_id] ??= []).push(row);
      }
      return next;
    });
  }, []);

  /** One batched reply-count fetch, remembering each counted reply id so the
      realtime bump below never double-counts an already-seen reply. */
  const loadReplyCounts = useCallback(async (messageIds: string[]) => {
    if (messageIds.length === 0) return;
    const { data } = await supabase
      .from("messages")
      .select("id, parent_id")
      .in("parent_id", messageIds)
      .is("deleted_at", null);
    if (!data) return;
    const counts: Record<string, number> = {};
    for (const row of data as { id: string; parent_id: string }[]) {
      countedRepliesRef.current.add(row.id);
      counts[row.parent_id] = (counts[row.parent_id] ?? 0) + 1;
    }
    setReplyCounts(counts);
  }, []);

  /** Which of these messages I've saved — one query per loaded page keeps
      the long-press menu label truthful. */
  const loadSaved = useCallback(
    async (messageIds: string[]) => {
      if (!userId || messageIds.length === 0) return;
      const { data } = await supabase
        .from("message_bookmarks")
        .select("message_id")
        .eq("user_id", userId)
        .in("message_id", messageIds);
      if (!data) return;
      setSavedIds((prev) => {
        const next = new Set(prev);
        for (const row of data as { message_id: string }[]) {
          next.add(row.message_id);
        }
        return next;
      });
    },
    [userId]
  );

  /** The channel's pinned list, newest pin first (small by construction). */
  const refreshPinned = useCallback(async () => {
    if (!channelId) return;
    const { data } = await supabase
      .from("messages")
      .select(MESSAGE_SELECT)
      .eq("channel_id", channelId)
      .not("pinned_at", "is", null)
      .is("deleted_at", null)
      .order("pinned_at", { ascending: false });
    if (data) setPinned(data as unknown as MessageRow[]);
  }, [channelId]);

  /** The display names behind any forwarded_author_id on this page. One
      batched query, and only for ids we haven't already resolved. */
  const loadForwardedNames = useCallback(
    async (rows: readonly { forwarded_author_id: string | null }[]) => {
      const wanted = new Set<string>();
      for (const row of rows) {
        const id = row.forwarded_author_id;
        if (id && !(id in forwardedNamesRef.current)) wanted.add(id);
      }
      if (wanted.size === 0) return;
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", [...wanted]);
      if (!data) return;
      setForwardedNames((prev) => {
        const next = { ...prev };
        for (const row of data as { id: string; display_name: string }[]) {
          next[row.id] = row.display_name;
        }
        return next;
      });
    },
    []
  );

  /** The channel's still-open availability polls, newest first. */
  const refreshOpenPolls = useCallback(async () => {
    if (!channelId) return;
    const { data } = await supabase
      .from("availability_polls")
      .select("id, title, created_at")
      .eq("channel_id", channelId)
      .is("closed_at", null)
      .order("created_at", { ascending: false })
      .limit(5);
    if (data) setOpenPolls(data as OpenPoll[]);
  }, [channelId]);

  /** Count each reply exactly once, whether it arrives via the initial batch
      load or a realtime echo (including our own sends from the thread screen). */
  const bumpReplyCount = useCallback((parentId: string, replyId: string) => {
    if (countedRepliesRef.current.has(replyId)) return;
    countedRepliesRef.current.add(replyId);
    setReplyCounts((prev) => ({
      ...prev,
      [parentId]: (prev[parentId] ?? 0) + 1,
    }));
  }, []);

  /** Optimistic toggle in message_reactions — the pill flips instantly, and
      anything but a double-tap race (23505) reverts to server truth. */
  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!userId || messageId.startsWith("temp-")) return;
      const mine = (reactionsRef.current[messageId] ?? []).some(
        (r) => r.user_id === userId && r.emoji === emoji
      );
      if (!mine) tapLight(); // adding a reaction gets a tick; removing stays silent
      setReactionsByMessage((prev) => {
        const rows = prev[messageId] ?? [];
        return {
          ...prev,
          [messageId]: mine
            ? rows.filter((r) => !(r.user_id === userId && r.emoji === emoji))
            : [
                ...rows,
                {
                  message_id: messageId,
                  user_id: userId,
                  emoji,
                  created_at: new Date().toISOString(),
                },
              ],
        };
      });
      const { error: reactError } = mine
        ? await supabase
            .from("message_reactions")
            .delete()
            .eq("message_id", messageId)
            .eq("user_id", userId)
            .eq("emoji", emoji)
        : await supabase
            .from("message_reactions")
            .insert({ message_id: messageId, user_id: userId, emoji });
      if (reactError && reactError.code !== "23505") {
        await loadReactions([messageId]);
      }
    },
    [userId, loadReactions]
  );

  const openThread = useCallback(
    (messageId: string) => {
      if (messageId.startsWith("temp-")) return;
      router.push({
        pathname: "/channel/thread",
        params: { channelId, messageId },
      });
    },
    [router, channelId]
  );

  const load = useCallback(async () => {
    if (!userId) return;
    if (!channelId) {
      setStatus("notFound");
      return;
    }
    const [channelRes, memberRes, messagesRes] = await Promise.all([
      supabase
        .from("channels")
        .select("id, kind, name, slug, description, course:courses(id, code, title)")
        .eq("id", channelId)
        .maybeSingle(),
      supabase
        .from("channel_members")
        .select("channel_id, last_read_at")
        .eq("channel_id", channelId)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("messages")
        .select(MESSAGE_SELECT)
        .eq("channel_id", channelId)
        .is("parent_id", null)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE),
    ]);
    if (channelRes.error) {
      setStatus("error");
      return;
    }
    const channelRow = channelRes.data as unknown as ChannelRow | null;
    // RLS hides other campuses' channels, so "not found" covers both cases.
    if (!channelRow) {
      setStatus("notFound");
      return;
    }
    setChannel(channelRow);
    if (!memberRes.data) {
      setStatus("notMember");
      return;
    }
    if (messagesRes.error) {
      setStatus("error");
      return;
    }
    // Newest first — exactly what an inverted FlatList wants. Deleted rows
    // stay in the stream as tombstones, matching the web room.
    const rows = (messagesRes.data ?? []) as unknown as MessageRow[];
    setMessages(rows);
    setStatus("ready");
    markRead();
    // Batch the chat-depth metadata after the page lands (web's pattern).
    const ids = rows.map((m) => m.id);
    void loadReactions(ids);
    void loadReplyCounts(ids);
    void loadSaved(ids);
    void loadForwardedNames(rows);
    void refreshPinned();
    void refreshOpenPolls();
  }, [
    channelId,
    userId,
    markRead,
    loadReactions,
    loadReplyCounts,
    loadSaved,
    loadForwardedNames,
    refreshPinned,
    refreshOpenPolls,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ------------------------ drafts and the queue ----------------------- */

  // Restore what was left mid-sentence, but never over something already
  // typed — a slow read must not overwrite a fast typist.
  useEffect(() => {
    let cancelled = false;
    void loadDraft(conversationKey).then((saved) => {
      if (cancelled || !saved) return;
      setDraft((current) => (current.length === 0 ? saved : current));
    });
    return () => {
      cancelled = true;
    };
  }, [conversationKey]);

  /** Debounced, not per keystroke: AsyncStorage is a round trip to native. */
  const noteDraft = useCallback(
    (text: string) => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      draftTimerRef.current = setTimeout(() => {
        draftTimerRef.current = null;
        // While editing, the composer holds someone's published words, not a
        // draft — the real draft is parked in draftBeforeEditRef.
        if (editingRef.current) return;
        void saveDraft(conversationKey, text);
      }, DRAFT_SAVE_MS);
    },
    [conversationKey]
  );

  // Leaving the room writes the last word, debounce or no debounce.
  useEffect(() => {
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      void saveDraft(
        conversationKey,
        editingRef.current ? draftBeforeEditRef.current : draftRef.current
      );
    };
  }, [conversationKey]);

  useEffect(() => {
    return () => {
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    };
  }, []);

  const refreshPending = useCallback(async () => {
    setPending(await peekQueue(conversationKey));
  }, [conversationKey]);

  /** Pull rows the queue just landed into the stream. Our own realtime echoes
      are skipped, so nothing else would bring them in. */
  const adoptSent = useCallback(async (ids: readonly string[]) => {
    if (ids.length === 0) return;
    const { data } = await supabase
      .from("messages")
      .select(MESSAGE_SELECT)
      .in("id", [...ids]);
    if (!data) return;
    const rows = (data as unknown as MessageRow[]).filter(
      (row) => row.parent_id === null
    );
    void loadForwardedNames(rows);
    setMessages((prev) => {
      const known = new Set(prev.map((m) => m.id));
      const fresh = rows
        .filter((row) => !known.has(row.id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return fresh.length === 0 ? prev : [...fresh, ...prev];
    });
  }, [loadForwardedNames]);

  const runFlush = useCallback(async () => {
    let landed: string[] = [];
    try {
      const result = await flushQueue();
      landed = result.sent
        .filter((message) => message.key === conversationKey)
        .map((message) => message.id);
    } catch {
      // The queue itself couldn't be read; the refresh below still tells the
      // truth about what's waiting.
    }
    // Retire the pending bubbles BEFORE the real rows arrive — the other
    // order shows both for a frame, which reads as a message sent twice.
    await refreshPending();
    if (landed.length > 0) {
      await adoptSent(landed);
      markRead();
    }
  }, [conversationKey, adoptSent, markRead, refreshPending]);

  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  /** Tap a pending bubble. A stuck one has spent its five tries, so it goes
      back in the queue fresh; anything else just needs another pass. */
  const retryQueued = useCallback(
    async (message: QueuedMessage) => {
      if (message.stuck) {
        await dropQueued(message.id);
        try {
          await enqueue({
            key: message.key,
            table: message.table,
            payload: message.payload,
          });
        } catch {
          // It couldn't be held again; the refresh shows it's gone.
        }
      }
      await refreshPending();
      await runFlush();
    },
    [refreshPending, runFlush]
  );

  const discardQueued = useCallback(
    async (id: string) => {
      await dropQueued(id);
      await refreshPending();
    },
    [refreshPending]
  );

  // Landing in the room and leaving it both count as caught up — the focus
  // effect's cleanup runs on blur and unmount alike, clearing the lists' dots.
  // Arriving is also when anything the queue is holding gets another go.
  useFocusEffect(
    useCallback(() => {
      markRead();
      void runFlush();
      // availability_polls isn't in the realtime publication, so a poll
      // someone started while you were away arrives on a refetch or not at all.
      void refreshOpenPolls();
      return markRead;
    }, [markRead, runFlush, refreshOpenPolls])
  );

  // Debounced in-room search: ilike over this channel's messages, wildcards
  // escaped so "100%" searches literally. Results are read-only rows.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!searchOpen || q === "") {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      const escaped = q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      void supabase
        .from("messages")
        .select(MESSAGE_SELECT)
        .eq("channel_id", channelId)
        .is("deleted_at", null)
        .ilike("content", `%${escaped}%`)
        .order("created_at", { ascending: false })
        .limit(20)
        .then(({ data }) => {
          if (cancelled) return;
          setSearching(false);
          setSearchResults((data ?? []) as unknown as MessageRow[]);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchOpen, searchQuery, channelId]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
  }, []);

  // Live inserts: thread replies just bump their parent's badge; own echoes
  // are skipped (the optimistic path already has them); everything else gets
  // its author hydrated and is prepended. Live updates (edits, soft deletes,
  // pin flips) merge into the matching row in place.
  const isReady = status === "ready";
  useEffect(() => {
    if (!isReady || !channelId || !userId) return;
    const room = supabase
      .channel(`room:${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload: RealtimePostgresInsertPayload<RawMessageRow>) => {
          const row = payload.new;
          markRead();
          if (row.parent_id) {
            // Replies never join the main list — just bump the badge.
            bumpReplyCount(row.parent_id, row.id);
            return;
          }
          if (row.author_id === userId) return;
          // A poll announcement is a hint that a poll may have just started,
          // never a binding — see the availability strip below.
          if (row.content.startsWith(AVAILABILITY_ANNOUNCE)) {
            void refreshOpenPolls();
          }
          void supabase
            .from("profiles")
            .select("id, handle, display_name, avatar_url")
            .eq("id", row.author_id)
            .maybeSingle()
            .then(({ data }) => {
              const incoming: MessageRow = {
                id: row.id,
                channel_id: row.channel_id,
                author_id: row.author_id,
                parent_id: row.parent_id,
                content: row.content,
                attachment_path: row.attachment_path,
                poll_id: row.poll_id,
                pinned_at: row.pinned_at,
                pinned_by: row.pinned_by,
                edited_at: row.edited_at,
                deleted_at: row.deleted_at,
                created_at: row.created_at,
                forwarded_from: row.forwarded_from,
                forwarded_author_id: row.forwarded_author_id,
                author: (data as unknown as Author | null) ?? null,
              };
              void loadForwardedNames([incoming]);
              setMessages((prev) =>
                prev.some((m) => m.id === incoming.id)
                  ? prev
                  : [incoming, ...prev]
              );
            });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload: RealtimePostgresUpdatePayload<RawMessageRow>) => {
          const row = payload.new;
          if (row.parent_id) return; // replies aren't in this list
          setMessages((prev) => {
            let changed = false;
            const next = prev.map((m) => {
              if (m.id !== row.id) return m;
              if (
                m.content === row.content &&
                m.edited_at === row.edited_at &&
                m.deleted_at === row.deleted_at &&
                m.pinned_at === row.pinned_at &&
                m.pinned_by === row.pinned_by
              ) {
                return m;
              }
              changed = true;
              return {
                ...m,
                content: row.content,
                edited_at: row.edited_at,
                deleted_at: row.deleted_at,
                pinned_at: row.pinned_at,
                pinned_by: row.pinned_by,
              };
            });
            return changed ? next : prev;
          });
          // Pins can flip on rows outside the loaded window, and deleting a
          // pinned message unlists it — refetch whenever the state differs.
          const isPinnedNow = Boolean(row.pinned_at) && !row.deleted_at;
          if (pinnedIdsRef.current.has(row.id) !== isPinnedNow) {
            void refreshPinned();
          }
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(room);
    };
  }, [
    isReady,
    channelId,
    userId,
    markRead,
    bumpReplyCount,
    refreshPinned,
    refreshOpenPolls,
    loadForwardedNames,
  ]);

  // Own display name — broadcast alongside typing events so other clients
  // (web included) can show "Ada is typing…".
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void supabase
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        const name = (data as { display_name: string } | null)?.display_name;
        if (!cancelled && name) setSelfName(name);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Live typing layer — same broadcast protocol as the web room, keyed by
  // channel id, so typers show across runtimes. Idle until the room is ready.
  const { typers, noteTyping } = useTyping(isReady ? channelId : "", {
    id: userId ?? "",
    name: selfName ?? "Someone",
  });

  // Composer @-autocomplete, fed from the channel's member roster.
  const mentions = useMentionSuggestions(isReady ? channelId : null);

  const handleJoin = useCallback(async () => {
    if (!channelId || !userId) return;
    setJoinError(null);
    setJoining(true);
    const { error: insertError } = await supabase
      .from("channel_members")
      .insert({ channel_id: channelId, user_id: userId });
    setJoining(false);
    if (insertError) {
      setJoinError("Couldn't join just now. Give it another try.");
      return;
    }
    setStatus("loading");
    void load();
  }, [channelId, userId, load]);

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending || !channelId || !userId) return;
    setSendError(null);
    setDraft("");
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    void clearDraft(conversationKey);
    mentions.reset();
    const tempId = `temp-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    // Optimistic bubble — own messages don't render the author, so null is fine.
    const optimistic: MessageRow = {
      id: tempId,
      channel_id: channelId,
      author_id: userId,
      parent_id: null,
      content,
      attachment_path: null,
      poll_id: null,
      pinned_at: null,
      pinned_by: null,
      edited_at: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
      forwarded_from: null,
      forwarded_author_id: null,
      author: null,
    };
    setMessages((prev) => [optimistic, ...prev]);
    tapLight(); // the send lands with the optimistic bubble, not the round-trip
    setSending(true);
    const { data, error: insertError } = await supabase
      .from("messages")
      .insert({ channel_id: channelId, author_id: userId, content })
      .select(MESSAGE_SELECT)
      .single();
    setSending(false);
    if (insertError || !data) {
      noteConnectivity(!isLikelyOffline(insertError));
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      // Hold it rather than drop it: the optimistic bubble becomes a pending
      // one, and the words stay in the room where they were typed.
      try {
        await enqueue({
          key: conversationKey,
          table: "messages",
          payload: { channel_id: channelId, author_id: userId, content },
        });
        await refreshPending();
        void runFlush();
      } catch (queueError) {
        // The device wouldn't hold it either — give the words back.
        setDraft(content);
        setSendError(
          queueError instanceof DraftError
            ? queueError.message
            : "Couldn't send that — check your connection and try again."
        );
      }
      return;
    }
    noteConnectivity(true);
    // Reconcile: swap the temp row for the real one (dedupe by id in case the
    // realtime echo ever lands first).
    const real = data as unknown as MessageRow;
    setMessages((prev) => [
      real,
      ...prev.filter((m) => m.id !== tempId && m.id !== real.id),
    ]);
    markRead();
  }, [
    draft,
    sending,
    channelId,
    userId,
    markRead,
    mentions,
    conversationKey,
    refreshPending,
    runFlush,
  ]);

  /** Pick a photo → upload to the student's own chat-uploads folder → send.
      Any typed draft rides along as the caption; otherwise content is "Photo". */
  const handlePickPhoto = useCallback(async () => {
    if (!channelId || !userId || uploading) return;
    setSendError(null);
    let asset: ImagePicker.ImagePickerAsset | null = null;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        quality: 0.7,
      });
      if (result.canceled) return;
      asset = result.assets[0] ?? null;
    } catch {
      setSendError("Couldn't open your photos. Give it another try.");
      return;
    }
    if (!asset) return;
    setUploading(true);
    try {
      const buffer = await (await fetch(asset.uri)).arrayBuffer();
      const contentType = asset.mimeType ?? "image/jpeg";
      const path = `${userId}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("chat-uploads")
        .upload(path, buffer, { contentType });
      if (uploadError) throw uploadError;
      const content = draft.trim() || "Photo";
      const { data, error: insertError } = await supabase
        .from("messages")
        .insert({
          channel_id: channelId,
          author_id: userId,
          content,
          attachment_path: path,
        })
        .select(MESSAGE_SELECT)
        .single();
      if (insertError || !data) throw insertError ?? new Error("send failed");
      setDraft("");
      void clearDraft(conversationKey);
      mentions.reset();
      const real = data as unknown as MessageRow;
      // Own realtime echoes are skipped, so append the row here.
      setMessages((prev) =>
        prev.some((m) => m.id === real.id) ? prev : [real, ...prev]
      );
      markRead();
    } catch {
      setSendError(
        "Couldn't send your photo — check your connection and try again."
      );
    } finally {
      setUploading(false);
    }
  }, [channelId, userId, uploading, draft, markRead, mentions, conversationKey]);

  // The poll RPC writes the poll + carrying message atomically and hands back
  // the message id. Our own realtime echoes are skipped, so fetch it here.
  const handlePollCreated = useCallback(
    (messageId: string) => {
      void supabase
        .from("messages")
        .select(MESSAGE_SELECT)
        .eq("id", messageId)
        .maybeSingle()
        .then(({ data }) => {
          if (!data) return;
          const real = data as unknown as MessageRow;
          setMessages((prev) =>
            prev.some((m) => m.id === real.id) ? prev : [real, ...prev]
          );
        });
      markRead();
    },
    [markRead]
  );

  /** `create_availability_poll` writes the poll, its times, and the message
      announcing it in one transaction. We get the poll id back; the message
      arrives with no id of its own, and our own echoes are skipped — so pull
      the newest row in and refresh the strip. */
  const handleAvailabilityCreated = useCallback(
    (pollId: string) => {
      // The id is the one thing we know for certain, so read that poll by id
      // rather than re-listing the channel and hoping ours is in the window.
      void supabase
        .from("availability_polls")
        .select("id, title, created_at")
        .eq("id", pollId)
        .maybeSingle()
        .then(({ data }) => {
          if (!data) return;
          const poll = data as OpenPoll;
          setOpenPolls((prev) =>
            prev.some((row) => row.id === poll.id) ? prev : [poll, ...prev]
          );
          setPollsExpanded(true);
        });
      void supabase
        .from("messages")
        .select(MESSAGE_SELECT)
        .eq("channel_id", channelId)
        .is("parent_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (!data) return;
          const real = data as unknown as MessageRow;
          setMessages((prev) =>
            prev.some((m) => m.id === real.id) ? prev : [real, ...prev]
          );
        });
      markRead();
    },
    [channelId, markRead]
  );

  /* -------------------- edit / delete / pin actions -------------------- */

  const startEdit = useCallback(
    (target: MessageRow) => {
      // Bank whatever was half-typed before the composer borrows itself out.
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      void saveDraft(conversationKey, draft);
      draftBeforeEditRef.current = draft;
      setEditing(target);
      setDraft(target.content);
      mentions.reset();
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [draft, mentions, conversationKey]
  );

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setDraft(draftBeforeEditRef.current);
    draftBeforeEditRef.current = "";
    mentions.reset();
  }, [mentions]);

  const handleSaveEdit = useCallback(async () => {
    if (!editing || !userId) return;
    const content = draft.trim();
    if (!content) return;
    const target = editing;
    setEditing(null);
    setDraft(draftBeforeEditRef.current);
    draftBeforeEditRef.current = "";
    mentions.reset();
    if (content === target.content) return;
    const editedAt = new Date().toISOString();
    setMessages((prev) =>
      prev.map((m) =>
        m.id === target.id ? { ...m, content, edited_at: editedAt } : m
      )
    );
    const { error: updateError } = await supabase
      .from("messages")
      .update({ content, edited_at: editedAt })
      .eq("id", target.id)
      .eq("author_id", userId);
    if (updateError) {
      setMessages((prev) => prev.map((m) => (m.id === target.id ? target : m)));
      setSendError("Couldn't save your edit — give it another try.");
    }
  }, [editing, userId, draft, mentions]);

  /** Soft delete: the row stays as a tombstone, matching the web room. */
  const handleDelete = useCallback(
    async (target: MessageRow) => {
      if (!userId) return;
      const deletedAt = new Date().toISOString();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === target.id ? { ...m, deleted_at: deletedAt } : m
        )
      );
      if (target.pinned_at) {
        setPinned((prev) => prev.filter((p) => p.id !== target.id));
      }
      const { error: updateError } = await supabase
        .from("messages")
        .update({ deleted_at: deletedAt })
        .eq("id", target.id)
        .eq("author_id", userId);
      if (updateError) {
        setMessages((prev) =>
          prev.map((m) => (m.id === target.id ? target : m))
        );
        if (target.pinned_at) void refreshPinned();
        setSendError("Couldn't delete that — give it another try.");
      }
    },
    [userId, refreshPinned]
  );

  /** Any member can pin or unpin — the RPC enforces membership server-side. */
  const handleTogglePin = useCallback(
    async (target: MessageRow, pin: boolean) => {
      if (!userId) return;
      if (pin) tapSuccess(); // pinning is a commitment; unpinning stays silent
      const pinnedAt = pin ? new Date().toISOString() : null;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === target.id
            ? { ...m, pinned_at: pinnedAt, pinned_by: pin ? userId : null }
            : m
        )
      );
      setPinned((prev) =>
        pin
          ? [
              { ...target, pinned_at: pinnedAt, pinned_by: userId },
              ...prev.filter((p) => p.id !== target.id),
            ]
          : prev.filter((p) => p.id !== target.id)
      );
      try {
        await setMessagePinned(target.id, pin);
        void refreshPinned();
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === target.id
              ? { ...m, pinned_at: target.pinned_at, pinned_by: target.pinned_by }
              : m
          )
        );
        void refreshPinned();
        setSendError(
          pin
            ? "Couldn't pin that — give it another try."
            : "Couldn't unpin that — give it another try."
        );
      }
    },
    [userId, refreshPinned]
  );

  /** Optimistic save/remove in message_bookmarks — a private keep-it-handy
      flag. A double-tap race (23505) already means saved, so it stands. */
  const handleToggleSaved = useCallback(
    async (messageId: string, save: boolean) => {
      if (!userId) return;
      if (save) tapLight();
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (save) next.add(messageId);
        else next.delete(messageId);
        return next;
      });
      const { error: savedError } = save
        ? await supabase
            .from("message_bookmarks")
            .insert({ user_id: userId, message_id: messageId })
        : await supabase
            .from("message_bookmarks")
            .delete()
            .eq("user_id", userId)
            .eq("message_id", messageId);
      if (savedError && !(save && savedError.code === "23505")) {
        setSavedIds((prev) => {
          const next = new Set(prev);
          if (save) next.delete(messageId);
          else next.add(messageId);
          return next;
        });
        setSendError(
          save
            ? "Couldn't save that — give it another try."
            : "Couldn't remove that from saved — give it another try."
        );
      }
    },
    [userId]
  );

  /* ----------------------------- forwarding ---------------------------- */

  /** What the picker is passing along. A forward of a forward keeps pointing
      at whoever wrote the words, not the last person to hand them on. */
  const forwardSource = useMemo<ForwardSource | null>(() => {
    if (!forwardFor || !channel) return null;
    return {
      content: forwardFor.content,
      attachmentPath: forwardFor.attachment_path,
      authorId: forwardFor.forwarded_author_id ?? forwardFor.author_id,
      fromLabel:
        forwardFor.forwarded_from ??
        forwardLabelFor({ kind: "channel", name: channelTitle(channel) }),
    };
  }, [forwardFor, channel]);

  const forwardExclude = useMemo(
    () => ({ kind: "channel" as const, id: channelId }),
    [channelId]
  );

  const showForwardNote = useCallback((message: string) => {
    setForwardNote(message);
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    noteTimerRef.current = setTimeout(() => {
      noteTimerRef.current = null;
      setForwardNote(null);
    }, 5000);
  }, []);

  // Blocked students' messages never render — filtering happens at the edge
  // so realtime, optimistic, and initial rows all pass through one gate.
  const visibleMessages = useMemo(
    () => messages.filter((m) => !blocked.has(m.author_id)),
    [messages, blocked]
  );
  const visiblePinned = useMemo(
    () => pinned.filter((m) => !blocked.has(m.author_id)),
    [pinned, blocked]
  );

  const renderMessage = useCallback(
    ({ item, index }: ListRenderItemInfo<MessageRow>) => {
      // Inverted list: index + 1 is the chronologically older neighbor.
      const older = visibleMessages[index + 1] ?? null;
      const isOwn = item.author_id === userId;
      const deleted = Boolean(item.deleted_at);
      const newDay = !older || dayKey(older.created_at) !== dayKey(item.created_at);
      const grouped =
        !newDay &&
        older !== null &&
        older.author_id === item.author_id &&
        new Date(item.created_at).getTime() -
          new Date(older.created_at).getTime() <
          GROUP_WINDOW_MS;
      const authorName = item.author?.display_name ?? "A classmate";
      const pills = groupReactions(reactionsByMessage[item.id], userId);
      const replyCount = replyCounts[item.id] ?? 0;
      return (
        <View>
          {newDay ? <DaySeparator label={dayLabel(item.created_at)} /> : null}
          <View
            style={{
              flexDirection: "row",
              justifyContent: isOwn ? "flex-end" : "flex-start",
              alignItems: "flex-end",
              gap: 8,
              marginTop: grouped ? 2 : 10,
            }}
          >
            {!isOwn ? (
              grouped ? (
                <View style={{ width: 28 }} />
              ) : (
                <Initials name={authorName} size={28} />
              )
            ) : null}
            <View
              style={{
                maxWidth: "80%",
                alignItems: isOwn ? "flex-end" : "flex-start",
              }}
            >
              {!isOwn && !grouped ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "baseline",
                    gap: 6,
                    paddingHorizontal: 4,
                    marginBottom: 2,
                  }}
                >
                  <AppText variant="label" numberOfLines={1}>
                    {authorName}
                  </AppText>
                  <AppText variant="caption" muted>
                    {timeLabel(item.created_at)}
                  </AppText>
                  {item.pinned_at ? (
                    <Feather name="bookmark" size={10} color={theme.brand} />
                  ) : null}
                </View>
              ) : null}
              <Pressable
                accessibilityHint="Long press for message actions"
                onLongPress={() => {
                  if (!item.id.startsWith("temp-") && !deleted) {
                    setActionsFor(item);
                  }
                }}
                delayLongPress={300}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                {deleted ? (
                  <View style={{ paddingHorizontal: 4, paddingVertical: 6 }}>
                    <AppText muted style={{ fontStyle: "italic" }}>
                      Message deleted
                    </AppText>
                  </View>
                ) : item.poll_id ? (
                  // The message is a poll carrier — render the live poll in
                  // place of the text (content duplicates the question).
                  <PollBubble pollId={item.poll_id} />
                ) : (
                  <Card
                    padded={false}
                    style={{
                      backgroundColor: isOwn ? theme.brandSoft : theme.surface2,
                      borderRadius: 16,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      gap: 6,
                    }}
                  >
                    {item.forwarded_from ? (
                      <ForwardedFrom
                        from={item.forwarded_from}
                        who={
                          item.forwarded_author_id
                            ? (forwardedNames[item.forwarded_author_id] ?? null)
                            : null
                        }
                        own={isOwn}
                      />
                    ) : null}
                    {item.attachment_path ? (
                      <AttachmentImage
                        path={item.attachment_path}
                        resolve={resolveAttachmentUrl}
                        onOpen={setViewerUrl}
                      />
                    ) : null}
                    {/* "Photo" is the placeholder content for caption-less sends. */}
                    {item.attachment_path && item.content === "Photo" ? null : (
                      <MentionText
                        text={item.content}
                        baseStyle={{ ...BODY_TEXT, color: theme.foreground }}
                        highlightColor={isOwn ? theme.brandInk : theme.brand}
                      />
                    )}
                    {item.edited_at ? (
                      <AppText
                        variant="caption"
                        muted
                        style={{ fontSize: 10, lineHeight: 12 }}
                      >
                        (edited)
                      </AppText>
                    ) : null}
                  </Card>
                )}
              </Pressable>
              {isOwn && !grouped ? (
                <AppText
                  variant="caption"
                  muted
                  style={{ marginTop: 2, paddingHorizontal: 4 }}
                >
                  {timeLabel(item.created_at)}
                </AppText>
              ) : null}
              {!deleted && pills.length > 0 ? (
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 4,
                    marginTop: 4,
                    justifyContent: isOwn ? "flex-end" : "flex-start",
                  }}
                >
                  {pills.map(([emoji, group]) => (
                    <Pressable
                      key={emoji}
                      accessibilityRole="button"
                      accessibilityLabel={`${emoji} — ${group.count} ${
                        group.count === 1 ? "reaction" : "reactions"
                      }${group.mine ? ", including yours" : ""}`}
                      onPress={() => void toggleReaction(item.id, emoji)}
                      hitSlop={8}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: radius.full,
                        borderWidth: 1,
                        borderColor: group.mine ? theme.brand : theme.border,
                        backgroundColor: group.mine
                          ? theme.brandSoft
                          : theme.surface,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <AppText style={{ fontSize: 12, lineHeight: 16 }}>
                        {emoji}
                      </AppText>
                      <AppText
                        variant="label"
                        style={{
                          color: group.mine ? theme.brandInk : theme.muted,
                        }}
                      >
                        {group.count}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {replyCount > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open thread — ${
                    replyCount === 1 ? "1 reply" : `${replyCount} replies`
                  }`}
                  onPress={() => openThread(item.id)}
                  hitSlop={10}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    marginTop: 4,
                    paddingHorizontal: 4,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Feather
                    name="message-circle"
                    size={12}
                    color={theme.accent}
                  />
                  <AppText variant="label" style={{ color: theme.accent }}>
                    {replyCount === 1 ? "1 reply" : `${replyCount} replies`}
                  </AppText>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      );
    },
    [
      visibleMessages,
      userId,
      theme,
      reactionsByMessage,
      replyCounts,
      toggleReaction,
      openThread,
      resolveAttachmentUrl,
      forwardedNames,
    ]
  );

  const title = channel ? channelTitle(channel) : "";

  /* ------------------------- pre-chat states ------------------------- */

  if (status !== "ready" || !channel) {
    const kind = channel?.kind;
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + 8,
        }}
      >
        <View style={{ paddingHorizontal: 12 }}>
          <BackChevron onPress={goBack} />
        </View>
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            padding: 28,
          }}
        >
          {status === "loading" ? (
            <ActivityIndicator size="large" color={theme.brand} />
          ) : status === "error" ? (
            <>
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 16,
                  backgroundColor: theme.brandSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Feather name="wifi-off" size={22} color={theme.brand} />
              </View>
              <AppText variant="title">Something hiccuped</AppText>
              <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
                We couldn't load this channel. Give it another try.
              </AppText>
              <Button
                label="Try again"
                variant="soft"
                size="sm"
                onPress={() => {
                  setStatus("loading");
                  void load();
                }}
              />
            </>
          ) : status === "notFound" ? (
            <>
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 16,
                  backgroundColor: theme.brandSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Feather name="lock" size={22} color={theme.brand} />
              </View>
              <AppText variant="title">Channel not available</AppText>
              <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
                This channel doesn't exist, or it belongs to another campus.
              </AppText>
              <Button
                label="Back to your channels"
                variant="soft"
                size="sm"
                onPress={goBack}
              />
            </>
          ) : kind === "campus" || kind === "topic" ? (
            <>
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 16,
                  backgroundColor: theme.brandSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Feather
                  name={kind ? KIND_ICONS[kind] : "hash"}
                  size={22}
                  color={theme.brand}
                />
              </View>
              <AppText variant="title">{title}</AppText>
              {channel?.description ? (
                <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
                  {channel.description}
                </AppText>
              ) : null}
              <AppText
                variant="caption"
                muted
                style={{ textAlign: "center", maxWidth: 280 }}
              >
                {kind === "campus" ? "Campus channel" : "Topic channel"} — open
                to everyone at your school.
              </AppText>
              <Button
                label="Join channel"
                pending={joining}
                onPress={() => void handleJoin()}
              />
              {joinError ? (
                <AppText variant="caption" style={{ color: theme.danger }}>
                  {joinError}
                </AppText>
              ) : null}
            </>
          ) : (
            <>
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 16,
                  backgroundColor: theme.brandSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Feather
                  name={kind ? KIND_ICONS[kind] : "hash"}
                  size={22}
                  color={theme.brand}
                />
              </View>
              <AppText variant="title">
                {kind === "course"
                  ? "This is a course channel"
                  : "This is a club channel"}
              </AppText>
              <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
                {kind === "course"
                  ? "Course channels are joined automatically from your schedule. Add this course and you're in."
                  : "Join the club and its channel comes with it."}
              </AppText>
              <Button
                label="Back to your channels"
                variant="soft"
                size="sm"
                onPress={goBack}
              />
            </>
          )}
        </View>
      </View>
    );
  }

  /* ----------------------------- the room ---------------------------- */

  const subtitle = channelSubtitle(channel);
  const canSend = draft.trim().length > 0 && !sending;
  const searchActive = searchOpen && searchQuery.trim() !== "";
  // Blocked students stay hidden in search too — same gate as the stream.
  const visibleResults = searchResults.filter((m) => !blocked.has(m.author_id));
  // The long-press sheet reads the live row, so pin state stays fresh.
  const actionsMessage = actionsFor
    ? messages.find((m) => m.id === actionsFor.id) ?? actionsFor
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingBottom: 10,
          paddingHorizontal: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
          backgroundColor: theme.surface,
        }}
      >
        <BackChevron onPress={goBack} />
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.control,
            backgroundColor: theme.brandSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather name={KIND_ICONS[channel.kind]} size={18} color={theme.brand} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="title" numberOfLines={1}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" muted numberOfLines={1}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            searchOpen ? "Close search" : "Search this room"
          }
          onPress={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather
            name="search"
            size={20}
            color={searchOpen ? theme.brand : theme.foreground}
          />
        </Pressable>
      </View>

      {searchOpen ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderBottomColor: theme.border,
            backgroundColor: theme.surface,
          }}
        >
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
            placeholder="Search this room"
            placeholderTextColor={theme.muted}
            accessibilityLabel="Search this room"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            cursorColor={theme.brand}
            selectionColor={theme.brandSoft}
            style={{
              flex: 1,
              minHeight: 44,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 22,
              backgroundColor: theme.background,
              paddingHorizontal: 14,
              fontFamily: fonts.body,
              fontSize: 15,
              color: theme.foreground,
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close search"
            onPress={closeSearch}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Feather name="x" size={20} color={theme.muted} />
          </Pressable>
        </View>
      ) : null}

      {visiblePinned.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View pinned messages — ${
            visiblePinned.length === 1
              ? "1 pinned"
              : `${visiblePinned.length} pinned`
          }`}
          onPress={() => setPinnedOpen(true)}
          style={({ pressed }) => ({
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 16,
            borderBottomWidth: 1,
            borderBottomColor: theme.border,
            backgroundColor: pressed ? theme.surface2 : theme.surface,
          })}
        >
          <Feather name="bookmark" size={14} color={theme.brand} />
          <AppText
            variant="label"
            style={{ color: theme.brandInk, flex: 1 }}
            numberOfLines={1}
          >
            {visiblePinned.length === 1
              ? "1 pinned"
              : `${visiblePinned.length} pinned`}
          </AppText>
          <Feather name="chevron-right" size={16} color={theme.muted} />
        </Pressable>
      ) : null}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {searchActive ? (
          // Search results replace the stream while a query is typed — a
          // reading surface only; rows don't jump into the conversation.
          searching && visibleResults.length === 0 ? (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                padding: 28,
              }}
            >
              <ActivityIndicator size="small" color={theme.brand} />
            </View>
          ) : visibleResults.length === 0 ? (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                padding: 28,
              }}
            >
              <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
                Nothing in this room matches that.
              </AppText>
            </View>
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingVertical: 12,
              }}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
            >
              {visibleResults.map((m, i) => (
                <View
                  key={m.id}
                  style={{
                    paddingVertical: 10,
                    gap: 4,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: theme.border,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <AppText variant="label" numberOfLines={1}>
                      {m.author?.display_name ?? "A classmate"}
                    </AppText>
                    <AppText variant="caption" muted>
                      {relativeTime(m.created_at)}
                    </AppText>
                  </View>
                  {m.attachment_path && m.content === "Photo" ? (
                    <AppText muted style={{ fontStyle: "italic" }}>
                      Photo
                    </AppText>
                  ) : (
                    <MentionText
                      text={m.content}
                      baseStyle={{ ...BODY_TEXT, color: theme.foreground }}
                      highlightColor={theme.brand}
                    />
                  )}
                </View>
              ))}
            </ScrollView>
          )
        ) : visibleMessages.length === 0 && pending.length === 0 ? (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              padding: 28,
            }}
          >
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 16,
                backgroundColor: theme.brandSoft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Feather name="message-circle" size={22} color={theme.brand} />
            </View>
            <AppText variant="title">It's quiet in here</AppText>
            <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
              Nobody's said anything yet — be the first to say hi.
            </AppText>
          </View>
        ) : (
          <FlatList
            data={visibleMessages}
            inverted
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingVertical: 12,
            }}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            // In an inverted list the header sits at the visual bottom — the
            // right home for messages that haven't gone out yet, oldest of
            // them first, right where they were typed.
            ListHeaderComponent={
              pending.length > 0 ? (
                <View>
                  {pending.map((message) => (
                    <PendingBubble
                      key={message.id}
                      message={message}
                      onRetry={() => void retryQueued(message)}
                      onDiscard={() => void discardQueued(message.id)}
                    />
                  ))}
                </View>
              ) : null
            }
            // …and the footer at the visual top — the right home for a
            // "beginning of the channel" note.
            ListFooterComponent={
              visibleMessages.length < PAGE_SIZE ? (
                <View style={{ paddingVertical: 16, gap: 2 }}>
                  <AppText variant="title">Welcome to {title}</AppText>
                  <AppText variant="caption" muted>
                    This is the very beginning of the channel.
                  </AppText>
                </View>
              ) : null
            }
          />
        )}

        <View
          style={{
            minHeight: 18,
            justifyContent: "flex-end",
            paddingHorizontal: 16,
            paddingBottom: 2,
          }}
        >
          <AppText
            variant="caption"
            muted
            numberOfLines={1}
            accessibilityLiveRegion="polite"
          >
            {typingLabel(typers)}
          </AppText>
        </View>

        {/* Availability polls live above the composer rather than inside a
            message bubble, and that is a deliberate call. Unlike a poll, an
            availability poll has no `messages.poll_id` to hang off: the RPC
            posts a plain "When can everyone meet? …" message, so binding a
            poll to a message would mean guessing from that text — and the
            moment somebody types those words themselves, or the announcing
            message is edited or deleted, the guess attaches a live poll to
            the wrong row. A strip can't misfire: it asks the channel for its
            open polls and shows exactly those. The announcing message stays
            in the stream as the plain sentence it is. */}
        {openPolls.length > 0 ? (
          <View
            style={{
              marginHorizontal: 16,
              marginBottom: 6,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: radius.control,
              backgroundColor: theme.surface,
              overflow: "hidden",
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: pollsExpanded }}
              accessibilityLabel={
                pollsExpanded
                  ? "Hide when everyone's free"
                  : `Say when you're free — ${openPolls[0].title}`
              }
              onPress={() => {
                const next = !pollsExpanded;
                setPollsExpanded(next);
                // Collapsing is the cheapest moment to notice a closed poll.
                if (!next) void refreshOpenPolls();
              }}
              style={({ pressed }) => ({
                minHeight: 44,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 12,
                paddingVertical: 6,
                backgroundColor: pressed ? theme.surface2 : "transparent",
              })}
            >
              <Feather name="calendar" size={14} color={theme.accent} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText variant="label" numberOfLines={1}>
                  {openPolls[0].title}
                </AppText>
                <AppText variant="caption" muted numberOfLines={1}>
                  {openPolls.length === 1
                    ? "Say when you're free"
                    : `Say when you're free · ${openPolls.length - 1} more open`}
                </AppText>
              </View>
              <Feather
                name={pollsExpanded ? "chevron-up" : "chevron-down"}
                size={16}
                color={theme.muted}
              />
            </Pressable>
            {pollsExpanded ? (
              <ScrollView
                style={{ maxHeight: 320 }}
                contentContainerStyle={{ padding: 10, gap: 10 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
              >
                {openPolls.map((poll) => (
                  <AvailabilityBubble key={poll.id} pollId={poll.id} />
                ))}
              </ScrollView>
            ) : null}
          </View>
        ) : null}

        {forwardNote ? (
          <View
            accessibilityLiveRegion="polite"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              marginHorizontal: 16,
              marginBottom: 6,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: radius.control,
              backgroundColor: theme.accentSoft,
            }}
          >
            <Feather name="corner-up-right" size={14} color={theme.accent} />
            <AppText variant="caption" style={{ color: theme.accent, flex: 1 }}>
              {forwardNote}
            </AppText>
          </View>
        ) : null}

        {sendError ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              marginHorizontal: 16,
              marginBottom: 6,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: radius.control,
              backgroundColor: theme.surface2,
            }}
          >
            <Feather name="alert-circle" size={14} color={theme.danger} />
            <AppText
              variant="caption"
              style={{ color: theme.danger, flex: 1 }}
            >
              {sendError}
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss error"
              onPress={() => setSendError(null)}
              hitSlop={14}
              style={{
                width: 24,
                height: 24,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Feather name="x" size={14} color={theme.muted} />
            </Pressable>
          </View>
        ) : null}

        {mentions.active && mentions.suggestions.length > 0 ? (
          <View
            accessibilityLabel="Mention a channel member"
            style={{
              marginHorizontal: 16,
              marginBottom: 6,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: radius.control,
              backgroundColor: theme.surface,
              overflow: "hidden",
            }}
          >
            {mentions.suggestions.map((s) => (
              <Pressable
                key={s.id}
                accessibilityRole="button"
                accessibilityLabel={`Mention ${s.displayName}`}
                onPress={() => setDraft(mentions.applyMention(draft, s.handle))}
                style={({ pressed }) => ({
                  minHeight: 44,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 12,
                  backgroundColor: pressed ? theme.surface2 : "transparent",
                })}
              >
                <AppText variant="bodySemi" style={{ color: theme.brand }}>
                  @{s.handle}
                </AppText>
                <AppText
                  variant="caption"
                  muted
                  numberOfLines={1}
                  style={{ flex: 1 }}
                >
                  {s.displayName}
                </AppText>
              </Pressable>
            ))}
          </View>
        ) : null}

        {editing ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              marginHorizontal: 16,
              marginBottom: 6,
              paddingHorizontal: 12,
              paddingVertical: 4,
              borderRadius: radius.control,
              backgroundColor: theme.brandSoft,
            }}
          >
            <Feather name="edit-2" size={13} color={theme.brandInk} />
            <AppText
              variant="caption"
              style={{ color: theme.brandInk, flex: 1 }}
            >
              Editing message
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel editing"
              onPress={cancelEdit}
              hitSlop={10}
              style={{
                width: 28,
                height: 28,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Feather name="x" size={14} color={theme.brandInk} />
            </Pressable>
          </View>
        ) : null}

        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 10,
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 8),
            borderTopWidth: 1,
            borderTopColor: theme.border,
            backgroundColor: theme.surface,
          }}
        >
          {/* One plus, one sheet. Everything the composer can add lives
              behind it, so the row is a text field with a way in on either
              side rather than a growing strip of icons. */}
          {!editing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add to your message"
              accessibilityHint="Opens photo, poll, and when-can-everyone-meet"
              disabled={uploading}
              onPress={() => setComposerMenuOpen(true)}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                borderRadius: radius.full,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.background,
                alignItems: "center",
                justifyContent: "center",
                opacity: uploading ? 0.6 : pressed ? 0.7 : 1,
              })}
            >
              {uploading ? (
                <ActivityIndicator size="small" color={theme.brand} />
              ) : (
                <Feather name="plus" size={20} color={theme.brand} />
              )}
            </Pressable>
          ) : null}
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              mentions.onDraftChange(text);
              noteTyping();
              noteDraft(text);
            }}
            placeholder={editing ? "Edit your message" : `Message ${title}`}
            placeholderTextColor={theme.muted}
            accessibilityLabel={editing ? "Edit your message" : `Message ${title}`}
            multiline
            maxLength={4000}
            cursorColor={theme.brand}
            selectionColor={theme.brandSoft}
            style={{
              flex: 1,
              minHeight: 44,
              maxHeight: 120,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 22,
              backgroundColor: theme.background,
              paddingHorizontal: 14,
              paddingTop: 11,
              paddingBottom: 11,
              fontFamily: fonts.body,
              fontSize: 15,
              color: theme.foreground,
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editing ? "Save edit" : "Send message"}
            disabled={!canSend}
            onPress={() => void (editing ? handleSaveEdit() : handleSend())}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: radius.full,
              backgroundColor: theme.brand,
              alignItems: "center",
              justifyContent: "center",
              opacity: !canSend ? 0.5 : pressed ? 0.85 : 1,
            })}
          >
            {sending ? (
              <ActivityIndicator size="small" color={theme.brandFg} />
            ) : (
              <Feather
                name={editing ? "check" : "send"}
                size={18}
                color={theme.brandFg}
              />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <PollComposer
        channelId={channelId}
        visible={pollOpen}
        onClose={() => setPollOpen(false)}
        onCreated={handlePollCreated}
      />

      <AvailabilityComposer
        channelId={channelId}
        visible={askWhenOpen}
        onClose={() => setAskWhenOpen(false)}
        onCreated={handleAvailabilityCreated}
      />

      {/* Pinned messages list — a reading surface, so the sheet's children
          are a scroller rather than action rows. */}
      <Sheet
        visible={pinnedOpen}
        onClose={() => setPinnedOpen(false)}
        title="Pinned messages"
      >
        {visiblePinned.length === 0 ? (
          <AppText muted style={{ paddingVertical: 16 }}>
            Nothing pinned right now.
          </AppText>
        ) : (
          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingBottom: 4 }}
            showsVerticalScrollIndicator={false}
          >
            {visiblePinned.map((m, i) => (
              <View
                key={m.id}
                style={{
                  paddingVertical: 10,
                  gap: 4,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: theme.border,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <AppText variant="label" numberOfLines={1}>
                    {m.author?.display_name ?? "A classmate"}
                  </AppText>
                  <AppText
                    variant="caption"
                    muted
                    numberOfLines={1}
                    style={{ flex: 1 }}
                  >
                    {relativeTime(m.created_at)}
                  </AppText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Unpin this message"
                    onPress={() => void handleTogglePin(m, false)}
                    hitSlop={10}
                    style={({ pressed }) => ({
                      minHeight: 32,
                      paddingHorizontal: 10,
                      borderRadius: radius.full,
                      backgroundColor: theme.surface2,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <AppText variant="label" style={{ color: theme.brandInk }}>
                      Unpin
                    </AppText>
                  </Pressable>
                </View>
                <MentionText
                  text={m.content}
                  numberOfLines={3}
                  baseStyle={{ ...BODY_TEXT, color: theme.foreground }}
                  highlightColor={theme.brand}
                />
              </View>
            ))}
          </ScrollView>
        )}
      </Sheet>

      {/* Full-screen photo viewer — tap anywhere to close. */}
      <Modal
        visible={viewerUrl !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setViewerUrl(null)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          onPress={() => setViewerUrl(null)}
          style={{ flex: 1, backgroundColor: palettes.dark.background }}
        >
          {viewerUrl ? (
            <Image
              source={{ uri: viewerUrl }}
              style={{ flex: 1 }}
              contentFit="contain"
            />
          ) : null}
        </Pressable>
      </Modal>

      {/* The composer's "+" menu wears the sheet's rows but keeps its own
          in-tree scrim: every choice hands off to another native surface in
          the same tick — the system photo picker, and the poll and
          availability composers' own Modals — and a Modal dismissing
          underneath any of them is how you get a picker that never appears.
          Everything else here is `Sheet`. */}
      {composerMenuOpen ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            justifyContent: "flex-end",
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => setComposerMenuOpen(false)}
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
          <Card
            elevation="floating"
            padded={false}
            style={{
              marginHorizontal: 12,
              marginBottom: Math.max(insets.bottom, 12),
              padding: 14,
              gap: 4,
            }}
          >
            <Sheet.Row
              icon="image"
              label="Photo"
              onPress={() => {
                setComposerMenuOpen(false);
                void handlePickPhoto();
              }}
            />
            <Sheet.Row
              icon="bar-chart-2"
              label="Poll"
              onPress={() => {
                setComposerMenuOpen(false);
                setPollOpen(true);
              }}
            />
            <Sheet.Row
              icon="calendar"
              label="When can everyone meet?"
              onPress={() => {
                setComposerMenuOpen(false);
                setAskWhenOpen(true);
              }}
            />
          </Card>
        </View>
      ) : null}

      {/* The long-press menu: quick reactions on top, then the actions. */}
      <Sheet
        visible={actionsMessage !== null}
        onClose={() => setActionsFor(null)}
      >
        <View style={{ gap: 12 }}>
          <AppText variant="caption" muted numberOfLines={2}>
            {actionsMessage?.content ?? ""}
          </AppText>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {REACTION_EMOJI.map((emoji) => {
              const mine = (
                (actionsMessage ? reactionsByMessage[actionsMessage.id] : []) ??
                []
              ).some((r) => r.user_id === userId && r.emoji === emoji);
              return (
                <Pressable
                  key={emoji}
                  accessibilityRole="button"
                  accessibilityLabel={
                    mine
                      ? `Remove your ${emoji} reaction`
                      : `React with ${emoji}`
                  }
                  onPress={() => {
                    const id = actionsMessage?.id;
                    setActionsFor(null);
                    if (id) void toggleReaction(id, emoji);
                  }}
                  style={({ pressed }) => ({
                    width: 48,
                    height: 48,
                    borderRadius: radius.control,
                    borderWidth: 1,
                    borderColor: mine ? theme.brand : theme.border,
                    backgroundColor: mine ? theme.brandSoft : theme.surface2,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <AppText style={{ fontSize: 22, lineHeight: 28 }}>
                    {emoji}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          <View style={{ height: 1, backgroundColor: theme.border }} />
        </View>
        <Sheet.Row
          icon="corner-down-right"
          label="Reply in thread"
          onPress={() => {
            const id = actionsMessage?.id;
            setActionsFor(null);
            if (id) openThread(id);
          }}
        />
        {/* A poll carrier's words are the question, and the poll itself
            doesn't travel — so there's nothing honest to forward. */}
        {actionsMessage && !actionsMessage.poll_id ? (
          <Sheet.Row
            icon="corner-up-right"
            label="Forward"
            onPress={() => {
              const target = actionsMessage;
              setActionsFor(null);
              setForwardFor(target);
            }}
          />
        ) : null}
        <Sheet.Row
          icon="bookmark"
          label={actionsMessage?.pinned_at ? "Unpin" : "Pin message"}
          onPress={() => {
            const target = actionsMessage;
            setActionsFor(null);
            if (target) void handleTogglePin(target, !target.pinned_at);
          }}
        />
        <Sheet.Row
          icon="star"
          label={
            actionsMessage && savedIds.has(actionsMessage.id)
              ? "Remove from saved"
              : "Save message"
          }
          onPress={() => {
            const id = actionsMessage?.id;
            if (!id) return;
            const save = !savedIds.has(id);
            setActionsFor(null);
            void handleToggleSaved(id, save);
          }}
        />
        {actionsMessage &&
        actionsMessage.author_id === userId &&
        !actionsMessage.poll_id ? (
          <Sheet.Row
            icon="edit-2"
            label="Edit"
            onPress={() => {
              const target = actionsMessage;
              setActionsFor(null);
              startEdit(target);
            }}
          />
        ) : null}
        {actionsMessage && actionsMessage.author_id === userId ? (
          <Sheet.Row
            icon="trash-2"
            label="Delete"
            danger
            onPress={() => {
              const target = actionsMessage;
              setActionsFor(null);
              void handleDelete(target);
            }}
          />
        ) : null}
      </Sheet>

      <ForwardPicker
        visible={forwardFor !== null}
        source={forwardSource}
        exclude={forwardExclude}
        blocked={blocked}
        liftForKeyboard
        onClose={() => setForwardFor(null)}
        onFinished={showForwardNote}
      />
    </View>
  );
}
