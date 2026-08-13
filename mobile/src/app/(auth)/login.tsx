import Feather from "@expo/vector-icons/Feather";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card, Field } from "@/components/ui";
import { fonts, radius, space } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/hooks/use-theme";

const RESEND_COOLDOWN_S = 30;

export default function LoginScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email?.trim() ?? "");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  // Three failures, three homes. A wrong password belongs on the password
  // field, because that is where the fix is. An unconfirmed address isn't a
  // typo at all. It's an unfinished signup, and it gets a panel with the way
  // out. Anything else is a one-line notice above the form.
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Signup/verify hand the email over so it's ready to go.
  useEffect(() => {
    const prefill = params.email?.trim();
    if (prefill) setEmail(prefill);
  }, [params.email]);

  // Tick the resend cooldown down one second at a time, same shape as
  // (auth)/verify.tsx, because auth email is rate-limited and a resend button
  // with no wait on it just spends a student's next three attempts.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleLogin() {
    if (pending) return;
    setCredentialError(null);
    setFormError(null);
    setUnconfirmed(false);
    setResent(false);
    setPending(true);
    const { data, error: signInError } =
      await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
    if (signInError) {
      setPending(false);
      // A student who signed up on their phone and never opened the email
      // gets the same "wrong password" from Supabase as someone who actually
      // mistyped it, and telling them to try the password again strands them
      // for good. The web app branches on the code too (see
      // src/features/auth/login-form.tsx), with a message test behind it for
      // the older self-hosted error shape.
      if (
        signInError.code === "email_not_confirmed" ||
        /not confirmed/i.test(signInError.message)
      ) {
        setUnconfirmed(true);
      } else if (
        signInError.code === "invalid_credentials" ||
        /invalid login credentials/i.test(signInError.message)
      ) {
        setCredentialError(
          "That email and password don't match. Give it another try."
        );
      } else {
        // The web app shows Supabase's own sentence in this branch. Native
        // doesn't: a raw API string is the one voice in the product nobody
        // wrote, and the next move is the same whatever it says.
        setFormError(
          "We couldn't log you in just now. Check your connection and give it another go."
        );
      }
      return;
    }

    // First login? `accepted_terms_at` is null until a student comes out the
    // far side of onboarding. The signup trigger writes a name and a handle
    // for everyone, so neither of those can tell a new account from an old
    // one. A profile we can't read is treated as finished: a login that can't
    // answer the question opens the app rather than blocking on it.
    const userId = data.user?.id;
    if (userId) {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("accepted_terms_at")
        .eq("id", userId)
        .maybeSingle();
      const row =
        (profile as { accepted_terms_at: string | null } | null) ?? null;
      if (!profileError && (!row || !row.accepted_terms_at)) {
        router.replace("/onboarding");
        return;
      }
    }
    // Everyone else goes back through the launch gate rather than straight to
    // the tabs, so a student who has finished onboarding but hasn't seen the
    // welcome on this device still gets it on this launch instead of the next
    // one.
    router.replace("/");
  }

  async function handleResendConfirmation() {
    const address = email.trim();
    if (!address || resending || cooldown > 0) return;
    setResending(true);
    setFormError(null);
    // No emailRedirectTo on native, exactly as in signup.tsx: the link opens
    // the web app's /auth/confirm, and the student comes back here to log in.
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: address,
    });
    setResending(false);
    if (resendError) {
      setFormError(
        "That resend didn't go through. Give it a moment and try again."
      );
      return;
    }
    setResent(true);
    setCooldown(RESEND_COOLDOWN_S);
  }

  const resendLabel = resending
    ? "Resending…"
    : cooldown > 0
      ? `Resend in ${cooldown}s`
      : "Resend the confirmation email";

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: space.gutter,
          paddingTop: insets.top + space.chapter,
          paddingBottom: insets.bottom + space.chapter,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <AppText
          variant="display"
          style={{ textAlign: "center", marginBottom: space.snug }}
        >
          hearth
        </AppText>
        <AppText
          muted
          style={{ textAlign: "center", marginBottom: space.chapter }}
        >
          Your campus, gathered.
        </AppText>

        <Card style={{ gap: space.card }}>
          <View style={{ gap: space.hair }}>
            <AppText variant="title">Welcome back</AppText>
            <AppText variant="caption" muted>
              Log in with your university email.
            </AppText>
          </View>

          {unconfirmed ? (
            <View
              style={{
                backgroundColor: theme.accentSoft,
                borderRadius: radius.control,
                paddingHorizontal: space.card,
                paddingVertical: space.close,
                gap: space.room,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: space.cosy,
                }}
              >
                <Feather
                  name="mail"
                  size={16}
                  color={theme.accent}
                  style={{ marginTop: space.hair }}
                />
                <AppText variant="body" style={{ color: theme.accent, flex: 1 }}>
                  Your email isn't confirmed yet. We sent a link to{" "}
                  {email.trim() || "your school email"}. Open it in your
                  browser, then come back and log in.
                </AppText>
              </View>
              {resent && cooldown > 0 ? (
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
                variant="soft"
                size="sm"
                pending={resending}
                disabled={!email.trim() || resending || cooldown > 0}
                onPress={handleResendConfirmation}
              />
            </View>
          ) : null}

          {formError ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: space.cosy,
                backgroundColor: theme.surface2,
                borderRadius: radius.control,
                paddingHorizontal: space.card,
                paddingVertical: space.close,
              }}
            >
              <Feather
                name="alert-circle"
                size={16}
                color={theme.danger}
                style={{ marginTop: space.hair }}
              />
              <AppText variant="body" style={{ color: theme.danger, flex: 1 }}>
                {formError}
              </AppText>
            </View>
          ) : null}

          <Field
            label="University email"
            placeholder="you@school.edu"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={(next) => {
              setEmail(next);
              // A new address makes the last verdict stale, including the
              // unconfirmed panel, which names the address it was about.
              if (unconfirmed) setUnconfirmed(false);
              if (credentialError) setCredentialError(null);
            }}
          />
          <Field
            label="Password"
            placeholder="Your password"
            secureTextEntry
            autoComplete="current-password"
            value={password}
            onChangeText={(next) => {
              setPassword(next);
              if (credentialError) setCredentialError(null);
            }}
            error={credentialError}
          />
          <Button
            label={pending ? "Logging in…" : "Log in"}
            size="lg"
            pending={pending}
            disabled={!email.trim() || !password}
            onPress={handleLogin}
          />

          {/* Caption text draws 16px tall, so it takes 14 of slop above and
              below to reach a 44px target. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Forgot your password?"
            hitSlop={{ top: 14, bottom: 14 }}
            onPress={() =>
              router.push({
                pathname: "/(auth)/forgot-password",
                params: email.trim() ? { email: email.trim() } : {},
              })
            }
            style={({ pressed }) => ({
              alignSelf: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <AppText
              variant="caption"
              style={{ color: theme.brand, fontFamily: fonts.bodySemi }}
            >
              Forgot your password?
            </AppText>
          </Pressable>
        </Card>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(auth)/signup")}
          style={({ pressed }) => ({
            minHeight: 44,
            alignItems: "center",
            justifyContent: "center",
            marginTop: space.close,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <AppText variant="caption" muted style={{ textAlign: "center" }}>
            New here?{" "}
            <AppText
              variant="caption"
              style={{ color: theme.brand, fontFamily: fonts.bodySemi }}
            >
              Create your account
            </AppText>
          </AppText>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
