import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";

/** Minimal local row shape — the web app's types live outside this tsconfig. */
type University = {
  id: string;
  name: string;
  email_domain: string;
};

export default function SignupScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // null = still loading (or the fetch failed) — in that case we don't gate on
  // the client and let the DB trigger be the backstop.
  const [universities, setUniversities] = useState<University[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDomainError, setIsDomainError] = useState(false);
  const [accountExists, setAccountExists] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("universities")
      .select("id, name, email_domain")
      .order("name")
      .then(({ data, error: fetchError }) => {
        if (cancelled || fetchError || !data) return;
        setUniversities(data as unknown as University[]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const domain = useMemo(() => {
    const at = email.lastIndexOf("@");
    if (at === -1) return null;
    const d = email.slice(at + 1).trim().toLowerCase();
    return d.includes(".") && !d.endsWith(".") ? d : null;
  }, [email]);

  const matched = useMemo(() => {
    if (!domain || !universities) return null;
    return (
      universities.find((u) => u.email_domain.toLowerCase() === domain) ?? null
    );
  }, [domain, universities]);

  const unsupportedDomain = Boolean(
    domain && universities && universities.length > 0 && !matched
  );

  const confirmMismatch = confirm.length > 0 && confirm !== password;

  const canSubmit =
    !pending &&
    Boolean(email.trim()) &&
    password.length >= 8 &&
    confirm === password &&
    !unsupportedDomain;

  async function handleSignup() {
    if (pending) return;
    setError(null);
    setIsDomainError(false);
    setAccountExists(false);

    if (unsupportedDomain && domain) {
      setIsDomainError(true);
      setError("Huddl is campus-only — use your school email.");
      return;
    }

    setPending(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      // No emailRedirectTo on native: Supabase's confirmation link opens the
      // web app's /auth/confirm page, which is exactly what we want — the
      // student confirms there, then comes back here to log in.
      email: email.trim(),
      password,
    });

    if (signUpError) {
      setPending(false);
      if (/database error saving new user/i.test(signUpError.message)) {
        // The DB trigger rejects unknown email domains with this generic error.
        setIsDomainError(true);
        setError(
          domain
            ? `Huddl isn't at ${domain} yet. We're adding new schools all the time — check back soon.`
            : "Huddl isn't at your school yet. We're adding new schools all the time — check back soon."
        );
      } else if (/already registered/i.test(signUpError.message)) {
        setAccountExists(true);
      } else {
        setError(
          "We couldn't create your account just now — give it a moment and try again."
        );
      }
      return;
    }

    // With email confirmation on, signing up an existing confirmed address
    // returns an obfuscated user with no identities instead of an error.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setPending(false);
      setAccountExists(true);
      return;
    }

    // Confirmations off (e.g. local dev): we're already signed in — go
    // straight to onboarding. Otherwise, on to the check-your-inbox screen.
    if (data.session) {
      router.replace("/onboarding");
      return;
    }
    router.replace({
      pathname: "/(auth)/verify",
      params: { email: email.trim() },
    });
  }

  function goToLogin() {
    router.replace({
      pathname: "/(auth)/login",
      params: email.trim() ? { email: email.trim() } : {},
    });
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <View
        style={{
          paddingTop: insets.top + space.close,
          paddingHorizontal: space.gutter,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
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
          padding: space.gutter,
          paddingTop: space.tight,
          paddingBottom: insets.bottom + space.chapter,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <AppText variant="display" style={{ marginBottom: space.snug }}>
          Join your campus
        </AppText>
        <AppText muted style={{ marginBottom: space.gutter }}>
          Sign up with your school email — that's how we keep Huddl
          campus-only.
        </AppText>

        <Card style={{ gap: space.card }}>
          {accountExists ? (
            <View
              style={{
                backgroundColor: theme.accentSoft,
                borderRadius: radius.control,
                paddingHorizontal: space.card,
                paddingVertical: space.close,
                gap: space.room,
              }}
            >
              <AppText variant="body" style={{ color: theme.accent }}>
                Looks like you already have an account with that email.
              </AppText>
              <Button
                label="Log in instead"
                variant="soft"
                size="sm"
                onPress={goToLogin}
              />
            </View>
          ) : null}

          {error ? (
            <View
              style={{
                backgroundColor: theme.surface2,
                borderRadius: radius.control,
                paddingHorizontal: space.card,
                paddingVertical: space.close,
                gap: space.cosy,
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
                  name="alert-circle"
                  size={16}
                  color={theme.danger}
                  style={{ marginTop: space.hair }}
                />
                <AppText
                  variant="body"
                  style={{ color: theme.danger, flex: 1 }}
                >
                  {error}
                </AppText>
              </View>
              {isDomainError && universities && universities.length > 0 ? (
                <View style={{ paddingLeft: space.chapter, gap: space.hair }}>
                  <AppText variant="bodySemi">Huddl is currently at:</AppText>
                  {universities.map((u) => (
                    <AppText key={u.id} variant="caption" muted>
                      {u.name} (@{u.email_domain})
                    </AppText>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={{ gap: space.snug }}>
            <Field
              label="University email"
              placeholder="you@school.edu"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              autoCorrect={false}
              value={email}
              onChangeText={setEmail}
            />
            {matched ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.snug,
                }}
              >
                <Feather name="check-circle" size={14} color={theme.success} />
                <AppText
                  variant="caption"
                  style={{ color: theme.success, flex: 1 }}
                >
                  That's a {matched.name} address — you're in the right place.
                </AppText>
              </View>
            ) : unsupportedDomain ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.snug,
                }}
              >
                <Feather name="alert-circle" size={14} color={theme.danger} />
                <AppText
                  variant="caption"
                  style={{ color: theme.danger, flex: 1 }}
                >
                  Huddl is campus-only — use your school email.
                </AppText>
              </View>
            ) : (
              <AppText variant="caption" muted>
                Use your .edu address — we match it to your school.
              </AppText>
            )}
          </View>

          <View style={{ gap: space.snug }}>
            <Field
              label="Password"
              placeholder="At least 8 characters"
              secureTextEntry
              autoComplete="new-password"
              value={password}
              onChangeText={setPassword}
            />
            <AppText variant="caption" muted>
              At least 8 characters.
            </AppText>
          </View>

          <Field
            label="Confirm password"
            placeholder="Same one, one more time"
            secureTextEntry
            autoComplete="new-password"
            value={confirm}
            onChangeText={setConfirm}
            error={confirmMismatch ? "These passwords don't match yet." : null}
          />

          <Button
            label={pending ? "Creating your account…" : "Create account"}
            size="lg"
            pending={pending}
            disabled={!canSubmit}
            onPress={handleSignup}
          />

          <AppText variant="caption" muted style={{ textAlign: "center" }}>
            By creating an account you agree to our{" "}
            <AppText
              variant="caption"
              accessibilityRole="link"
              style={{ color: theme.brand, fontFamily: fonts.bodySemi }}
              onPress={() => router.push("/legal/terms")}
            >
              Terms of Service
            </AppText>{" "}
            and{" "}
            <AppText
              variant="caption"
              accessibilityRole="link"
              style={{ color: theme.brand, fontFamily: fonts.bodySemi }}
              onPress={() => router.push("/legal/privacy")}
            >
              Privacy Policy
            </AppText>
            .
          </AppText>

          <AppText variant="caption" muted style={{ textAlign: "center" }}>
            We'll email you a confirmation link to verify your student status.
          </AppText>
        </Card>

        <Pressable
          accessibilityRole="button"
          onPress={goToLogin}
          style={({ pressed }) => ({
            minHeight: 44,
            alignItems: "center",
            justifyContent: "center",
            marginTop: space.close,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <AppText variant="caption" muted>
            Already have an account?{" "}
            <AppText
              variant="caption"
              style={{ color: theme.brand, fontFamily: fonts.bodySemi }}
            >
              Log in
            </AppText>
          </AppText>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
