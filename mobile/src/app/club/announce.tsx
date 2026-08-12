import Feather from "@expo/vector-icons/Feather";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Mug } from "@/components/illustrations";
import {
  AppText,
  Button,
  EmptyState,
  Field,
  useReducedMotion,
} from "@/components/ui";
import { motion, radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  ClubAnnouncementError,
  canPostAnnouncements,
  fetchMyClubRole,
  postAnnouncement,
  type ClubRole,
} from "@/lib/club-announcements";
import { tapSuccess } from "@/lib/haptics";
import { useAuth } from "@/providers/auth-provider";

/* Writing to the whole club at once.
 *
 * One title, one body, one notification each — that last part is the reason
 * this screen exists instead of a pinned chat message, and the reason the
 * line above the form says so out loud before anyone starts typing.
 *
 * Officers and owners only. We check the role on mount rather than letting
 * the insert bounce, so a member who wandered in gets a warm explanation
 * instead of a permissions error. Every query and every error sentence comes
 * from `@/lib/club-announcements`. */

/** Start warning about the cap this late — earlier is just nagging. */
const COUNT_VISIBLE_FROM = 1800;

/** How long the "posted" note sits on screen before we hand the club back. */
const CONFIRM_MS = 900;

type RoleStatus = "loading" | "error" | "ready";

/** The confirmation beat: a fern check, one sentence, then back to the club. */
function PostedNote() {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const enter = useRef(new Animated.Value(0)).current;

  // An arrival, so it lands on the out-curve — and lands instantly when the
  // student has asked the OS for less movement.
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: reduceMotion ? motion.instant : motion.base,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter, reduceMotion]);

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 28,
        opacity: enter,
        transform: [
          {
            translateY: enter.interpolate({
              inputRange: [0, 1],
              outputRange: [6, 0],
            }),
          },
        ],
      }}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: radius.full,
          backgroundColor: theme.accentSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name="check" size={24} color={theme.accent} />
      </View>
      <AppText variant="title">Posted — the club has it.</AppText>
    </Animated.View>
  );
}

export default function ClubAnnounceScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const { clubId, clubName } = useLocalSearchParams<{
    clubId?: string;
    clubName?: string;
  }>();
  const club = clubId ?? "";

  const [roleStatus, setRoleStatus] = useState<RoleStatus>("loading");
  const [role, setRole] = useState<ClubRole | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [posted, setPosted] = useState(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else if (club) router.replace(`/club/${club}`);
    else router.replace("/(tabs)/clubs");
  }, [router, club]);

  const loadRole = useCallback(async () => {
    if (!club) {
      setRoleStatus("ready");
      return;
    }
    setRoleStatus("loading");
    try {
      setRole(await fetchMyClubRole(club));
      setRoleStatus("ready");
    } catch {
      setRoleStatus("error");
    }
  }, [club]);

  useEffect(() => {
    void loadRole();
  }, [loadRole]);

  // The confirmation gets a beat to be read, then the club page comes back
  // with the new post already on it.
  useEffect(() => {
    if (!posted) return;
    const timer = setTimeout(goBack, CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [posted, goBack]);

  const handlePost = useCallback(async () => {
    if (pending || posted || !club) return;
    setFormError(null);
    setPending(true);
    try {
      await postAnnouncement({ clubId: club, title, body });
      // A completion moment: the club just heard from you.
      tapSuccess();
      setPosted(true);
    } catch (caught) {
      setFormError(
        caught instanceof ClubAnnouncementError
          ? caught.message
          : "We couldn't post that just now. Give it another go."
      );
    } finally {
      setPending(false);
    }
  }, [pending, posted, club, title, body]);

  // Deep links land here directly — signed-out visitors get a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  const heading = clubName ? `Post to ${clubName}` : "Post to the club";
  const remaining = ANNOUNCEMENT_BODY_MAX - body.length;
  const showCount = body.length > COUNT_VISIBLE_FROM;
  const canSubmit = title.trim().length > 0 && body.trim().length > 0;
  const mayPost = canPostAnnouncements(role);

  const backChevron = (
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
  );

  const scaffold = (children: React.ReactNode) => (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ flex: 1, paddingTop: insets.top + space.close }}>
        {backChevron}
        {children}
      </View>
    </KeyboardAvoidingView>
  );

  if (posted) {
    return scaffold(<PostedNote />);
  }

  // Only reachable from a stray deep link — the club page always passes both
  // params. Say what's missing instead of pretending the club is closed.
  if (!club) {
    return scaffold(
      <View
        style={{ flex: 1, justifyContent: "center", paddingHorizontal: 20 }}
      >
        <EmptyState
          illustration={Mug}
          title="Which club is this for?"
          body="We lost track of the club along the way. Open it from your clubs and tap Post again."
          action={{ label: "Back to your clubs", onPress: goBack }}
        />
      </View>
    );
  }

  if (roleStatus === "loading") {
    return scaffold(
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          paddingBottom: 60,
        }}
      >
        <ActivityIndicator size="large" color={theme.brand} />
        <AppText variant="caption" muted>
          Opening the composer…
        </AppText>
      </View>
    );
  }

  if (roleStatus === "error") {
    return scaffold(
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          paddingHorizontal: 28,
          paddingBottom: 60,
        }}
      >
        <Feather name="cloud-off" size={28} color={theme.muted} />
        <AppText variant="bodySemi">Something hiccuped</AppText>
        <AppText
          variant="caption"
          muted
          style={{ textAlign: "center", maxWidth: 280 }}
        >
          We couldn't check whether you're an officer here. Check your
          connection and give it another go.
        </AppText>
        <Button
          label="Try again"
          variant="soft"
          size="sm"
          onPress={() => void loadRole()}
        />
      </View>
    );
  }

  // Not an officer — or not in the club at all. Either way, an explanation
  // and a way out, never a raw permissions error.
  if (!mayPost) {
    return scaffold(
      <View
        style={{ flex: 1, justifyContent: "center", paddingHorizontal: 20 }}
      >
        <EmptyState
          illustration={Mug}
          title={
            role === null
              ? "You're not in this club yet"
              : "Officers post the announcements"
          }
          body={
            role === null
              ? "Join the club first, and you'll get every post the officers send."
              : "Only officers and the owner can write to everyone at once. If something needs saying, nudge one of them in the club chat."
          }
          action={{ label: "Back to the club", onPress: goBack }}
        />
      </View>
    );
  }

  return scaffold(
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
        <AppText variant="display">{heading}</AppText>
        <AppText variant="caption" muted>
          Everyone in the club gets this once, in their notifications.
        </AppText>
      </View>

      <Field
        label="Title"
        value={title}
        onChangeText={setTitle}
        placeholder="Officer elections are Thursday"
        maxLength={ANNOUNCEMENT_TITLE_MAX}
        editable={!pending}
        returnKeyType="next"
      />

      <View style={{ gap: 6 }}>
        <Field
          label="What's happening"
          value={body}
          onChangeText={setBody}
          placeholder="Where, when, and what to bring."
          maxLength={ANNOUNCEMENT_BODY_MAX}
          multiline
          editable={!pending}
          style={{ minHeight: 160, textAlignVertical: "top" }}
        />
        {showCount ? (
          remaining > 0 ? (
            <AppText variant="caption" muted style={{ alignSelf: "flex-end" }}>
              {remaining} characters left
            </AppText>
          ) : (
            <AppText
              variant="caption"
              style={{ alignSelf: "flex-end", color: theme.danger }}
            >
              That's the full {ANNOUNCEMENT_BODY_MAX} characters — trim
              something to add more.
            </AppText>
          )
        ) : null}
      </View>

      {formError ? (
        <AppText variant="caption" style={{ color: theme.danger }}>
          {formError}
        </AppText>
      ) : null}

      <Button
        label={pending ? "Posting…" : "Post to everyone"}
        pending={pending}
        disabled={!canSubmit}
        icon={<Feather name="send" size={16} color={theme.brandFg} />}
        onPress={() => void handlePost()}
        style={{ marginTop: 4 }}
      />
    </ScrollView>
  );
}
