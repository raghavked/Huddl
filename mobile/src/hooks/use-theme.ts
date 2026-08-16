import { hearthPalettes, type Palette } from "@/constants/theme";
import { useDisplay } from "@/providers/display-provider";

/**
 * The active palette: the student's chosen hearth, in the appearance in
 * effect right now. Both preferences live in the display provider, so a
 * change to either repaints everything that calls this.
 */
export function useTheme(): Palette {
  const { hearth, resolvedScheme } = useDisplay();
  return hearthPalettes[hearth][resolvedScheme];
}
