import Feather from "@expo/vector-icons/Feather";
import type { ComponentProps, ReactNode } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { palettes, radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { AppText } from "./app-text";
import { Card } from "./card";

type FeatherName = ComponentProps<typeof Feather>["name"];

/** One 44px row inside a Sheet: soft icon tile, label, optional danger tone. */
function SheetRow({
  icon,
  label,
  danger = false,
  onPress,
}: {
  icon: FeatherName;
  label: string;
  /** For the one destructive choice: leave, delete, report, block. */
  danger?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.control,
          backgroundColor: danger ? theme.surface2 : theme.brandSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather
          name={icon}
          size={16}
          color={danger ? theme.danger : theme.brand}
        />
      </View>
      <AppText
        variant="bodyMedium"
        numberOfLines={1}
        style={{ flex: 1, ...(danger ? { color: theme.danger } : null) }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

/**
 * The bottom action sheet: a candle-dark scrim and a card that slides up
 * from the bottom edge.
 *
 * Reach for it when a tap needs two to five follow-up choices and a full
 * screen would be too much ceremony — the "…" on a message, the owner menu
 * on a club, the overflow on an event. Anything longer than five rows wants
 * a real screen instead.
 *
 * The scrim is `palettes.dark.background` at 55% in **both** appearances:
 * the room behind the sheet dims like someone turned the lamp down, and a
 * light-theme scrim would blow the page out. Tapping it closes, and it
 * carries its own accessibility label so screen readers get an exit.
 *
 * The card sits on `floating` elevation, respects the home indicator, and
 * caps at 85% of the screen — pass a `ScrollView` as `children` if the
 * content can outgrow that.
 *
 * `Sheet.Row` is the row every caller was drawing by hand: 44px tall, soft
 * ember icon tile, one label, `danger` for the destructive choice. Close the
 * sheet in the row's own `onPress` before doing the work.
 *
 * ```tsx
 * <Sheet visible={menuOpen} onClose={close} title="This event">
 *   <Sheet.Row icon="edit-2" label="Edit event" onPress={edit} />
 *   <Sheet.Row icon="x-circle" label="Cancel event" danger onPress={cancel} />
 * </Sheet>
 * ```
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  /** Adds a heading row with a 44px close button. */
  title?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
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
        <Card
          elevation="floating"
          padded={false}
          style={{
            marginHorizontal: 12,
            marginBottom: Math.max(insets.bottom, 12),
            padding: 14,
            gap: 4,
            maxHeight: "85%",
          }}
        >
          {title ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                marginBottom: 4,
              }}
            >
              <AppText variant="title" numberOfLines={1} style={{ flex: 1 }}>
                {title}
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={onClose}
                hitSlop={8}
                style={({ pressed }) => ({
                  width: 44,
                  height: 44,
                  marginRight: -10,
                  marginVertical: -10,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Feather name="x" size={18} color={theme.muted} />
              </Pressable>
            </View>
          ) : null}
          {children}
        </Card>
      </View>
    </Modal>
  );
}

Sheet.Row = SheetRow;
