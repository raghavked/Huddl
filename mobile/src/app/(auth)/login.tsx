import { router } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card, Field } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/hooks/use-theme";

export default function LoginScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setError(null);
    setPending(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setPending(false);
    if (signInError) {
      setError("That email and password don't match. Give it another try.");
      return;
    }
    router.replace("/(tabs)/home");
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

        <AppText
          variant="caption"
          muted
          style={{ textAlign: "center", marginTop: 20 }}
        >
          New here? Sign up on the web first — accounts are verified with your
          school email.
        </AppText>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
