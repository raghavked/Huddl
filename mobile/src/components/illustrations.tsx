import Svg, { Path } from "react-native-svg";

/* Hand-drawn marks for Huddl's quiet moments. Five small stroke
   illustrations, deliberately imperfect — gentle quadratic wobble, round
   caps, no geometric-perfect circles — so an empty screen feels like a
   note left on the kitchen table, not a dashboard placeholder.

   Callers pass both colors from the theme: `color` for the strokes
   (theme.muted keeps things quiet; theme.brand turns the warmth up) and
   `softColor` for the one soft blob some drawings carry (theme.surface2,
   or theme.brandSoft when paired with brand). */

export type IllustrationProps = {
  /** Rendered width and height, in px. ~96 standing alone, ~72 in a card. */
  size?: number;
  /** Stroke color — a theme token, e.g. theme.muted or theme.brand. */
  color: string;
  /** Soft blob fill — a theme token, e.g. theme.surface2 or theme.brandSoft. */
  softColor: string;
};

const stroke = {
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  fill: "none",
} as const;

/**
 * The house motif: a round mug with two curls of steam, still warm.
 * Mood — settle in, the kettle's on; nothing here is a problem.
 */
export function Mug({ size = 96, color, softColor }: IllustrationProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 96 96">
      <Path
        d="M34 46 Q32 60 37 67 Q42 74 48.5 73.5 Q55.5 73 60.5 66 Q65 59 63 46.5 Q48.5 43 34 46 Z"
        fill={softColor}
      />
      <Path
        d="M30 43.5 Q27.5 60 34 69 Q40.5 77.5 49 77.5 Q57.5 77.5 63.5 69 Q70 60.5 67 43.5 Q48.5 39.5 30 43.5"
        stroke={color}
        {...stroke}
      />
      <Path d="M67 48 Q75.5 46 77 53 Q78.5 60.5 67.5 62.5" stroke={color} {...stroke} />
      <Path d="M41.5 32.5 Q37.5 27 41.5 22 Q45.5 17 42 11.5" stroke={color} {...stroke} />
      <Path d="M54.5 32.5 Q50.5 27 54.5 22 Q58.5 17 55 11.5" stroke={color} {...stroke} />
    </Svg>
  );
}

/**
 * An ajar door with a sliver of warm light spilling through the gap.
 * Mood — there's a room waiting on the other side; you're invited,
 * not locked out. For places you haven't joined yet.
 */
export function Doorway({ size = 96, color, softColor }: IllustrationProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 96 96">
      <Path
        d="M51.5 25 Q57.5 23.5 63.5 24 Q64.5 50 63.5 76.5 Q57.5 74.5 51.5 73 Q52.5 49 51.5 25 Z"
        fill={softColor}
      />
      <Path
        d="M31.5 78.5 Q30.5 50 31.5 22.5 Q48 19 64.5 22 Q65.5 50 64.5 77.5"
        stroke={color}
        {...stroke}
      />
      <Path
        d="M31.5 22.5 Q42 23.5 51.5 25 Q52.5 49 51.5 73 Q41.5 76 31.5 78.5"
        stroke={color}
        {...stroke}
      />
      <Path d="M46.5 49.5 Q47.5 48.8 48 49.8" stroke={color} {...stroke} />
      <Path d="M25 79.5 Q48 82 71 79" stroke={color} {...stroke} />
    </Svg>
  );
}

/**
 * A folded paper plane climbing, a dashed wobble of a trail behind it.
 * Mood — the first message is already halfway there; someone just has
 * to let go. For conversations waiting to happen.
 */
export function PaperPlane({ size = 96, color, softColor }: IllustrationProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 96 96">
      <Path
        d="M14 76 Q23 68 31 70.5 Q39 73 44.5 65.5"
        stroke={color}
        {...stroke}
        strokeDasharray="5 8"
      />
      <Path
        d="M45.5 51.5 Q46.5 56.5 48.5 61.5 Q50.5 58.5 52.5 55.5 Q49 53.5 45.5 51.5 Z"
        fill={softColor}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M73 25 Q51.5 34.5 29.5 45.5 Q41 50.5 52.5 55.5 Q62.5 40.5 73 25"
        stroke={color}
        {...stroke}
      />
      <Path d="M73 25 Q58 39.5 46 50" stroke={color} {...stroke} />
    </Svg>
  );
}

/**
 * A little campus pennant on a pole, caught mid-wave.
 * Mood — school spirit at kitchen-table scale; somebody should start
 * the club, and it might as well be you.
 */
export function Pennant({ size = 96, color, softColor }: IllustrationProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 96 96">
      <Path
        d="M39 25.5 Q52.5 27.5 64 31 Q52 34.5 39.5 37.5 Q38.8 31.5 39 25.5 Z"
        fill={softColor}
      />
      <Path
        d="M35.5 21 Q55.5 23.5 74.5 30.5 Q55 35 36 41.5 Q35.2 31 35.5 21"
        stroke={color}
        {...stroke}
      />
      <Path d="M34.5 17.5 Q33.5 48 35 80.5" stroke={color} {...stroke} />
      <Path d="M27.5 81 Q35 82.5 42.5 80.5" stroke={color} {...stroke} />
    </Svg>
  );
}

/**
 * A hand lantern with a small steady flame and a soft pool of glow.
 * Mood — hold the light up and look around; what you're after is out
 * there somewhere. For search and discovery.
 */
export function Lantern({ size = 96, color, softColor }: IllustrationProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 96 96">
      <Path
        d="M48 36.5 Q56.5 38 58 47 Q59.5 56.5 50.5 59.5 Q42.5 62 38.5 54.5 Q34.5 46.5 41 40 Q44 37 48 36.5 Z"
        fill={softColor}
      />
      <Path d="M39.5 29.5 Q41 14.5 48.5 14.5 Q56 14.5 57 29.5" stroke={color} {...stroke} />
      <Path d="M36.5 31.5 Q48 29 59.5 31.5" stroke={color} {...stroke} />
      <Path
        d="M38.5 32 Q36.5 47 38.5 61.5 Q48 64.5 57.5 61.5 Q59.5 47 57.5 32"
        stroke={color}
        {...stroke}
      />
      <Path d="M48 42.5 Q52 47.5 48.5 51.5 Q44.5 48 48 42.5" stroke={color} {...stroke} />
    </Svg>
  );
}
