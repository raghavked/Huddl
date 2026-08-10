import { palettes, type Palette } from "@/constants/theme";
import { useResolvedScheme } from "@/providers/display-provider";

/**
 * The active hearth palette — follows the student's display preference,
 * which itself follows the system appearance when set to "system".
 */
export function useTheme(): Palette {
  return useResolvedScheme() === "dark" ? palettes.dark : palettes.light;
}
