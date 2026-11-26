import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_BUFFER, createRunner } from "../server/runner.ts";
import { EXE, FIXTURE, SETTINGS, WS, goodEntries, harness, type Script } from "./runner-harness.ts";

const DISCOVER = readFileSync(new URL("../fixtures/exports/harbor-discover.json", import.meta.url), "utf8");
const VERSION_OUT = "etat-major 0.1.0\n";
const script = (reply: ReturnType<Script>): Script => (c) => (c.args[0] === "--version" ? { stdout: VERSION_OUT } : reply);
const both: Script = (c) => ({ stdout: c.args[0] === "--version" ? VERSION_OUT : c.args[1] === "discover" ? DISCOVER : FIXTURE });
const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code);
// Recorded from an exporter built before the command existed (argparse usage error, exit 2).
const NO_DISCOVER = "usage: etat-major export [-h] {planning} ...\netat-major export: error: argument action: invalid choice: 'discover' (choose from 'planning')\n";
const NO_EXPORT = "usage: etat-major [-h] [--version]\n                  {trace,index} ...\netat-major: error: argument command: invalid choice: 'export' (choose from 'trace', 'index')\n";

test("discover: exact argv, options and scrubbed env; prs, releases and --repo are never passed", async () => {
  process.env["PEM_CANARY"] = "leaked";
  try {
    const h = harness(both);
    const r = await createRunner(h.deps).exportDiscover({ ...SETTINGS, prs: "/srv/rec/prs.json", releases: "/missing" });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.data.schema, "etat-major/discover@1");
      assert.equal(r.exportedAt, "2026-11-25T10:00:00.000Z");
      assert.equal(r.version, "0.1.0");
    }
    assert.equal(h.calls.length, 2);
    const x = h.calls[1]!;
    assert.equal(x.file, EXE);
    assert.deepEqual(x.args, ["export", "discover", "--json", `--workspace=${WS}`, "--project=harbor"]);
    const { env, ...rest } = x.options;
    assert.deepEqual(rest, { shell: false, cwd: WS, maxBuffer: MAX_BUFFER, detached: true, encoding: "utf8" });
    assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "PATH", "PYTHONDONTWRITEBYTECODE", "PYTHONNOUSERSITE"]);
    assert.equal(JSON.stringify(x.options).includes("leaked"), false);
    assert.deepEqual(h.fs.removed, [env.HOME]);
    assert.deepEqual(h.kills, h.calls.map((c) => [c.pid, "SIGKILL"]));
  } finally {
    delete process.env["PEM_CANARY"];
  }
});

test("discover: the same validation as planning, before anything spawns", async () => {
  const h = harness(both);
  const runner = createRunner(h.deps);
  assert.equal(code(await runner.exportDiscover({})), "NOT_CONFIGURED");
  assert.equal(code(await runner.exportDiscover({ ...SETTINGS, project: "--repo=/x" })), "NOT_CONFIGURED");
  assert.equal(code(await runner.exportDiscover({ ...SETTINGS, executable: "rel/etat-major" })), "EXE_INVALID");
  assert.equal(code(await runner.exportDiscover({ ...SETTINGS, workspace: "/missing" })), "WORKSPACE_INVALID");
  const inside = { ...goodEntries(), "/srv/ws/tools": { kind: "dir" as const }, "/srv/ws/tools/etat-major": { kind: "file" as const, mode: 0o755 } };
  const h2 = harness(both, inside);
  assert.equal(code(await createRunner(h2.deps).exportDiscover({ ...SETTINGS, executable: "/srv/ws/tools/etat-major" })), "EXE_INVALID");
  assert.equal(h.calls.length + h2.calls.length, 0);
});

test("discover: an exporter without the command (exit 2) is DISCOVER_UNSUPPORTED", async () => {
  for (const stderr of [NO_DISCOVER, NO_EXPORT]) {
    const h = harness(script({ code: 2, stderr }));
    assert.deepEqual(await createRunner(h.deps).exportDiscover(SETTINGS), { ok: false, code: "DISCOVER_UNSUPPORTED" });
    assert.deepEqual(h.logs.map((l) => (l as { code: string }).code), ["DISCOVER_UNSUPPORTED"]);
  }
});

test("discover: any other failure stays EXPORT_FAILED, including other exit 2 causes", async () => {
  const cases: Array<ReturnType<Script>> = [
    { code: 2, stderr: "error: export discover: field 'project': no records for the configured project\n" },
    { code: 2, stderr: "error: export discover: field 'x': invalid choice: 'discover'\n" },
    { code: 1, stderr: NO_DISCOVER },
    { code: 2 },
    { code: null },
  ];
  for (const reply of cases) {
    const h = harness(script(reply));
    assert.equal(code(await createRunner(h.deps).exportDiscover(SETTINGS)), "EXPORT_FAILED", JSON.stringify(reply));
  }
});

test("planning never reports DISCOVER_UNSUPPORTED", async () => {
  const h = harness(script({ code: 2, stderr: NO_EXPORT }));
  assert.equal(code(await createRunner(h.deps).exportPlanning(SETTINGS)), "EXPORT_FAILED");
});

test("discover: parse, size and timeout failures", async () => {
  const run = async (reply: ReturnType<Script>) => code(await createRunner(harness(script(reply)).deps).exportDiscover(SETTINGS));
  assert.equal(await run({ stdout: "{" }), "BAD_JSON");
  assert.equal(await run({ stdout: FIXTURE }), "SCHEMA_MISMATCH");
  assert.equal(await run({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }), "OUTPUT_TOO_LARGE");
  const h = harness(script({ hang: true }));
  const pending = createRunner(h.deps).exportDiscover(SETTINGS);
  while (h.timers.length < 2) await new Promise((r) => setImmediate(r));
  h.timers[1]!.fn();
  assert.equal(code(await pending), "TIMEOUT");
});

test("single flight spans both views: identical discover calls share a child, planning meanwhile is BUSY", async () => {
  const h = harness(script({ hang: true }));
  const runner = createRunner(h.deps);
  const a = runner.exportDiscover(SETTINGS);
  while (h.calls.length < 2) await new Promise((r) => setImmediate(r));
  const b = runner.exportDiscover(SETTINGS);
  assert.equal(code(await runner.exportPlanning(SETTINGS)), "BUSY");
  assert.equal(code(await runner.exportDiscover({ ...SETTINGS, project: "other" })), "BUSY");
  assert.equal(h.calls.length, 2);
  h.calls[1]!.cb(null, DISCOVER, "");
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.ok, true);
  assert.equal(ra, rb);
});

test("single flight: a discover call never joins a planning export of the same settings", async () => {
  const h = harness(script({ hang: true }));
  const runner = createRunner(h.deps);
  const planning = runner.exportPlanning(SETTINGS);
  while (h.calls.length < 2) await new Promise((r) => setImmediate(r));
  assert.equal(code(await runner.exportDiscover(SETTINGS)), "BUSY");
  h.calls[1]!.cb(null, FIXTURE, "");
  assert.equal((await planning).ok, true);
});
