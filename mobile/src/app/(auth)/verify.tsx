import Feather from "@expo/vector-icons/Feather";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card } from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";

const RESEND_COOLDOWN_S = 30;

export default function VerifyScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = params.email?.trim() || null;

  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Signup replaces itself with this screen, so there is usually nothing
  // behind us, so fall back to sending people back to sign up.
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(auth)/signup");
  }, []);

  // Tick the resend cooldown down one second at a time.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleResend() {
    if (!email || sending || cooldown > 0) return;
    setSending(true);
    setError(null);
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email,
    });
    setSending(false);
    if (resendError) {
      setError("That resend didn't go through. Give it a moment and try again.");
      return;
    }
    setSent(true);
    setCooldown(RESEND_COOLDOWN_S);
  }

  function goToLogin() {
    router.replace({
      pathname: "/(auth)/login",
      params: email ? { email } : {},
    });
  }

  const resendLabel = sending
    ? "Resending…"
    : cooldown > 0
      ? `Resend in ${cooldown}s`
      : "Resend the email";

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        style={{
          paddingTop: insets.top + space.close,
          paddingHorizontal: space.gutter,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={goBack}
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
      </View>

      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: space.gutter,
          paddingBottom: insets.bottom + space.chapter,
        }}
      >
        <Card
          style={{
            alignItems: "center",
            gap: space.close,
            paddingVertical: space.rest,
          }}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: radius.control,
              backgroundColor: theme.brandSoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather name="mail" size={24} color={theme.brandInk} />
          </View>

          <AppText variant="display" style={{ textAlign: "center" }}>
            Check your inbox
          </AppText>

          {email ? (
            <View
              style={{
                backgroundColor: theme.brandSoft,
                borderRadius: radius.full,
                paddingHorizontal: space.card,
                paddingVertical: space.snug,
                maxWidth: "100%",
              }}
            >
              <AppText
                variant="bodySemi"
                numberOfLines={1}
                style={{ color: theme.brandInk }}
              >
                {email}
              </AppText>
            </View>
          ) : null}

          <AppText muted style={{ textAlign: "center" }}>
            We sent a confirmation link to{" "}
            {email ? "that address" : "your school email"}. It opens in your
            browser. Tap it to prove you're a student, then come back here and
            log in.
          </AppText>

          {error ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: space.cosy,
                backgroundColor: theme.surface2,
                borderRadius: radius.control,
                paddingHorizontal: space.card,
                paddingVertical: space.close,
                alignSelf: "stretch",
              }}
            >
              <Feather
                name="alert-circle"
                size={16}
                color={theme.danger}
                style={{ marginTop: space.hair }}
              />
              <AppText variant="body" style={{ color: theme.danger, flex: 1 }}>
                {error}
              </AppText>
            </View>
          ) : null}

          <Button
            label="I've confirmed, log me in"
            size="lg"
            style={{ alignSelf: "stretch", marginTop: space.tight }}
            onPress={goToLogin}
          />

          {sent && cooldown > 0 ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.snug,
              }}
            >
              <Feather name="check-circle" size={14} color={theme.success} />
              <AppText variant="caption" style={{ color: theme.success }}>
                Sent. Check your inbox (and spam).
              </AppText>
            </View>
          ) : null}

          <Button
            label={resendLabel}
            variant="secondary"
            pending={sending}
            disabled={!email || sending || cooldown > 0}
            style={{ alignSelf: "stretch" }}
            onPress={handleResend}
            icon={
              sending ? null : (
                <Feather
                  name="send"
                  size={15}
                  color={cooldown > 0 || !email ? theme.muted : theme.foreground}
                />
              )
            }
          />

          {!email ? (
            <AppText variant="caption" muted style={{ textAlign: "center" }}>
              We lost track of your email on the way here. Head back and sign
              up again. It only takes a minute.
            </AppText>
          ) : null}
        </Card>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/(auth)/signup")}
          style={({ pressed }) => ({
            minHeight: 44,
            alignItems: "center",
            justifyContent: "center",
            marginTop: space.close,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <AppText variant="caption" muted>
            Wrong email? Start over
          </AppText>
        </Pressable>
      </ScrollView>
    </View>
  );
}
