import Feather from "@expo/vector-icons/Feather";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Field } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* The app-wide report flow. Pushed from anywhere with
   { messageId?, userId?, label? } — label is a short human subject
   (a display name) for the header. Inserts into public.reports;
   message-only reports also record the message's author so the report
   keeps a subject if the message is later deleted. */

const CATEGORIES = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "spam", label: "Spam" },
  { value: "hate", label: "Hate or discrimination" },
  { value: "impersonation", label: "Impersonation" },
  { value: "sexual_content", label: "Sexual content" },
  { value: "self_harm", label: "Self-harm concern" },
  { value: "academic_dishonesty", label: "Academic dishonesty" },
  { value: "other", label: "Something else" },
] as const;

type Category = (typeof CATEGORIES)[number]["value"];

const RATE_LIMIT_MESSAGE =
  "You've filed a lot of reports this hour — we're on it. Try again later.";

function CategoryChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        justifyContent: "center",
        paddingHorizontal: 14,
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: selected ? theme.brand : theme.border,
        backgroundColor: selected ? theme.brandSoft : theme.surface,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <AppText
        variant="bodySemi"
        style={{
          fontSize: 14,
          color: selected ? theme.brandInk : theme.foreground,
        }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

export default function ReportScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const myId = session?.user.id ?? null;

  const params = useLocalSearchParams<{
    messageId?: string;
    userId?: string;
    label?: string;
  }>();
  const messageId =
    typeof params.messageId === "string" && params.messageId
      ? params.messageId
      : null;
  const reportedUserParam =
    typeof params.userId === "string" && params.userId ? params.userId : null;
  const label =
    typeof params.label === "string" && params.label.trim()
      ? params.label.trim()
      : null;

  const [category, setCategory] = useState<Category | null>(null);
  const [categoryError, setCategoryError] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  };

  // Confirmation lingers just long enough to read, then steps back out.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => {
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/home");
    }, 2200);
    return () => clearTimeout(timer);
  }, [done]);

  const subject = messageId
    ? label
      ? `a message from ${label}`
      : "a message"
    : (label ?? "this person");

  async function handleSubmit() {
    if (!myId || submitting) return;
    const trimmed = reason.trim();
    let valid = true;
    if (!category) {
      setCategoryError(true);
      valid = false;
    }
    if (trimmed.length === 0) {
      setReasonError("A few words about what happened helps us act fast.");
      valid = false;
    } else if (trimmed.length > 500) {
      setReasonError("Keep it under 500 characters — the short version is fine.");
      valid = false;
    }
    if (!valid || !category) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      // Message-only report: look up the author once so the report keeps a
      // subject even if the message is deleted later.
      let reportedUserId = reportedUserParam;
      if (!reportedUserId && messageId) {
        const { data } = await supabase
          .from("messages")
          .select("author_id")
          .eq("id", messageId)
          .maybeSingle();
        reportedUserId =
          (data as { author_id: string } | null)?.author_id ?? null;
      }

      const { error } = await supabase.from("reports").insert({
        reporter_id: myId,
        message_id: messageId,
        reported_user_id: reportedUserId,
        category,
        reason: trimmed,
      });
      if (error) throw error;
      setDone(true);
    } catch (err) {
      const message = (err as { message?: string } | null)?.message ?? "";
      setSubmitError(
        message.includes("reports this hour")
          ? RATE_LIMIT_MESSAGE
          : "That report didn't go through. Give it another try."
      );
    } finally {
      setSubmitting(false);
    }
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

  /* Nothing to report — pushed without a subject. */
  if (!messageId && !reportedUserParam) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
        }}
      >
        {backChevron}
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            paddingBottom: 80,
          }}
        >
          <Feather name="flag" size={28} color={theme.muted} />
          <AppText variant="title">Nothing to report here</AppText>
          <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
            Head back and try again from the message or profile you want to
            flag.
          </AppText>
          <Button label="Go back" variant="soft" size="sm" onPress={goBack} />
        </View>
      </View>
    );
  }

  /* Confirmation state. */
  if (done) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
        }}
      >
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            paddingBottom: 80,
          }}
        >
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: radius.full,
              backgroundColor: theme.accentSoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather name="check" size={26} color={theme.success} />
          </View>
          <AppText variant="title">Report sent</AppText>
          <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
            Thanks for looking out — we review reports within 24 hours.
          </AppText>
        </View>
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + 8,
      }}
    >
      <View style={{ paddingHorizontal: 20 }}>{backChevron}</View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 32,
        }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        <AppText variant="display" style={{ marginTop: 2 }}>
          Report
        </AppText>
        <AppText variant="caption" muted style={{ marginTop: 6 }}>
          You're reporting {subject}. Reports are private — they won't know it
          was you.
        </AppText>

        <AppText variant="label" style={{ marginTop: 20, marginBottom: 10 }}>
          What's going on?
        </AppText>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {CATEGORIES.map((c) => (
            <CategoryChip
              key={c.value}
              label={c.label}
              selected={category === c.value}
              onPress={() => {
                setCategory(c.value);
                setCategoryError(false);
              }}
            />
          ))}
        </View>
        {categoryError ? (
          <AppText
            variant="caption"
            style={{ color: theme.danger, marginTop: 8 }}
          >
            Pick the category that fits best.
          </AppText>
        ) : null}

        <View style={{ marginTop: 20 }}>
          <Field
            label="Tell us a bit more"
            value={reason}
            onChangeText={(text) => {
              setReason(text);
              if (reasonError) setReasonError(null);
            }}
            placeholder="What happened? A sentence or two is plenty."
            multiline
            maxLength={500}
            error={reasonError}
            style={{ minHeight: 120, textAlignVertical: "top" }}
          />
          <AppText
            variant="caption"
            muted
            style={{ marginTop: 6, textAlign: "right" }}
          >
            {reason.length}/500
          </AppText>
        </View>

        <View style={{ marginTop: 12, gap: 10 }}>
          <Button
            label="Send report"
            pending={submitting}
            onPress={() => void handleSubmit()}
            icon={<Feather name="flag" size={15} color={theme.brandFg} />}
          />
          {submitError ? (
            <AppText
              variant="caption"
              style={{ color: theme.danger, textAlign: "center" }}
            >
              {submitError}
            </AppText>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
