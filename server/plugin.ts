import type { PluginServerContext } from "@getpaseo/plugin/server";
import { planningGet, planningRefresh, status } from "../shared/contracts.ts";
import type { ErrorCode } from "../shared/errors.ts";
import { VERSION } from "../shared/version.ts";
import type { ExportResult, Runner } from "./runner.ts";
import { SETTINGS_ID, SETTINGS_VERSION, SettingsSchema } from "./settings.ts";

// Wires settings and the three RPC handlers. Registers nothing else (no hooks, providers or tools).
// The cache lives in this closure and is cleared by the returned cleanup function.
export function createPlugin(server: PluginServerContext, runner: Runner): () => void {
  const settings = server.registerSettings({ id: SETTINGS_ID, scope: "host", version: SETTINGS_VERSION, schema: SettingsSchema });
  const cache = new Map<string, ExportResult>();
  let lastError: ErrorCode | null = null;
  let closed = false;

  const notConfigured: ExportResult = { ok: false, code: "NOT_CONFIGURED" };

  async function load(force: boolean): Promise<ExportResult> {
    const state = await settings.read();
    const v = state.status === "ready" ? state.values : undefined;
    const result = await resolve(v, force);
    lastError = result.ok ? null : result.code;
    return result;
  }

  async function resolve(v: { executable?: string | undefined; workspace?: string | undefined; project?: string | undefined } | undefined, force: boolean): Promise<ExportResult> {
    if (!v?.executable || !v.workspace || !v.project) return notConfigured;
    // Keyed on the configured values: any settings change misses and re-exports on the next get.
    const key = [v.executable, v.workspace, v.project].join("\0");
    const hit = force ? undefined : cache.get(key);
    if (hit) return hit;
    const result = await runner.exportPlanning(v).catch((): ExportResult => ({ ok: false, code: "EXPORT_FAILED" }));
    // BUSY is transient; a result that finishes after cleanup must not repopulate the cache.
    if (!closed && !(!result.ok && result.code === "BUSY")) cache.set(key, result);
    return result;
  }

  server.handle(status, async () => {
    const state = await settings.read();
    const v = state.status === "ready" ? state.values : undefined;
    return { version: VERSION, configured: Boolean(v?.executable && v.workspace && v.project), lastError };
  });
  server.handle(planningGet, () => load(false));
  server.handle(planningRefresh, () => load(true));

  return () => {
    closed = true;
    cache.clear();
  };
}
