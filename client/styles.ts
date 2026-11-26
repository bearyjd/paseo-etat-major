import type { PluginHostProps } from "@getpaseo/plugin/client";
import type { TextStyle, ViewStyle } from "react-native";

// Pure: host theme and layout in, plain style objects out. Every color comes from the theme,
// because React Native's own defaults (black text, black borders) ignore it.

const MIN_TAP = 44;
const MAX_WIDTH = 720;

type Colors = PluginHostProps["theme"]["colors"];

function viewStyles(c: Colors, compact: boolean) {
  const stack = (gap: number) => ({ gap, backgroundColor: c.surface0 });
  const row = { flexDirection: "row", flexWrap: "wrap", gap: 8, backgroundColor: c.surface0 } as const;
  const card = { gap: 4, borderWidth: 1, borderRadius: 8, padding: 12, borderColor: c.border, backgroundColor: c.surface1 };
  const pressable = { minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: "center", borderWidth: 1, borderRadius: 8 } as const;
  const button = { ...pressable, paddingHorizontal: 12, borderColor: c.accent, backgroundColor: c.accent };
  const tab = { ...pressable, paddingHorizontal: 10, borderColor: c.border, backgroundColor: c.surface2 };
  return {
    screen: { backgroundColor: c.surface0 },
    content: { flexGrow: 1, padding: compact ? 12 : 24, backgroundColor: c.surface0 },
    column: { ...stack(16), width: "100%", maxWidth: MAX_WIDTH, alignSelf: "center" },
    tight: stack(4),
    stack: stack(8),
    loose: stack(12),
    row,
    card,
    cardWarning: { ...card, borderColor: c.statusWarning },
    cardDanger: { ...card, borderColor: c.statusDanger },
    taskRow: { ...card, minHeight: MIN_TAP, justifyContent: "center" },
    button,
    buttonDisabled: { ...button, borderColor: c.border, backgroundColor: c.surface2 },
    tab,
    tabSelected: { ...tab, borderColor: c.accent, backgroundColor: c.accent },
  } satisfies Record<string, ViewStyle>;
}

function textStyles(c: Colors) {
  const body = { color: c.foreground };
  const muted = { color: c.foregroundMuted };
  const strong = { ...body, fontWeight: "600" } as const;
  return {
    title: { ...body, fontSize: 20, fontWeight: "700" },
    detailTitle: { ...body, fontSize: 18, fontWeight: "700" },
    heading: { ...body, fontSize: 16, fontWeight: "700" },
    body,
    strong,
    muted,
    danger: { color: c.statusDanger },
    dangerStrong: { color: c.statusDanger, fontWeight: "700" },
    warning: { color: c.statusWarning },
    warningStrong: { color: c.statusWarning, fontWeight: "700" },
    success: { color: c.statusSuccess },
    pill: {
      ...muted,
      fontSize: 12,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 8,
      alignSelf: "flex-start",
      borderColor: c.border,
      backgroundColor: c.surface2,
    },
    button: { color: c.accentForeground, fontWeight: "600" },
    buttonDisabled: { ...muted, fontWeight: "600" },
    tab: body,
    tabSelected: { color: c.accentForeground, fontWeight: "700" },
    badge: muted,
  } satisfies Record<string, TextStyle>;
}

export function makeStyles(theme: PluginHostProps["theme"], layout: Pick<PluginHostProps["layout"], "compact">) {
  return { ...viewStyles(theme.colors, layout.compact), text: textStyles(theme.colors) };
}

export type Styles = ReturnType<typeof makeStyles>;
