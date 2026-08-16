import Feather from "@expo/vector-icons/Feather";
import { Redirect, router } from "expo-router";
import { useCallback, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card, Field } from "@/components/ui";
import { space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { roomTitle } from "@/lib/room-identity";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Start a topic room: name it, say what it's for, and you're in.
   The insert matches the RLS shape exactly (kind 'topic', your own
   university, created_by you), and you join your new channel on the way
   through to its room. */

/* These three match the web client's create form and its server action
   exactly. They used to be 3/40/200 against the web's 3/80/500, so a channel
   named or described on the web could be longer than this screen would let
   anyone type, and the two clients refused different input. Nothing in the
   database constrains either column, so the wider of the two is the safe
   direction: no channel that already exists becomes uneditable here. */
const NAME_MIN = 3;
const NAME_MAX = 80;
const DESCRIPTION_MAX = 500;

/** "Pickup Soccer!!" -> "pickup-soccer": lowercase, runs of anything
    non-alphanumeric collapsed to single dashes, ends trimmed. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A short random tail for the rare slug collision retry. */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

export default function NewChannelScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const userId = session?.user.id ?? null;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/channels");
  }, []);

  const slug = slugify(name);
  const trimmedName = name.trim();

  const handleCreate = useCallback(async () => {
    if (!userId || creating) return;
    const channelName = name.trim();
    if (channelName.length < NAME_MIN || channelName.length > NAME_MAX) {
      setNameError(`Room names run ${NAME_MIN}–${NAME_MAX} characters.`);
      return;
    }
    const baseSlug = slugify(channelName);
    if (!baseSlug) {
      setNameError("Try a name with a few letters or numbers in it.");
      return;
    }
    setNameError(null);
    setFormError(null);
    setCreating(true);
    try {
      // The channel lives at my university, so read it off my profile.
      const { data: me, error: meError } = await supabase
        .from("profiles")
        .select("university_id")
        .eq("id", userId)
        .maybeSingle();
      const universityId = (me as { university_id: string } | null)
        ?.university_id;
      if (meError || !universityId) {
        setFormError(
          "We couldn't start that room just now. Give it another try."
        );
        return;
      }

      const trimmedDescription = description.trim();
      const insertChannel = (slugAttempt: string) =>
        supabase
          .from("channels")
          .insert({
            university_id: universityId,
            kind: "topic",
            name: channelName,
            slug: slugAttempt,
            description: trimmedDescription || null,
            created_by: userId,
          })
          .select("id")
          .single();

      // First try the natural slug; if a classmate already took it (23505),
      // retry once with a short random tail.
      let { data, error: insertError } = await insertChannel(baseSlug);
      if (insertError?.code === "23505") {
        ({ data, error: insertError } = await insertChannel(
          `${baseSlug}-${randomSuffix()}`
        ));
      }
      const channelId = (data as { id: string } | null)?.id ?? null;
      if (insertError || !channelId) {
        setFormError(
          insertError?.code === "23505"
            ? "A room with that name already exists. Find it in the directory, or pick another name."
            : "We couldn't start that room just now. Give it another try."
        );
        return;
      }

      // Join my own channel; 23505 would just mean we're somehow already in.
      const { error: joinError } = await supabase
        .from("channel_members")
        .insert({ channel_id: channelId, user_id: userId });
      if (joinError && joinError.code !== "23505") {
        setFormError(
          "The room is up, but we couldn't drop you in. Join it from the directory."
        );
        return;
      }

      router.replace(`/channel/${channelId}`);
    } finally {
      setCreating(false);
    }
  }, [userId, creating, name, description]);

  // Deep links land here directly, so a signed-out visitor gets a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + space.close,
          paddingHorizontal: space.gutter,
          paddingBottom: insets.bottom + space.rest,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={goBack}
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

        <AppText variant="display" style={{ marginTop: space.hair }}>
          Start a room
        </AppText>
        <AppText
          variant="caption"
          muted
          style={{ marginTop: space.tight, marginBottom: space.card }}
        >
          Anything your campus cares about: a hobby, a hunt for teammates, a
          very specific obsession.
        </AppText>

        <Card style={{ gap: space.card }}>
          <View style={{ gap: space.snug }}>
            <Field
              label="Room name"
              value={name}
              onChangeText={(text) => {
                setName(text);
                if (nameError) setNameError(null);
                if (formError) setFormError(null);
              }}
              placeholder="Pickup soccer"
              maxLength={NAME_MAX}
              autoFocus
              editable={!creating}
              error={nameError}
            />
            {slug && !nameError ? (
              <AppText variant="caption" muted>
                It'll appear as {roomTitle(trimmedName, slug)}
              </AppText>
            ) : null}
          </View>

          <Field
            label="What's it about? (optional)"
            value={description}
            onChangeText={(text) => {
              setDescription(text);
              if (formError) setFormError(null);
            }}
            placeholder="Casual games on the quad, all skill levels welcome"
            maxLength={DESCRIPTION_MAX}
            multiline
            editable={!creating}
            style={{ minHeight: 84, textAlignVertical: "top" }}
          />

          {formError ? (
            <AppText variant="caption" style={{ color: theme.danger }}>
              {formError}
            </AppText>
          ) : null}

          <Button
            label="Start room"
            pending={creating}
            disabled={creating || trimmedName.length < NAME_MIN}
            icon={<Feather name="plus" size={16} color={theme.brandFg} />}
            onPress={() => void handleCreate()}
            style={{ alignSelf: "flex-start" }}
          />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
