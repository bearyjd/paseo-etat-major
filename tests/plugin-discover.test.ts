import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRunner, type ExportResult, type Runner } from "../server/runner.ts";
import { createPlugin } from "../server/plugin.ts";
import { PlanningResult, DiscoverResult, discoverGet, discoverRefresh } from "../shared/contracts.ts";
import { EXE, FIXTURE, WS, harness, type Script } from "./runner-harness.ts";
import { fakeServer } from "./fake-server.ts";

const DISCOVER = readFileSync(new URL("../fixtures/exports/harbor-discover.json", import.meta.url), "utf8");
const GOOD = { executable: EXE, workspace: WS, project: "harbor" };
const GET = "etat-major.discover.get";
const REFRESH = "etat-major.discover.refresh";
const both: Script = (c) => ({ stdout: c.args[0] === "--version" ? "etat-major 0.1.0\n" : c.args[1] === "discover" ? DISCOVER : FIXTURE });
const setup = (values: unknown = GOOD, script: Script = both, now?: () => number) => {
  const h = harness(script);
  const s = fakeServer(values);
  const cleanup = createPlugin(s.ctx as never, createRunner(h.deps), now);
  const exports = (view: string) => h.calls.filter((c) => c.args[1] === view).length;
  return { ...s, h, cleanup, exports };
};

test("discover contracts: names, and results that cannot be confused with planning", async () => {
  assert.equal(discoverGet.name, GET);
  assert.equal(discoverRefresh.name, REFRESH);
  const s = setup();
  const r = await s.call(GET);
  assert.ok(DiscoverResult.safeParse(r).success);
  assert.equal(PlanningResult.safeParse(r).success, false);
  assert.ok(DiscoverResult.safeParse({ ok: false, code: "DISCOVER_UNSUPPORTED" }).success);
});

test("discover get exports once and caches; planning keeps its own cache entry", async () => {
  const s = setup();
  const a = await s.call(GET);
  assert.equal(a.ok, true);
  await s.call("etat-major.planning.get");
  assert.deepEqual(await s.call(GET), a);
  await s.call("etat-major.planning.get");
  assert.equal(s.exports("discover"), 1);
  assert.equal(s.exports("planning"), 1);
});

test("discover NOT_CONFIGURED spawns nothing", async () => {
  const s = setup({});
  assert.deepEqual(await s.call(GET), { ok: false, code: "NOT_CONFIGURED" });
  assert.deepEqual(await s.call(REFRESH), { ok: false, code: "NOT_CONFIGURED" });
  assert.equal(s.h.calls.length, 0);
});

test("discover refresh re-runs, rate limited independently of planning refresh", async () => {
  let t = 1_000_000;
  const s = setup(GOOD, both, () => t);
  await s.call(GET);
  await s.call("etat-major.planning.get");
  await s.call("etat-major.planning.refresh");
  await s.call(REFRESH);
  assert.equal(s.exports("discover"), 2, "a planning refresh does not use up the discover refresh");
  for (let i = 0; i < 20; i++) await s.call(REFRESH);
  assert.equal(s.exports("discover"), 2);
  t += 5_000;
  await s.call(REFRESH);
  assert.equal(s.exports("discover"), 3);
});

test("the discover cache ignores prs and releases but follows executable, workspace and project", async () => {
  const s = setup();
  await s.call(GET);
  s.state.values = { ...GOOD, prs: "/srv/rec/prs.json", releases: "/missing" };
  assert.equal((await s.call(GET)).ok, true);
  assert.equal(s.exports("discover"), 1);
  s.state.values = { ...GOOD, project: "other" };
  await s.call(GET);
  assert.equal(s.exports("discover"), 2);
});

test("an older exporter shows up as DISCOVER_UNSUPPORTED in the result and the status", async () => {
  const s = setup(GOOD, (c) =>
    c.args[0] === "--version" ? { stdout: "etat-major 0.1.0\n" } : { code: 2, stderr: "usage: x\netat-major export: error: argument action: invalid choice: 'discover' (choose from 'planning')\n" });
  assert.deepEqual(await s.call(GET), { ok: false, code: "DISCOVER_UNSUPPORTED" });
  assert.equal((await s.call("etat-major.status.get")).lastError, "DISCOVER_UNSUPPORTED");
});

test("BUSY is not cached for discover", async () => {
  let runs = 0;
  const runner: Runner = {
    exportPlanning: async () => ({ ok: false, code: "BAD_JSON" }),
    exportDiscover: async () => (runs++, { ok: false, code: "BUSY" }),
  };
  const s = fakeServer(GOOD);
  createPlugin(s.ctx as never, runner);
  await s.call(GET);
  await s.call(GET);
  assert.equal(runs, 2);
});

test("a refresh answered BUSY does not use up the refresh window", async () => {
  let t = 1_000_000;
  let runs = 0;
  const runner: Runner = {
    exportPlanning: async () => ({ ok: false, code: "BAD_JSON" }),
    // The second run meets another export in progress; the others finish (with a cacheable result).
    exportDiscover: async () => ({ ok: false, code: ++runs === 2 ? "BUSY" : "TIMEOUT" }),
  };
  const s = fakeServer(GOOD);
  createPlugin(s.ctx as never, runner, () => t);
  await s.call(GET);
  assert.deepEqual(await s.call(REFRESH), { ok: false, code: "BUSY" });
  t += 1_000;
  assert.deepEqual(await s.call(REFRESH), { ok: false, code: "TIMEOUT" });
  assert.equal(runs, 3, "the retry ran the export instead of serving the cache");
  await s.call(REFRESH);
  assert.equal(runs, 3, "a finished refresh still starts the window");
});

test("a thrown discover failure becomes EXPORT_FAILED", async () => {
  const runner: Runner = {
    exportPlanning: async () => ({ ok: false, code: "BAD_JSON" }),
    exportDiscover: () => Promise.reject(new Error(`boom ${EXE}`)),
  };
  const s = fakeServer(GOOD);
  createPlugin(s.ctx as never, runner);
  assert.deepEqual(await s.call(GET), { ok: false, code: "EXPORT_FAILED" });
});

test("cleanup clears the discover cache and drops a result still in flight", async () => {
  let release: (r: ExportResult<never>) => void = () => {};
  let runs = 0;
  const runner: Runner = {
    exportPlanning: async () => ({ ok: false, code: "BAD_JSON" }),
    exportDiscover: () => (runs++, new Promise<ExportResult<never>>((res) => (release = res))),
  };
  const s = fakeServer(GOOD);
  const cleanup = createPlugin(s.ctx as never, runner);
  const pending = s.call(GET);
  await new Promise((r) => setImmediate(r));
  cleanup();
  release({ ok: false, code: "TIMEOUT" });
  await pending;
  assert.deepEqual(await s.call(GET), { ok: false, code: "EXPORT_FAILED" });
  assert.equal(runs, 1);

  const cached = setup();
  await cached.call(GET);
  cached.cleanup();
  assert.deepEqual(await cached.call(GET), { ok: false, code: "EXPORT_FAILED" });
});
