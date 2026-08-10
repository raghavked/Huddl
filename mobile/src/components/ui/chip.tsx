import Feather from "@expo/vector-icons/Feather";
import type { ComponentProps } from "react";
import {
  Pressable,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { radius, type Palette } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { AppText } from "./app-text";

type FeatherName = ComponentProps<typeof Feather>["name"];

/** Ember for identity, fern for status, clay for everything ordinary. */
export type ChipTone = "brand" | "accent" | "neutral" | "danger";

/** `sm` is the metadata pill inside a row; `md` stands on its own line. */
export type ChipSize = "sm" | "md";

type ChipMetrics = {
  fontSize: number;
  lineHeight: number;
  icon: number;
  gap: number;
  /** [static, interactive] — a tappable pill carries a little more air. */
  paddingHorizontal: [number, number];
  paddingVertical: [number, number];
};

/* These numbers are the ones already drawn by hand across the app — the
   static pair matches the metadata pills in plan / course / club, and the
   interactive `md` pair matches the kind picker in course/calendar exactly,
   hairline and all. Adoption should be a visual no-op. */
const SIZES: Record<ChipSize, ChipMetrics> = {
  sm: {
    fontSize: 11,
    lineHeight: 14,
    icon: 11,
    gap: 4,
    paddingHorizontal: [8, 10],
    paddingVertical: [3, 5],
  },
  md: {
    fontSize: 12,
    lineHeight: 16,
    icon: 13,
    gap: 5,
    paddingHorizontal: [10, 12],
    paddingVertical: [4, 7],
  },
};

function toneColors(tone: ChipTone, theme: Palette): { bg: string; fg: string } {
  switch (tone) {
    case "brand":
      return { bg: theme.brandSoft, fg: theme.brandInk };
    case "accent":
      return { bg: theme.accentSoft, fg: theme.accent };
    case "danger":
      // No dangerSoft token exists; a 12% wash of danger is the soft fill.
      return { bg: theme.danger + "1f", fg: theme.danger };
    default:
      return { bg: theme.surface2, fg: theme.muted };
  }
}

/**
 * The pill the whole app runs on: course codes, item kinds, club roles,
 * filter toggles.
 *
 * Two jobs, one component:
 * - **Static** (no `onPress`) — a label about the row it sits in. Filled
 *   with the tone's soft color, no border, hugging its content.
 * - **Interactive** (`onPress`, usually with `selected`) — a filter or a
 *   picker. Gains a hairline border, a little more padding, and enough
 *   `hitSlop` to reach a 44px touch target no matter which size it is.
 *   Unselected reads quiet (surface + border + muted text); selected fills
 *   with the tone and borders in the tone's ink.
 *
 * Tone is about meaning, never about variety: `brand` for identity (a
 * course code, a category), `accent` for something graded or scheduled,
 * `neutral` for plain metadata, `danger` for a state the reader should
 * notice (overdue, removed, blocked).
 *
 * ```tsx
 * <Chip label="ECS 36A" tone="brand" />
 * <Chip label="Exam" tone="accent" icon="edit-3" />
 * <Chip label="Quizzes" selected={kind === "quiz"} onPress={pick} size="md" />
 * ```
 */
export function Chip({
  label,
  tone = "neutral",
  size = "sm",
  icon,
  selected,
  onPress,
  accessibilityLabel,
  style,
}: {
  label: string;
  tone?: ChipTone;
  size?: ChipSize;
  icon?: FeatherName;
  /** Only meaningful with `onPress` — drives the fill and a11y state. */
  selected?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const colors = toneColors(tone, theme);
  const metrics = SIZES[size];
  const interactive = typeof onPress === "function";
  const isSelected = selected === true;

  const step = interactive ? 1 : 0;
  const paddingHorizontal = metrics.paddingHorizontal[step];
  const paddingVertical = metrics.paddingVertical[step];

  // Unselected interactive chips stay quiet until they're chosen.
  const fg = interactive && !isSelected ? theme.muted : colors.fg;
  const bg = interactive
    ? isSelected
      ? colors.bg
      : theme.surface
    : colors.bg;

  const base: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: icon ? metrics.gap : 0,
    paddingHorizontal,
    paddingVertical,
    borderRadius: radius.full,
    backgroundColor: bg,
    ...(interactive
      ? { borderWidth: 1, borderColor: isSelected ? colors.fg : theme.border }
      : null),
  };

  const body = (
    <>
      {icon ? <Feather name={icon} size={metrics.icon} color={fg} /> : null}
      <AppText
        variant="label"
        numberOfLines={1}
        style={{
          color: fg,
          fontSize: metrics.fontSize,
          lineHeight: metrics.lineHeight,
        }}
      >
        {label}
      </AppText>
    </>
  );

  if (!interactive) {
    return <View style={[base, style]}>{body}</View>;
  }

  // Grow the tap area to 44px however short the pill itself is.
  const drawnHeight = paddingVertical * 2 + metrics.lineHeight + 2;
  const slop = Math.max(6, Math.ceil((44 - drawnHeight) / 2));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: isSelected }}
      onPress={onPress}
      hitSlop={slop}
      style={({ pressed }) => [base, { opacity: pressed ? 0.7 : 1 }, style]}
    >
      {body}
    </Pressable>
  );
}
