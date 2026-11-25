import type {
  PluginClientContext,
  PluginScreenProps,
  PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";

function PlanningScreen(_: PluginScreenProps) {
  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "700" }}>État-major</Text>
      <Text>Not configured yet</Text>
    </View>
  );
}

// A screen is only reachable through another contribution: this sidebar row opens it.
function PlanningEntry({ openScreen, currentScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Compass"
      label="État-major"
      active={currentScreen?.screenId === "planning"}
      onPress={() => openScreen({ screenId: "planning" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  const removeScreen = client.addScreen({ id: "planning", title: "État-major", Component: PlanningScreen });
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
