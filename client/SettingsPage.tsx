import { useState } from "react";
import { Text, View } from "react-native";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput, SettingsSection } from "@getpaseo/plugin/client/ui";
import { CAPS, sanitizeText } from "../shared/sanitize.ts";
import { clientSettings } from "./settings-def.ts";
import type { Styles } from "./styles.ts";

type Draft = { executable?: string; workspace?: string; project?: string; prs?: string };
type Field = keyof Draft;

// Empty fields are dropped so the saved document only holds what was typed.
function clean(draft: Draft, base: Draft): Draft {
  const merged = { ...base, ...draft };
  const out: Draft = {};
  for (const k of ["executable", "workspace", "project", "prs"] as const) {
    const v = merged[k]?.trim();
    if (v) out[k] = v;
  }
  return out;
}

export function SettingsPage({ styles, onDone }: { styles: Styles; onDone: () => void }) {
  const state = useSettings(clientSettings);
  const [draft, setDraft] = useState<Draft>({});
  const [saved, setSaved] = useState(false);

  if (state.status === "loading") return <Text style={styles.text.muted}>Loading settings.</Text>;
  if (state.status === "error") {
    return <Text style={styles.text.danger}>{`Settings could not be read. ${sanitizeText(state.error, CAPS.title)}`}</Text>;
  }
  const base: Draft = state.status === "ready" ? state.values : {};
  const set = (k: Field) => (text: string) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [k]: text }));
  };
  const save = async () => {
    setSaved(await state.save(clean(draft, base), state.revision));
  };

  return (
    <View style={styles.loose}>
      <SettingsSection title="État-major settings">
        <SettingsCard>
          <SettingsInput label="Executable" hint="Absolute path to the etat-major command." initialValue={base.executable ?? ""} onChangeText={set("executable")} />
          <SettingsInput label="Workspace" hint="Absolute path to the workspace directory." initialValue={base.workspace ?? ""} onChangeText={set("workspace")} />
          <SettingsInput label="Project" hint="Project id: lowercase letters, digits and dashes." initialValue={base.project ?? ""} onChangeText={set("project")} />
          <SettingsInput label="Pull requests file" hint="Optional. Absolute path to a recorded pull request JSON file." initialValue={base.prs ?? ""} onChangeText={set("prs")} />
        </SettingsCard>
      </SettingsSection>
      {state.status === "invalid" ? <Text style={styles.text.warning}>Stored settings were not valid. Saving replaces them.</Text> : null}
      {state.saveError ? <Text style={styles.text.danger}>{sanitizeText(state.saveError, CAPS.title)}</Text> : null}
      {saved ? <Text style={styles.text.success}>Saved.</Text> : null}
      <SettingsAction label="Save" actionLabel={state.saving ? "Saving" : "Save"} disabled={state.saving} onPress={() => void save()} />
      <SettingsAction label="Back to planning" actionLabel="Back" onPress={onDone} />
    </View>
  );
}
