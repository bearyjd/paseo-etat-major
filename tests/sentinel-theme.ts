import type { PluginTheme } from "@getpaseo/plugin";

// Distinct strings that are no real color, so any value not taken from the theme stands out.
export const sentinelTheme: PluginTheme = {
  colors: {
    surface0: "sentinel:surface0",
    surface1: "sentinel:surface1",
    surface2: "sentinel:surface2",
    border: "sentinel:border",
    foreground: "sentinel:foreground",
    foregroundMuted: "sentinel:foregroundMuted",
    accent: "sentinel:accent",
    accentForeground: "sentinel:accentForeground",
    statusSuccess: "sentinel:statusSuccess",
    statusWarning: "sentinel:statusWarning",
    statusDanger: "sentinel:statusDanger",
  },
};
