import Feather from "@expo/vector-icons/Feather";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { AppText, Button, Card, Field } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Same rules as the web account form — one brand, one validation story. */
const HANDLE_RE = /^[a-z0-9_]{3,24}$/;
const MAX_BIO_LENGTH = 280;

type AccountRow = {
  display_name: string;
  handle: string;
  major: string | null;
  grad_year: number | null;
  bio: string | null;
  avatar_url: string | null;
  is_public: boolean;
  university: { short_name: string } | null;
};

type FieldErrors = {
  displayName?: string;
  handle?: string;
  gradYear?: string;
  form?: string;
};

export default function AccountScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const email = session?.user.email ?? null;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [universityName, setUniversityName] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [major, setMajor] = useState("");
  const [gradYear, setGradYear] = useState("");
  const [bio, setBio] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // The photo flow gets its own quiet corner of state.
  const [photoBusy, setPhotoBusy] = useState<"upload" | "remove" | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    []
  );

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setMissing(false);
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "display_name, handle, major, grad_year, bio, avatar_url, is_public, university:universities(short_name)"
      )
      .eq("id", userId)
      .maybeSingle();
    setLoading(false);
    if (error) {
      setLoadError("We couldn't load your profile right now.");
      return;
    }
    const row = data as unknown as AccountRow | null;
    if (!row) {
      setMissing(true);
      return;
    }
    setDisplayName(row.display_name);
    setHandle(row.handle);
    setMajor(row.major ?? "");
    setGradYear(row.grad_year ? String(row.grad_year) : "");
    setBio(row.bio ?? "");
    setIsPublic(row.is_public);
    setAvatarUrl(row.avatar_url);
    setUniversityName(row.university?.short_name ?? null);
  }, [userId]);

  /** Pick a square photo, push it to the public avatars bucket, save the URL. */
  const handleChangePhoto = useCallback(async () => {
    if (!userId || photoBusy) return;
    setPhotoError(null);
    let asset: ImagePicker.ImagePickerAsset | null = null;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled) return;
      asset = result.assets[0] ?? null;
    } catch {
      setPhotoError("Couldn't open your photos. Give it another try.");
      return;
    }
    if (!asset) return;
    setPhotoBusy("upload");
    try {
      const buffer = await (await fetch(asset.uri)).arrayBuffer();
      const path = `${userId}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, buffer, { contentType: "image/jpeg", upsert: true });
      if (uploadError) throw uploadError;
      // Same path every time — the ?v= stamp is what busts stale caches.
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = `${data.publicUrl}?v=${Date.now()}`;
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: url })
        .eq("id", userId);
      if (updateError) throw updateError;
      setAvatarUrl(url);
    } catch {
      setPhotoError("Couldn't update your photo. Give it another try.");
    } finally {
      setPhotoBusy(null);
    }
  }, [userId, photoBusy]);

  /** Back to initials — clears the profile link, leaves the file be. */
  const handleRemovePhoto = useCallback(async () => {
    if (!userId || photoBusy) return;
    setPhotoError(null);
    setPhotoBusy("remove");
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: null })
      .eq("id", userId);
    setPhotoBusy(null);
    if (error) {
      setPhotoError("Couldn't remove your photo. Give it another try.");
      return;
    }
    setAvatarUrl(null);
  }, [userId, photoBusy]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Mirrors the web account form's save: same validation, same update set. */
  const handleSave = useCallback(async () => {
    if (!userId || saving) return;
    const next: FieldErrors = {};

    const name = displayName.trim();
    if (!name) next.displayName = "Add a display name.";

    const h = handle.trim().toLowerCase();
    if (!HANDLE_RE.test(h)) {
      next.handle =
        "Handles are 3–24 characters: lowercase letters, numbers and underscores.";
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
    setSaved(false);
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: name,
        handle: h,
        major: major.trim() || null,
        grad_year: year,
        bio: bio.trim() || null,
        is_public: isPublic,
      })
      .eq("id", userId);
    setSaving(false);
    if (error) {
      if (error.code === "23505") {
        setErrors({ handle: "That handle is already taken — try another." });
      } else if (error.code === "23514") {
        setErrors({
          handle:
            "Handles are 3–24 characters: lowercase letters, numbers and underscores.",
        });
      } else {
        setErrors({ form: "Couldn't save your changes. Please try again." });
      }
      return;
    }
    setHandle(h);
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2500);
  }, [userId, saving, displayName, handle, gradYear, major, bio, isPublic]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + 8,
      }}
    >
      <View style={{ paddingHorizontal: 20 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={8}
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

        <AppText variant="display" style={{ marginTop: 2, marginBottom: 16 }}>
          Account
        </AppText>
      </View>

      {loading ? (
        <View style={{ paddingHorizontal: 20 }}>
          <Card style={{ alignItems: "center", paddingVertical: 32 }}>
            <ActivityIndicator color={theme.brand} />
          </Card>
        </View>
      ) : loadError ? (
        <View style={{ paddingHorizontal: 20 }}>
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
        </View>
      ) : missing ? (
        <View style={{ paddingHorizontal: 20 }}>
          <Card style={{ alignItems: "center", gap: 6, paddingVertical: 24 }}>
            <AppText variant="bodySemi">We couldn't find your profile</AppText>
            <AppText variant="caption" muted style={{ textAlign: "center" }}>
              Try signing out and back in — that usually clears it up.
            </AppText>
          </Card>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingBottom: insets.bottom + 32,
              gap: 16,
            }}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            <Card style={{ gap: 12 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <Avatar
                  url={avatarUrl}
                  name={displayName || "You"}
                  size={56}
                />
                <View style={{ flex: 1, gap: 4 }}>
                  <AppText variant="title">Your photo</AppText>
                  <AppText variant="caption" muted>
                    {avatarUrl
                      ? "Classmates see this next to your name."
                      : "Right now classmates see your initials."}
                  </AppText>
                </View>
              </View>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <Button
                  label={photoBusy === "upload" ? "Uploading…" : "Change photo"}
                  variant="secondary"
                  size="sm"
                  pending={photoBusy === "upload"}
                  disabled={photoBusy !== null}
                  icon={
                    <Feather name="camera" size={14} color={theme.foreground} />
                  }
                  onPress={() => void handleChangePhoto()}
                />
                {avatarUrl ? (
                  <Button
                    label={photoBusy === "remove" ? "Removing…" : "Remove photo"}
                    variant="ghost"
                    size="sm"
                    pending={photoBusy === "remove"}
                    disabled={photoBusy !== null}
                    onPress={() => void handleRemovePhoto()}
                  />
                ) : null}
              </View>
              {photoError ? (
                <AppText variant="caption" style={{ color: theme.danger }}>
                  {photoError}
                </AppText>
              ) : null}
            </Card>

            <Card style={{ gap: 14 }}>
              <AppText variant="title">About you</AppText>
              <Field
                label="Display name"
                value={displayName}
                onChangeText={setDisplayName}
                maxLength={60}
                autoComplete="name"
                error={errors.displayName ?? null}
              />
              <View style={{ gap: 6 }}>
                <Field
                  label="Handle"
                  value={handle}
                  onChangeText={(t) =>
                    setHandle(t.toLowerCase().replace(/\s/g, ""))
                  }
                  maxLength={24}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  error={errors.handle ?? null}
                />
                {!errors.handle ? (
                  <AppText variant="caption" muted>
                    3–24 characters: lowercase letters, numbers, underscores.
                  </AppText>
                ) : null}
              </View>
              <Field
                label="Major (optional)"
                value={major}
                onChangeText={setMajor}
                maxLength={80}
                placeholder="e.g. Computer Science"
              />
              <Field
                label="Graduation year (optional)"
                value={gradYear}
                onChangeText={setGradYear}
                keyboardType="number-pad"
                maxLength={4}
                placeholder="2027"
                error={errors.gradYear ?? null}
              />
              <View style={{ gap: 6 }}>
                <Field
                  label="Bio (optional)"
                  value={bio}
                  onChangeText={(t) => setBio(t.slice(0, MAX_BIO_LENGTH))}
                  maxLength={MAX_BIO_LENGTH}
                  multiline
                  placeholder="A line or two about you — clubs, interests, what you're studying."
                  style={{ minHeight: 88, textAlignVertical: "top" }}
                />
                <AppText variant="caption" muted>
                  {bio.length}/{MAX_BIO_LENGTH}
                </AppText>
              </View>
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.border,
                  paddingTop: 12,
                }}
              >
                <AppText variant="caption" muted>
                  Signed in as {email ?? "your school email"}
                  {universityName ? ` · ${universityName}` : ""}. Your school
                  email can't be changed.
                </AppText>
              </View>
            </Card>

            <Card
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
              }}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <AppText variant="title">Public profile</AppText>
                <AppText variant="caption" muted>
                  Appear in the people directory and let classmates
                  {universityName ? ` at ${universityName}` : ""} view your
                  profile.
                </AppText>
              </View>
              <Switch
                accessibilityLabel="Public profile"
                value={isPublic}
                onValueChange={setIsPublic}
                trackColor={{ false: theme.surface3, true: theme.brand }}
                thumbColor={theme.onSolid}
                ios_backgroundColor={theme.surface3}
              />
            </Card>

            {errors.form ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: radius.control,
                  backgroundColor: theme.surface2,
                }}
              >
                <Feather name="alert-circle" size={14} color={theme.danger} />
                <AppText
                  variant="caption"
                  style={{ color: theme.danger, flex: 1 }}
                >
                  {errors.form}
                </AppText>
              </View>
            ) : null}

            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <Button
                label={saving ? "Saving…" : "Save changes"}
                pending={saving}
                onPress={() => void handleSave()}
              />
              {saved ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Feather name="check" size={16} color={theme.success} />
                  <AppText
                    variant="bodySemi"
                    style={{ color: theme.success }}
                  >
                    Saved
                  </AppText>
                </View>
              ) : null}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}
