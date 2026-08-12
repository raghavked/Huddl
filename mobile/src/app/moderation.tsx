import Feather from "@expo/vector-icons/Feather";
import { Redirect, router, useFocusEffect, type Href } from "expo-router";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  Animated,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import {
  Mug,
  Shoebox,
  Tray,
  type IllustrationProps,
} from "@/components/illustrations";
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  SkeletonRow,
  useReducedMotion,
} from "@/components/ui";
import { motion, radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { tapLight } from "@/lib/haptics";
import {
  amIModerator,
  categoryLabel,
  fetchQueue,
  fetchQueueCounts,
  fetchReportedContent,
  filedAgo,
  moveCount,
  ModerationError,
  reportSubject,
  setStatus,
  statusLabel,
  STATUSES,
  summarize,
  triageActions,
  type ModerationReport,
  type ReportedContent,
  type ReportStatus,
} from "@/lib/moderation";
import { useAuth } from "@/providers/auth-provider";

/* Reports — the moderation queue's front door.
 *
 * Reports have been piling up since migration 0015 with triage locked behind
 * the service role. 0034 hands a few students the key, and this is the room it
 * opens.
 *
 * Who this screen is for shapes everything on it: a volunteer, probably a
 * sophomore, reading what their own campus flagged, probably late, probably on
 * their phone in bed. So there are no dashboards, no throughput numbers, no
 * red. Three counts on three chips is all the arithmetic anyone needs, and
 * they're there to say "nothing's waiting" as often as they say "six are".
 *
 * The one thing the screen insists on is context. A moderator should be able to
 * decide without leaving: the category the reporter picked, what the subject
 * actually was, the reporter's reason IN FULL (that's the substance — nothing
 * here truncates it to a tidy line), and the reported words themselves quoted
 * in a well. When the subject can't be shown — deleted, or in a channel this
 * moderator never joined — the row says so in a sentence instead of leaving a
 * gap the reader has to interpret.
 *
 * Triage is optimistic and reversible. A tap starts the row leaving straight
 * away; the write goes out alongside it and the row is only really dropped once
 * both have landed. A refusal brings the row back with a warm line under it.
 * Nothing is a trapdoor: every row offers a way back to `open`, because a tired
 * tap at 1am shouldn't be a decision anyone has to live with.
 */

/** How long a triaged row takes to leave. One `motion.base`, then it's gone. */
const SETTLE_MS = motion.base;

/* ────────────────────────────── the well ────────────────────────────── */

/**
 * The recessed block that holds someone else's words. One step back from the
 * card it sits in, with a hairline, so a quote never reads as the moderator's
 * own text.
 */
function Well({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: space.snug,
        padding: space.close,
        borderRadius: radius.control,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.surface2,
      }}
    >
      {children}
    </View>
  );
}

/**
 * A reported message the queue query couldn't carry — a room this moderator
 * isn't in, or a direct message, which no moderator is ever a participant of.
 *
 * Deliberately behind a tap rather than loaded with the list. These are
 * private words, and the difference between "a screen that can show you a
 * reported message" and "a screen that pulls a hundred private messages out
 * of the database to draw a list" is exactly this button.
 */
function HiddenMessage({
  report,
  note,
}: {
  report: ModerationReport;
  note: string;
}) {
  const theme = useTheme();
  const [content, setContent] = useState<ReportedContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  const load = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const found = await fetchReportedContent(report.id);
      if (found) setContent(found);
      else setEmpty(true);
    } catch (caught) {
      setError(
        caught instanceof ModerationError
          ? caught.message
          : "We couldn't load what was reported. Give it another go."
      );
    } finally {
      setLoading(false);
    }
  }, [report.id, loading]);

  if (content) {
    return (
      <View style={{ gap: space.snug }}>
        <AppText variant="label" muted>
          {content.kind === "direct" ? "The direct message" : "What they said"}
        </AppText>
        <Well>
          <AppText>{content.content}</AppText>
          {content.deleted_at ? (
            <AppText variant="caption" muted>
              The author has taken this down since.
            </AppText>
          ) : null}
        </Well>
      </View>
    );
  }

  return (
    <View style={{ gap: space.cosy }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: space.snug,
        }}
      >
        <Feather
          name="eye-off"
          size={13}
          color={theme.muted}
          style={{ marginTop: space.hair }}
        />
        <AppText variant="caption" muted style={{ flex: 1 }}>
          {empty
            ? "That message has been deleted outright. The report is all that's left."
            : note}
        </AppText>
      </View>
      {empty ? null : (
        <Button
          label="Read the message"
          variant="secondary"
          size="sm"
          pending={loading}
          onPress={() => void load()}
        />
      )}
      {error ? (
        <AppText variant="caption" style={{ color: theme.danger }}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * What was reported, quoted — or a sentence saying where it went.
 *
 * A soft-deleted message keeps its content here on purpose: "they took it down
 * after being reported" is the most useful thing a moderator can know, and
 * hiding the words would leave them deciding on nothing.
 */
function Subject({ report }: { report: ModerationReport }) {
  const theme = useTheme();
  const subject = reportSubject(report);

  if (subject.kind === "gone") {
    /* A message we can't embed isn't necessarily a message we can't read.
       `messages` is channel-member-only and `dm_messages` is participant-only,
       so a moderator triaging a room they never joined — or any DM at all —
       used to be judging words they couldn't see. `reported_content()` is the
       one narrow way through, so offer it rather than the shrug. */
    if (subject.was === "message") {
      return <HiddenMessage report={report} note={subject.note} />;
    }
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: space.snug,
        }}
      >
        <Feather
          name="eye-off"
          size={13}
          color={theme.muted}
          style={{ marginTop: space.hair }}
        />
        <AppText variant="caption" muted style={{ flex: 1 }}>
          {subject.note}
        </AppText>
      </View>
    );
  }

  if (subject.kind === "message") {
    const { message } = subject;
    return (
      <View style={{ gap: space.snug }}>
        <AppText variant="label" muted>
          What they said
        </AppText>
        <Well>
          {message.channel ? (
            <AppText variant="caption" muted>
              #{message.channel.slug}
            </AppText>
          ) : null}
          <AppText>{message.content}</AppText>
          {message.deleted_at ? (
            <AppText variant="caption" muted>
              The author has taken this down since.
            </AppText>
          ) : null}
        </Well>
      </View>
    );
  }

  if (subject.kind === "post") {
    const { post } = subject;
    return (
      <View style={{ gap: space.snug }}>
        <AppText variant="label" muted>
          The post
        </AppText>
        <Well>
          <AppText variant="bodySemi">{post.title}</AppText>
          {post.body ? <AppText>{post.body}</AppText> : null}
          {post.closed_at ? (
            <AppText variant="caption" muted>
              The author has marked this sorted.
            </AppText>
          ) : null}
        </Well>
      </View>
    );
  }

  const { profile } = subject;
  return (
    <View style={{ gap: space.snug }}>
      <AppText variant="label" muted>
        Their profile
      </AppText>
      <Well>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.room,
          }}
        >
          <Avatar url={profile.avatar_url} name={profile.display_name} size={36} />
          <View style={{ flex: 1, gap: space.hair }}>
            <AppText variant="bodySemi" numberOfLines={1}>
              {profile.display_name}
            </AppText>
            <AppText variant="caption" muted numberOfLines={1}>
              @{profile.handle}
            </AppText>
          </View>
        </View>
        {profile.bio ? <AppText>{profile.bio}</AppText> : null}
      </Well>
    </View>
  );
}

/* ─────────────────────────────── the row ────────────────────────────── */

/**
 * Where tapping a report should take you: the room it happened in, the board
 * post, or the person. A report whose message sits in a channel this moderator
 * hasn't joined still leads somewhere useful — the reported student's profile —
 * so the row is only inert when there is genuinely nothing left to look at.
 */
function subjectRoute(report: ModerationReport): Href | null {
  const subject = reportSubject(report);
  if (subject.kind === "message" && subject.message.channel !== null) {
    return `/channel/${subject.message.channel.id}`;
  }
  if (subject.kind === "post") return `/board/${subject.post.id}`;
  if (subject.kind === "profile") return `/u/${subject.profile.handle}`;
  if (report.reported !== null) return `/u/${report.reported.handle}`;
  return null;
}

/**
 * One report, whole: what kind of thing was flagged, who flagged it and when,
 * why in their own words, the words themselves, and the two ways out.
 *
 * The settle is the only animation on the screen and it reports a completion —
 * the row you just triaged leaving the pile it's no longer in. It runs the
 * moment you tap, alongside the write rather than after it, so the tap feels
 * answered; a refusal retraces the same curve back and the row stays put.
 */
function ReportRow({
  report,
  index,
  now,
  settling,
  error,
  onTriage,
}: {
  report: ModerationReport;
  /** Position in the pile, for the staggered arrival. */
  index: number;
  now: Date;
  settling: boolean;
  error: string | null;
  onTriage: (next: ReportStatus) => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const settle = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(settle, {
      toValue: settling ? 0 : 1,
      duration: reduceMotion ? motion.instant : SETTLE_MS,
      // Reversible: a rollback comes back along the curve it left on.
      easing: motion.easing.standard,
      useNativeDriver: true,
    }).start();
  }, [settling, reduceMotion, settle]);

  const route = subjectRoute(report);
  const reporter = report.reporter?.display_name ?? "Someone on campus";
  const title = summarize(report);
  const actions = triageActions(report.status);

  return (
    <Animated.View
      pointerEvents={settling ? "none" : "auto"}
      style={{
        opacity: settle,
        transform: [
          {
            scale: settle.interpolate({
              inputRange: [0, 1],
              outputRange: [0.97, 1],
            }),
          },
        ],
      }}
    >
      <Card
        padded={false}
        entrance={index}
        style={{ marginBottom: space.close }}
      >
        <Pressable
          accessibilityRole={route ? "button" : "text"}
          accessibilityLabel={title}
          accessibilityHint={route ? "Opens what was reported." : undefined}
          disabled={route === null}
          onPress={() => {
            if (route) router.push(route);
          }}
          style={({ pressed }) => ({
            gap: space.room,
            padding: space.card,
            opacity: pressed && route !== null ? 0.7 : 1,
          })}
        >
          {/* The reporter's own pick, in their words. Brand, never danger —
              a category is what this is about, not a verdict on it. */}
          <Chip label={categoryLabel(report.category)} tone="brand" />

          {/* `summarize` folds a board post's whole title into this line, and
              a title can run long — the full one is quoted in the well below,
              so the headline is safe to cap. */}
          <AppText variant="bodySemi" numberOfLines={2}>
            {title}
          </AppText>

          <AppText variant="caption" muted numberOfLines={1}>
            Reported by {reporter} · {filedAgo(report, now)}
          </AppText>

          {/* The reporter's own words, in full. This is the substance of the
              report; a one-line preview would be the wrong economy. */}
          <AppText>{report.reason}</AppText>

          <Subject report={report} />
        </Pressable>

        <View
          style={{
            flexDirection: "row",
            gap: space.room,
            padding: space.close,
            borderTopWidth: 1,
            borderTopColor: theme.border,
          }}
        >
          {actions.map((action, index) => (
            <Button
              key={action.status}
              label={action.label}
              variant={index === 0 ? "soft" : "secondary"}
              disabled={settling}
              onPress={() => onTriage(action.status)}
              // Two-up inside a card is narrower than two-up on a screen, so
              // the label gets the padding back as room to breathe.
              style={{ flex: 1, paddingHorizontal: space.close }}
            />
          ))}
        </View>

        {error ? (
          <AppText
            variant="caption"
            style={{
              color: theme.danger,
              paddingHorizontal: space.card,
              paddingBottom: space.card,
            }}
          >
            {error}
          </AppText>
        ) : null}
      </Card>
    </Animated.View>
  );
}

/* ───────────────────────────── the screen ───────────────────────────── */

/**
 * What each pile says when there's nothing in it, and the mark it says it
 * under. The open queue gets the empty tray — everything that needed a person
 * has had one. The other two are keeping places rather than backlogs, so they
 * both get the box: put away, still there when you want to look back.
 */
const EMPTIES: Record<
  ReportStatus,
  {
    title: string;
    body: string;
    illustration: ComponentType<IllustrationProps>;
  }
> = {
  open: {
    illustration: Tray,
    title: "The queue is clear",
    body: "This is the pile that needs a person, and there's nothing in it. Either someone got here first, or campus is just having a quiet night.",
  },
  reviewed: {
    illustration: Shoebox,
    title: "Nothing reviewed yet",
    body: "Reports you've acted on collect here, so you can look back at what you decided and who decided it.",
  },
  dismissed: {
    illustration: Shoebox,
    title: "Nothing dismissed yet",
    body: "Reports that turned out to be fine end up here rather than disappearing. Worth a second look now and then.",
  },
};

export default function ModerationScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { session, ready } = useAuth();

  const [moderator, setModerator] = useState<boolean | null>(null);
  const [status, setFilter] = useState<ReportStatus>("open");
  const [reports, setReports] = useState<ModerationReport[] | null>(null);
  const [counts, setCounts] = useState<Record<ReportStatus, number> | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  // Every "3h ago" on the screen reads off one moment, refreshed with the
  // list — so two rows can't disagree about what "now" is.
  const [now, setNow] = useState(() => new Date());

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  }, []);

  const load = useCallback(async () => {
    try {
      // The badge is checked every time rather than cached: it's one cheap
      // row, and a moderator who stepped down mid-session should stop seeing
      // other people's reports at the next pull, not at the next cold start.
      const allowed = await amIModerator();
      setModerator(allowed);
      if (!allowed) {
        setReports(null);
        setCounts(null);
        setError(null);
        return;
      }
      const [rows, tallies] = await Promise.all([
        fetchQueue(status),
        fetchQueueCounts(),
      ]);
      setReports(rows);
      setCounts(tallies);
      setNow(new Date());
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ModerationError
          ? caught.message
          : "We couldn't load the queue. Check your connection and give it another go."
      );
    }
  }, [status]);

  // Runs on first focus, again whenever the filter changes `load`'s identity,
  // and again on every return — so a channel you stepped into and back out of
  // leaves the queue current.
  useFocusEffect(
    useCallback(() => {
      void load().finally(() => setLoading(false));
    }, [load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setRowError(null);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  const pickFilter = useCallback(
    (next: ReportStatus) => {
      if (next === status) return;
      // A different pile is a different query — say so with the skeletons
      // rather than leaving one pile's rows sitting under another's chip.
      setReports(null);
      setRowError(null);
      setLoading(true);
      setFilter(next);
    },
    [status]
  );

  /**
   * Move a report to another pile. The row starts leaving on the tap; the
   * write goes out alongside it; the row is only dropped once both have
   * landed, and comes back with a line under it if the write didn't.
   */
  const triage = useCallback(
    async (report: ModerationReport, next: ReportStatus) => {
      if (settlingId !== null) return;
      setRowError(null);
      setSettlingId(report.id);

      const settled = new Promise<void>((resolve) => {
        setTimeout(resolve, reduceMotion ? motion.instant : SETTLE_MS);
      });

      try {
        await setStatus(report.id, next);
        await settled;
        setReports((rows) =>
          (rows ?? []).filter((row) => row.id !== report.id)
        );
        setCounts((current) =>
          current === null ? null : moveCount(current, report.status, next)
        );
        // One tick, at the moment it's actually done. Never on the tap.
        tapLight();
      } catch (caught) {
        setRowError({
          id: report.id,
          message:
            caught instanceof ModerationError
              ? caught.message
              : "That didn't save. Give it another tap in a moment.",
        });
      } finally {
        setSettlingId(null);
      }
    },
    [settlingId, reduceMotion]
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ModerationReport>) => (
      <ReportRow
        report={item}
        index={index}
        now={now}
        settling={settlingId === item.id}
        error={rowError?.id === item.id ? rowError.message : null}
        onTriage={(next) => void triage(item, next)}
      />
    ),
    [now, settlingId, rowError, triage]
  );

  // A deep link can land here signed out — send them to a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  const backChevron = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={goBack}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        marginLeft: -10,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Feather name="chevron-left" size={26} color={theme.foreground} />
    </Pressable>
  );

  /** Every state wears the same hat: safe-area scaffold, chevron, one title. */
  const page = (children: ReactNode) => (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + space.close,
      }}
    >
      <View style={{ paddingHorizontal: space.gutter }}>
        {backChevron}
        <AppText variant="display" style={{ marginTop: space.hair }}>
          Reports
        </AppText>
      </View>
      {children}
    </View>
  );

  const errorPane = (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: space.room,
        paddingHorizontal: space.rest,
        paddingBottom: 80,
      }}
    >
      <Feather name="cloud-off" size={28} color={theme.muted} />
      <AppText variant="bodySemi">Something went sideways</AppText>
      <AppText
        variant="caption"
        muted
        style={{ textAlign: "center", maxWidth: 280 }}
      >
        {error}
      </AppText>
      <Button
        label="Try again"
        variant="soft"
        size="sm"
        onPress={() => {
          setLoading(true);
          void load().finally(() => setLoading(false));
        }}
      />
    </View>
  );

  /* Still finding out whose queue this is. No caption and no chips yet — a
     student who turns out not to be a moderator shouldn't watch the room's
     furniture arrive and then get carried back out. */
  if (moderator === null) {
    return page(
      error !== null ? (
        errorPane
      ) : (
        <View
          style={{ paddingHorizontal: space.gutter, paddingTop: space.gutter }}
        >
          {[0, 1, 2].map((index) => (
            <SkeletonRow key={index} avatar={false} lines={3} />
          ))}
        </View>
      )
    );
  }

  /* Not a moderator: a warm door, never a permissions error. The queue isn't
     a secret, it's just somebody else's chore. */
  if (!moderator) {
    return page(
      <View
        style={{ paddingHorizontal: space.gutter, marginTop: space.gutter }}
      >
        <EmptyState
          illustration={Mug}
          title="This one's for the moderators"
          body="A few students look after campus here — they read what gets flagged and decide what happens next. Anything you've reported is already with them."
        />
      </View>
    );
  }

  return page(
    <>
      <AppText
        variant="caption"
        muted
        style={{ paddingHorizontal: space.gutter, marginTop: space.tight }}
      >
        What campus has flagged. Take them one at a time — there's no clock on
        this.
      </AppText>

      {/* The rail bleeds into both gutters so it runs off the edge rather
          than stopping short of it. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, marginTop: space.card, marginBottom: space.card }}
        contentContainerStyle={{
          alignItems: "center",
          gap: space.cosy,
          paddingHorizontal: space.gutter,
          paddingVertical: space.hair,
        }}
      >
        {STATUSES.map((candidate) => {
          const label = statusLabel(candidate);
          const count = counts?.[candidate];
          return (
            <Chip
              key={candidate}
              label={count === undefined ? label : `${label} · ${count}`}
              tone="brand"
              size="md"
              selected={status === candidate}
              onPress={() => pickFilter(candidate)}
              accessibilityLabel={
                count === undefined
                  ? label
                  : `${label}, ${count} ${count === 1 ? "report" : "reports"}`
              }
            />
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={{ paddingHorizontal: space.gutter }}>
          {[0, 1, 2].map((index) => (
            <SkeletonRow key={index} avatar={false} lines={3} />
          ))}
        </View>
      ) : error !== null && reports === null ? (
        errorPane
      ) : (
        <FlatList
          data={reports ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: space.gutter,
            paddingBottom: insets.bottom + space.rest,
          }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            error !== null ? (
              <AppText
                variant="caption"
                style={{ color: theme.danger, marginBottom: space.room }}
              >
                {error}
              </AppText>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              illustration={EMPTIES[status].illustration}
              title={EMPTIES[status].title}
              body={EMPTIES[status].body}
            />
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.brand}
              colors={[theme.brand]}
            />
          }
        />
      )}
    </>
  );
}
