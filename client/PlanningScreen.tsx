import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { planningGet, planningRefresh } from "../shared/contracts.ts";
import type { ErrorCode } from "../shared/errors.ts";
import { SettingsPage } from "./SettingsPage.tsx";
import { publishSummary } from "./summary-store.ts";
import {
  LOAD_ERROR_VIEW,
  buildPlanningVm,
  errorView,
  footerSummary,
  type LaneVm,
  type PlanningVm,
  type TaskRow,
} from "./view-model.ts";

// Every string below is either a fixed literal or comes out of view-model.ts already sanitized,
// and is rendered as plain Text: no Markdown, no links, no images.

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "vm"; readonly vm: PlanningVm }
  | { readonly kind: "error"; readonly view: { sentence: string; hint: string }; readonly code: ErrorCode | null };

const MIN_TAP = 44;
const MAX_WIDTH = 720;

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: "center", paddingHorizontal: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <Text style={{ fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

function Pill({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <Text style={{ opacity: muted ? 0.55 : 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, alignSelf: "flex-start", fontSize: 12 }}>{text}</Text>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontWeight: "700", fontSize: 16 }}>{title}</Text>
      {children}
    </View>
  );
}

function TaskDetail({ task, lane, onBack }: { task: TaskRow; lane: string; onBack: () => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Button label="Back to list" onPress={onBack} />
      <Text style={{ fontWeight: "700", fontSize: 18 }}>{task.title}</Text>
      <Text>{`${task.id} · ${lane}`}</Text>
      {task.evidence.map((e) => (
        <View key={e.key} style={{ gap: 4, paddingVertical: 4 }}>
          <Text style={{ fontWeight: "600" }}>{e.label}</Text>
          {e.unverified ? <Pill text="unverified" muted /> : e.refs.map((r, i) => <Text key={`${r}:${i}`}>{r}</Text>)}
        </View>
      ))}
    </View>
  );
}

function Lane({ lane, onOpen }: { lane: LaneVm; onOpen: (id: string) => void }) {
  if (lane.count === 0) return <Text>{lane.emptyLine}</Text>;
  return (
    <View style={{ gap: 4 }}>
      {lane.tasks.map((t) => (
        <Pressable key={t.id} accessibilityRole="button" accessibilityLabel={`${t.title}, ${t.unverifiedCount} of 7 unverified`} onPress={() => onOpen(t.id)} style={{ minHeight: MIN_TAP, justifyContent: "center", paddingVertical: 6 }}>
          <Text style={{ fontWeight: "600" }}>{t.title}</Text>
          <Text style={{ opacity: 0.6 }}>{`${t.id} · ${t.unverifiedCount} of 7 unverified`}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Board({ vm }: { vm: PlanningVm }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const lane = vm.lanes.find((l) => l.state === picked) ?? vm.lanes.find((l) => l.count > 0) ?? vm.lanes[0]!;
  const task = taskId === null ? undefined : lane.tasks.find((t) => t.id === taskId);
  if (task) return <TaskDetail task={task} lane={lane.label} onBack={() => setTaskId(null)} />;
  return (
    <View style={{ gap: 12 }}>
      <View accessibilityRole="tablist" style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {vm.lanes.map((l) => (
          <Pressable key={l.state} accessibilityRole="tab" accessibilityState={{ selected: l.state === lane.state }} onPress={() => { setPicked(l.state); setTaskId(null); }} style={{ minHeight: MIN_TAP, justifyContent: "center", paddingHorizontal: 10, borderBottomWidth: l.state === lane.state ? 2 : 0 }}>
            <Text style={{ fontWeight: l.state === lane.state ? "700" : "400" }}>{`${l.label} ${l.count}`}</Text>
          </Pressable>
        ))}
      </View>
      <Lane lane={lane} onOpen={setTaskId} />
      <Section title="Features">
        {vm.features.length === 0 ? <Text>No features.</Text> : vm.features.map((f) => (
          <View key={f.id} style={{ gap: 2 }}>
            <Text style={{ fontWeight: "600" }}>{f.title}</Text>
            <Text style={{ opacity: 0.6 }}>{`${f.id} · ${f.status} · ${f.state}`}</Text>
            {f.outcome ? <Text>{f.outcome}</Text> : null}
            {f.architecture.map((a, i) => <Text key={`${a.ref}:${i}`} style={{ opacity: 0.8 }}>{`${a.relation} ${a.ref} (${a.state}, ${a.provenance})`}</Text>)}
          </View>
        ))}
      </Section>
      <Section title="Sources">
        {vm.sources.length === 0 ? <Text>No sources.</Text> : vm.sources.map((s, i) => <Text key={`${s.label}:${i}`}>{`${s.label}: ${s.status}`}</Text>)}
      </Section>
    </View>
  );
}

export function PlanningScreen({ params, layout }: PluginScreenProps) {
  const getRpc = useRpc(planningGet);
  const refreshRpc = useRpc(planningRefresh);
  const rpcs = useRef({ getRpc, refreshRpc });
  rpcs.current = { getRpc, refreshRpc };
  const alive = useRef(true);
  const [page, setPage] = useState<"planning" | "settings">(params.initialPage === "settings" ? "settings" : "planning");
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [running, setRunning] = useState(false);

  const run = useCallback(async (force: boolean) => {
    setRunning(true);
    let next: Loaded;
    try {
      const r = await (force ? rpcs.current.refreshRpc({}) : rpcs.current.getRpc({}));
      next = r.ok
        ? { kind: "vm", vm: buildPlanningVm({ data: r.data, exportedAt: r.exportedAt, version: r.version }) }
        : { kind: "error", view: errorView(r.code), code: r.code };
    } catch {
      next = { kind: "error", view: LOAD_ERROR_VIEW, code: null };
    }
    if (!alive.current) return;
    publishSummary(next.kind === "vm" ? footerSummary(next.vm) : null);
    setLoaded(next);
    setRunning(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    if (page === "planning") void run(false);
    return () => {
      alive.current = false;
    };
  }, [page, run]);

  const pad = layout.compact ? 12 : 24;
  const vm = loaded.kind === "vm" ? loaded.vm : null;
  return (
    <ScrollView contentContainerStyle={{ padding: pad }}>
      <View style={{ width: "100%", maxWidth: MAX_WIDTH, alignSelf: "center", gap: 16 }}>
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 20, fontWeight: "700" }}>{vm ? `État-major · ${vm.project}` : "État-major"}</Text>
          {vm ? <Text style={{ opacity: 0.7 }}>{`Exported ${vm.exportedAtText} · ${vm.version}`}</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            <Button label={running ? "Trying again" : "Try again"} disabled={running || page === "settings"} onPress={() => void run(true)} />
            <Button label={page === "settings" ? "Planning" : "Settings"} onPress={() => setPage(page === "settings" ? "planning" : "settings")} />
          </View>
        </View>
        {page === "settings" ? (
          <SettingsPage onDone={() => setPage("planning")} />
        ) : loaded.kind === "loading" ? (
          <Text>Loading the planning export.</Text>
        ) : loaded.kind === "error" ? (
          <View style={{ gap: 4 }}>
            <Text style={{ fontWeight: "600" }}>{loaded.view.sentence}</Text>
            <Text>{loaded.view.hint}</Text>
            {loaded.code === "NOT_CONFIGURED" ? <Button label="Open Settings" onPress={() => setPage("settings")} /> : null}
          </View>
        ) : (
          <>
            {loaded.vm.issues ? (
              <View accessibilityRole="alert" style={{ gap: 4, borderWidth: 1, padding: 12 }}>
                <Text style={{ fontWeight: "700" }}>{loaded.vm.issues.heading}</Text>
                {loaded.vm.issues.rows.map((i, n) => (
                  <Text key={n}>{`${i.blocking ? "Blocking " : ""}${i.severity}: ${i.message} (${i.path}${i.field ? `, ${i.field}` : ""})`}</Text>
                ))}
              </View>
            ) : null}
            {loaded.vm.stale ? (
              <View style={{ gap: 2, borderWidth: 1, padding: 12 }}>
                <Text style={{ fontWeight: "600" }}>{loaded.vm.stale.sentence}</Text>
                <Text>{loaded.vm.stale.hint}</Text>
              </View>
            ) : null}
            <Board vm={loaded.vm} />
          </>
        )}
      </View>
    </ScrollView>
  );
}
