import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Text } from "react-native";
import { useSyncExternalStore } from "react";
import { PlanningScreen } from "./client/PlanningScreen.tsx";
import { makeStyles } from "./client/styles.ts";
import { getSummary, subscribeSummary } from "./client/summary-store.ts";
import { PLANNING_SCREEN_ID } from "./shared/ids.ts";

// A screen is only reachable through another contribution: this sidebar row opens it.
// The counts appear only after the screen has loaded data; the row never starts an export itself.
function PlanningEntry({ theme, layout, openScreen, currentScreen }: PluginSidebarItemProps) {
  const summary = useSyncExternalStore(subscribeSummary, getSummary);
  const styles = makeStyles(theme, layout);
  return (
    <SidebarRow
      icon="Compass"
      label="État-major"
      trailing={summary ? <Text accessibilityLabel={summary.label} style={styles.text.badge}>{summary.short}</Text> : undefined}
      active={currentScreen?.screenId === PLANNING_SCREEN_ID}
      onPress={() => openScreen({ screenId: PLANNING_SCREEN_ID })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  const removeScreen = client.addScreen({ id: PLANNING_SCREEN_ID, title: "État-major", Component: PlanningScreen });
  const removeEntry = client.addSidebarFooterItem({
    id: "planning-entry",
    title: "État-major",
    Component: PlanningEntry,
  });
  return () => {
    removeEntry();
    removeScreen();
  };
}
