import { TextInput, View, type TextInputProps } from "react-native";
import { fonts, radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { AppText } from "./app-text";

export function Field({
  label,
  error,
  style,
  ...props
}: TextInputProps & { label: string; error?: string | null }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label">{label}</AppText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.muted + "b3"}
        cursorColor={theme.brand}
        selectionColor={theme.brandSoft}
        style={[
          {
            borderWidth: 1,
            borderColor: error ? theme.danger : theme.border,
            borderRadius: radius.control,
            backgroundColor: theme.surface,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontFamily: fonts.body,
            fontSize: 15,
            color: theme.foreground,
          },
          style,
        ]}
        {...props}
      />
      {error ? (
        <AppText variant="caption" style={{ color: theme.danger }}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}
