import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AppText,
  Button,
  Card,
  Chip,
  SectionLabel,
  Sheet,
} from "@/components/ui";
import { fonts, radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

type FeatherName = ComponentProps<typeof Feather>["name"];

/* Minimal local row shapes — the web app's types live outside this tsconfig. */

type RsvpStatus = "going" | "maybe" | "declined";

type EventDetail = {
  id: string;
  kind: "study_session" | "meetup";
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  capacity: number | null;
  creator_id: string;
  creator: { display_name: string } | null;
};

type RsvpRow = { user_id: string; status: RsvpStatus };

type Status = "loading" | "error" | "notFound" | "ready";

const RSVP_OPTIONS: readonly {
  value: RsvpStatus;
  label: string;
  icon: FeatherName;
}[] = [
  { value: "going", label: "Going", icon: "check-circle" },
  { value: "maybe", label: "Maybe", icon: "help-circle" },
  { value: "declined", label: "Can't", icon: "x-circle" },
];

/** "Sat, Aug 9 · 3:00 PM–5:00 PM" — local device time, like the web. */
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

/** Large weekday / day / month tile — accent, matching the events tab. */
function DateTile({ iso }: { iso: string }) {
  const theme = useTheme();
  const d = new Date(iso);
  return (
    <View
      accessibilityElementsHidden
      style={{
        width: 64,
        height: 64,
        borderRadius: radius.control,
        backgroundColor: theme.accentSoft,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <AppText
        variant="label"
        style={{
          color: theme.accent,
          fontSize: 10,
          lineHeight: 12,
          textTransform: "uppercase",
          letterSpacing: 0.8,
        }}
      >
        {d.toLocaleDateString([], { weekday: "short" })}
      </AppText>
      <AppText
        style={{
          color: theme.accent,
          fontFamily: fonts.bodyBold,
          fontSize: 24,
          lineHeight: 28,
        }}
      >
        {String(d.getDate())}
      </AppText>
      <AppText
        variant="label"
        style={{
          color: theme.accent,
          fontSize: 10,
          lineHeight: 12,
          textTransform: "uppercase",
          letterSpacing: 0.8,
        }}
      >
        {d.toLocaleDateString([], { month: "short" })}
      </AppText>
    </View>
  );
}

/** The event's kind, as the house pill: fern for study, ember for a meetup. */
function KindChip({ kind }: { kind: EventDetail["kind"] }) {
  const isStudy = kind === "study_session";
  return (
    <Chip
      label={isStudy ? "Study session" : "Meetup"}
      tone={isStudy ? "accent" : "brand"}
      size="md"
      icon={isStudy ? "book-open" : "smile"}
    />
  );
}

function MetaRow({
  icon,
  children,
}: {
  icon: FeatherName;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      <Feather
        name={icon}
        size={15}
        color={theme.muted}
        style={{ marginTop: 3 }}
      />
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
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

export default function EventDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { id } = useLocalSearchParams<{ id: string }>();
  const eventId = id ?? "";

  const [status, setStatus] = useState<Status>("loading");
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [rsvps, setRsvps] = useState<RsvpRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<RsvpStatus | null>(null);
  const [rsvpError, setRsvpError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/events");
  }, [router]);

  const load = useCallback(async () => {
    if (!eventId) {
      setStatus("notFound");
      return;
    }
    const [eventRes, rsvpRes] = await Promise.all([
      supabase
        .from("events")
        .select(
          "id, kind, title, description, location, starts_at, ends_at, capacity, creator_id, creator:profiles(display_name)"
        )
        .eq("id", eventId)
        .maybeSingle(),
      supabase
        .from("event_rsvps")
        .select("user_id, status")
        .eq("event_id", eventId),
    ]);
    if (eventRes.error) {
      setStatus("error");
      return;
    }
    const eventRow = eventRes.data as unknown as EventDetail | null;
    // RLS hides other campuses' events, so "not found" covers both cases.
    if (!eventRow) {
      setStatus("notFound");
      return;
    }
    if (rsvpRes.error) {
      setStatus("error");
      return;
    }
    setEvent(eventRow);
    setRsvps((rsvpRes.data ?? []) as unknown as RsvpRow[]);
    setStatus("ready");
  }, [eventId]);

  // Reload on focus, not just mount — coming back from the edit screen
  // should show the saved changes right away.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  /** Creator-only: confirm, delete the row, and step back to the list. */
  const handleCancelEvent = useCallback(() => {
    if (!event || !userId || cancelling) return;
    Alert.alert(
      "Cancel this event?",
      "Everyone who RSVP'd will see it disappear.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Cancel event",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setCancelling(true);
              const { error: deleteError } = await supabase
                .from("events")
                .delete()
                .eq("id", event.id)
                .eq("creator_id", userId);
              setCancelling(false);
              if (deleteError) {
                Alert.alert(
                  "Couldn't cancel the event",
                  "Give it another try."
                );
                return;
              }
              goBack();
            })();
          },
        },
      ]
    );
  }, [event, userId, cancelling, goBack]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const myStatus: RsvpStatus | null =
    rsvps.find((r) => r.user_id === userId)?.status ?? null;
  const goingCount = rsvps.filter((r) => r.status === "going").length;
  const maybeCount = rsvps.filter((r) => r.status === "maybe").length;
  const declinedCount = rsvps.filter((r) => r.status === "declined").length;
  const atCapacity =
    event !== null && event.capacity !== null && goingCount >= event.capacity;
  // People already going keep their spot; only new "going" taps are blocked.
  const goingBlocked = atCapacity && myStatus !== "going";
  const isPast =
    event !== null &&
    new Date(event.ends_at ?? event.starts_at).getTime() < Date.now();

  const choose = useCallback(
    async (next: RsvpStatus) => {
      if (!userId || !event || pendingStatus !== null) return;
      const current = rsvps.find((r) => r.user_id === userId)?.status ?? null;
      if (next === current) return;
      setRsvpError(null);
      // Mirror the web rsvp action's capacity check, simply: count everyone
      // else who's going — re-confirming your own spot is fine.
      if (next === "going" && event.capacity !== null) {
        const othersGoing = rsvps.filter(
          (r) => r.status === "going" && r.user_id !== userId
        ).length;
        if (othersGoing >= event.capacity) {
          setRsvpError(
            `This event is full — all ${event.capacity} spots are taken.`
          );
          return;
        }
      }
      setPendingStatus(next);
      const { error: upsertError } = await supabase
        .from("event_rsvps")
        .upsert(
          { event_id: event.id, user_id: userId, status: next },
          { onConflict: "event_id,user_id" }
        );
      setPendingStatus(null);
      if (upsertError) {
        setRsvpError("Couldn't save your RSVP. Give it another try.");
        return;
      }
      setRsvps((prev) => [
        ...prev.filter((r) => r.user_id !== userId),
        { user_id: userId, status: next },
      ]);
    },
    [userId, event, rsvps, pendingStatus]
  );

  /* ------------------------- pre-detail states ------------------------- */

  if (status !== "ready" || !event) {
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
                <Feather name="calendar" size={22} color={theme.brand} />
              </View>
              <AppText variant="title">Event not available</AppText>
              <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
                This event doesn't exist anymore, or it belongs to another
                campus.
              </AppText>
              <Button
                label="Back to events"
                variant="soft"
                onPress={goBack}
              />
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
                <Feather name="wifi-off" size={22} color={theme.brand} />
              </View>
              <AppText variant="title">Something hiccuped</AppText>
              <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
                We couldn't load this event. Give it another try.
              </AppText>
              <Button
                label="Try again"
                variant="soft"
                onPress={() => {
                  setStatus("loading");
                  void load();
                }}
              />
            </>
          )}
        </View>
      </View>
    );
  }

  /* ----------------------------- the detail ---------------------------- */

  const hostName = event.creator?.display_name ?? "A classmate";
  const isCreator = userId !== null && event.creator_id === userId;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 12,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <BackChevron onPress={goBack} />
        <View style={{ flex: 1 }} />
        {isCreator ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Event options"
            onPress={() => setMenuOpen(true)}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            {cancelling ? (
              <ActivityIndicator size="small" color={theme.brand} />
            ) : (
              <Feather
                name="more-horizontal"
                size={22}
                color={theme.foreground}
              />
            )}
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 4,
          paddingBottom: insets.bottom + 32,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={theme.brand}
            colors={[theme.brand]}
          />
        }
      >
        <AppText variant="display">{event.title}</AppText>
        <AppText variant="caption" muted style={{ marginTop: 6 }}>
          Hosted by{" "}
          <AppText variant="label" muted>
            {hostName}
          </AppText>
        </AppText>

        <Card style={{ marginTop: 16, gap: 14 }}>
          <View style={{ flexDirection: "row", gap: 14 }}>
            <DateTile iso={event.starts_at} />
            <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                <KindChip kind={event.kind} />
                {isPast ? <Chip label="Ended" size="md" /> : null}
              </View>
              <MetaRow icon="clock">
                <AppText variant="bodyMedium">
                  {formatEventTime(event.starts_at, event.ends_at)}
                </AppText>
              </MetaRow>
              {event.location ? (
                <MetaRow icon="map-pin">
                  <AppText>{event.location}</AppText>
                </MetaRow>
              ) : null}
              <MetaRow icon="users">
                <AppText>
                  {goingCount} going
                  {event.capacity !== null ? (
                    <AppText muted>
                      {" "}
                      of {event.capacity}{" "}
                      {event.capacity === 1 ? "spot" : "spots"}
                    </AppText>
                  ) : null}
                </AppText>
              </MetaRow>
            </View>
          </View>

          {event.description ? (
            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: theme.border,
                paddingTop: 12,
              }}
            >
              <AppText muted>{event.description}</AppText>
            </View>
          ) : null}
        </Card>

        <SectionLabel text="Your RSVP" />

        {isPast ? (
          <Card padded={false} style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
            <AppText muted>
              This event has ended
              {myStatus === "going" ? " — hope it was a good one." : "."}
            </AppText>
          </Card>
        ) : (
          <>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Your RSVP"
              style={{ flexDirection: "row", gap: 8 }}
            >
              {RSVP_OPTIONS.map(({ value, label, icon }) => {
                const active = myStatus === value;
                const blocked = value === "going" && goingBlocked;
                return (
                  <Button
                    key={value}
                    label={label}
                    variant={active ? "primary" : "secondary"}
                    pending={pendingStatus === value}
                    disabled={pendingStatus !== null || blocked}
                    accessibilityLabel={`RSVP ${label}`}
                    accessibilityState={{ selected: active }}
                    icon={
                      <Feather
                        name={icon}
                        size={15}
                        color={active ? theme.brandFg : theme.foreground}
                      />
                    }
                    onPress={() => void choose(value)}
                    style={{ flex: 1, paddingHorizontal: 0 }}
                  />
                );
              })}
            </View>
            {goingBlocked && !rsvpError ? (
              <AppText variant="caption" muted style={{ marginTop: 8 }}>
                This event is full — you can still RSVP "maybe" in case a spot
                opens up.
              </AppText>
            ) : null}
            {rsvpError ? (
              <AppText
                variant="caption"
                style={{ color: theme.danger, marginTop: 8 }}
              >
                {rsvpError}
              </AppText>
            ) : null}
          </>
        )}

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            marginTop: 14,
          }}
        >
          <Feather name="user" size={13} color={theme.muted} />
          {rsvps.length === 0 ? (
            <AppText variant="caption" muted>
              No RSVPs yet — be the first to tap one above.
            </AppText>
          ) : (
            <AppText variant="caption" muted>
              {goingCount} going · {maybeCount} maybe · {declinedCount} can't
              go
            </AppText>
          )}
        </View>
      </ScrollView>

      <Sheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={event.title}
      >
        <Sheet.Row
          icon="edit-2"
          label="Edit event"
          onPress={() => {
            setMenuOpen(false);
            router.push({
              pathname: "/event/edit",
              params: { eventId: event.id },
            });
          }}
        />
        <Sheet.Row
          icon="x-circle"
          label="Cancel event"
          danger
          onPress={() => {
            setMenuOpen(false);
            handleCancelEvent();
          }}
        />
      </Sheet>
    </View>
  );
}
