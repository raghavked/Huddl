import Feather from "@expo/vector-icons/Feather";
import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Mug } from "@/components/illustrations";
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  SkeletonRow,
} from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  categoryLabel,
  type ReportCategory,
  type ReportStatus,
} from "@/lib/moderation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* The receipt for every report a student has filed.
 *
 * Reporting has always been a one-way door: you pick a category, write what
 * happened, the screen says "Report sent", and that is the last you ever hear
 * of it. Migration 0015 granted reporters SELECT on their own rows from the
 * beginning — the record was always there, nothing in the app ever read it.
 *
 * The screen is deliberately modest about what it can promise. A moderator can
 * move a report between three piles and that is the whole of the tooling that
 * exists today, so this says where the report sits and nothing about what was
 * done to anyone. A receipt, not a verdict.
 */

type ReportedPerson = {
  handle: string;
  display_name: string;
  is_public: boolean;
};

type FiledReport = {
  id: string;
  status: ReportStatus;
  category: ReportCategory;
  reason: string;
  created_at: string;
  messageId: string | null;
  boardPostId: string | null;
  reportedUserId: string | null;
  reported: ReportedPerson | null;
};

const SELECT =
  "id, status, category, reason, created_at, message_id, board_post_id, reported_user_id, " +
  "reported:profiles!reports_reported_user_id_fkey(handle, display_name, is_public)";

/** A student's own pile is small; a hundred is far more than anyone files. */
const LIMIT = 100;

const CATEGORY_KEYS: readonly ReportCategory[] = [
  "harassment",
  "spam",
  "hate",
  "impersonation",
  "sexual_content",
  "self_harm",
  "academic_dishonesty",
  "other",
];

/* ------------------------------- narrowing ------------------------------- */

/** The Supabase client here is untyped, so every field is checked once. */
function embedded(raw: unknown): Record<string, unknown> | null {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function text(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function toStatus(raw: unknown): ReportStatus {
  return raw === "reviewed" || raw === "dismissed" ? raw : "open";
}

function toCategory(raw: unknown): ReportCategory {
  return typeof raw === "string" &&
    (CATEGORY_KEYS as readonly string[]).includes(raw)
    ? (raw as ReportCategory)
    : "other";
}

function toPerson(raw: unknown): ReportedPerson | null {
  const record = embedded(raw);
  if (!record) return null;
  const handle = text(record["handle"]);
  if (handle === null) return null;
  return {
    handle,
    display_name: text(record["display_name"]) ?? handle,
    is_public: record["is_public"] === true,
  };
}

function toReport(raw: unknown): FiledReport | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const id = text(row["id"]);
  const createdAt = text(row["created_at"]);
  if (id === null || createdAt === null) return null;
  return {
    id,
    status: toStatus(row["status"]),
    category: toCategory(row["category"]),
    reason: text(row["reason"]) ?? "",
    created_at: createdAt,
    messageId: text(row["message_id"]),
    boardPostId: text(row["board_post_id"]),
    reportedUserId: text(row["reported_user_id"]),
    reported: toPerson(row["reported"]),
  };
}

/* -------------------------------- wording -------------------------------- */

/**
 * Where the report sits, said in words a student can act on rather than in
 * the queue's own vocabulary. `dismissed` is the hard one and it stays
 * honest: nothing came of it, and pretending otherwise would be worse than
 * the silence this screen replaces.
 */
function statusLine(status: ReportStatus): { label: string; accent: boolean } {
  if (status === "reviewed") return { label: "Reviewed", accent: true };
  if (status === "dismissed")
    return { label: "Closed, no action", accent: false };
  return { label: "Waiting on a moderator", accent: false };
}

/** "A message", "A board post", "Maya Chen's profile". */
function subjectLine(report: FiledReport): string {
  const who = report.reported
    ? report.reported.is_public
      ? report.reported.display_name
      : `@${report.reported.handle}`
    : null;
  if (report.messageId !== null) {
    return who ? `A message from ${who}` : "A message";
  }
  if (report.boardPostId !== null) {
    return who ? `A board post by ${who}` : "A board post";
  }
  if (who) return `${who}'s profile`;
  if (report.reportedUserId !== null) return "A classmate's profile";
  return "Something that has since been deleted";
}

/** "Aug 2", or "Aug 2, 2025" once we're past the year it happened in. */
function filedOn(iso: string): string {
  const day = new Date(iso);
  const sameYear = day.getFullYear() === new Date().getFullYear();
  return day.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(sameYear ? null : { year: "numeric" }),
  });
}

/* --------------------------------- the row -------------------------------- */

function ReportRow({ report, index }: { report: FiledReport; index: number }) {
  const theme = useTheme();
  const state = statusLine(report.status);

  return (
    <Card entrance={index} style={{ gap: space.cosy, marginBottom: space.room }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: space.snug,
        }}
      >
        <Chip label={categoryLabel(report.category)} tone="brand" />
        <Chip
          label={state.label}
          tone={state.accent ? "accent" : "neutral"}
          icon={state.accent ? "check" : "clock"}
        />
      </View>

      <AppText variant="bodySemi">{subjectLine(report)}</AppText>

      {report.reason ? (
        <View
          style={{
            padding: space.close,
            borderRadius: radius.control,
            backgroundColor: theme.surface2,
          }}
        >
          <AppText style={{ lineHeight: 21 }}>{report.reason}</AppText>
        </View>
      ) : null}

      <AppText variant="caption" muted>
        Filed {filedOn(report.created_at)}
      </AppText>
    </Card>
  );
}

/* -------------------------------- the screen ------------------------------ */

export default function MyReportsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const userId = session?.user.id ?? null;

  const [reports, setReports] = useState<FiledReport[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  }, []);

  const run = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!userId) return;
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      /* RLS already scopes this to the reports I filed; asking for my own id
         as well means a moderator opening this screen sees their own pile
         rather than the whole campus queue. */
      const { data, error: queryError } = await supabase
        .from("reports")
        .select(SELECT)
        .eq("reporter_id", userId)
        .order("created_at", { ascending: false })
        .limit(LIMIT);
      if (mode === "initial") setLoading(false);
      if (mode === "refresh") setRefreshing(false);
      if (queryError) {
        setError("We couldn't load your reports right now.");
        return;
      }
      const rows: FiledReport[] = [];
      for (const raw of Array.isArray(data) ? data : []) {
        const report = toReport(raw);
        if (report) rows.push(report);
      }
      setReports(rows);
      setError(null);
    },
    [userId]
  );

  useEffect(() => {
    if (!userId) return;
    void run("initial");
  }, [userId, run]);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<FiledReport>) => (
      <ReportRow report={item} index={index} />
    ),
    []
  );

  // A deep link can land here signed out — send them to a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + 8,
        paddingHorizontal: space.gutter,
      }}
    >
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
        <Feather
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          name="chevron-left"
          size={26}
          color={theme.foreground}
        />
      </Pressable>

      <AppText
        variant="display"
        accessibilityRole="header"
        style={{ marginTop: space.hair }}
      >
        Reports you've filed
      </AppText>
      <AppText variant="caption" muted style={{ marginTop: space.tight, marginBottom: space.card }}>
        Every report you've sent, and where it sits. Nobody you reported is
        ever told you filed it.
      </AppText>

      {loading ? (
        <View style={{ flex: 1 }}>
          {[0, 1].map((index) => (
            <SkeletonRow key={index} avatar={false} lines={2} />
          ))}
        </View>
      ) : error && reports === null ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: space.room,
            paddingBottom: 80,
          }}
        >
          <Feather
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            name="cloud-off"
            size={28}
            color={theme.muted}
          />
          <AppText variant="bodySemi" accessibilityRole="header">
            Something went sideways
          </AppText>
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
        <FlatList
          data={reports ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            error ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={{ color: theme.danger, marginBottom: space.room }}
              >
                We couldn't refresh just now — pull down to try again.
              </AppText>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              illustration={Mug}
              title="You haven't reported anything"
              body="If someone crosses a line, the flag is in the overflow on their profile, their message, or their board post. Whatever you send lands here."
            />
          }
          ListFooterComponent={
            (reports ?? []).length > 0 ? (
              <AppText
                variant="caption"
                muted
                style={{ marginTop: space.snug, lineHeight: 17 }}
              >
                A campus moderator reads every one. "Closed, no action" means
                they looked and decided nothing needed doing — if it happens
                again, report it again, and say that it has.
              </AppText>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void run("refresh")}
              tintColor={theme.brand}
              colors={[theme.brand]}
            />
          }
        />
      )}
    </View>
  );
}
