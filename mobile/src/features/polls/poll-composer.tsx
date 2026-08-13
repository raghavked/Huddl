import Feather from "@expo/vector-icons/Feather";
import { useCallback, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Field } from "@/components/ui";
import { palettes, radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";

/** Props for {@link PollComposer}. */
export type PollComposerProps = {
  /**
   * The channel the poll is created in. The `create_poll` RPC writes the poll,
   * its options, and the chat message that carries it atomically, so the
   * student must already be a member of this channel (the backend enforces it).
   */
  channelId: string;
  /**
   * Whether the sheet is shown. The room owns this, typically toggled from a
   * "+" or attachment action in the message bar. Drafts survive a dismiss; the
   * form only resets after a successful create.
   */
  visible: boolean;
  /**
   * Called whenever the sheet should go away: scrim tap, the X button, the
   * hardware back button, and right after a successful create. The room should
   * set its `visible` flag false here.
   */
  onClose: () => void;
  /**
   * Called with the id of the newly created chat message (the one carrying
   * `poll_id`) after a successful create, just before `onClose`. The room does
   * NOT need to insert or render anything from here. The message arrives
   * through the room's own realtime INSERT subscription. Useful for
   * scroll-to-latest or read-marking.
   */
  onCreated?: (messageId: string) => void;
};

const QUESTION_MAX = 300;
const OPTION_MAX = 100;
const MAX_OPTIONS = 8;
const MIN_OPTIONS = 2;

/**
 * A slide-up sheet for starting a poll in a channel: one question, 2–8
 * options, warm inline validation, and a pending Create button. On success
 * the poll lands in the chat stream as a regular message (rendered by the
 * room via `PollBubble`), and the form resets for next time.
 */
export function PollComposer({
  channelId,
  visible,
  onClose,
  onCreated,
}: PollComposerProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const setOption = useCallback((index: number, value: string) => {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  }, []);

  const addOption = useCallback(() => {
    setOptions((prev) => (prev.length >= MAX_OPTIONS ? prev : [...prev, ""]));
  }, []);

  const removeOption = useCallback((index: number) => {
    setOptions((prev) =>
      prev.length <= MIN_OPTIONS ? prev : prev.filter((_, i) => i !== index)
    );
  }, []);

  const handleCreate = useCallback(async () => {
    if (pending) return;
    const trimmedQuestion = question.trim();
    // Blank rows are fine. They're just skipped, as long as two real
    // options remain.
    const cleanOptions = options.map((o) => o.trim()).filter((o) => o.length > 0);

    if (trimmedQuestion.length === 0) {
      setFormError("Give your poll a question first.");
      return;
    }
    if (cleanOptions.length < MIN_OPTIONS) {
      setFormError("Polls need at least two options.");
      return;
    }
    if (cleanOptions.some((o) => o.length > OPTION_MAX)) {
      setFormError(`Keep each option under ${OPTION_MAX} characters.`);
      return;
    }

    setFormError(null);
    setPending(true);
    const { data, error } = await supabase.rpc("create_poll", {
      p_channel_id: channelId,
      p_question: trimmedQuestion,
      p_options: cleanOptions,
    });
    setPending(false);
    if (error || typeof data !== "string") {
      setFormError("Couldn't create the poll. Give it another try.");
      return;
    }

    onCreated?.(data);
    setQuestion("");
    setOptions(["", ""]);
    onClose();
  }, [pending, question, options, channelId, onCreated, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: "flex-end" }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss poll composer"
          onPress={onClose}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            // The scrim stays candle-dark in both appearances.
            backgroundColor: palettes.dark.background,
            opacity: 0.55,
          }}
        />
        <View
          style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: radius.card,
            borderTopRightRadius: radius.card,
            borderWidth: 1,
            borderColor: theme.border,
            paddingTop: 14,
            paddingHorizontal: 20,
            paddingBottom: Math.max(insets.bottom, 16),
            gap: 12,
            maxHeight: "88%",
          }}
        >
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
          >
            <AppText variant="title" style={{ flex: 1 }}>
              New poll
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              hitSlop={8}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Feather name="x" size={20} color={theme.muted} />
            </Pressable>
          </View>

          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ gap: 12, paddingBottom: 4 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Field
              label="Question"
              value={question}
              onChangeText={setQuestion}
              maxLength={QUESTION_MAX}
              placeholder="What should we decide?"
              autoFocus
            />

            {options.map((option, index) => (
              <View
                // Rows are positional (values are controlled), so index keys
                // stay correct through removals.
                key={`option-${index}`}
                style={{
                  flexDirection: "row",
                  alignItems: "flex-end",
                  gap: 4,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Field
                    label={`Option ${index + 1}`}
                    value={option}
                    onChangeText={(value) => setOption(index, value)}
                    maxLength={OPTION_MAX}
                    placeholder={index === 0 ? "First choice" : "Another choice"}
                  />
                </View>
                {options.length > MIN_OPTIONS ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove option ${index + 1}`}
                    onPress={() => removeOption(index)}
                    hitSlop={4}
                    style={({ pressed }) => ({
                      width: 44,
                      height: 46,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Feather name="x" size={18} color={theme.muted} />
                  </Pressable>
                ) : null}
              </View>
            ))}

            {options.length < MAX_OPTIONS ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add option"
                onPress={addOption}
                style={({ pressed }) => ({
                  minHeight: 44,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Feather name="plus" size={16} color={theme.brand} />
                <AppText variant="bodySemi" style={{ color: theme.brand }}>
                  Add option
                </AppText>
              </Pressable>
            ) : null}
          </ScrollView>

          {formError ? (
            <AppText variant="caption" style={{ color: theme.danger }}>
              {formError}
            </AppText>
          ) : null}

          <Button
            label="Create poll"
            pending={pending}
            onPress={() => void handleCreate()}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
