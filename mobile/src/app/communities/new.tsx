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
import {
  COMMUNITY_DESCRIPTION_MAX,
  COMMUNITY_NAME_MAX,
  COMMUNITY_NAME_MIN,
  CommunityError,
  createCommunity,
} from "@/lib/communities";
import { tapSuccess } from "@/lib/haptics";
import { useAuth } from "@/providers/auth-provider";

/* Starting a community: a name, a line about it, and you're its steward.
 *
 * Two fields and nothing else, because the interesting part happens after:
 * the DB trigger seats the founder as steward, and the community's first
 * post is a better founding document than any form. The slug is derived in
 * the data layer and never shown; a name is a name, not an address.
 */

export default function NewCommunityScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();

  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/communities");
  }, []);

  const handleCreate = useCallback(async () => {
    if (pending) return;
    setFormError(null);
    setPending(true);
    try {
      const id = await createCommunity(name, about);
      // It exists and you're standing in it: the completion moment.
      tapSuccess();
      router.replace(`/communities/${id}`);
    } catch (caught) {
      setFormError(
        caught instanceof CommunityError
          ? caught.message
          : "We couldn't start that community just now. Give it another go."
      );
    } finally {
      setPending(false);
    }
  }, [pending, name, about]);

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
          Start a community
        </AppText>
        <AppText
          variant="caption"
          muted
          style={{ marginTop: space.tight, marginBottom: space.card }}
        >
          A feed for whatever your campus cares about. You'll be its steward,
          which mostly means you tend it.
        </AppText>

        <Card style={{ gap: space.card }}>
          <Field
            label="Name"
            value={name}
            onChangeText={(text) => {
              setName(text);
              if (formError) setFormError(null);
            }}
            placeholder="Night owls"
            maxLength={COMMUNITY_NAME_MAX}
            autoFocus
            editable={!pending}
          />

          <Field
            label="What is it about?"
            value={about}
            onChangeText={(text) => {
              setAbout(text);
              if (formError) setFormError(null);
            }}
            placeholder="Late-night study company, campus after dark, who's still up"
            maxLength={COMMUNITY_DESCRIPTION_MAX}
            multiline
            editable={!pending}
            style={{ minHeight: 84, textAlignVertical: "top" }}
          />

          {formError ? (
            <AppText variant="caption" style={{ color: theme.danger }}>
              {formError}
            </AppText>
          ) : null}

          <Button
            label={pending ? "Starting…" : "Start it"}
            pending={pending}
            disabled={pending || name.trim().length < COMMUNITY_NAME_MIN}
            icon={<Feather name="plus" size={16} color={theme.brandFg} />}
            onPress={() => void handleCreate()}
            style={{ alignSelf: "flex-start" }}
          />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
