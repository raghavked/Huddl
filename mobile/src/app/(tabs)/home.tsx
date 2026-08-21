import Feather from "@expo/vector-icons/Feather";
import { router, useFocusEffect } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
} from "react";
import {
  Animated,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  View,
  type ListRenderItemInfo,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FocusStrip } from "@/components/focus-strip";
import { Mug, type IllustrationProps } from "@/components/illustrations";
import { RoomTile } from "@/components/room-tile";
import {
  AppText,
  Button,
  Card,
  SectionLabel,
  useReducedMotion,
} from "@/components/ui";
import { motion, radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useUnreadNotifications } from "@/hooks/use-unread";
import { fetchBlockedIds } from "@/lib/blocks";
import { categoryInfo, fetchBoard, type BoardPost } from "@/lib/board";
import { membersLabel } from "@/lib/communities";
import { roomTitle } from "@/lib/room-identity";
import { buildPlan, toPlanKind, type PlanItem } from "@/lib/study-plan";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many open board posts the front door previews before "See all". */
const BOARD_PREVIEW = 3;

/** How many communities the front door previews before "See all". */
const COMMUNITIES_PREVIEW = 3;

/* ---- local row types (mirror the web home's query shapes) ---- */

type CourseInfo = { id: string; code: string; title: string };

type ChannelRow = {
  id: string;
  kind: "campus" | "course" | "topic";
  name: string;
  slug: string;
  course: CourseInfo | null;
};

type EventRow = {
  id: string;
  kind: "study_session" | "meetup";
  title: string;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
};

type MessagePreview = {
  content: string;
  created_at: string;
  author_id: string;
  author: { display_name: string } | null;
};

/** A community as the front door previews one: a name and a headcount. */
type CommunityPreview = { id: string; name: string; memberCount: number };

/** My membership extras per channel. The campus rows' unread dots hang off
    these (latest preview newer than my last_read_at, not mine, not muted). */
type MemberMeta = { lastReadAt: string; muted: boolean };

type MemberMetaRow = {
  channel_id: string;
  last_read_at: string;
  muted: boolean;
};

/* Rows feeding the "Your plan" card, built via buildPlan over the week
   around now (7 days back for missed deadlines, 7 days ahead). */
type EnrollmentJoin = {
  /** Set when the student has shelved the class (see 0028's `enrollments`). */
  archived_at: string | null;
  course: { id: string; code: string } | null;
};

type CalendarItemRow = {
  id: string;
  course_id: string;
  kind: string;
  title: string;
  due_at: string;
};

/** The plan card's three numbers. The score is deliberately the WEEK's: the
    same window `/plan` prints, so the two screens can't disagree. */
type PlanSummary = {
  /** Everything in the fetched window, however far out. Gates the card's copy. */
  total: number;
  /** Items due between a week ago and the end of this week. */
  weekTotal: number;
  /** Checked off among those. */
  weekHandled: number;
  nextUp: { courseCode: string; title: string; dueAt: Date } | null;
};

/** What's still on deck today, skimmed from the same plan fetch. The Today
    strip renders only when there's something here or an event tonight. */
type TodaySummary = { dueCount: number; firstDueTitle: string | null };

type HomeData = {
  firstName: string;
  campusChannels: ChannelRow[];
  courseChannels: ChannelRow[];
  events: EventRow[];
  previews: Record<string, MessagePreview>;
  memberMeta: Record<string, MemberMeta>;
  plan: PlanSummary;
  today: TodaySummary;
  /** The newest open board posts, or null when the board didn't load. Like
      the communities below, it may come back missing instead of failing the
      screen. */
  board: BoardPost[] | null;
  /** The newest communities, or null when they didn't load. Same bargain as
      the board: a doorway that didn't open is no reason to bar the door. */
  communities: CommunityPreview[] | null;
  /** Everyone I've blocked. It travels with the rest of the data because
      hiding their content is the client's job (see `lib/blocks`), and the
      previews were fetched against this exact set. Keeping the two apart is
      how the front door ends up quoting someone the rooms already hide. */
  blocked: Set<string>;
};

type FeatherName = ComponentProps<typeof Feather>["name"];

type CourseCell = { channel: ChannelRow; preview: MessagePreview | null };

type RowAction = { label: string; onPress: () => void };

type ListRow =
  | { type: "label"; key: string; text: string; action?: RowAction }
  | {
      type: "campus";
      key: string;
      channel: ChannelRow;
      preview: MessagePreview | null;
      unread: boolean;
    }
  | { type: "courses"; key: string; left: CourseCell; right: CourseCell | null }
  | { type: "event"; key: string; event: EventRow }
  | { type: "board"; key: string; posts: BoardPost[] }
  | { type: "communities"; key: string; communities: CommunityPreview[] }
  | {
      type: "empty";
      key: string;
      icon: FeatherName;
      title: string;
      body: string;
      action?: RowAction;
      /** A hand-drawn mark shown in place of the icon circle. */
      illustration?: ComponentType<IllustrationProps>;
    };

/* ---- time formatting, ported from the web's utils ---- */

function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const weekAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  if (d > weekAgo) {
    return d.toLocaleDateString([], {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatEventTime(startIso: string, endIso: string | null): string {
  const start = new Date(startIso);
  const datePart = start.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const startTime = start.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (!endIso) return `${datePart} · ${startTime}`;
  const endTime = new Date(endIso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart} · ${startTime}–${endTime}`;
}

function formatDueTime(d: Date): string {
  const day = d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

/* ---- the opening moment's words ---- */

/** "Morning" / "Afternoon" / "Evening" for the greeting's first word. */
function daypartGreeting(now: Date): "Morning" | "Afternoon" | "Evening" {
  const hour = now.getHours();
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

/** "PHYS 9B review tonight" / "Coffee hour at 3:00 PM" for the Today strip. */
function eventTodayPhrase(event: EventRow): string {
  const start = new Date(event.starts_at);
  if (start.getHours() >= 17) return `${event.title} tonight`;
  const time = start.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${event.title} at ${time}`;
}

/** One calm line from what today actually holds. Null means stay silent. */
function buildTodayLine(
  today: TodaySummary,
  event: EventRow | null
): string | null {
  const eventPart = event ? eventTodayPhrase(event) : null;
  if (today.dueCount > 0 && eventPart) {
    return `${today.dueCount} due · ${eventPart}`;
  }
  if (today.dueCount > 0) {
    return today.firstDueTitle
      ? `${today.dueCount} due today · ${today.firstDueTitle}`
      : `${today.dueCount} due today`;
  }
  return eventPart;
}

/* ---- section pieces ---- */

/** The "today at a glance" strip. It only exists when today holds something. */
function TodayCard({ line }: { line: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Today: ${line}`}
      onPress={() => router.push("/calendar")}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card
        padded={false}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.close,
          paddingHorizontal: space.card,
          paddingVertical: space.close,
          minHeight: 64,
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.control,
            backgroundColor: theme.accentSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather name="calendar" size={18} color={theme.accent} />
        </View>
        <AppText variant="bodySemi" numberOfLines={1} style={{ flex: 1 }}>
          {line}
        </AppText>
        <Feather name="chevron-right" size={18} color={theme.muted} />
      </Card>
    </Pressable>
  );
}

/** The study-plan doorway: next thing due, this week's score, one tap in. */
function PlanCard({ plan }: { plan: PlanSummary }) {
  const theme = useTheme();
  const hasItems = plan.total > 0;
  const line = !hasItems
    ? "Plan your week"
    : plan.nextUp
      ? `Next up: ${plan.nextUp.courseCode} ${plan.nextUp.title}`
      : "All handled. Nothing hanging over you";
  // Named window, always: an unlabelled score is the reason Home and /plan
  // could print two different fractions of the same term.
  const score =
    plan.weekTotal > 0
      ? `${plan.weekHandled} of ${plan.weekTotal} handled this week`
      : "Nothing due this week";
  const caption = !hasItems
    ? "Import a syllabus and every due date lands here."
    : plan.nextUp
      ? `${plan.nextUp.dueAt.getTime() < Date.now() ? "Was due" : "Due"} ${formatDueTime(
          plan.nextUp.dueAt
        )} · ${score}`
      : score;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Your plan"
      onPress={() => router.push("/plan")}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card
        padded={false}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.close,
          paddingHorizontal: space.card,
          paddingVertical: space.close,
          minHeight: 64,
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.control,
            backgroundColor: theme.brandSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather name="check-circle" size={18} color={theme.brand} />
        </View>
        <View style={{ flex: 1, gap: space.hair }}>
          <AppText variant="bodySemi" numberOfLines={1}>
            {line}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {caption}
          </AppText>
        </View>
        <Feather name="chevron-right" size={18} color={theme.muted} />
      </Card>
    </Pressable>
  );
}

function EmptySection({
  icon,
  title,
  body,
  action,
  illustration: Illustration,
}: {
  icon: FeatherName;
  title: string;
  body: string;
  action?: RowAction;
  illustration?: ComponentType<IllustrationProps>;
}) {
  const theme = useTheme();
  return (
    <Card
      style={{
        alignItems: "center",
        gap: space.snug,
        paddingVertical: space.chapter,
        borderStyle: "dashed",
      }}
    >
      {Illustration ? (
        <Illustration size={72} color={theme.muted} softColor={theme.surface2} />
      ) : (
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.full,
            backgroundColor: theme.brandSoft,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: space.hair,
          }}
        >
          <Feather name={icon} size={18} color={theme.brand} />
        </View>
      )}
      <AppText variant="bodySemi">{title}</AppText>
      <AppText
        variant="caption"
        muted
        style={{ textAlign: "center", maxWidth: 260 }}
      >
        {body}
      </AppText>
      {action ? (
        <Button
          label={action.label}
          variant="soft"
          size="sm"
          style={{ marginTop: space.snug }}
          onPress={action.onPress}
        />
      ) : null}
    </Card>
  );
}

function CampusRow({
  channel,
  preview,
  unread,
}: {
  channel: ChannelRow;
  preview: MessagePreview | null;
  unread: boolean;
}) {
  const theme = useTheme();
  const authorFirst =
    preview?.author?.display_name.trim().split(/\s+/)[0] ?? "Someone";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/channel/${channel.id}`)}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card
        padded={false}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.close,
          paddingHorizontal: space.card,
          paddingVertical: space.close,
          minHeight: 64,
        }}
      >
        <RoomTile
          kind={channel.kind}
          name={channel.name}
          slug={channel.slug}
          size={32}
        />
        <View style={{ flex: 1, gap: space.hair }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: space.cosy,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.snug,
                flexShrink: 1,
              }}
            >
              <AppText
                variant="bodySemi"
                numberOfLines={1}
                style={{ flexShrink: 1 }}
              >
                {roomTitle(channel.name, channel.slug)}
              </AppText>
              {unread ? (
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: radius.full,
                    backgroundColor: theme.brand,
                  }}
                />
              ) : null}
            </View>
            {preview ? (
              <AppText variant="caption" muted>
                {formatMessageTime(preview.created_at)}
              </AppText>
            ) : null}
          </View>
          {preview ? (
            <AppText variant="caption" muted numberOfLines={1}>
              <AppText variant="label">{authorFirst}: </AppText>
              {preview.content.replace(/\s+/g, " ")}
            </AppText>
          ) : (
            <AppText variant="caption" muted numberOfLines={1}>
              No messages yet. Say hi.
            </AppText>
          )}
        </View>
      </Card>
    </Pressable>
  );
}

function CourseCard({ channel, preview }: CourseCell) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/channel/${channel.id}`)}
      style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.85 : 1 })}
    >
      <Card
        padded={false}
        style={{
          flex: 1,
          gap: space.tight,
          padding: space.card,
          minHeight: 88,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.snug,
          }}
        >
          <Feather name="book-open" size={15} color={theme.brand} />
          <AppText
            variant="bodySemi"
            numberOfLines={1}
            style={{ flexShrink: 1 }}
          >
            {channel.course?.code ?? channel.name}
          </AppText>
        </View>
        {channel.course?.title ? (
          <AppText variant="caption" muted numberOfLines={1}>
            {channel.course.title}
          </AppText>
        ) : null}
        <AppText
          variant="caption"
          muted
          style={{ marginTop: "auto", paddingTop: space.tight }}
        >
          {preview
            ? `Active ${formatMessageTime(preview.created_at)}`
            : "No messages yet"}
        </AppText>
      </Card>
    </Pressable>
  );
}

function EventCard({ event }: { event: EventRow }) {
  const theme = useTheme();
  const isStudy = event.kind === "study_session";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/event/${event.id}`)}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card
        padded={false}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.close,
          paddingHorizontal: space.card,
          paddingVertical: space.close,
          minHeight: 64,
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.control,
            backgroundColor: theme.accentSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather name="calendar" size={18} color={theme.accent} />
        </View>
        <View style={{ flex: 1, gap: space.hair }}>
          <AppText variant="bodySemi" numberOfLines={1}>
            {event.title}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {formatEventTime(event.starts_at, event.ends_at)}
            {event.location ? ` · ${event.location}` : ""}
          </AppText>
        </View>
        <View
          style={{
            paddingHorizontal: space.room,
            paddingVertical: 3,
            borderRadius: radius.full,
            backgroundColor: isStudy ? theme.accentSoft : theme.brandSoft,
          }}
        >
          <AppText
            variant="label"
            style={{ color: isStudy ? theme.accent : theme.brandInk }}
          >
            {isStudy ? "Study" : "Meetup"}
          </AppText>
        </View>
      </Card>
    </Pressable>
  );
}

/**
 * The campus board's front door: the newest few open posts, each with the
 * board it's on, or one warm line when nobody's asking for anything. The whole
 * card is the tap target. A single post's row would promise its own screen,
 * and this preview is a doorway to the list, not to a post.
 */
function BoardCard({ posts }: { posts: BoardPost[] }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Campus board"
      onPress={() => router.push("/board")}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card padded={false} style={{ minHeight: 64 }}>
        {posts.length === 0 ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.room,
              paddingHorizontal: space.card,
              paddingVertical: space.close,
              minHeight: 64,
            }}
          >
            <Feather name="clipboard" size={15} color={theme.brand} />
            <AppText variant="caption" muted style={{ flex: 1 }}>
              Nothing on the board right now. A ride home, a couch to give
              away, a lost water bottle all start here.
            </AppText>
          </View>
        ) : (
          posts.map((post, index) => {
            const info = categoryInfo(post.category);
            return (
              <View
                key={post.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.room,
                  paddingHorizontal: space.card,
                  paddingVertical: space.room,
                  minHeight: 48,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: theme.border,
                }}
              >
                <Feather name={info.icon} size={15} color={theme.brand} />
                <AppText
                  variant="bodyMedium"
                  numberOfLines={1}
                  style={{ flex: 1 }}
                >
                  {post.title}
                </AppText>
                <AppText variant="caption" muted>
                  {info.label}
                </AppText>
              </View>
            );
          })
        )}
      </Card>
    </Pressable>
  );
}

/**
 * The communities' front door, drawn the way the board's is: the newest few
 * spaces, each a name and a headcount, or one warm line when nobody has
 * started one. The whole card is the tap target, a doorway to the list.
 */
function CommunitiesCard({
  communities,
}: {
  communities: CommunityPreview[];
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Communities"
      onPress={() => router.push("/communities")}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card padded={false} style={{ minHeight: 64 }}>
        {communities.length === 0 ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.room,
              paddingHorizontal: space.card,
              paddingVertical: space.close,
              minHeight: 64,
            }}
          >
            <Feather name="globe" size={15} color={theme.brand} />
            <AppText variant="caption" muted style={{ flex: 1 }}>
              No communities yet. Start the first one.
            </AppText>
          </View>
        ) : (
          communities.map((community, index) => (
            <View
              key={community.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.room,
                paddingHorizontal: space.card,
                paddingVertical: space.room,
                minHeight: 48,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: theme.border,
              }}
            >
              <Feather name="globe" size={15} color={theme.brand} />
              <AppText
                variant="bodyMedium"
                numberOfLines={1}
                style={{ flex: 1 }}
              >
                {community.name}
              </AppText>
              <AppText variant="caption" muted>
                {membersLabel(community.memberCount)}
              </AppText>
            </View>
          ))
        )}
      </Card>
    </Pressable>
  );
}

/**
 * The newest readable message in each of these channels, keyed by channel id.
 *
 * One tiny indexed lookup per channel, all in flight together: the same shape
 * the first load uses, cheap enough to re-run every time Home comes back into
 * view, which is what makes an unread dot able to APPEAR rather than only to
 * clear. A channel with nothing in it is simply absent.
 *
 * "Readable" includes the block list: a blocked classmate is excluded in the
 * query rather than dropped from the answer, so the row falls back to the
 * newest message you can actually read instead of going quiet. The unread
 * dot, which hangs off this same preview, stops lighting up for someone whose
 * messages the room itself won't show you.
 *
 * Failures are silent per channel: a preview that didn't come back leaves the
 * row without a subtitle, which is not worth an error state on the front door.
 */
async function fetchPreviews(
  channels: readonly ChannelRow[],
  blocked: ReadonlySet<string>
): Promise<Record<string, MessagePreview>> {
  const hidden = [...blocked];
  const previews: Record<string, MessagePreview> = {};
  await Promise.all(
    channels.map(async (channel) => {
      let query = supabase
        .from("messages")
        .select("content, created_at, author_id, author:profiles!messages_author_id_fkey(display_name)")
        .eq("channel_id", channel.id)
        .is("deleted_at", null);
      // `not.in.()` is not a filter PostgREST will take, so an empty block
      // list simply doesn't add one.
      if (hidden.length > 0) {
        query = query.not("author_id", "in", `(${hidden.join(",")})`);
      }
      const { data: preview } = await query
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (preview) {
        previews[channel.id] = preview as unknown as MessagePreview;
      }
    })
  );
  return previews;
}

/** Quiet surface2 blocks mirroring the real layout while home loads. */
function HomeGhosts() {
  const theme = useTheme();
  const block = (height: number): ViewStyle => ({
    height,
    borderRadius: radius.card,
    backgroundColor: theme.surface2,
  });
  const labelBar: ViewStyle = {
    width: 112,
    height: 12,
    borderRadius: radius.full,
    backgroundColor: theme.surface2,
    marginTop: space.chapter,
    marginBottom: space.close,
  };
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={block(64)} />
      <View style={labelBar} />
      <View style={[block(64), { marginBottom: space.close }]} />
      <View style={block(64)} />
      <View style={labelBar} />
      <View style={{ flexDirection: "row", gap: space.close }}>
        <View style={[block(88), { flex: 1 }]} />
        <View style={[block(88), { flex: 1 }]} />
      </View>
      <View style={labelBar} />
      <View style={block(64)} />
    </View>
  );
}

/* ---- screen ---- */

export default function HomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { count: unreadCount, refresh: refreshUnread } =
    useUnreadNotifications();

  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One calm settle when the first data lands: opacity 0→1, translateY 8→0.
  const entrance = useRef(new Animated.Value(0)).current;
  const entranceRan = useRef(false);
  const reduceMotion = useReducedMotion();

  const fetchHome = useCallback(async (): Promise<HomeData> => {
    if (!userId) throw new Error("Not signed in");

    // The block list rides in the opening trip because both the previews and
    // the board preview are cut against it. It is the one piece here that
    // must not fail soft: an empty set would quietly put a blocked classmate
    // back on the front door, and a trip that couldn't reach `blocks` is a
    // trip where "try again" is the honest answer anyway.
    const [profileRes, membershipRes, enrollmentRes, blocked] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("display_name, handle, university_id")
          .eq("id", userId)
          .single(),
        supabase
          .from("channel_members")
          .select(
            "channel_id, last_read_at, muted, channel:channels(id, kind, name, slug, course:courses(id, code, title))"
          )
          .eq("user_id", userId),
        supabase
          .from("enrollments")
          .select("archived_at, course:courses(id, code)")
          .eq("user_id", userId),
        fetchBlockedIds(userId),
      ]);
    if (profileRes.error) throw profileRes.error;
    if (membershipRes.error) throw membershipRes.error;
    if (enrollmentRes.error) throw enrollmentRes.error;

    const profile = profileRes.data as unknown as {
      display_name: string;
      handle: string;
      university_id: string;
    };

    const membershipRows = (membershipRes.data ?? []) as unknown as
      (MemberMetaRow & { channel: ChannelRow | null })[];

    const myChannels = membershipRows
      .map((row) => row.channel)
      .filter((c): c is ChannelRow => Boolean(c));

    const memberMeta: Record<string, MemberMeta> = {};
    for (const row of membershipRows) {
      memberMeta[row.channel_id] = {
        lastReadAt: row.last_read_at,
        muted: row.muted,
      };
    }

    const enrollmentRows = (enrollmentRes.data ?? []) as unknown as
      EnrollmentJoin[];

    // Shelving a class leaves its chat membership alone, so the grid has to
    // do the filtering: last quarter's rooms stay reachable from /courses,
    // they just stop taking up the front door.
    const archivedCourseIds = new Set(
      enrollmentRows
        .filter((row) => row.archived_at !== null)
        .map((row) => row.course?.id)
        .filter((id): id is string => typeof id === "string")
    );

    const campusChannels = myChannels
      .filter((c) => c.kind === "campus")
      .sort((a, b) => a.slug.localeCompare(b.slug));
    const courseChannels = myChannels
      .filter((c) => c.kind === "course")
      .filter((c) => !c.course || !archivedCourseIds.has(c.course.id))
      .sort((a, b) =>
        (a.course?.code ?? a.name).localeCompare(b.course?.code ?? b.name)
      );

    // The campus board rides along with the events query. It is the one piece
    // of Home that swallows its own failure: `fetchBoard` throws warm copy,
    // but a board that didn't load is no reason for the front door not to
    // open, so it resolves to null and the card simply isn't drawn. RLS scopes
    // the read to this campus, which is why there's no university to pass.
    const [eventsRes, board, communitiesRes] = await Promise.all([
      supabase
        .from("events")
        .select("id, kind, title, location, starts_at, ends_at")
        .eq("university_id", profile.university_id)
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true })
        .limit(4),
      fetchBoard({ limit: BOARD_PREVIEW }).catch(
        (): BoardPost[] | null => null
      ),
      // Communities make the same bargain the board does: campus-scoped by
      // RLS, and a failed fetch costs the card, never the front door.
      supabase
        .from("communities")
        .select("id, name, community_members(count)")
        .order("created_at", { ascending: false })
        .limit(COMMUNITIES_PREVIEW),
    ]);
    if (eventsRes.error) throw eventsRes.error;
    const events = (eventsRes.data ?? []) as unknown as EventRow[];

    // `community_members(count)` arrives as [{ count }] beside each row.
    const communities: CommunityPreview[] | null = communitiesRes.error
      ? null
      : (
          (communitiesRes.data ?? []) as unknown as {
            id: string;
            name: string;
            community_members: { count: number }[];
          }[]
        ).map((row) => ({
          id: row.id,
          name: row.name,
          memberCount: row.community_members?.[0]?.count ?? 0,
        }));

    // The plan card's week: class-calendar items from 7 days back (missed
    // deadlines still count) through 7 days ahead, scored against my
    // check-offs by the same pure buildPlan the full screen uses.
    // Active classes only, exactly as /plan scopes it. A shelved course
    // keeps its history, but last quarter's due dates have no business in
    // this card. Counting them makes Home promise "2 due today" over a plan
    // screen that shows nothing.
    const enrolledCourses = enrollmentRows
      .filter((row) => row.archived_at === null)
      .map((row) => row.course)
      .filter((c): c is { id: string; code: string } => c !== null);
    let plan: PlanSummary = {
      total: 0,
      weekTotal: 0,
      weekHandled: 0,
      nextUp: null,
    };
    let today: TodaySummary = { dueCount: 0, firstDueTitle: null };
    if (enrolledCourses.length > 0) {
      const now = new Date();
      const codeById = new Map(enrolledCourses.map((c) => [c.id, c.code]));
      const [calendarRes, checkoffsRes] = await Promise.all([
        supabase
          .from("course_calendar_items")
          .select("id, course_id, kind, title, due_at")
          .in("course_id", [...codeById.keys()])
          .gte("due_at", new Date(now.getTime() - 7 * DAY_MS).toISOString())
          .lte("due_at", new Date(now.getTime() + 7 * DAY_MS).toISOString())
          .order("due_at", { ascending: true }),
        supabase.from("study_checkoffs").select("item_id").eq("user_id", userId),
      ]);
      if (calendarRes.error) throw calendarRes.error;
      if (checkoffsRes.error) throw checkoffsRes.error;
      const planItems = (
        (calendarRes.data ?? []) as unknown as CalendarItemRow[]
      ).map(
        (row): PlanItem => ({
          id: row.id,
          courseCode: codeById.get(row.course_id) ?? "Course",
          kind: toPlanKind(row.kind),
          title: row.title,
          dueAt: new Date(row.due_at),
        })
      );
      const checkoffs = new Set(
        ((checkoffsRes.data ?? []) as unknown as { item_id: string }[]).map(
          (row) => row.item_id
        )
      );
      const { groups, stats } = buildPlan(planItems, checkoffs, now);
      plan = {
        total: stats.total,
        weekTotal: stats.weekTotal,
        weekHandled: stats.weekHandled,
        nextUp: stats.nextUp
          ? {
              courseCode: stats.nextUp.courseCode,
              title: stats.nextUp.title,
              dueAt: stats.nextUp.dueAt,
            }
          : null,
      };
      // The Today strip skims the same plan: what's still ahead of me today
      // and unhandled. No extra queries, and silence when the day is clear.
      const dueToday =
        groups
          .find((g) => g.label === "Today")
          ?.entries.filter((e) => !e.done) ?? [];
      const firstDue = dueToday[0];
      today = {
        dueCount: dueToday.length,
        firstDueTitle: firstDue
          ? `${firstDue.courseCode} ${firstDue.title}`
          : null,
      };
    }

    const previews = await fetchPreviews(
      [...campusChannels, ...courseChannels],
      blocked
    );

    const firstName =
      profile.display_name.trim().split(/\s+/)[0] || profile.handle;

    return {
      firstName,
      campusChannels,
      courseChannels,
      events,
      previews,
      memberMeta,
      plan,
      today,
      board,
      communities,
      blocked,
    };
  }, [userId]);

  /**
   * `initial` shows the ghosts, `refresh` drives the pull-to-refresh spinner,
   * and `silent` re-fetches with no visible machinery, for the refresh nobody
   * asked for when the app comes back to the foreground.
   */
  const run = useCallback(
    async (mode: "initial" | "refresh" | "silent") => {
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      try {
        setData(await fetchHome());
        setError(null);
      } catch {
        setError("We couldn't load your campus right now.");
      } finally {
        if (mode === "initial") setLoading(false);
        if (mode === "refresh") setRefreshing(false);
      }
    },
    [fetchHome]
  );

  useEffect(() => {
    if (!userId) return;
    void run("initial");
  }, [userId, run]);

  // The entrance runs exactly once, on first data. It's an arrival, so it
  // lands on the out-curve. It lands there instantly when the student has
  // asked the OS for less movement.
  useEffect(() => {
    if (!data || entranceRan.current) return;
    entranceRan.current = true;
    Animated.timing(entrance, {
      toValue: 1,
      duration: reduceMotion ? motion.instant : motion.base,
      easing: motion.easing.enter,
      useNativeDriver: true,
    }).start();
  }, [data, entrance, reduceMotion]);

  /* The channel list, kept where a callback can reach it without being
     rebuilt every time Home's data changes. */
  const channelsRef = useRef<ChannelRow[]>([]);
  useEffect(() => {
    channelsRef.current = data
      ? [...data.campusChannels, ...data.courseChannels]
      : [];
  }, [data]);

  /**
   * Both halves of an unread dot, re-pulled together.
   *
   * A dot is "the newest message is newer than my last_read_at", so refreshing
   * only the membership rows can move `lastReadAt` forward and never move the
   * message. The dot could clear but could never appear. Opening a channel
   * bumps `last_read_at` (the room screen's job) and messages arrive while
   * Home sits there, so both sides have to come back from the same trip.
   *
   * The block list comes along for the same reason the board screen re-pulls
   * it on focus: a block made from someone's profile has to take hold the
   * moment you step back here, and the previews have to be asked for against
   * the set they'll be rendered under. A trip that didn't come back leaves
   * Home exactly as it was.
   */
  const refreshUnreadDots = useCallback(async () => {
    if (!userId) return;
    const channels = channelsRef.current;
    const [metaRes, blocked] = await Promise.all([
      supabase
        .from("channel_members")
        .select("channel_id, last_read_at, muted")
        .eq("user_id", userId),
      fetchBlockedIds(userId).catch((): Set<string> | null => null),
    ]);
    if (metaRes.error || !blocked) return;
    const previews = await fetchPreviews(channels, blocked);
    const memberMeta: Record<string, MemberMeta> = {};
    for (const row of (metaRes.data ?? []) as unknown as MemberMetaRow[]) {
      memberMeta[row.channel_id] = {
        lastReadAt: row.last_read_at,
        muted: row.muted,
      };
    }
    setData((prev) => {
      if (!prev) return prev;
      // The first focus can land before the first load, with no channels to
      // ask about yet. Don't let that empty answer erase real previews.
      if (channels.length === 0) return { ...prev, memberMeta, blocked };
      return { ...prev, memberMeta, previews, blocked };
    });
  }, [userId]);

  // Coming back from the inbox: rows marked read arrive as UPDATEs, which the
  // count subscription ignores, so re-count whenever the tab regains focus.
  useFocusEffect(
    useCallback(() => {
      refreshUnread();
      void refreshUnreadDots();
    }, [refreshUnread, refreshUnreadDots])
  );

  /* Focus is not foreground. Lock the phone on Home and Home never blurs, so
     `useFocusEffect` never fires again. The front door still shows whatever
     was true when the screen was locked. Coming back from the background is
     the other moment everything on this page can be stale, so it gets the
     same treatment, quietly and without a spinner. */
  useEffect(() => {
    if (!userId) return;
    let away = false;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        away = true;
        return;
      }
      if (!away) return;
      away = false;
      refreshUnread();
      void run("silent");
    });
    return () => sub.remove();
  }, [userId, run, refreshUnread]);

  const rows = useMemo<ListRow[]>(() => {
    if (!data) return [];
    const out: ListRow[] = [];

    out.push({ type: "label", key: "label-campus", text: "Your campus" });
    if (data.campusChannels.length === 0) {
      out.push({
        type: "empty",
        key: "empty-campus",
        icon: "coffee",
        illustration: Mug,
        title: "No campus rooms yet",
        body: "Campus rooms usually come free with your profile. They'll show up here soon.",
      });
    } else {
      for (const channel of data.campusChannels) {
        const preview = data.previews[channel.id] ?? null;
        const meta = data.memberMeta[channel.id];
        out.push({
          type: "campus",
          key: `campus-${channel.id}`,
          channel,
          preview,
          // Unread = the latest message is newer than my last_read_at and not
          // mine; a muted channel never shows a dot.
          unread: Boolean(
            preview &&
              meta &&
              !meta.muted &&
              preview.author_id !== userId &&
              new Date(preview.created_at).getTime() >
                new Date(meta.lastReadAt).getTime()
          ),
        });
      }
    }

    out.push({
      type: "label",
      key: "label-courses",
      text: "Your courses",
      action: { label: "Manage", onPress: () => router.push("/courses") },
    });
    if (data.courseChannels.length === 0) {
      out.push({
        type: "empty",
        key: "empty-courses",
        icon: "book-open",
        title: "No courses yet",
        body: "Add your classes and you'll get a chat channel for every one.",
        action: {
          label: "Add your courses",
          onPress: () => router.push("/courses/add"),
        },
      });
    } else {
      for (let i = 0; i < data.courseChannels.length; i += 2) {
        const left = data.courseChannels[i];
        const right = data.courseChannels[i + 1] ?? null;
        out.push({
          type: "courses",
          key: `courses-${left.id}`,
          left: { channel: left, preview: data.previews[left.id] ?? null },
          right: right
            ? { channel: right, preview: data.previews[right.id] ?? null }
            : null,
        });
      }
    }

    out.push({
      type: "label",
      key: "label-events",
      text: "Coming up",
      action: { label: "Calendar", onPress: () => router.push("/calendar") },
    });
    if (data.events.length === 0) {
      out.push({
        type: "empty",
        key: "empty-events",
        icon: "calendar",
        title: "Nothing on the calendar yet",
        body: "When someone plans a study session or meetup, it'll land right here.",
      });
    } else {
      for (const event of data.events) {
        out.push({ type: "event", key: `event-${event.id}`, event });
      }
    }

    // Communities sit with the board at the bottom of the page: both are
    // places you browse rather than things waiting on you, at the same
    // prominence. A card that didn't load draws nothing at all.
    if (data.communities !== null) {
      out.push({
        type: "label",
        key: "label-communities",
        text: "Communities",
        action: { label: "See all", onPress: () => router.push("/communities") },
      });
      out.push({
        type: "communities",
        key: "communities",
        communities: data.communities,
      });
    }

    if (data.board !== null) {
      out.push({
        type: "label",
        key: "label-board",
        text: "Campus board",
        action: { label: "See all", onPress: () => router.push("/board") },
      });
      // Same cut the board screen makes: somebody you blocked doesn't get a
      // slot on the front door either. Dropping their post can leave the
      // preview short, or empty. Empty is the card's warm line, which is the
      // right thing to read.
      out.push({
        type: "board",
        key: "board",
        posts: data.board.filter((post) => !data.blocked.has(post.author_id)),
      });
    }

    return out;
  }, [data, userId]);

  const renderItem = useCallback(({ item }: ListRenderItemInfo<ListRow>) => {
    switch (item.type) {
      case "label":
        return <SectionLabel text={item.text} action={item.action} />;
      case "campus":
        return (
          <View style={{ marginBottom: space.close }}>
            <CampusRow
              channel={item.channel}
              preview={item.preview}
              unread={item.unread}
            />
          </View>
        );
      case "courses":
        return (
          <View
            style={{
              flexDirection: "row",
              gap: space.close,
              marginBottom: space.close,
            }}
          >
            <CourseCard
              channel={item.left.channel}
              preview={item.left.preview}
            />
            {item.right ? (
              <CourseCard
                channel={item.right.channel}
                preview={item.right.preview}
              />
            ) : (
              <View style={{ flex: 1 }} />
            )}
          </View>
        );
      case "event":
        return (
          <View style={{ marginBottom: space.close }}>
            <EventCard event={item.event} />
          </View>
        );
      case "board":
        return (
          <View style={{ marginBottom: space.close }}>
            <BoardCard posts={item.posts} />
          </View>
        );
      case "communities":
        return (
          <View style={{ marginBottom: space.close }}>
            <CommunitiesCard communities={item.communities} />
          </View>
        );
      case "empty":
        return (
          <EmptySection
            icon={item.icon}
            title={item.title}
            body={item.body}
            action={item.action}
            illustration={item.illustration}
          />
        );
    }
  }, []);

  const now = new Date();
  const dateLine = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const greeting = data ? `${daypartGreeting(now)}, ${data.firstName}` : "Home";

  // Today's strip: due items from the plan fetch + the first event that lands
  // today, all data home already has in hand. No line, no card.
  const todayLine = useMemo(() => {
    if (!data) return null;
    const todayStamp = new Date().toDateString();
    const todayEvent =
      data.events.find(
        (e) => new Date(e.starts_at).toDateString() === todayStamp
      ) ?? null;
    return buildTodayLine(data.today, todayEvent);
  }, [data]);

  /* Home builds its own header (instead of Screen's) for one reason: the
     greeting carries a quiet date line UNDER it, and Screen's title slot is a
     single line. The date sits below because a screen title stands on its
     own: an all-caps line above a heading reads as the heading. Metrics mirror
     Screen exactly (same safe-area padding, same margins), so the front door
     still feels like every room. */
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + space.close,
        paddingHorizontal: space.gutter,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: space.close,
          marginBottom: space.card,
        }}
      >
        <View style={{ flexShrink: 1, gap: space.hair }}>
          <AppText variant="display" numberOfLines={1}>
            {greeting}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {dateLine}
          </AppText>
        </View>
        {/* Three 44px targets, pulled 10px past the gutter so the icons sit
            optically on it and the greeting keeps the width their padding
            would otherwise take. */}
        <View
          style={{ flexDirection: "row", alignItems: "center", marginRight: -10 }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search campus"
            onPress={() => router.push("/search")}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Feather name="search" size={22} color={theme.muted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              unreadCount > 0 ? "Notifications, unread" : "Notifications"
            }
            onPress={() => router.push("/notifications")}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <View>
              <Feather name="bell" size={22} color={theme.muted} />
              {unreadCount > 0 ? (
                <View
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -2,
                    width: 10,
                    height: 10,
                    borderRadius: radius.full,
                    backgroundColor: theme.brand,
                    borderWidth: 2,
                    borderColor: theme.background,
                  }}
                />
              ) : null}
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={() => router.push("/settings")}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Feather name="settings" size={22} color={theme.muted} />
          </Pressable>
        </View>
      </View>
      {loading ? (
        <HomeGhosts />
      ) : error && !data ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: space.room,
            paddingBottom: 80,
          }}
        >
          <Feather name="cloud-off" size={28} color={theme.muted} />
          <AppText variant="bodySemi">Something went sideways</AppText>
          <AppText
            variant="caption"
            muted
            style={{ textAlign: "center", maxWidth: 260 }}
          >
            {error} Check your connection and give it another go.
          </AppText>
          <Button
            label="Try again"
            variant="soft"
            size="sm"
            onPress={() => void run("initial")}
          />
        </View>
      ) : (
        <Animated.View
          style={{
            flex: 1,
            opacity: entrance,
            transform: [
              {
                translateY: entrance.interpolate({
                  inputRange: [0, 1],
                  outputRange: [8, 0],
                }),
              },
            ],
          }}
        >
          <FlatList
            data={rows}
            keyExtractor={(row) => row.key}
            renderItem={renderItem}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View style={{ gap: space.close }}>
                {error ? (
                  <AppText variant="caption" style={{ color: theme.danger }}>
                    We couldn't refresh just now. Pull down to try again.
                  </AppText>
                ) : null}
                {todayLine ? <TodayCard line={todayLine} /> : null}
                {/* Renders nothing unless somebody else is heads-down right
                    now, so most mornings this line simply isn't here. */}
                <FocusStrip />
                {data ? <PlanCard plan={data.plan} /> : null}
              </View>
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  refreshUnread();
                  void run("refresh");
                }}
                tintColor={theme.brand}
                colors={[theme.brand]}
              />
            }
          />
        </Animated.View>
      )}
    </View>
  );
}
