import { useColorScheme } from "react-native";
import { palettes, type Palette } from "@/constants/theme";

/** The active hearth palette — follows the system appearance. */
export function useTheme(): Palette {
  const scheme = useColorScheme();
  return scheme === "dark" ? palettes.dark : palettes.light;
}
