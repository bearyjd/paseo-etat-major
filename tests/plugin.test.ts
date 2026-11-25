import { test } from "node:test";
import assert from "node:assert/strict";
import { createRunner, type ExportResult, type Runner } from "../server/runner.ts";
import { createPlugin } from "../server/plugin.ts";
import { SettingsSchema } from "../server/settings.ts";
import { EXE, WS, harness, okScript, type Script } from "./runner-harness.ts";

type Handler = (input: unknown, ctx: unknown) => Promise<Record<string, unknown>>;

// Only handle() and registerSettings() exist; any other use (hooks, providers, ...) throws.
function fakeServer(initial: unknown) {
  const handlers = new Map<string, Handler>();
  const state = { values: initial };
  let definition: { id: string; scope: string; version: number } | undefined;
  const target = {
    handle(contract: { name: string }, h: Handler) {
      handlers.set(contract.name, h);
    },
    registerSettings(def: { id: string; scope: string; version: number; schema: typeof SettingsSchema }) {
      definition = def;
      return {
        read: async () => {
          const r = def.schema.safeParse(state.values);
          return r.success
            ? { status: "ready", revision: "1", values: r.data }
            : { status: "invalid", revision: "1", error: "invalid settings" };
        },
        subscribe: () => () => {},
      };
    },
  };
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return (t as never)[k];
      throw new Error(`unexpected server context use: ${String(k)}`);
    },
  });
  const call = (name: string, input: unknown = {}) => {
    const h = handlers.get(name);
    assert.ok(h, `no handler ${name}`);
    return h(input, {});
  };
  return { ctx, handlers, state, call, definition: () => definition };
}

const GOOD = { executable: EXE, workspace: WS, project: "harbor" };
const setup = (values: unknown = GOOD, script: Script = okScript, logs: unknown[] = []) => {
  const h = harness(script);
  let n = 0;
  const runner = createRunner({ ...h.deps, now: () => new Date(Date.UTC(2026, 10, 25, 10, 0, n++)), log: (e) => void logs.push(e) });
  const s = fakeServer(values);
  const cleanup = createPlugin(s.ctx as never, runner);
  return { ...s, h, cleanup, logs };
};
const execCount = (h: ReturnType<typeof harness>) => h.calls.length;

test("registers host settings v1 and exactly three handlers, nothing else", () => {
  const s = setup();
  assert.deepEqual([...s.handlers.keys()].sort(), ["etat-major.planning.get", "etat-major.planning.refresh", "etat-major.status.get"]);
  const def = s.definition()!;
  assert.equal(def.scope, "host");
  assert.equal(def.version, 1);
});

test("NOT_CONFIGURED when settings are unset or invalid, and nothing is spawned", async () => {
  for (const values of [{}, { executable: EXE }, { executable: "rel/etat-major", workspace: WS, project: "harbor" }]) {
    const s = setup(values);
    assert.deepEqual(await s.call("etat-major.planning.get"), { ok: false, code: "NOT_CONFIGURED" });
    assert.deepEqual(await s.call("etat-major.planning.refresh"), { ok: false, code: "NOT_CONFIGURED" });
    const st = await s.call("etat-major.status.get");
    assert.deepEqual(st, { version: "0.0.1", configured: false, lastError: "NOT_CONFIGURED" });
    assert.equal(execCount(s.h), 0);
  }
});

test("get exports once, then serves the cache with the same exportedAt", async () => {
  const s = setup();
  const a = await s.call("etat-major.planning.get");
  assert.equal(a.ok, true);
  assert.equal(a.exportedAt, "2026-11-25T10:00:00.000Z");
  const calls = execCount(s.h);
  assert.ok(calls > 0);
  const b = await s.call("etat-major.planning.get");
  assert.deepEqual(b, a);
  assert.equal(execCount(s.h), calls);
  assert.deepEqual(await s.call("etat-major.status.get"), { version: "0.0.1", configured: true, lastError: null });
});

test("refresh re-runs only when called explicitly", async () => {
  const s = setup();
  const a = await s.call("etat-major.planning.get");
  const before = execCount(s.h);
  const r = await s.call("etat-major.planning.refresh");
  assert.equal(r.ok, true);
  assert.ok(execCount(s.h) > before);
  assert.notEqual(r.exportedAt, a.exportedAt);
  const after = execCount(s.h);
  const g = await s.call("etat-major.planning.get");
  assert.equal(g.exportedAt, r.exportedAt);
  assert.equal(execCount(s.h), after);
});

test("a settings change is a new cache key and triggers an export", async () => {
  const s = setup();
  await s.call("etat-major.planning.get");
  const before = execCount(s.h);
  s.state.values = { ...GOOD, project: "other" };
  await s.call("etat-major.planning.get");
  assert.ok(execCount(s.h) > before);
});

test("runner error codes map to UI-safe states, are cached, and refresh retries", async () => {
  const s = setup(GOOD, (c) => ({ stdout: c.args[0] === "--version" ? "etat-major 0.1.3\n" : "not json" }));
  assert.deepEqual(await s.call("etat-major.planning.get"), { ok: false, code: "BAD_JSON" });
  assert.equal((await s.call("etat-major.status.get")).lastError, "BAD_JSON");
  const n = execCount(s.h);
  await s.call("etat-major.planning.get");
  assert.equal(execCount(s.h), n);
  await s.call("etat-major.planning.refresh");
  assert.ok(execCount(s.h) > n);
});

test("a thrown runner failure becomes EXPORT_FAILED", async () => {
  const runner: Runner = { exportPlanning: () => Promise.reject(new Error(`boom ${EXE}`)) };
  const s = fakeServer(GOOD);
  createPlugin(s.ctx as never, runner);
  assert.deepEqual(await s.call("etat-major.planning.get"), { ok: false, code: "EXPORT_FAILED" });
});

test("cleanup clears the cache and drops results of exports still in flight", async () => {
  const s = setup();
  await s.call("etat-major.planning.get");
  const before = execCount(s.h);
  s.cleanup();
  await s.call("etat-major.planning.get");
  assert.ok(execCount(s.h) > before);

  let release: (r: ExportResult) => void = () => {};
  let runs = 0;
  const runner: Runner = { exportPlanning: () => (runs++, new Promise<ExportResult>((res) => (release = res))) };
  const t = fakeServer(GOOD);
  const cleanup = createPlugin(t.ctx as never, runner);
  const pending = t.call("etat-major.planning.get");
  await new Promise((r) => setImmediate(r));
  cleanup();
  release({ ok: false, code: "TIMEOUT" });
  await pending;
  void t.call("etat-major.planning.get");
  await new Promise((r) => setImmediate(r));
  assert.equal(runs, 2); // the late result was not cached, so this get ran again
});

test("settings schema rejects relative paths, traversal and bad project ids without echoing values", () => {
  assert.ok(SettingsSchema.safeParse(GOOD).success);
  assert.ok(SettingsSchema.safeParse({}).success);
  const bad: unknown[] = [
    { executable: "bin/etat-major" },
    { executable: "/opt/../etc/etat-major" },
    { workspace: "relative/ws" },
    { workspace: "" },
    { project: "../x" },
    { project: "Harbor" },
    { project: "" },
    { project: "a".repeat(65) },
    { executable: 5 },
  ];
  for (const v of bad) {
    const r = SettingsSchema.safeParse(v);
    assert.equal(r.success, false, JSON.stringify(v));
  }
  const r = SettingsSchema.safeParse({ workspace: "secret-relative-value" });
  assert.ok(!r.success && !JSON.stringify(r.error.issues).includes("secret-relative-value"));
});

test("no setting value is logged raw", async () => {
  const logs: unknown[] = [];
  const s = setup(GOOD, (c) => (c.args[0] === "--version" ? { stdout: "etat-major 0.1.3\n" } : { code: 2, stderr: `error: cannot open ${WS}/x for ${EXE}\n` }), logs);
  assert.deepEqual(await s.call("etat-major.planning.get"), { ok: false, code: "EXPORT_FAILED" });
  assert.ok(logs.length > 0);
  const text = JSON.stringify(logs);
  for (const secret of [EXE, WS, "harbor"]) assert.ok(!text.includes(secret), `log leaked ${secret}`);
});
