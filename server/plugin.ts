import type { PluginServerContext } from "@getpaseo/plugin/server";
import { planningGet, planningRefresh, status } from "../shared/contracts.ts";
import type { ErrorCode } from "../shared/errors.ts";
import { VERSION } from "../shared/version.ts";
import type { ExportResult, Runner } from "./runner.ts";
import { SETTINGS_ID, SETTINGS_VERSION, SettingsSchema } from "./settings.ts";

// Wires settings and the three RPC handlers. Registers nothing else (no hooks, providers or tools).
// The cache lives in this closure and is cleared by the returned cleanup function.
// Minimum gap between forced exports: faster refreshes serve the cached entry instead.
export const MIN_REFRESH_MS = 5000;

export function createPlugin(server: PluginServerContext, runner: Runner, now: () => number = Date.now): () => void {
  const settings = server.registerSettings({ id: SETTINGS_ID, scope: "host", version: SETTINGS_VERSION, schema: SettingsSchema });
  // Single entry: a settings change replaces it, so going A -> B -> A re-exports A.
  let cache: { readonly key: string; readonly result: ExportResult } | null = null;
  let lastError: ErrorCode | null = null;
  let latestKey: string | null = null;
  let closed = false;
  let lastForcedAt = -Infinity;

  const notConfigured: ExportResult = { ok: false, code: "NOT_CONFIGURED" };

  type Values = { executable?: string | undefined; workspace?: string | undefined; project?: string | undefined; prs?: string | undefined };
  // Keyed on the configured values; null when settings are incomplete.
  const keyOf = (v: Values | undefined): string | null => (!v?.executable || !v.workspace || !v.project ? null : [v.executable, v.workspace, v.project, v.prs ?? ""].join("\0"));

  async function load(force: boolean): Promise<ExportResult> {
    const state = await settings.read();
    const v = state.status === "ready" ? state.values : undefined;
    const key = keyOf(v);
    latestKey = key;
    const result = await resolve(key, v, force);
    // A late result for settings that have since changed must not overwrite the status.
    if (key === latestKey) lastError = result.ok ? null : result.code;
    return result;
  }

  async function resolve(key: string | null, v: Values | undefined, force: boolean): Promise<ExportResult> {
    if (key === null || !v) return notConfigured;
    if (closed) return { ok: false, code: "EXPORT_FAILED" };
    if (cache && cache.key === key && (!force || now() - lastForcedAt < MIN_REFRESH_MS)) return cache.result;
    if (force) lastForcedAt = now();
    const result = await runner.exportPlanning({ executable: v.executable!, workspace: v.workspace!, project: v.project!, prs: v.prs }).catch((): ExportResult => ({ ok: false, code: "EXPORT_FAILED" }));
    // BUSY is transient; a result that finishes after cleanup must not repopulate the cache.
    if (!closed && !(!result.ok && result.code === "BUSY")) cache = { key, result };
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
    cache = null;
  };
}
