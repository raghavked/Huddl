import Feather from "@expo/vector-icons/Feather";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Field } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

type EventKind = "study_session" | "meetup";

const KIND_OPTIONS: readonly { value: EventKind; label: string }[] = [
  { value: "study_session", label: "Study session" },
  { value: "meetup", label: "Meetup" },
];

function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

/** "Sat, Aug 9 · 3:00 PM" — how the plan reads in the class chat. */
function announceWhen(d: Date): string {
  const day = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
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

export default function NewEventScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const userId = session?.user.id ?? null;
  const { courseId, courseCode } = useLocalSearchParams<{
    courseId?: string;
    courseCode?: string;
  }>();

  // The course link arrives via params and can be quietly dropped.
  const [linkedCourseId, setLinkedCourseId] = useState<string | null>(
    courseId ?? null
  );

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

  const handleCreate = useCallback(async () => {
    if (!userId || pending) return;

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

    // The event lives on your campus — grab it from your profile.
    const profileRes = await supabase
      .from("profiles")
      .select("university_id")
      .eq("id", userId)
      .single();
    if (profileRes.error) {
      setPending(false);
      setFormError("We couldn't reach your profile. Give it another try.");
      return;
    }
    const { university_id: universityId } = profileRes.data as unknown as {
      university_id: string;
    };

    const insertRes = await supabase
      .from("events")
      .insert({
        university_id: universityId,
        course_id: linkedCourseId,
        creator_id: userId,
        kind,
        title: cleanTitle,
        description: description.trim() || null,
        location: location.trim() || null,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt ? endsAt.toISOString() : null,
        capacity: capacityNumber,
      })
      .select("id")
      .single();
    if (insertRes.error || !insertRes.data) {
      setPending(false);
      setFormError("We couldn't create your event. Give it another try.");
      return;
    }
    const eventId = (insertRes.data as unknown as { id: string }).id;

    // You're hosting — you're going. Best-effort: the event exists either way.
    await supabase
      .from("event_rsvps")
      .upsert(
        { event_id: eventId, user_id: userId, status: "going" },
        { onConflict: "event_id,user_id" }
      );

    // Course-linked plans get a quiet heads-up in the class's front room.
    // Best-effort on purpose — a chat hiccup shouldn't eat the event.
    if (linkedCourseId) {
      try {
        const channelRes = await supabase
          .from("channels")
          .select("id")
          .eq("course_id", linkedCourseId)
          .eq("is_main", true)
          .maybeSingle();
        const channel = channelRes.data as unknown as { id: string } | null;
        if (channel) {
          const label =
            kind === "study_session" ? "Study session planned" : "Meetup planned";
          await supabase.from("messages").insert({
            channel_id: channel.id,
            author_id: userId,
            content: `${label}: ${cleanTitle} · ${announceWhen(startsAt)}`,
          });
        }
      } catch {
        // The announcement is a bonus — carry on to the event.
      }
    }

    router.replace(`/event/${eventId}`);
  }, [
    userId,
    pending,
    title,
    date,
    startTime,
    endTime,
    capacity,
    linkedCourseId,
    kind,
    description,
    location,
    router,
  ]);

  // Deep links land here directly — signed-out visitors get a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ flex: 1, paddingTop: insets.top + 8 }}>
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
            paddingBottom: insets.bottom + 32,
            gap: 14,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ gap: 6 }}>
            <AppText variant="display">Plan something</AppText>
            <AppText variant="caption" muted>
              Put it on the campus calendar — classmates can RSVP right away.
            </AppText>
          </View>

          {linkedCourseId && courseCode ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Linked to ${courseCode}. Tap to remove the link`}
              onPress={() => setLinkedCourseId(null)}
              hitSlop={8}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                alignSelf: "flex-start",
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: radius.full,
                backgroundColor: theme.accentSoft,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Feather name="book-open" size={13} color={theme.accent} />
              <AppText variant="label" style={{ color: theme.accent }}>
                For {courseCode}
              </AppText>
              <Feather name="x" size={13} color={theme.accent} />
            </Pressable>
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
            label={pending ? "Planning…" : "Put it on the calendar"}
            pending={pending}
            icon={<Feather name="calendar" size={16} color={theme.brandFg} />}
            onPress={() => void handleCreate()}
            style={{ marginTop: 4 }}
          />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
