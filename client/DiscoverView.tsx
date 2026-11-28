import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { discoverGet, discoverRefresh } from "../shared/contracts.ts";
import { DiscoverBoard, type DiscoverSection } from "./DiscoverBoard.tsx";
import { Button } from "./controls.tsx";
import { buildDiscoverVm, discoverErrorView, type DiscoverVm } from "./discover-view-model.ts";
import type { Styles } from "./styles.ts";
import { LOAD_ERROR_VIEW, freshness, settleLoad, type Loaded } from "./view-model.ts";

// Loads the Discover export and keeps the selection; DiscoverBoard draws it.
export function DiscoverView({ styles, nowMs, onOpenSettings }: { styles: Styles; nowMs: number; onOpenSettings: () => void }) {
  const getRpc = useRpc(discoverGet);
  const refreshRpc = useRpc(discoverRefresh);
  const rpcs = useRef({ getRpc, refreshRpc });
  rpcs.current = { getRpc, refreshRpc };
  const alive = useRef(true);
  const [loaded, setLoaded] = useState<Loaded<DiscoverVm>>({ kind: "loading" });
  const loadedRef = useRef<Loaded<DiscoverVm>>(loaded);
  const [running, setRunning] = useState(false);
  const [section, setSection] = useState<DiscoverSection>("decisions");
  const [selected, setSelected] = useState<string | null>(null);

  const run = useCallback(async (force: boolean) => {
    setRunning(true);
    let next: Loaded<DiscoverVm>;
    try {
      const r = await (force ? rpcs.current.refreshRpc({}) : rpcs.current.getRpc({}));
      next = r.ok
        ? { kind: "vm", vm: buildDiscoverVm({ data: r.data, exportedAt: r.exportedAt, version: r.version }) }
        : { kind: "error", view: discoverErrorView(r.code), code: r.code };
    } catch {
      next = { kind: "error", view: LOAD_ERROR_VIEW, code: null };
    }
    if (!alive.current) return;
    const settled = settleLoad(loadedRef.current, next, force);
    // Row keys are positional, so a new export drops the selection.
    if (settled.kind !== "vm" || loadedRef.current.kind !== "vm" || settled.vm !== loadedRef.current.vm) setSelected(null);
    loadedRef.current = settled;
    setLoaded(settled);
    setRunning(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    void run(false);
    return () => {
      alive.current = false;
    };
  }, [run]);

  const vm = loaded.kind === "vm" ? loaded.vm : null;
  const fresh = vm ? freshness(vm.exportedAt, nowMs) : null;
  return (
    <View style={styles.loose}>
      <View style={styles.tight}>
        <Text style={styles.text.heading}>Discover</Text>
        {vm ? <Text style={styles.text.muted}>{`Exported ${fresh!.exportedAtText} · ${vm.version}`}</Text> : null}
        <View style={styles.row}>
          <Button styles={styles} label={running ? "Trying again" : "Try again"} disabled={running} onPress={() => void run(true)} />
        </View>
      </View>
      {loaded.kind === "loading" ? (
        <Text style={styles.text.muted}>Loading the Discover export.</Text>
      ) : loaded.kind === "error" ? (
        <View style={styles.cardDanger}>
          <Text style={styles.text.dangerStrong}>{loaded.view.sentence}</Text>
          <Text style={styles.text.body}>{loaded.view.hint}</Text>
          {loaded.code === "NOT_CONFIGURED" ? <Button styles={styles} label="Open Settings" onPress={onOpenSettings} /> : null}
        </View>
      ) : (
        <>
          {loaded.vm.notices.length === 0 ? null : (
            <View accessibilityRole="alert" style={styles.cardWarning}>
              {loaded.vm.notices.map((n) => <Text key={n} style={styles.text.warning}>{n}</Text>)}
            </View>
          )}
          {loaded.refreshError ? (
            <View accessibilityRole="alert" style={styles.cardDanger}>
              <Text style={styles.text.dangerStrong}>{loaded.refreshError.sentence}</Text>
              <Text style={styles.text.body}>{`${loaded.refreshError.hint} The records below are from the last export that loaded.`}</Text>
            </View>
          ) : null}
          {fresh!.stale ? (
            <View style={styles.cardWarning}>
              <Text style={styles.text.warningStrong}>{fresh!.stale.sentence}</Text>
              <Text style={styles.text.body}>{fresh!.stale.hint}</Text>
            </View>
          ) : null}
          <DiscoverBoard
            styles={styles}
            vm={loaded.vm}
            section={section}
            selected={selected}
            onSection={(next) => { setSection(next); setSelected(null); }}
            onSelect={setSelected}
          />
        </>
      )}
    </View>
  );
}
