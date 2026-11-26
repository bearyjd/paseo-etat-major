import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { planningGet, planningRefresh } from "../shared/contracts.ts";
import { SettingsPage } from "./SettingsPage.tsx";
import { makeStyles, type Styles } from "./styles.ts";
import { publishSummary } from "./summary-store.ts";
import {
  LOAD_ERROR_VIEW,
  buildPlanningVm,
  errorView,
  footerSummary,
  freshness,
  settleLoad,
  type Loaded,
  type LaneVm,
  type PlanningVm,
  type TaskRow,
} from "./view-model.ts";

// Every string below is either a fixed literal or comes out of view-model.ts already sanitized,
// and is rendered as plain Text: no Markdown, no links, no images.

const TICK_MS = 60_000;

function Button({ styles, label, onPress, disabled }: { styles: Styles; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={disabled ? styles.buttonDisabled : styles.button}
    >
      <Text style={disabled ? styles.text.buttonDisabled : styles.text.button}>{label}</Text>
    </Pressable>
  );
}

function Pill({ styles, text }: { styles: Styles; text: string }) {
  return <Text style={styles.text.pill}>{text}</Text>;
}

function Section({ styles, title, children }: { styles: Styles; title: string; children: ReactNode }) {
  return (
    <View style={styles.stack}>
      <Text style={styles.text.heading}>{title}</Text>
      {children}
    </View>
  );
}

function TaskDetail({ styles, task, lane, onBack }: { styles: Styles; task: TaskRow; lane: string; onBack: () => void }) {
  return (
    <View style={styles.stack}>
      <Button styles={styles} label="Back to list" onPress={onBack} />
      <Text style={styles.text.detailTitle}>{task.title}</Text>
      <Text style={styles.text.muted}>{`${task.id} · ${lane}`}</Text>
      {task.evidence.map((e) => (
        <View key={e.key} style={styles.card}>
          <Text style={styles.text.strong}>{e.label}</Text>
          {e.unverified ? <Pill styles={styles} text="unverified" /> : e.refs.map((r, i) => <Text key={`${r}:${i}`} style={styles.text.body}>{r}</Text>)}
        </View>
      ))}
    </View>
  );
}

function Lane({ styles, lane, onOpen }: { styles: Styles; lane: LaneVm; onOpen: (id: string) => void }) {
  if (lane.count === 0) return <Text style={styles.text.muted}>{lane.emptyLine}</Text>;
  return (
    <View style={styles.tight}>
      {lane.tasks.map((t) => (
        <Pressable key={t.key} accessibilityRole="button" accessibilityLabel={`${t.title}, ${t.unverifiedCount} of 7 unverified`} onPress={() => onOpen(t.key)} style={styles.taskRow}>
          <Text style={styles.text.strong}>{t.title}</Text>
          <Text style={styles.text.muted}>{`${t.id} · ${t.unverifiedCount} of 7 unverified`}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Board({ styles, vm }: { styles: Styles; vm: PlanningVm }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const lane = vm.lanes.find((l) => l.state === picked) ?? vm.lanes.find((l) => l.count > 0) ?? vm.lanes[0]!;
  const task = taskId === null ? undefined : lane.tasks.find((t) => t.key === taskId);
  if (task) return <TaskDetail styles={styles} task={task} lane={lane.label} onBack={() => setTaskId(null)} />;
  return (
    <View style={styles.loose}>
      <View accessibilityRole="tablist" style={styles.row}>
        {vm.lanes.map((l) => (
          <Pressable key={l.state} accessibilityRole="tab" accessibilityState={{ selected: l.state === lane.state }} onPress={() => { setPicked(l.state); setTaskId(null); }} style={l.state === lane.state ? styles.tabSelected : styles.tab}>
            <Text style={l.state === lane.state ? styles.text.tabSelected : styles.text.tab}>{`${l.label} ${l.count}`}</Text>
          </Pressable>
        ))}
      </View>
      <Lane styles={styles} lane={lane} onOpen={setTaskId} />
      <Section styles={styles} title="Features">
        {vm.features.length === 0 ? <Text style={styles.text.muted}>No features.</Text> : vm.features.map((f) => (
          <View key={f.id} style={styles.card}>
            <Text style={styles.text.strong}>{f.title}</Text>
            <Text style={styles.text.muted}>{`${f.id} · ${f.status} · ${f.state}`}</Text>
            {f.outcome ? <Text style={styles.text.body}>{f.outcome}</Text> : null}
            {f.architecture.map((a, i) => <Text key={`${a.ref}:${i}`} style={styles.text.muted}>{`${a.relation} ${a.ref} (${a.state}, ${a.provenance})`}</Text>)}
          </View>
        ))}
      </Section>
      <Section styles={styles} title="Sources">
        {vm.sources.length === 0 ? <Text style={styles.text.muted}>No sources.</Text> : vm.sources.map((s, i) => <Text key={`${s.label}:${i}`} style={styles.text.body}>{`${s.label}: ${s.status}`}</Text>)}
      </Section>
    </View>
  );
}

function Issues({ styles, issues }: { styles: Styles; issues: NonNullable<PlanningVm["issues"]> }) {
  const blocking = issues.rows.some((i) => i.blocking);
  return (
    <View accessibilityRole="alert" style={blocking ? styles.cardDanger : styles.cardWarning}>
      <Text style={blocking ? styles.text.dangerStrong : styles.text.warningStrong}>{issues.heading}</Text>
      {issues.rows.map((i, n) => (
        <Text key={n} style={i.blocking ? styles.text.danger : styles.text.warning}>{`${i.blocking ? "Blocking " : ""}${i.severity}: ${i.message} (${i.path}${i.field ? `, ${i.field}` : ""})`}</Text>
      ))}
    </View>
  );
}

export function PlanningScreen({ params, theme, layout }: PluginScreenProps) {
  const getRpc = useRpc(planningGet);
  const refreshRpc = useRpc(planningRefresh);
  const rpcs = useRef({ getRpc, refreshRpc });
  rpcs.current = { getRpc, refreshRpc };
  const alive = useRef(true);
  const [page, setPage] = useState<"planning" | "settings">(params.initialPage === "settings" ? "settings" : "planning");
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const loadedRef = useRef<Loaded>(loaded);
  const [running, setRunning] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Freshness is derived at render time from the raw export time, so a screen left open
  // still ages: re-render once a minute.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

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
    const settled = settleLoad(loadedRef.current, next, force);
    loadedRef.current = settled;
    publishSummary(settled.kind === "vm" ? footerSummary(settled.vm) : null);
    setLoaded(settled);
    setRunning(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    if (page === "planning") void run(false);
    return () => {
      alive.current = false;
    };
  }, [page, run]);

  const styles = makeStyles(theme, layout);
  const vm = loaded.kind === "vm" ? loaded.vm : null;
  const fresh = vm ? freshness(vm.exportedAt, nowMs) : null;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.column}>
        <View style={styles.tight}>
          <Text style={styles.text.title}>{vm ? `État-major · ${vm.project}` : "État-major"}</Text>
          {vm ? <Text style={styles.text.muted}>{`Exported ${fresh!.exportedAtText} · ${vm.version}`}</Text> : null}
          <View style={styles.row}>
            <Button styles={styles} label={running ? "Trying again" : "Try again"} disabled={running || page === "settings"} onPress={() => void run(true)} />
            <Button styles={styles} label={page === "settings" ? "Planning" : "Settings"} onPress={() => setPage(page === "settings" ? "planning" : "settings")} />
          </View>
        </View>
        {page === "settings" ? (
          <SettingsPage styles={styles} onDone={() => setPage("planning")} />
        ) : loaded.kind === "loading" ? (
          <Text style={styles.text.muted}>Loading the planning export.</Text>
        ) : loaded.kind === "error" ? (
          <View style={styles.cardDanger}>
            <Text style={styles.text.dangerStrong}>{loaded.view.sentence}</Text>
            <Text style={styles.text.body}>{loaded.view.hint}</Text>
            {loaded.code === "NOT_CONFIGURED" ? <Button styles={styles} label="Open Settings" onPress={() => setPage("settings")} /> : null}
          </View>
        ) : (
          <>
            {loaded.vm.issues ? <Issues styles={styles} issues={loaded.vm.issues} /> : null}
            {loaded.refreshError ? (
              <View accessibilityRole="alert" style={styles.cardDanger}>
                <Text style={styles.text.dangerStrong}>{loaded.refreshError.sentence}</Text>
                <Text style={styles.text.body}>{`${loaded.refreshError.hint} The board below is the last export that loaded.`}</Text>
              </View>
            ) : null}
            {fresh!.stale ? (
              <View style={styles.cardWarning}>
                <Text style={styles.text.warningStrong}>{fresh!.stale.sentence}</Text>
                <Text style={styles.text.body}>{fresh!.stale.hint}</Text>
              </View>
            ) : null}
            <Board styles={styles} vm={loaded.vm} />
          </>
        )}
      </View>
    </ScrollView>
  );
}
