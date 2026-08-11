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
import { fonts } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/hooks/use-theme";

export default function LoginScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email?.trim() ?? "");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Signup/verify hand the email over so it's ready to go.
  useEffect(() => {
    const prefill = params.email?.trim();
    if (prefill) setEmail(prefill);
  }, [params.email]);

  async function handleLogin() {
    setError(null);
    setPending(true);
    const { data, error: signInError } =
      await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
    if (signInError) {
      setPending(false);
      setError("That email and password don't match. Give it another try.");
      return;
    }

    // First login? `accepted_terms_at` is null until a student comes out the
    // far side of onboarding — the signup trigger writes a name and a handle
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
    // welcome on this device still gets it — on this launch, not the next one.
    router.replace("/");
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 20,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <AppText
          variant="display"
          style={{ textAlign: "center", marginBottom: 6 }}
        >
          huddl
        </AppText>
        <AppText
          muted
          style={{ textAlign: "center", marginBottom: 24 }}
        >
          Your campus, in one huddle.
        </AppText>

        <Card style={{ gap: 16 }}>
          <View style={{ gap: 2 }}>
            <AppText variant="title">Welcome back</AppText>
            <AppText variant="caption" muted>
              Log in with your university email.
            </AppText>
          </View>
          <Field
            label="University email"
            placeholder="you@school.edu"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <Field
            label="Password"
            placeholder="Your password"
            secureTextEntry
            autoComplete="current-password"
            value={password}
            onChangeText={setPassword}
            error={error}
          />
          <Button
            label={pending ? "Logging in…" : "Log in"}
            size="lg"
            pending={pending}
            disabled={!email.trim() || !password}
            onPress={handleLogin}
          />
        </Card>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(auth)/signup")}
          style={({ pressed }) => ({
            minHeight: 44,
            alignItems: "center",
            justifyContent: "center",
            marginTop: 12,
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
