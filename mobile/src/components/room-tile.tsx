import Feather from "@expo/vector-icons/Feather";
import { View } from "react-native";
import { AppText } from "@/components/ui";
import { radius, courseTintsFor, type CourseTint } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useResolvedScheme } from "@/providers/display-provider";
import {
  roomGlyph,
  roomMonogram,
  roomTone,
  roomTitle,
  type RoomKind,
} from "@/lib/room-identity";

/**
 * The face a room wears in every list, header and picker: a rounded tile
 * that says what KIND of place this is, replacing the hash and speaker
 * glyphs that said "Discord" instead.
 *
 *   campus  purpose glyph (coffee, users, calendar, tag) on ember soft
 *   course  book on the course's own tint when the caller knows it, ember
 *           soft when it does not
 *   topic   the room's monogram on its deterministic ember or sage, the
 *           same recipe as a photo-less avatar
 *   club    award on sage soft
 *
 * Pass the raw `name` and `slug` off the channel row; the tile derives the
 * rest. `tint` only matters for course rooms and comes from the same
 * course-color call the shelf already makes.
 */
export function RoomTile({
  kind,
  name,
  slug,
  tint,
  size = 32,
}: {
  kind: RoomKind;
  name: string | null;
  slug: string;
  /** The course's tint, when the caller has the course in hand. */
  tint?: CourseTint;
  /** Tile edge in px. 32 matches list rows, 40 suits headers. */
  size?: number;
}) {
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const glyph = roomGlyph(kind, slug);
  const iconSize = Math.round(size / 2);

  let background = theme.brandSoft;
  let ink = theme.brand;

  if (kind === "course" && tint) {
    const tones = courseTintsFor(scheme)[tint];
    background = tones.soft;
    ink = tones.ink;
  } else if (kind === "club") {
    background = theme.accentSoft;
    ink = theme.accent;
  } else if (kind === "topic") {
    const tone = roomTone(roomTitle(name, slug));
    background = tone === "ember" ? theme.brandSoft : theme.accentSoft;
    ink = tone === "ember" ? theme.brandInk : theme.accent;
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.control,
        backgroundColor: background,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {glyph ? (
        <Feather
          name={glyph as keyof typeof Feather.glyphMap}
          size={iconSize}
          color={ink}
        />
      ) : (
        <AppText
          variant={size >= 40 ? "bodySemi" : "label"}
          style={{ color: ink }}
        >
          {roomMonogram(roomTitle(name, slug))}
        </AppText>
      )}
    </View>
  );
}
