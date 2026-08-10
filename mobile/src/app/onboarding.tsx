import Feather from "@expo/vector-icons/Feather";
import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card, Field } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

const HANDLE_RE = /^[a-z0-9_]{3,24}$/;
const BIO_MAX = 280;
const HANDLE_HINT =
  "3–24 characters: lowercase letters, numbers, underscores.";

/** Minimal local row shape — the web app's types live outside this tsconfig. */
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
  // The handle already saved on the row — no availability check needed for it.
  const [savedHandle, setSavedHandle] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [major, setMajor] = useState("");
  const [gradYear, setGradYear] = useState("");
  const [bio, setBio] = useState("");

  const [handleStatus, setHandleStatus] = useState<HandleStatus>("idle");
  const [saving, setSaving] = useState(false);
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
      // No row yet (unusual — the signup trigger normally creates one).
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
            // Can't check right now — the unique constraint is the backstop.
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

  async function handleSave() {
    if (saving || !userId) return;
    const next: typeof errors = {};

    const name = displayName.trim();
    if (!name) next.displayName = "Add a display name.";

    const h = handle.trim().toLowerCase();
    if (!HANDLE_RE.test(h)) {
      next.handle = HANDLE_HINT;
    } else if (handleStatus === "taken") {
      next.handle = "That handle's taken — try another.";
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
      // Signup told them creating an account is agreeing to the terms;
      // this records when that agreement was made.
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
          form: "We couldn't match your school — try signing out and back in.",
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
        setErrors({ handle: "That handle's taken — try another." });
      } else if (saveError.code === "23514") {
        setErrors({ handle: HANDLE_HINT });
      } else {
        setErrors({ form: "Couldn't save your profile. Please try again." });
      }
      return;
    }

    // First-run handoff: profile's saved, so hand off to the welcome, which
    // shows what the app does and then walks them into adding classes.
    router.replace("/welcome");
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

  const handleFieldError =
    errors.handle ??
    (handleStatus === "taken"
      ? "That handle's taken — try another."
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
          padding: 20,
          paddingTop: insets.top + 20,
          paddingBottom: insets.bottom + 32,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <AppText variant="display" style={{ marginBottom: 6 }}>
          {firstName ? `Welcome to Huddl, ${firstName}!` : "Welcome to Huddl!"}
        </AppText>
        <AppText muted style={{ marginBottom: 8 }}>
          Tell your classmates a little about yourself — you can change any of
          this later.
        </AppText>
        {universityName ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              alignSelf: "flex-start",
              backgroundColor: theme.accentSoft,
              borderRadius: radius.full,
              paddingHorizontal: 12,
              paddingVertical: 5,
              marginBottom: 16,
            }}
          >
            <Feather name="award" size={13} color={theme.accent} />
            <AppText variant="caption" style={{ color: theme.accent }}>
              Verified at {universityName}
            </AppText>
          </View>
        ) : (
          <View style={{ marginBottom: 8 }} />
        )}

        {loading ? (
          <Card style={{ alignItems: "center", paddingVertical: 32 }}>
            <ActivityIndicator color={theme.brand} />
          </Card>
        ) : loadError ? (
          <Card style={{ alignItems: "center", gap: 10, paddingVertical: 24 }}>
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
          <Card style={{ gap: 16 }}>
            {errors.form ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 8,
                  backgroundColor: theme.surface2,
                  borderRadius: radius.control,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                }}
              >
                <Feather
                  name="alert-circle"
                  size={16}
                  color={theme.danger}
                  style={{ marginTop: 2 }}
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

            <View style={{ gap: 6 }}>
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
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
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

            <View style={{ gap: 6 }}>
              <Field
                label="Bio (optional)"
                placeholder="Clubs, hobbies, what you're studying — anything classmates should know."
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
              disabled={saving || !displayName.trim() || !handle.trim()}
              onPress={handleSave}
            />
            <Button
              label="Skip for now"
              variant="ghost"
              disabled={saving}
              onPress={() => router.replace("/(tabs)/home")}
            />
          </Card>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
