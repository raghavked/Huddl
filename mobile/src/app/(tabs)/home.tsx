import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { Screen } from "@/components/screen";
import { AppText, Button, Card } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

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
  author: { display_name: string } | null;
};

type HomeData = {
  firstName: string;
  campusChannels: ChannelRow[];
  courseChannels: ChannelRow[];
  events: EventRow[];
  previews: Record<string, MessagePreview>;
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
    }
  | { type: "courses"; key: string; left: CourseCell; right: CourseCell | null }
  | { type: "event"; key: string; event: EventRow }
  | {
      type: "empty";
      key: string;
      icon: FeatherName;
      title: string;
      body: string;
      action?: RowAction;
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

/* ---- section pieces ---- */

function SectionLabel({
  text,
  first,
  action,
}: {
  text: string;
  first: boolean;
  action?: RowAction;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginTop: first ? 6 : 24,
        marginBottom: 10,
      }}
    >
      <AppText
        variant="label"
        muted
        style={{ textTransform: "uppercase", letterSpacing: 1.2 }}
      >
        {text}
      </AppText>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 2,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <AppText variant="label" style={{ color: theme.brand }}>
            {action.label}
          </AppText>
          <Feather name="chevron-right" size={14} color={theme.brand} />
        </Pressable>
      ) : null}
    </View>
  );
}

function EmptySection({
  icon,
  title,
  body,
  action,
}: {
  icon: FeatherName;
  title: string;
  body: string;
  action?: RowAction;
}) {
  const theme = useTheme();
  return (
    <Card
      style={{
        alignItems: "center",
        gap: 6,
        paddingVertical: 24,
        borderStyle: "dashed",
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.full,
          backgroundColor: theme.brandSoft,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 2,
        }}
      >
        <Feather name={icon} size={18} color={theme.brand} />
      </View>
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
          style={{ marginTop: 6 }}
          onPress={action.onPress}
        />
      ) : null}
    </Card>
  );
}

function CampusRow({
  channel,
  preview,
}: {
  channel: ChannelRow;
  preview: MessagePreview | null;
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
          gap: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
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
          <Feather name="volume-2" size={18} color={theme.brand} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <AppText
              variant="bodySemi"
              numberOfLines={1}
              style={{ flexShrink: 1 }}
            >
              #{channel.slug}
            </AppText>
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
              No messages yet — say hi!
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
      <Card padded={false} style={{ flex: 1, gap: 4, padding: 14, minHeight: 88 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
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
          style={{ marginTop: "auto", paddingTop: 4 }}
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
          gap: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
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
        <View style={{ flex: 1, gap: 2 }}>
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
            paddingHorizontal: 9,
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

/* ---- screen ---- */

export default function HomeScreen() {
  const theme = useTheme();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHome = useCallback(async (): Promise<HomeData> => {
    if (!userId) throw new Error("Not signed in");

    const [profileRes, membershipRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, handle, university_id")
        .eq("id", userId)
        .single(),
      supabase
        .from("channel_members")
        .select("channel:channels(id, kind, name, slug, course:courses(id, code, title))")
        .eq("user_id", userId),
    ]);
    if (profileRes.error) throw profileRes.error;
    if (membershipRes.error) throw membershipRes.error;

    const profile = profileRes.data as unknown as {
      display_name: string;
      handle: string;
      university_id: string;
    };

    const myChannels = (
      (membershipRes.data ?? []) as unknown as { channel: ChannelRow | null }[]
    )
      .map((row) => row.channel)
      .filter((c): c is ChannelRow => Boolean(c));

    const campusChannels = myChannels
      .filter((c) => c.kind === "campus")
      .sort((a, b) => a.slug.localeCompare(b.slug));
    const courseChannels = myChannels
      .filter((c) => c.kind === "course")
      .sort((a, b) =>
        (a.course?.code ?? a.name).localeCompare(b.course?.code ?? b.name)
      );

    const eventsRes = await supabase
      .from("events")
      .select("id, kind, title, location, starts_at, ends_at")
      .eq("university_id", profile.university_id)
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(4);
    if (eventsRes.error) throw eventsRes.error;
    const events = (eventsRes.data ?? []) as unknown as EventRow[];

    // Latest message per joined channel: one tiny indexed lookup each,
    // batched in parallel — same shape as the web home.
    const previews: Record<string, MessagePreview> = {};
    await Promise.all(
      [...campusChannels, ...courseChannels].map(async (channel) => {
        const { data: preview } = await supabase
          .from("messages")
          .select("content, created_at, author:profiles(display_name)")
          .eq("channel_id", channel.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (preview) {
          previews[channel.id] = preview as unknown as MessagePreview;
        }
      })
    );

    const firstName =
      profile.display_name.trim().split(/\s+/)[0] || profile.handle;

    return { firstName, campusChannels, courseChannels, events, previews };
  }, [userId]);

  const run = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      try {
        setData(await fetchHome());
        setError(null);
      } catch {
        setError("We couldn't load your campus right now.");
      } finally {
        if (mode === "initial") setLoading(false);
        else setRefreshing(false);
      }
    },
    [fetchHome]
  );

  useEffect(() => {
    if (!userId) return;
    void run("initial");
  }, [userId, run]);

  const rows = useMemo<ListRow[]>(() => {
    if (!data) return [];
    const out: ListRow[] = [];

    out.push({ type: "label", key: "label-campus", text: "Your campus" });
    if (data.campusChannels.length === 0) {
      out.push({
        type: "empty",
        key: "empty-campus",
        icon: "volume-2",
        title: "No campus channels yet",
        body: "Campus channels usually come free with your profile — they'll show up here soon.",
      });
    } else {
      for (const channel of data.campusChannels) {
        out.push({
          type: "campus",
          key: `campus-${channel.id}`,
          channel,
          preview: data.previews[channel.id] ?? null,
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

    out.push({ type: "label", key: "label-events", text: "Coming up" });
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

    return out;
  }, [data]);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ListRow>) => {
      switch (item.type) {
        case "label":
          return (
            <SectionLabel
              text={item.text}
              first={index === 0}
              action={item.action}
            />
          );
        case "campus":
          return (
            <View style={{ marginBottom: 10 }}>
              <CampusRow channel={item.channel} preview={item.preview} />
            </View>
          );
        case "courses":
          return (
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
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
            <View style={{ marginBottom: 10 }}>
              <EventCard event={item.event} />
            </View>
          );
        case "empty":
          return (
            <EmptySection
              icon={item.icon}
              title={item.title}
              body={item.body}
              action={item.action}
            />
          );
      }
    },
    []
  );

  return (
    <Screen
      title={data ? `Hey ${data.firstName}` : "Home"}
      scroll={false}
      action={
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
      }
    >
      {loading ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            paddingBottom: 80,
          }}
        >
          <ActivityIndicator size="large" color={theme.brand} />
          <AppText variant="caption" muted>
            Getting your campus ready…
          </AppText>
        </View>
      ) : error && !data ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
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
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderItem}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={{ gap: 6 }}>
              <AppText muted>Here's what's happening on campus.</AppText>
              {error ? (
                <AppText variant="caption" style={{ color: theme.danger }}>
                  We couldn't refresh just now — pull down to try again.
                </AppText>
              ) : null}
            </View>
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
    </Screen>
  );
}
