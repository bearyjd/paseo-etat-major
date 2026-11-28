import type { PluginServerContext } from "@getpaseo/plugin/server";
import { discoverGet, discoverRefresh, planningGet, planningRefresh, status } from "../shared/contracts.ts";
import type { ErrorCode } from "../shared/errors.ts";
import { VERSION } from "../shared/version.ts";
import type { ExportResult, Runner } from "./runner.ts";
import { SETTINGS_ID, SETTINGS_VERSION, SettingsSchema } from "./settings.ts";

// Wires settings and the five RPC handlers. Registers nothing else (no hooks, providers or tools).
// The caches live in this closure and are cleared by the returned cleanup function.
// Minimum gap between forced exports of one view: faster refreshes serve the cached entry instead.
export const MIN_REFRESH_MS = 5000;

type Values = { executable?: string | undefined; workspace?: string | undefined; project?: string | undefined; prs?: string | undefined; releases?: string | undefined };
type Configured = Values & { executable: string; workspace: string; project: string };

// Identifies the configured values as a whole; null when settings are incomplete.
const keyOf = (v: Values | undefined): string | null => (!v?.executable || !v.workspace || !v.project ? null : [v.executable, v.workspace, v.project, v.prs ?? "", v.releases ?? ""].join("\0"));

export function createPlugin(server: PluginServerContext, runner: Runner, now: () => number = Date.now): () => void {
  const settings = server.registerSettings({ id: SETTINGS_ID, scope: "host", version: SETTINGS_VERSION, schema: SettingsSchema });
  let lastError: ErrorCode | null = null;
  let latestKey: string | null = null;
  let closed = false;

  // One cached export per view. cacheKey names the settings that view's output depends on.
  function cachedView<T>(cacheKey: (v: Configured) => string, run: (v: Configured) => Promise<ExportResult<T>>) {
    // Single entry: a settings change replaces it, so going A -> B -> A re-exports A.
    let cache: { readonly key: string; readonly result: ExportResult<T> } | null = null;
    let lastForcedAt = -Infinity;

    async function resolve(v: Configured, force: boolean): Promise<ExportResult<T>> {
      if (closed) return { ok: false, code: "EXPORT_FAILED" };
      const key = cacheKey(v);
      if (cache && cache.key === key && (!force || now() - lastForcedAt < MIN_REFRESH_MS)) return cache.result;
      const startedAt = now();
      const result = await run(v).catch((): ExportResult<T> => ({ ok: false, code: "EXPORT_FAILED" }));
      // BUSY ran nothing: it neither starts the refresh window nor replaces the cached export.
      const busy = !result.ok && result.code === "BUSY";
      if (force && !busy) lastForcedAt = startedAt;
      // A result that finishes after cleanup must not repopulate the cache.
      if (!closed && !busy) cache = { key, result };
      return result;
    }

    async function load(force: boolean): Promise<ExportResult<T>> {
      const state = await settings.read();
      const v = state.status === "ready" ? state.values : undefined;
      const settingsKey = keyOf(v);
      latestKey = settingsKey;
      const result: ExportResult<T> = settingsKey === null ? { ok: false, code: "NOT_CONFIGURED" } : await resolve(v as Configured, force);
      // A late result for settings that have since changed must not overwrite the status.
      if (settingsKey === latestKey) lastError = result.ok ? null : result.code;
      return result;
    }

    return { load, clear: () => void (cache = null) };
  }

  const planning = cachedView(
    (v) => keyOf(v)!,
    (v) => runner.exportPlanning({ executable: v.executable, workspace: v.workspace, project: v.project, prs: v.prs, releases: v.releases }),
  );
  // The Discover export takes no recorded inputs, so changing them keeps its cache.
  const discover = cachedView(
    (v) => [v.executable, v.workspace, v.project].join("\0"),
    (v) => runner.exportDiscover({ executable: v.executable, workspace: v.workspace, project: v.project }),
  );

  server.handle(status, async () => {
    const state = await settings.read();
    const v = state.status === "ready" ? state.values : undefined;
    return { version: VERSION, configured: Boolean(v?.executable && v.workspace && v.project), lastError };
  });
  server.handle(planningGet, () => planning.load(false));
  server.handle(planningRefresh, () => planning.load(true));
  server.handle(discoverGet, () => discover.load(false));
  server.handle(discoverRefresh, () => discover.load(true));

  return () => {
    closed = true;
    planning.clear();
    discover.clear();
  };
}
