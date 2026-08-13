import Feather from "@expo/vector-icons/Feather";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
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

/* Forgot password, the native half.
 *
 * The emailed link does not come back to this app. Native deliberately sends
 * auth mail to the web app (signup.tsx documents the same round trip for
 * confirmation links) because a recovery link that opens a browser and then
 * has to hand a live session across to a bundle is three moving parts where
 * one will do. The student picks the new password on the web, then comes back
 * here and logs in with it. No password is ever typed on this screen.
 *
 * What this screen refuses to do is tell anyone whether an address has an
 * account. `resetPasswordForEmail` succeeds either way, and that is a feature
 * rather than a limitation: a screen that answers "we don't know that email"
 * is a membership oracle for a campus app, which is exactly the question a
 * student is entitled to keep private. So every sentence here is conditional
 * ("if that address has an account"), and the confirmation looks identical for
 * a real address and a typo.
 *
 * The four states arrive in the shape a form takes rather than the shape a
 * query takes: ready (the address), sending, failed with the send still one
 * tap away, and sent. There is no empty state because nothing is fetched:
 * there is no list here that could come back with nothing in it.
 */

const RESEND_COOLDOWN_S = 30;

/* Where the link in the email lands. `EXPO_PUBLIC_WEB_URL` is inlined at
   bundle time so a dev build can point at a laptop; production is the
   fallback.

   It goes STRAIGHT to /reset-password, and deliberately not through
   /auth/confirm the way the web app's own forgot-password form does. The two
   apps genuinely need different doors, because they are on different auth
   flows:

     - The web form runs on @supabase/ssr's browser client, which is PKCE. Its
       recovery link comes back carrying `?code=`, a query parameter, and
       /auth/confirm is the server route that exchanges it for cookies.
     - This app runs supabase-js with its default `flowType: 'implicit'` (see
       lib/supabase.ts; nothing overrides it). An implicit recovery link comes
       back carrying `#access_token=…`, a URL *fragment*, which by definition
       never reaches a server. Sending it to /auth/confirm would hand the
       server a request with no code and no token_hash, and the student would
       be told their link was invalid.

   Landing directly on /reset-password is what works: that page's browser
   client has `detectSessionInUrl` on by default, so it reads the fragment on
   load and the recovery session is established client-side.

   Switching this app to PKCE would NOT let both share the door. PKCE binds
   the exchange to the client that started it, and the phone is not the
   browser that finishes it. Two flows, two entrances, on purpose. */
const WEB_ORIGIN = (
  process.env.EXPO_PUBLIC_WEB_URL ?? "https://huddl.app"
).replace(/\/+$/, "");
const RESET_URL = `${WEB_ORIGIN}/reset-password`;

/** Enough of a check to catch a fat-fingered address, and no more. The real
    verdict is the inbox, and we're not in the business of rejecting valid
    addresses because they didn't match a regex. */
function looksLikeEmail(value: string) {
  const at = value.lastIndexOf("@");
  return at > 0 && value.slice(at + 1).includes(".") && !value.endsWith(".");
}

export default function ForgotPasswordScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string }>();

  const [email, setEmail] = useState(params.email?.trim() ?? "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [resent, setResent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Login hands the address over so nobody types it twice.
  useEffect(() => {
    const prefill = params.email?.trim();
    if (prefill) setEmail(prefill);
  }, [params.email]);

  // Reachable from login and from a cold deep link, so there isn't always
  // something behind us. Fall back to the screen that sent people here.
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(auth)/login");
  }, []);

  // Tick the cooldown down one second at a time.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleSend({ isResend }: { isResend: boolean }) {
    const address = email.trim();
    if (sending || cooldown > 0 || !address) return;
    if (!looksLikeEmail(address)) {
      setFieldError("That doesn't look like an email address yet.");
      return;
    }

    setSending(true);
    setFieldError(null);
    setError(null);

    const { error: sendError } = await supabase.auth.resetPasswordForEmail(
      address,
      { redirectTo: RESET_URL }
    );
    setSending(false);

    if (sendError) {
      // Supabase rate-limits auth mail hard, and "try again" on a throttled
      // send just burns another attempt, so that one case gets its own
      // sentence and its own wait. Everything else is one warm line; the raw
      // API string never reaches a student.
      const throttled =
        sendError.code === "over_email_send_rate_limit" ||
        /rate limit/i.test(sendError.message);
      if (throttled) {
        setCooldown(RESEND_COOLDOWN_S);
        setError(
          "That's a few reset emails in a row. Give it a minute, then try again."
        );
      } else {
        setError(
          "We couldn't send that email just now. Check your connection and give it another go."
        );
      }
      return;
    }

    setSent(true);
    setResent(isResend);
    setCooldown(RESEND_COOLDOWN_S);
  }

  function goToLogin() {
    router.replace({
      pathname: "/(auth)/login",
      params: email.trim() ? { email: email.trim() } : {},
    });
  }

  const address = email.trim();
  const sendLabel = sending
    ? "Sending…"
    : cooldown > 0
      ? `Try again in ${cooldown}s`
      : error
        ? "Try again"
        : "Send the reset link";
  const resendLabel = sending
    ? "Resending…"
    : cooldown > 0
      ? `Resend in ${cooldown}s`
      : "Resend the email";

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
        keyboardShouldPersistTaps="handled"
      >
        {sent ? (
          <>
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
                  {address}
                </AppText>
              </View>

              {/* Conditional on purpose. See the note at the top of the file.
                  We never say whether that address has an account. */}
              <AppText muted style={{ textAlign: "center" }}>
                If that address has a Huddl account, a link to set a new
                password is on its way. It opens in your browser. Pick the new
                password there, then come back here and log in with it.
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
                  <AppText
                    variant="body"
                    style={{ color: theme.danger, flex: 1 }}
                  >
                    {error}
                  </AppText>
                </View>
              ) : null}

              <Button
                label="Back to log in"
                size="lg"
                style={{ alignSelf: "stretch", marginTop: space.tight }}
                onPress={goToLogin}
              />

              {resent && cooldown > 0 ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.snug,
                  }}
                >
                  <Feather
                    name="check-circle"
                    size={14}
                    color={theme.success}
                  />
                  <AppText variant="caption" style={{ color: theme.success }}>
                    Sent again. Check your inbox (and spam).
                  </AppText>
                </View>
              ) : null}

              <Button
                label={resendLabel}
                variant="secondary"
                pending={sending}
                disabled={sending || cooldown > 0}
                style={{ alignSelf: "stretch" }}
                onPress={() => void handleSend({ isResend: true })}
                icon={
                  sending ? null : (
                    <Feather
                      name="send"
                      size={15}
                      color={cooldown > 0 ? theme.muted : theme.foreground}
                    />
                  )
                }
              />

              <AppText variant="caption" muted style={{ textAlign: "center" }}>
                Nothing after a few minutes? Check spam, and make sure that's
                the address you signed up with.
              </AppText>
            </Card>

            {/* Back to the form with the cooldown still running. A typo in
                the address is the likeliest reason nothing arrived, but auth
                mail is rate-limited per project rather than per address, so
                the next send waits its turn either way. */}
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setSent(false);
                setResent(false);
                setError(null);
              }}
              style={({ pressed }) => ({
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
                marginTop: space.close,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <AppText variant="caption" muted>
                Wrong email?{" "}
                <AppText
                  variant="caption"
                  style={{ color: theme.brand, fontFamily: fonts.bodySemi }}
                >
                  Use a different one
                </AppText>
              </AppText>
            </Pressable>
          </>
        ) : (
          <>
            <AppText variant="display" style={{ marginBottom: space.snug }}>
              Reset your password
            </AppText>
            <AppText muted style={{ marginBottom: space.gutter }}>
              Tell us the email you signed up with and we'll send a link for
              setting a new password.
            </AppText>

            <Card style={{ gap: space.card }}>
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
                  onChangeText={(next) => {
                    setEmail(next);
                    if (fieldError) setFieldError(null);
                  }}
                  onSubmitEditing={() => void handleSend({ isResend: false })}
                  returnKeyType="send"
                  error={fieldError}
                />
                <AppText variant="caption" muted>
                  The link opens on the web. You'll set the new password there,
                  then log in here.
                </AppText>
              </View>

              <Button
                label={sendLabel}
                size="lg"
                pending={sending}
                disabled={!address || sending || cooldown > 0}
                onPress={() => void handleSend({ isResend: false })}
              />
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
                Remembered it?{" "}
                <AppText
                  variant="caption"
                  style={{ color: theme.brand, fontFamily: fonts.bodySemi }}
                >
                  Back to log in
                </AppText>
              </AppText>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
