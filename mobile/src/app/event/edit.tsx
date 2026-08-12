import Feather from "@expo/vector-icons/Feather";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Field } from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

type EventKind = "study_session" | "meetup";

const KIND_OPTIONS: readonly { value: EventKind; label: string }[] = [
  { value: "study_session", label: "Study session" },
  { value: "meetup", label: "Meetup" },
];

/** Minimal local row shape — the web app's types live outside this tsconfig. */
type EventRow = {
  id: string;
  kind: EventKind;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  capacity: number | null;
  creator_id: string;
  course: { code: string } | null;
  club: { name: string } | null;
};

type Status = "loading" | "error" | "notFound" | "ready";

function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

/** "14:30" -> { hours, minutes }, or null when it doesn't parse. */
function parseTime(raw: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO timestamp -> "2026-10-14" in device-local time, form-ready. */
function toDateInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ISO timestamp -> "15:00" in device-local time, form-ready. */
function toTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EditEventScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const userId = session?.user.id ?? null;
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  const id = eventId ?? "";

  const [status, setStatus] = useState<Status>("loading");
  const [event, setEvent] = useState<EventRow | null>(null);

  const [kind, setKind] = useState<EventKind>("study_session");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [capacity, setCapacity] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/events");
  }, [router]);

  const load = useCallback(async () => {
    if (!userId) return;
    if (!id) {
      setStatus("notFound");
      return;
    }
    const { data, error: queryError } = await supabase
      .from("events")
      .select(
        "id, kind, title, description, location, starts_at, ends_at, capacity, creator_id, course:courses(code), club:clubs(name)"
      )
      .eq("id", id)
      .maybeSingle();
    if (queryError) {
      setStatus("error");
      return;
    }
    const row = data as unknown as EventRow | null;
    // RLS hides other campuses' events, so "not found" covers both cases.
    if (!row) {
      setStatus("notFound");
      return;
    }
    // Only the creator edits — everyone else steps quietly back.
    if (row.creator_id !== userId) {
      goBack();
      return;
    }
    setEvent(row);
    setKind(row.kind);
    setTitle(row.title);
    setDescription(row.description ?? "");
    setLocation(row.location ?? "");
    setDate(toDateInput(row.starts_at));
    setStartTime(toTimeInput(row.starts_at));
    setEndTime(row.ends_at ? toTimeInput(row.ends_at) : "");
    setCapacity(row.capacity !== null ? String(row.capacity) : "");
    setStatus("ready");
  }, [id, userId, goBack]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    if (!userId || !event || pending) return;

    const cleanTitle = title.trim();
    if (cleanTitle === "") {
      setFormError(
        "Give it a title — “Midterm grind at Shields”, that kind of thing."
      );
      return;
    }

    const dateMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date.trim());
    if (!dateMatch) {
      setFormError("Dates look like YYYY-MM-DD — try 2026-10-14.");
      return;
    }
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(month, year)) {
      setFormError("That day doesn't exist — double-check the month and day.");
      return;
    }

    const start = parseTime(startTime.trim());
    if (!start) {
      setFormError("Start times look like HH:MM — try 15:00.");
      return;
    }
    const startsAt = new Date(year, month - 1, day, start.hours, start.minutes);

    let endsAt: Date | null = null;
    if (endTime.trim() !== "") {
      const end = parseTime(endTime.trim());
      if (!end) {
        setFormError("End times look like HH:MM — try 17:00, or leave it blank.");
        return;
      }
      endsAt = new Date(year, month - 1, day, end.hours, end.minutes);
      if (endsAt.getTime() <= startsAt.getTime()) {
        setFormError("The end time needs to land after the start.");
        return;
      }
    }

    let capacityNumber: number | null = null;
    if (capacity.trim() !== "") {
      capacityNumber = Number(capacity.trim());
      if (!Number.isInteger(capacityNumber) || capacityNumber < 1) {
        setFormError(
          "Capacity is a whole number of spots — or leave it blank for no cap."
        );
        return;
      }
    }

    setFormError(null);
    setPending(true);

    // No announcement post on edits — the plan already made its entrance.
    const { error: updateError } = await supabase
      .from("events")
      .update({
        kind,
        title: cleanTitle,
        description: description.trim() || null,
        location: location.trim() || null,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt ? endsAt.toISOString() : null,
        capacity: capacityNumber,
      })
      .eq("id", event.id)
      .eq("creator_id", userId);
    setPending(false);
    if (updateError) {
      setFormError("We couldn't save your changes. Give it another try.");
      return;
    }

    goBack();
  }, [
    userId,
    event,
    pending,
    title,
    date,
    startTime,
    endTime,
    capacity,
    kind,
    description,
    location,
    goBack,
  ]);

  // Deep links land here directly — signed-out visitors get a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  /* -------------------------- pre-form states -------------------------- */

  if (status !== "ready" || !event) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + space.close,
        }}
      >
        <View style={{ paddingHorizontal: 12 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={goBack}
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
              <Button label="Back to events" variant="soft" onPress={goBack} />
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

  /* ------------------------------ the form ----------------------------- */

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ flex: 1, paddingTop: insets.top + space.close }}>
        <View style={{ paddingHorizontal: 12 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={goBack}
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
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: insets.bottom + space.rest,
            gap: 14,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ gap: 6 }}>
            <AppText variant="display">Edit your event</AppText>
            <AppText variant="caption" muted>
              Fix the details — everyone who RSVP'd keeps their spot.
            </AppText>
          </View>

          {/* The course/club link is set when the plan is made — shown here,
              not editable. */}
          {event.course ? (
            <View
              accessibilityLabel={`Linked to ${event.course.code}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                alignSelf: "flex-start",
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: radius.full,
                backgroundColor: theme.accentSoft,
              }}
            >
              <Feather name="book-open" size={13} color={theme.accent} />
              <AppText variant="label" style={{ color: theme.accent }}>
                For {event.course.code}
              </AppText>
            </View>
          ) : null}

          {event.club ? (
            <View
              accessibilityLabel={`Hosted by ${event.club.name}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                alignSelf: "flex-start",
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: radius.full,
                backgroundColor: theme.accentSoft,
              }}
            >
              <Feather name="users" size={13} color={theme.accent} />
              <AppText variant="label" style={{ color: theme.accent }}>
                For {event.club.name}
              </AppText>
            </View>
          ) : null}

          <View style={{ flexDirection: "row", gap: 8 }}>
            {KIND_OPTIONS.map((option) => {
              const selected = kind === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={option.label}
                  onPress={() => setKind(option.value)}
                  hitSlop={6}
                  style={({ pressed }) => ({
                    paddingHorizontal: 14,
                    paddingVertical: 9,
                    borderRadius: radius.full,
                    backgroundColor: selected ? theme.brandSoft : theme.surface,
                    borderWidth: 1,
                    borderColor: selected ? theme.brandInk : theme.border,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <AppText
                    variant="label"
                    style={{
                      color: selected ? theme.brandInk : theme.muted,
                      fontSize: 13,
                    }}
                  >
                    {option.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <Field
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder={
              kind === "study_session"
                ? "Midterm grind at Shields"
                : "Coffee before lecture"
            }
            maxLength={200}
            editable={!pending}
          />
          <Field
            label="Description (optional)"
            value={description}
            onChangeText={setDescription}
            placeholder="What you're covering, what to bring…"
            maxLength={2000}
            multiline
            editable={!pending}
            style={{ minHeight: 88, textAlignVertical: "top" }}
          />
          <Field
            label="Location (optional)"
            value={location}
            onChangeText={setLocation}
            placeholder="Shields Library, room 210"
            maxLength={200}
            editable={!pending}
          />
          <Field
            label="Date"
            value={date}
            onChangeText={setDate}
            placeholder="2026-10-14"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            editable={!pending}
          />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Field
                label="Starts"
                value={startTime}
                onChangeText={setStartTime}
                placeholder="15:00"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                editable={!pending}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Ends (optional)"
                value={endTime}
                onChangeText={setEndTime}
                placeholder="17:00"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                editable={!pending}
              />
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <Field
              label="Capacity (optional)"
              value={capacity}
              onChangeText={setCapacity}
              placeholder="8"
              keyboardType="number-pad"
              maxLength={4}
              editable={!pending}
            />
            <AppText variant="caption" muted>
              Cap the spots if the table only seats so many.
            </AppText>
          </View>

          {formError ? (
            <AppText variant="caption" style={{ color: theme.danger }}>
              {formError}
            </AppText>
          ) : null}

          <Button
            label={pending ? "Saving…" : "Save changes"}
            pending={pending}
            icon={<Feather name="check" size={16} color={theme.brandFg} />}
            onPress={() => void handleSave()}
            style={{ marginTop: 4 }}
          />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
