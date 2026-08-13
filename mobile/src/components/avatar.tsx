import { Image } from "expo-image";
import { View } from "react-native";
import { AppText } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * Avatar: the one way we draw a person.
 *
 * Shows their photo when they've set one, and otherwise falls back to the
 * familiar initials look: two letters on a warm circle, tinted by a stable
 * hash of the name (ember or sage, so a person keeps their color everywhere).
 *
 * Decorative by design. Screens render the person's name right next to it,
 * so the circle itself is hidden from assistive tech.
 *
 * @param url  Public image URL (profiles.avatar_url). Null/undefined falls
 *             back to initials.
 * @param name Display name, which drives both the initials and the tint.
 * @param size Diameter in px. Defaults to 40, the list-row size.
 */
export function Avatar({
  url,
  name,
  size = 40,
}: {
  url?: string | null;
  name: string;
  size?: number;
}) {
  const theme = useTheme();

  if (url) {
    return (
      <Image
        accessibilityElementsHidden
        source={{ uri: url }}
        contentFit="cover"
        transition={120}
        style={{
          width: size,
          height: size,
          borderRadius: radius.full,
          backgroundColor: theme.surface2,
        }}
      />
    );
  }

  // Stable tint: hash the name, pick ember or sage. Same recipe the
  // screens have hand-rolled so far, extracted here for everyone.
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const pair =
    hash % 2 === 0
      ? { bg: theme.brandSoft, fg: theme.brandInk }
      : { bg: theme.accentSoft, fg: theme.accent };
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1] ?? "" : "";
  const initials =
    `${first.charAt(0)}${last ? last.charAt(0) : first.charAt(1)}`.toUpperCase() ||
    "?";

  return (
    <View
      accessibilityElementsHidden
      style={{
        width: size,
        height: size,
        borderRadius: radius.full,
        backgroundColor: pair.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <AppText
        variant="label"
        style={{ color: pair.fg, fontSize: size * 0.36, lineHeight: size * 0.5 }}
      >
        {initials}
      </AppText>
    </View>
  );
}
