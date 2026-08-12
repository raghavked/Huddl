import Feather from "@expo/vector-icons/Feather";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Field } from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useBlockedIds } from "@/hooks/use-blocked";
import { useTheme } from "@/hooks/use-theme";
import { blockUser } from "@/lib/blocks";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* The app-wide report flow. Pushed from anywhere with
   { messageId?, dmMessageId?, userId?, boardPostId?, label?, context? } —
   label is a short human subject (a display name, or a post's title) for the
   header, and context is the reported words themselves, quoted back so she
   can see exactly which message she's flagging.

   Four things can be reported, and public.reports takes any one of them: a
   room message, a direct message, a person, or a post on the campus board.
   Whichever it is, the author rides along in reported_user_id, because every
   subject column is `on delete set null` — the report has to keep a subject
   when the thing it named is deleted, which is the most likely moment for
   someone to try.

   Direct messages were the gap. Until migration 0038 there was no
   dm_message_id, so a reported DM filed against the PERSON with the words
   pasted into the reason box if the student thought to include them — and
   the moderator triaged a harassment report with no evidence attached. That
   is now a real subject like any other. */

/** Longest quoted excerpt we show back — enough to recognise the message. */
const CONTEXT_MAX = 240;

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
    dmMessageId?: string;
    userId?: string;
    boardPostId?: string;
    label?: string;
    context?: string;
  }>();
  const messageId =
    typeof params.messageId === "string" && params.messageId
      ? params.messageId
      : null;
  const reportedUserParam =
    typeof params.userId === "string" && params.userId ? params.userId : null;
  const dmMessageId =
    typeof params.dmMessageId === "string" && params.dmMessageId
      ? params.dmMessageId
      : null;
  const boardPostId =
    typeof params.boardPostId === "string" && params.boardPostId
      ? params.boardPostId
      : null;
  const label =
    typeof params.label === "string" && params.label.trim()
      ? params.label.trim()
      : null;
  const context =
    typeof params.context === "string" && params.context.trim()
      ? params.context.trim().slice(0, CONTEXT_MAX)
      : null;

  const [category, setCategory] = useState<Category | null>(null);
  const [categoryError, setCategoryError] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Blocking, offered on the way out. Reporting and blocking are one intent,
  // and the person who just filed a report is exactly who shouldn't have to
  // go find the profile screen to finish the job.
  const { blocked, refresh: refreshBlocked } = useBlockedIds();
  const [blockTarget, setBlockTarget] = useState<string | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);
  const canOfferBlock =
    blockTarget !== null && blockTarget !== myId && !blocked.has(blockTarget);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  };

  // Confirmation lingers just long enough to read, then steps back out — but
  // only when there's nothing left to decide. Offering to block and then
  // yanking the screen away mid-thought is worse than no offer at all.
  useEffect(() => {
    if (!done || canOfferBlock) return;
    const timer = setTimeout(() => {
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/home");
    }, 2200);
    return () => clearTimeout(timer);
  }, [done, canOfferBlock]);

  async function handleBlock() {
    if (!myId || !blockTarget || blocking) return;
    setBlocking(true);
    setBlockError(null);
    try {
      await blockUser(myId, blockTarget);
      await refreshBlocked();
    } catch {
      setBlockError("We couldn't block them just now. Give it another try.");
    } finally {
      setBlocking(false);
    }
  }

  /* Message, then post, then person — the same precedence `reportSubject` in
     `@/lib/moderation` reads them back with, so the sentence a student sees
     here and the one a moderator sees later name the same thing. A board post
     arrives with its author attached, and naming the post is what keeps this
     from reading as a report about them. A direct message is a message like
     any other now that 0038 gave it a column. */
  const aboutAMessage =
    Boolean(messageId) ||
    Boolean(dmMessageId) ||
    (Boolean(context) && !boardPostId);
  const subject = aboutAMessage
    ? label
      ? `a message from ${label}`
      : "a message"
    : boardPostId
      ? label
        ? `this post — ${label}`
        : "this post"
      : (label ?? "this person");
  /* The one case where the words still don't travel: a screen quoted a
     message at us without naming which row it was. The reason field has to
     carry it, and the copy below says so rather than letting a student assume
     the message went with it. */
  const wordsDontTravel =
    Boolean(context) && !messageId && !dmMessageId && !boardPostId;

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
        dm_message_id: dmMessageId,
        board_post_id: boardPostId,
        reported_user_id: reportedUserId,
        category,
        reason: trimmed,
      });
      if (error) throw error;
      // Whoever the report names is who the confirmation can offer to block.
      setBlockTarget(reportedUserId);
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
  if (!messageId && !dmMessageId && !reportedUserParam && !boardPostId) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + space.close,
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
            Head back and try again from the message, post, or profile you want
            to flag.
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
          paddingTop: insets.top + space.close,
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
          {/* Reporting and blocking are one intent. The report is filed
              either way; this is the half that changes her day today. */}
          {canOfferBlock ? (
            <View style={{ alignItems: "center", gap: 10, marginTop: 6 }}>
              <AppText
                variant="caption"
                muted
                style={{ textAlign: "center", maxWidth: 280 }}
              >
                {label
                  ? `Want to block ${label} while we look at it?`
                  : "Want to block them while we look at it?"}
              </AppText>
              <Button
                label="Block them too"
                variant="soft"
                pending={blocking}
                onPress={() => void handleBlock()}
                icon={<Feather name="slash" size={15} color={theme.brandInk} />}
              />
              {blockError ? (
                <AppText
                  variant="caption"
                  style={{ color: theme.danger, textAlign: "center" }}
                >
                  {blockError}
                </AppText>
              ) : null}
              <Button label="No thanks" variant="ghost" onPress={goBack} />
            </View>
          ) : blockTarget !== null && blocked.has(blockTarget) ? (
            <View style={{ alignItems: "center", gap: 10, marginTop: 6 }}>
              <AppText
                variant="caption"
                muted
                style={{ textAlign: "center", maxWidth: 300 }}
              >
                They can't message you, and their posts stay out of sight.
                They weren't told.
              </AppText>
              <Button label="Done" variant="soft" onPress={goBack} />
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + space.close,
      }}
    >
      <View style={{ paddingHorizontal: 20 }}>{backChevron}</View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + space.rest,
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

        {/* The words themselves, quoted back, so there's no doubt which
            message this is about. */}
        {context ? (
          <View
            style={{
              marginTop: 12,
              paddingLeft: 12,
              paddingVertical: 2,
              borderLeftWidth: 2,
              borderLeftColor: theme.border,
            }}
          >
            <AppText muted numberOfLines={4}>
              {context}
            </AppText>
          </View>
        ) : null}
        {wordsDontTravel ? (
          <AppText variant="caption" muted style={{ marginTop: 8 }}>
            We couldn't attach the message itself, so tell us below what was
            said.
          </AppText>
        ) : null}

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
