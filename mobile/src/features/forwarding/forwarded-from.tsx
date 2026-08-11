import Feather from "@expo/vector-icons/Feather";
import { View } from "react-native";
import { AppText } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

export type ForwardedFromProps = {
  /**
   * The row's `forwarded_from` — "#mat-21a", "a direct message". Comes off the
   * message straight from the column; `forwardLabelFor` wrote it.
   */
  from: string;
  /**
   * Whoever wrote the words first, resolved to a display name, or null when
   * that account is gone and the line reads as the room alone.
   */
  who: string | null;
  /** True when this sits inside the signed-in student's own clay bubble. */
  own: boolean;
};

/** The quiet provenance line above a forwarded message's words. */
export function ForwardedFrom({ from, who, own }: ForwardedFromProps) {
  const theme = useTheme();
  // Secondary text on the own-message clay takes its tint from that clay;
  // on the neutral fill it's the usual muted.
  const tint = own ? theme.brandInk : theme.muted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Feather name="corner-up-right" size={11} color={tint} />
      <AppText
        variant="caption"
        numberOfLines={1}
        style={{ color: tint, flex: 1 }}
      >
        {who ? `Forwarded from ${from} · ${who}` : `Forwarded from ${from}`}
      </AppText>
    </View>
  );
}
