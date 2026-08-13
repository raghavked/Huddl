import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card, EmptyState, Field } from "@/components/ui";
import { fonts, radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { tapSuccess } from "@/lib/haptics";
import {
  checkPassword,
  describeProblem,
  describeStrength,
  passwordsMatch,
  PASSWORD_MIN_LENGTH,
  type PasswordStrength,
} from "@/lib/password";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Security: the password, and everywhere it's still signed in.
 *
 * Two controls, and both of them are really the same worry said twice: a
 * password somebody else may have seen, and a session somebody else may still
 * be holding. They sit together because that is how a student arrives at
 * them. "I typed it into a library computer" is one thought, not two.
 *
 * WHY THE CURRENT PASSWORD IS ASKED FOR. `updateUser` will happily change the
 * password of whoever is holding the token, and on a phone the token is
 * simply *there*. The current-password field is the only thing standing
 * between a borrowed unlocked phone and an account somebody else now owns, so
 * it is checked for real (a `signInWithPassword` against the same address)
 * rather than trusted because the form drew a box for it.
 *
 * WHAT IT REFUSES TO DO. It never invents its own password rules: everything
 * about what is acceptable comes from `@/lib/password`, where `ok` gates the
 * submit and `strength` only labels the field. It never repeats a raw
 * Supabase sentence to a student. Every failure lands as one warm line with
 * the next move in it. And it never claims a password is safe; the strongest
 * thing this screen will say about one is "Strong".
 *
 * THE SESSION MAY BE PULLED OUT FROM UNDER IT. A password change can revoke
 * the account's other sessions, and depending on how the project is
 * configured, this one along with them. That arrives here as a null session
 * through `onAuthStateChange` in the auth provider, and `/security` is not
 * inside `(tabs)`, so nothing redirects on our behalf. So the success state
 * outranks the signed-out one: once a change has landed, no later loss of
 * the session may take the news of it off the screen. And it reads the live
 * session to decide its own last sentence. The student sees "it worked, and
 * you'll need to log in again", never a screen that empties itself the
 * instant it succeeded.
 *
 * Resetting by email is deliberately not re-implemented here. A student who
 * can't fill the first field goes out to `(auth)/forgot-password`, which
 * takes the same web round trip signup documents.
 */

/** Where the screen is in its own life, before any of the form's state. */
type Phase = "loading" | "error" | "signed-out" | "ready";

type FormErrors = {
  current?: string;
  next?: string;
  confirm?: string;
  form?: string;
};

/**
 * A field's error, said as part of the field rather than only drawn in red
 * beside it, the same trick `account.tsx` uses, for the same reason: `Field`
 * puts its `label` on the input, and a passed `accessibilityLabel` wins.
 */
function fieldLabel(label: string, error?: string | null): string {
  return error ? `${label}. ${error}` : label;
}

/**
 * The word under the new-password field, with the one useful thing to do
 * about it. The word itself comes from `@/lib/password` so the phone and the
 * laptop grade a password with the same vocabulary.
 */
function strengthNote(strength: PasswordStrength): string {
  const word = describeStrength(strength);
  switch (strength) {
    case "weak":
      return `${word}. Length is the easiest fix. A few unrelated words beat one clever one.`;
    case "ok":
      return `${word}. A couple more characters and it's strong.`;
    case "strong":
      return `${word}.`;
  }
}

export default function SecurityScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  const [phase, setPhase] = useState<Phase>("loading");
  const [email, setEmail] = useState<string | null>(null);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);

  const [othersPending, setOthersPending] = useState(false);
  const [othersDone, setOthersDone] = useState(false);
  const [othersError, setOthersError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  }, []);

  /* `getUser` rather than the session already in memory: it asks the server,
     and a screen that is about to collect a password should find out that the
     sign-in behind it has expired *before* the student types one. It also
     hands back the address the re-auth needs, from the source of truth. */
  const load = useCallback(async () => {
    setPhase("loading");
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      // A token the server has already retired isn't a network blip. There
      // is nothing to retry, they are simply signed out.
      const gone =
        error.code === "session_not_found" ||
        error.code === "session_expired" ||
        error.status === 401 ||
        error.status === 403;
      setEmail(null);
      setPhase(gone ? "signed-out" : "error");
      return;
    }
    // Every Huddl account is a university email address, so a user with none
    // isn't a case to design for; it's a sign-in we couldn't re-check.
    const address = data.user?.email ?? null;
    setEmail(address);
    setPhase(address ? "ready" : "signed-out");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* The session going away while the screen is open: a password changed on a
     laptop can revoke this phone, and it lands as a null session here. Two
     moments are deliberately exempt: mid-save, because `handleChange` is
     holding the outcome and is about to render it, and after a change, where
     the success card says so itself. */
  useEffect(() => {
    if (session || saving || changed) return;
    setPhase((previous) => (previous === "ready" ? "signed-out" : previous));
  }, [session, saving, changed]);

  const clearError = useCallback((key: keyof FormErrors) => {
    setErrors((previous) =>
      previous[key] ? { ...previous, [key]: undefined } : previous
    );
  }, []);

  const handleChange = useCallback(async () => {
    if (!email || saving) return;

    const found: FormErrors = {};
    if (!current) found.current = "Type the password you're using now.";

    const check = checkPassword(next, { email });
    if (!next) {
      found.next = "Pick a new password.";
    } else if (!check.ok) {
      // One sentence, the first one worth saying; the library orders them.
      found.next = describeProblem(check.problems[0]);
    } else if (next === current) {
      found.next = "That's the password you already have. Pick a different one.";
    }

    if (!found.next && !passwordsMatch(next, confirm)) {
      found.confirm = "These two don't match yet.";
    }

    if (Object.values(found).some(Boolean)) {
      setErrors(found);
      return;
    }

    setErrors({});
    setSaving(true);

    /* Step one: prove the current password. Signing in with it is the only
       way to actually check it, and it costs a fresh session for the same
       student, which is also what keeps `updateUser` from being refused for
       a login that happened three weeks ago. */
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email,
      password: current,
    });
    if (reauthError) {
      setSaving(false);
      if (
        reauthError.code === "invalid_credentials" ||
        /invalid login credentials/i.test(reauthError.message)
      ) {
        setErrors({
          current: "That's not the password you're using now. Give it another go.",
        });
      } else if (
        reauthError.code === "over_request_rate_limit" ||
        /rate limit/i.test(reauthError.message)
      ) {
        setErrors({
          form: "That's a few tries in a row. Give it a minute, then try again. Nothing changed.",
        });
      } else {
        setErrors({
          form: "We couldn't check your current password just now. Check your connection and give it another go.",
        });
      }
      return;
    }

    /* Step two: the change itself. */
    const { error: updateError } = await supabase.auth.updateUser({
      password: next,
    });
    if (updateError) {
      setSaving(false);
      if (
        updateError.code === "same_password" ||
        /should be different/i.test(updateError.message)
      ) {
        setErrors({
          next: "That's the password you already have. Pick a different one.",
        });
      } else if (updateError.code === "weak_password") {
        // Our own rules passed it and the server's didn't. Say what to do,
        // not whose rule it was.
        setErrors({
          next: "That one came back as too easy to guess. Longer beats fancier, so try a few unrelated words.",
        });
      } else if (
        updateError.code === "reauthentication_needed" ||
        updateError.code === "reauthentication_not_valid" ||
        /reauthenticat/i.test(updateError.message)
      ) {
        // Some projects want a fresh sign-in of their own before a password
        // moves. We can't do that from in here, so we hand over both exits.
        setErrors({
          form: "This account wants a fresh sign-in before its password can change, so nothing changed. Sign out, sign back in, and come straight here. Or reset it by email from the login screen.",
        });
      } else if (
        updateError.code === "session_not_found" ||
        updateError.code === "session_expired"
      ) {
        setErrors({
          form: "Your sign-in ran out before that went through, so nothing changed. Sign in again and it'll take.",
        });
      } else if (
        updateError.code === "over_request_rate_limit" ||
        /rate limit/i.test(updateError.message)
      ) {
        setErrors({
          form: "That's a few tries in a row. Give it a minute, then try again. Nothing changed.",
        });
      } else {
        setErrors({
          form: "We couldn't change your password just now. Check your connection and give it another go.",
        });
      }
      return;
    }

    setSaving(false);
    // Nothing typed here should survive the moment it stopped being needed.
    setCurrent("");
    setNext("");
    setConfirm("");
    setChanged(true);
    tapSuccess();
  }, [email, saving, current, next, confirm]);

  const signOutOthers = useCallback(async () => {
    if (othersPending) return;
    setOthersPending(true);
    setOthersError(null);
    setOthersDone(false);
    /* `scope: "others"` leaves this device's session alone. That's the whole
       point of the control, and it's why this one doesn't clear the push
       token the way signing out does. */
    const { error } = await supabase.auth.signOut({ scope: "others" });
    setOthersPending(false);
    if (error) {
      setOthersError(
        "Those other sessions are still signed in. Give it another go."
      );
      return;
    }
    setOthersDone(true);
    tapSuccess();
  }, [othersPending]);

  const confirmSignOutOthers = useCallback(() => {
    Alert.alert(
      "Sign out everywhere else?",
      "Every other phone, tablet and browser signed in as you gets signed out. This one stays.",
      [
        { text: "Keep them", style: "cancel" },
        {
          text: "Sign them out",
          style: "destructive",
          onPress: () => void signOutOthers(),
        },
      ]
    );
  }, [signOutOthers]);

  /* The screen keeps working with a dead session only in one direction: it
     can report a change that already happened. Everything else needs a live
     one, and the card below says so rather than failing on the next tap. */
  const sessionLost = session === null;

  const strength = next
    ? checkPassword(next, { email: email ?? undefined }).strength
    : null;
  const strengthColor =
    strength === "strong"
      ? theme.success
      : strength === "weak"
        ? theme.warning
        : theme.muted;

  const changePasswordCard = (
    <Card style={{ gap: space.close }}>
      <View style={{ gap: space.tight }}>
        <AppText variant="title" accessibilityRole="header">
          Change your password
        </AppText>
        <AppText variant="caption" muted>
          Signed in as {email}. We'll ask for the one you use now before
          setting the new one.
        </AppText>
      </View>

      <Field
        label="Current password"
        accessibilityLabel={fieldLabel("Current password", errors.current)}
        value={current}
        onChangeText={(text) => {
          setCurrent(text);
          clearError("current");
        }}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="next"
        error={errors.current ?? null}
      />

      <View style={{ gap: space.snug }}>
        <Field
          label="New password"
          accessibilityLabel={fieldLabel("New password", errors.next)}
          value={next}
          onChangeText={(text) => {
            setNext(text);
            clearError("next");
            clearError("confirm");
          }}
          placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          error={errors.next ?? null}
        />
        {/* The word labels the field, it does not gate it: a "Weak" password
            still submits, and the errors above are the only thing that ever
            stops one. That split is the library's, not this screen's. */}
        {errors.next ? null : strength ? (
          <AppText
            variant="caption"
            accessibilityLiveRegion="polite"
            style={{ color: strengthColor }}
          >
            {strengthNote(strength)}
          </AppText>
        ) : (
          <AppText variant="caption" muted>
            At least {PASSWORD_MIN_LENGTH} characters. Length does more for you
            than punctuation does.
          </AppText>
        )}
      </View>

      <Field
        label="Confirm new password"
        accessibilityLabel={fieldLabel("Confirm new password", errors.confirm)}
        value={confirm}
        onChangeText={(text) => {
          setConfirm(text);
          clearError("confirm");
        }}
        placeholder="Same one, one more time"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="done"
        onSubmitEditing={() => void handleChange()}
        error={errors.confirm ?? null}
      />

      {errors.form ? (
        <View
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel={errors.form}
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: space.cosy,
            paddingHorizontal: space.close,
            paddingVertical: space.room,
            borderRadius: radius.control,
            backgroundColor: theme.surface2,
          }}
        >
          <Feather
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            name="alert-circle"
            size={14}
            color={theme.danger}
            style={{ marginTop: space.hair }}
          />
          <AppText variant="caption" style={{ color: theme.danger, flex: 1 }}>
            {errors.form}
          </AppText>
        </View>
      ) : null}

      <Button
        label={saving ? "Changing…" : "Change password"}
        pending={saving}
        accessibilityState={{ busy: saving, disabled: saving }}
        onPress={() => void handleChange()}
      />

      {/* The way out for someone who can't fill the first field. The emailed
          link opens the web app, the same round trip signup and
          forgot-password already document, and setting a password there can
          sign this phone out, which is fine: they'll come back and log in. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Don't remember your current password? Reset it by email."
        hitSlop={{ top: 14, bottom: 14 }}
        onPress={() =>
          router.push({
            pathname: "/(auth)/forgot-password",
            params: email ? { email } : {},
          })
        }
        style={({ pressed }) => ({
          alignSelf: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <AppText variant="caption" muted>
          Don't remember it?{" "}
          <AppText
            variant="caption"
            style={{ color: theme.brand, fontFamily: fonts.bodySemi }}
          >
            Reset it by email
          </AppText>
        </AppText>
      </Pressable>
    </Card>
  );

  /* Announced when it arrives, but never collapsed into a single
     accessibility node: the button inside has to stay reachable on its own. */
  const successCard = (
    <Card
      accessibilityLiveRegion="polite"
      style={{
        alignItems: "center",
        gap: space.close,
        paddingVertical: space.chapter,
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
        <Feather
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          name="check"
          size={24}
          color={theme.brandInk}
        />
      </View>

      <AppText variant="title" accessibilityRole="header">
        Your password is changed
      </AppText>

      {/* Which of these is true gets decided somewhere else, and possibly a
          second after the tap, so it reads the session live rather than
          whatever it was when the change went through. */}
      <AppText variant="body" muted style={{ textAlign: "center" }}>
        {sessionLost
          ? "This phone was signed out along with everywhere else. Log in with the new one and everything's where you left it."
          : "Use the new one next time you log in. Anywhere else signed in as you may have been signed out by the change."}
      </AppText>

      <Button
        label={sessionLost ? "Go to log in" : "Back to settings"}
        style={{ alignSelf: "stretch", marginTop: space.tight }}
        onPress={() =>
          sessionLost ? router.replace("/(auth)/login") : goBack()
        }
      />
    </Card>
  );

  const signOutOthersCard = (
    <Card style={{ gap: space.close }}>
      <View style={{ gap: space.tight }}>
        <AppText variant="title" accessibilityRole="header">
          Sign out everywhere else
        </AppText>
        <AppText variant="caption" muted>
          Signs you out on every other phone, tablet and browser signed in as
          you. This one stays put. Worth doing if you left yourself logged in
          on a library computer.
        </AppText>
      </View>

      <Button
        label={othersPending ? "Signing them out…" : "Sign out everywhere else"}
        variant="secondary"
        pending={othersPending}
        accessibilityState={{ busy: othersPending, disabled: othersPending }}
        icon={
          othersPending ? null : (
            <Feather name="log-out" size={15} color={theme.foreground} />
          )
        }
        onPress={confirmSignOutOthers}
      />

      {othersError ? (
        <AppText
          variant="caption"
          accessibilityLiveRegion="polite"
          style={{ color: theme.danger }}
        >
          {othersError}
        </AppText>
      ) : othersDone ? (
        <View
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel="Everywhere else is signed out. Anything else signed in as you will ask for your password again."
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: space.cosy,
          }}
        >
          <Feather
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            name="check-circle"
            size={14}
            color={theme.success}
            style={{ marginTop: space.hair }}
          />
          <AppText variant="caption" style={{ color: theme.success, flex: 1 }}>
            Everywhere else is signed out. Anything else signed in as you will
            ask for your password again.
          </AppText>
        </View>
      ) : null}
    </Card>
  );

  let body: React.ReactNode;
  if (phase === "loading") {
    body = (
      <Card style={{ alignItems: "center", paddingVertical: space.rest }}>
        <ActivityIndicator
          accessibilityLabel="Checking your sign-in"
          color={theme.brand}
        />
      </Card>
    );
  } else if (phase === "error") {
    body = (
      <Card
        accessibilityLiveRegion="polite"
        style={{
          alignItems: "center",
          gap: space.room,
          paddingVertical: space.chapter,
        }}
      >
        <Feather
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          name="cloud-off"
          size={26}
          color={theme.muted}
        />
        <AppText variant="bodySemi" accessibilityRole="header">
          Something went sideways
        </AppText>
        <AppText
          variant="caption"
          muted
          style={{ textAlign: "center", maxWidth: 280 }}
        >
          We couldn't check your sign-in just now, and this screen won't ask for
          a password until it can. Check your connection and give it another go.
        </AppText>
        <Button
          label="Try again"
          variant="soft"
          size="sm"
          onPress={() => void load()}
        />
      </Card>
    );
  } else if (phase === "signed-out" && !changed) {
    body = (
      <EmptyState
        icon="log-in"
        title="You're signed out"
        body="Changing your password and clearing your other sessions both need a live sign-in to work on. Log back in and this screen is right where you left it."
        action={{
          label: "Go to log in",
          onPress: () => router.replace("/(auth)/login"),
        }}
      />
    );
  } else {
    body = (
      <View style={{ gap: space.card }}>
        {changed ? successCard : changePasswordCard}
        {/* Only offered while there's a session to do it with. After a change
            that took this phone down with it, the button would fail on tap. */}
        {session ? signOutOthersCard : null}
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
      <View style={{ paddingHorizontal: space.gutter }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={goBack}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            /* Pulls the 44px target's optical edge back onto the gutter. */
            marginLeft: -10,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            name="chevron-left"
            size={26}
            color={theme.foreground}
          />
        </Pressable>

        <AppText
          variant="display"
          accessibilityRole="header"
          style={{ marginTop: space.hair, marginBottom: space.snug }}
        >
          Security
        </AppText>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: space.gutter,
            paddingBottom: insets.bottom + space.rest,
            gap: space.card,
          }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <AppText variant="body" muted>
            The password you log in with, and the other devices still signed in
            as you.
          </AppText>

          {body}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
