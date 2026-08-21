import Feather from "@expo/vector-icons/Feather";
import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import { useAuth } from "@/providers/auth-provider";

const HANDLE_RE = /^[a-z0-9_]{3,24}$/;
const BIO_MAX = 280;
const HANDLE_HINT =
  "3–24 characters: lowercase letters, numbers, underscores.";

/** Minimal local row shape. The web app's types live outside this tsconfig. */
type ProfileRow = {
  display_name: string;
  handle: string;
  major: string | null;
  grad_year: number | null;
  bio: string | null;
  university: { name: string } | null;
};

type HandleStatus = "idle" | "checking" | "available" | "taken" | "invalid";

/** "ada.lovelace@school.edu" -> "adalovelace" as a friendly starting handle. */
function handleFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const cleaned = local.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return cleaned.slice(0, 24);
}

export default function OnboardingScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const userId = session?.user.id ?? null;
  const userEmail = session?.user.email ?? "";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Whether a profiles row already exists (the signup trigger creates one).
  const [hasRow, setHasRow] = useState(false);
  const [universityName, setUniversityName] = useState<string | null>(null);
  // The handle already saved on the row, so no availability check for it.
  const [savedHandle, setSavedHandle] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [major, setMajor] = useState("");
  const [gradYear, setGradYear] = useState("");
  const [bio, setBio] = useState("");

  const [handleStatus, setHandleStatus] = useState<HandleStatus>("idle");
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [errors, setErrors] = useState<{
    displayName?: string;
    handle?: string;
    gradYear?: string;
    form?: string;
  }>({});

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setLoadError(null);
    const { data, error: queryError } = await supabase
      .from("profiles")
      .select(
        "display_name, handle, major, grad_year, bio, university:universities(name)"
      )
      .eq("id", userId)
      .maybeSingle();
    if (queryError) {
      setLoading(false);
      setLoadError("We couldn't load your profile right now.");
      return;
    }
    const row = (data as unknown as ProfileRow | null) ?? null;
    if (row) {
      setHasRow(true);
      setSavedHandle(row.handle);
      setDisplayName(row.display_name ?? "");
      setHandle(row.handle ?? "");
      setMajor(row.major ?? "");
      setGradYear(row.grad_year ? String(row.grad_year) : "");
      setBio(row.bio ?? "");
      setUniversityName(row.university?.name ?? null);
    } else {
      // No row yet (unusual, since the signup trigger normally creates one).
      // Start from sensible defaults and insert on save.
      setHasRow(false);
      setSavedHandle(null);
      setHandle(handleFromEmail(userEmail));
    }
    setLoading(false);
  }, [userId, userEmail]);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced handle availability check against classmates' handles.
  useEffect(() => {
    if (!userId) return;
    const h = handle.trim().toLowerCase();
    if (!h || h === savedHandle) {
      setHandleStatus("idle");
      return;
    }
    if (!HANDLE_RE.test(h)) {
      setHandleStatus("invalid");
      return;
    }
    setHandleStatus("checking");
    let cancelled = false;
    const timer = setTimeout(() => {
      void supabase
        .from("profiles")
        .select("id")
        .eq("handle", h)
        .neq("id", userId)
        .maybeSingle()
        .then(({ data, error: checkError }) => {
          if (cancelled) return;
          if (checkError) {
            // Can't check right now. The unique constraint is the backstop.
            setHandleStatus("idle");
            return;
          }
          setHandleStatus(data ? "taken" : "available");
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handle, savedHandle, userId]);

  /**
   * "Skip for now" leaves the form as it stands and goes on in.
   *
   * It still stamps `accepted_terms_at`, and that is not a shortcut: signup
   * told them creating an account is agreeing to the Terms, so the agreement
   * already happened and this only records when. It is also the column the
   * launch gate reads. Leaving it null would hand this same screen back on
   * every cold launch, which is a loop rather than a skip.
   *
   * A failed write costs one more pass through this screen next launch, so it
   * never blocks the exit. The no-row recovery case has nothing to stamp; the
   * gate will rightly ask again, because there is genuinely no profile yet.
   */
  async function handleSkip() {
    if (saving || skipping || !userId) return;
    setSkipping(true);
    try {
      if (hasRow) {
        await supabase
          .from("profiles")
          .update({ accepted_terms_at: new Date().toISOString() })
          .eq("id", userId);
      }
    } catch {
      // Offline, most likely. The exit still happens; the gate asks again.
    }
    router.replace("/onboarding-communities");
  }

  async function handleSave() {
    if (saving || skipping || !userId) return;
    const next: typeof errors = {};

    const name = displayName.trim();
    if (!name) next.displayName = "Add a display name.";

    const h = handle.trim().toLowerCase();
    if (!HANDLE_RE.test(h)) {
      next.handle = HANDLE_HINT;
    } else if (handleStatus === "taken") {
      next.handle = "That handle's taken. Try another.";
    }

    let year: number | null = null;
    if (gradYear.trim()) {
      year = Number(gradYear.trim());
      if (!Number.isInteger(year) || year < 1950 || year > 2100) {
        next.gradYear = "Enter a 4-digit year, like 2027.";
      }
    }

    if (Object.values(next).some(Boolean)) {
      setErrors(next);
      return;
    }

    setErrors({});
    setSaving(true);

    const patch = {
      display_name: name,
      handle: h,
      major: major.trim() || null,
      grad_year: year,
      bio: bio.trim() || null,
      // Signup told them creating an account is agreeing to the terms; this
      // records when that agreement was made. It doubles as the first-run
      // gate; see the launch gate in app/index.tsx.
      accepted_terms_at: new Date().toISOString(),
    };

    let saveError: { code?: string } | null = null;
    if (hasRow) {
      const { error: updateError } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", userId);
      saveError = updateError;
    } else {
      // Recovery path: look up the university by email domain and insert.
      const at = userEmail.lastIndexOf("@");
      const domain = at === -1 ? null : userEmail.slice(at + 1).toLowerCase();
      const { data: uni } = domain
        ? await supabase
            .from("universities")
            .select("id")
            .eq("email_domain", domain)
            .maybeSingle()
        : { data: null };
      const universityId = (uni as { id: string } | null)?.id ?? null;
      if (!universityId) {
        setSaving(false);
        setErrors({
          form: "We couldn't match your school. Try signing out and back in.",
        });
        return;
      }
      const { error: insertError } = await supabase
        .from("profiles")
        .insert({ id: userId, university_id: universityId, ...patch });
      saveError = insertError;
    }

    if (saveError) {
      setSaving(false);
      if (saveError.code === "23505") {
        setErrors({ handle: "That handle's taken. Try another." });
      } else if (saveError.code === "23514") {
        setErrors({ handle: HANDLE_HINT });
      } else {
        setErrors({ form: "Couldn't save your profile. Please try again." });
      }
      return;
    }

    // First-run handoff: profile's saved, so hand off to picking
    // communities, which hands off to the welcome in its turn.
    router.replace("/onboarding-communities");
  }

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.background,
        }}
      >
        <ActivityIndicator color={theme.brand} />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  const firstName = displayName.trim().split(/\s+/)[0] || null;

  // The signup trigger builds the handle out of the email local-part, and one
  // campus means one domain, so a handle still in its original shape is the
  // student's email address in public. Say so while it's still true.
  const handleIsFromEmail =
    handle.trim().length > 0 &&
    handle.trim().toLowerCase() === handleFromEmail(userEmail);

  const handleFieldError =
    errors.handle ??
    (handleStatus === "taken"
      ? "That handle's taken. Try another."
      : handleStatus === "invalid"
        ? HANDLE_HINT
        : null);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <ScrollView
        contentContainerStyle={{
          padding: space.gutter,
          paddingTop: insets.top + space.gutter,
          paddingBottom: insets.bottom + space.rest,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <AppText variant="display" style={{ marginBottom: space.snug }}>
          {firstName ? `Welcome to Hearth, ${firstName}` : "Welcome to Hearth"}
        </AppText>
        <AppText muted style={{ marginBottom: space.cosy }}>
          Tell your classmates a little about yourself. You can change any of
          this later.
        </AppText>
        {universityName ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.snug,
              alignSelf: "flex-start",
              backgroundColor: theme.accentSoft,
              borderRadius: radius.full,
              paddingHorizontal: space.close,
              paddingVertical: space.snug,
              marginBottom: space.card,
            }}
          >
            <Feather name="award" size={13} color={theme.accent} />
            <AppText variant="caption" style={{ color: theme.accent }}>
              Verified at {universityName}
            </AppText>
          </View>
        ) : (
          <View style={{ marginBottom: space.cosy }} />
        )}

        {loading ? (
          <Card style={{ alignItems: "center", paddingVertical: space.rest }}>
            <ActivityIndicator color={theme.brand} />
          </Card>
        ) : loadError ? (
          <Card
            style={{
              alignItems: "center",
              gap: space.room,
              paddingVertical: space.chapter,
            }}
          >
            <AppText variant="bodySemi">Something went sideways</AppText>
            <AppText variant="caption" muted style={{ textAlign: "center" }}>
              {loadError}
            </AppText>
            <Button
              label="Try again"
              variant="soft"
              size="sm"
              onPress={() => void load()}
            />
          </Card>
        ) : (
          <Card style={{ gap: space.card }}>
            {errors.form ? (
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
                  {errors.form}
                </AppText>
              </View>
            ) : null}

            <Field
              label="Display name"
              placeholder="Ada Lovelace"
              autoComplete="name"
              maxLength={60}
              value={displayName}
              onChangeText={(t) => {
                setDisplayName(t);
                if (errors.displayName) {
                  setErrors((e) => ({ ...e, displayName: undefined }));
                }
              }}
              error={errors.displayName ?? null}
            />

            <View style={{ gap: space.snug }}>
              <Field
                label="Handle"
                placeholder="ada_lovelace"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                maxLength={24}
                value={handle}
                onChangeText={(t) => {
                  setHandle(t.toLowerCase().replace(/\s/g, ""));
                  if (errors.handle) {
                    setErrors((e) => ({ ...e, handle: undefined }));
                  }
                }}
                error={handleFieldError}
              />
              {handleStatus === "checking" ? (
                <AppText variant="caption" muted>
                  Checking availability…
                </AppText>
              ) : handleStatus === "available" ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.snug,
                  }}
                >
                  <Feather
                    name="check-circle"
                    size={13}
                    color={theme.success}
                  />
                  <AppText variant="caption" style={{ color: theme.success }}>
                    @{handle} is yours if you want it.
                  </AppText>
                </View>
              ) : handleFieldError ? null : (
                <AppText variant="caption" muted>
                  {HANDLE_HINT}
                </AppText>
              )}
              {handleIsFromEmail ? (
                <AppText variant="caption" muted>
                  This came from your email address, and it's public. Change it
                  if you'd rather.
                </AppText>
              ) : null}
            </View>

            <Field
              label="Major (optional)"
              placeholder="e.g. Computer Science"
              maxLength={80}
              value={major}
              onChangeText={setMajor}
            />

            <Field
              label="Graduation year (optional)"
              placeholder="2027"
              keyboardType="number-pad"
              maxLength={4}
              value={gradYear}
              onChangeText={(t) => {
                setGradYear(t.replace(/[^0-9]/g, ""));
                if (errors.gradYear) {
                  setErrors((e) => ({ ...e, gradYear: undefined }));
                }
              }}
              error={errors.gradYear ?? null}
            />

            <View style={{ gap: space.snug }}>
              <Field
                label="Bio (optional)"
                placeholder="Clubs, hobbies, what you're studying: anything classmates should know."
                multiline
                numberOfLines={4}
                maxLength={BIO_MAX}
                value={bio}
                onChangeText={setBio}
                style={{ minHeight: 96, textAlignVertical: "top" }}
              />
              <AppText variant="caption" muted style={{ textAlign: "right" }}>
                {bio.length}/{BIO_MAX}
              </AppText>
            </View>

            <Button
              label={saving ? "Saving…" : "Save and continue"}
              size="lg"
              pending={saving}
              disabled={
                saving || skipping || !displayName.trim() || !handle.trim()
              }
              onPress={handleSave}
            />
            <Button
              label="Skip for now"
              variant="ghost"
              pending={skipping}
              disabled={saving || skipping}
              onPress={() => void handleSkip()}
            />
            {/* The moment of record: both buttons stamp accepted_terms_at, so
                the document that stamp refers to is one tap away from it.
                The link is its own Pressable: caption text draws 16px tall,
                so it takes 14 of slop above and below to reach 44. */}
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <AppText variant="caption" muted style={{ flexShrink: 1 }}>
                Saving or skipping records that you agreed to our{" "}
              </AppText>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Terms of Service"
                hitSlop={{ top: 14, bottom: 14 }}
                onPress={() => router.push("/legal/terms")}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <AppText
                  variant="caption"
                  style={{ color: theme.brand, fontFamily: fonts.bodySemi }}
                >
                  Terms of Service
                </AppText>
              </Pressable>
              <AppText variant="caption" muted style={{ flexShrink: 1 }}>
                {" "}
                when you created your account.
              </AppText>
            </View>
          </Card>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
