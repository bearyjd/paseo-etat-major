import { test } from "node:test";
import assert from "node:assert/strict";
import { ERROR_CODES, type ErrorCode } from "../shared/errors.ts";
import { createRunner } from "../server/runner.ts";
import { EXE, FIXTURE, SETTINGS, WS, goodEntries, harness, okScript, type Script } from "./runner-harness.ts";

const MAXBUF = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
const failure = (r: { ok: boolean; code?: ErrorCode }) => (r.ok ? "ok" : r.code);

test("NOT_CONFIGURED when any setting is missing or the project id is malformed; nothing spawned", async () => {
  const h = harness();
  const runner = createRunner(h.deps);
  for (const s of [{}, { ...SETTINGS, executable: undefined }, { ...SETTINGS, workspace: "" }, { ...SETTINGS, project: undefined },
    { ...SETTINGS, project: "--workspace=/x" }, { ...SETTINGS, project: "-a" }, { ...SETTINGS, project: "A" }]) {
    assert.deepEqual(await runner.exportPlanning(s), { ok: false, code: "NOT_CONFIGURED" }, JSON.stringify(s));
  }
  assert.equal(h.calls.length, 0);
});

test("EXE_INVALID and WORKSPACE_INVALID, checked before any spawn", async () => {
  const e = goodEntries();
  e[EXE] = { kind: "file", mode: 0o777 };
  const h = harness(okScript, e);
  const runner = createRunner(h.deps);
  assert.deepEqual(await runner.exportPlanning(SETTINGS), { ok: false, code: "EXE_INVALID" });
  assert.deepEqual(await createRunner(harness().deps).exportPlanning({ ...SETTINGS, executable: "rel/etat-major" }), { ok: false, code: "EXE_INVALID" });
  const h2 = harness();
  assert.deepEqual(await createRunner(h2.deps).exportPlanning({ ...SETTINGS, workspace: "/missing" }), { ok: false, code: "WORKSPACE_INVALID" });
  assert.deepEqual(await createRunner(h2.deps).exportPlanning({ ...SETTINGS, workspace: "rel" }), { ok: false, code: "WORKSPACE_INVALID" });
  assert.equal(h.calls.length + h2.calls.length, 0);
});

test("an executable inside the workspace is EXE_INVALID", async () => {
  const e = goodEntries();
  e["/srv/ws/tools"] = { kind: "dir" };
  e["/srv/ws/tools/etat-major"] = { kind: "file", mode: 0o755 };
  const h = harness(okScript, e);
  const r = await createRunner(h.deps).exportPlanning({ ...SETTINGS, executable: "/srv/ws/tools/etat-major" });
  assert.deepEqual(r, { ok: false, code: "EXE_INVALID" });
  assert.equal(h.calls.length, 0);
});

test("exact argv, options and env for --version and export", async () => {
  process.env["PEM_CANARY"] = "leaked";
  try {
    const h = harness();
    const r = await createRunner(h.deps).exportPlanning(SETTINGS);
    assert.equal(r.ok, true);
    assert.equal(h.calls.length, 2);
    const [v, x] = h.calls;
    assert.equal(v!.file, EXE);
    assert.deepEqual(v!.args, ["--version"]);
    assert.equal(x!.file, EXE);
    assert.deepEqual(x!.args, ["export", "planning", "--json", `--workspace=${WS}`, "--project=harbor"]);
    for (const c of [v!, x!]) {
      const { env, ...rest } = c.options;
      assert.deepEqual(rest, { shell: false, cwd: WS, maxBuffer: 4 * 1024 * 1024, detached: true, encoding: "utf8" });
      assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "PATH", "PYTHONDONTWRITEBYTECODE", "PYTHONNOUSERSITE"]);
      assert.deepEqual({ ...env, HOME: "" }, { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", HOME: "", PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1" });
      assert.equal(JSON.stringify(c.options).includes("leaked"), false);
      assert.equal("PEM_CANARY" in env, false);
    }
    assert.equal(x!.options.env.HOME.startsWith("/sandbox/"), true);
  } finally {
    delete process.env["PEM_CANARY"];
  }
});

test("HOME is a fresh temp dir per call and is removed afterwards, also on failure", async () => {
  const h = harness();
  const runner = createRunner(h.deps);
  await runner.exportPlanning(SETTINGS);
  await runner.exportPlanning(SETTINGS);
  const homes = h.calls.filter((c) => c.args[0] === "export").map((c) => c.options.env.HOME);
  assert.equal(new Set(homes).size, 2);
  assert.deepEqual(h.fs.removed, homes);
  const f = harness((c) => (c.args[0] === "--version" ? { stdout: "etat-major 0.1.0\n" } : { code: 2, stderr: "boom" }));
  assert.equal(failure(await createRunner(f.deps).exportPlanning(SETTINGS)), "EXPORT_FAILED");
  assert.equal(f.fs.removed.length, 1);
  assert.equal(f.fs.removed[0], f.calls[0]!.options.env.HOME);
});

test("version regex and pinned range", async () => {
  const cases: Array<[string, boolean]> = [
    ["etat-major 0.1.0\n", true], ["etat-major 0.1.0", true], ["etat-major 0.1.99\n", true],
    ["etat-major 0.0.9\n", false], ["etat-major 0.2.0\n", false], ["etat-major 1.0.0\n", false],
    ["etat-major 0.1\n", false], ["etat-major 0.1.0-rc1\n", false], ["etat-major 0.1.0\nextra\n", false],
    ["other 0.1.0\n", false], ["etat-major 0.1.0\n\n", false], ["", false], [" etat-major 0.1.0\n", false],
  ];
  for (const [out, ok] of cases) {
    const h = harness((c) => (c.args[0] === "--version" ? { stdout: out } : { stdout: FIXTURE }));
    const r = await createRunner(h.deps).exportPlanning(SETTINGS);
    assert.equal(failure(r), ok ? "ok" : "VERSION_UNSUPPORTED", JSON.stringify(out));
    if (!ok) assert.equal(h.calls.length, 1, "export must not run on a bad version");
  }
});

test("--version failure modes", async () => {
  const exit1 = harness(() => ({ code: 1, stderr: "x" }));
  assert.equal(failure(await createRunner(exit1.deps).exportPlanning(SETTINGS)), "VERSION_UNSUPPORTED");
  const enoent = harness(() => ({ code: "ENOENT" }));
  assert.equal(failure(await createRunner(enoent.deps).exportPlanning(SETTINGS)), "EXE_INVALID");
  const big = harness(() => ({ code: MAXBUF }));
  assert.equal(failure(await createRunner(big.deps).exportPlanning(SETTINGS)), "OUTPUT_TOO_LARGE");
});

test("version cache key also covers size and inode", async () => {
  for (const change of [{ size: 99 }, { ino: 77 }]) {
    const e = goodEntries();
    const h = harness(okScript, e);
    const runner = createRunner(h.deps);
    await runner.exportPlanning(SETTINGS);
    e[EXE] = { kind: "file", mode: 0o755, mtimeMs: 7, ...change };
    await runner.exportPlanning(SETTINGS);
    assert.equal(h.calls.filter((c) => c.args[0] === "--version").length, 2, JSON.stringify(change));
  }
});

test("process group is killed after every completion path, not just timeouts", async () => {
  const cases: Array<[string, Script]> = [
    ["exit 0", okScript],
    ["non-zero", (c) => (c.args[0] === "--version" ? { stdout: "etat-major 0.1.0\n" } : { code: 2 })],
    ["bad json", (c) => (c.args[0] === "--version" ? { stdout: "etat-major 0.1.0\n" } : { stdout: "{" })],
  ];
  for (const [name, script] of cases) {
    const h = harness(script);
    await createRunner(h.deps).exportPlanning(SETTINGS);
    assert.deepEqual(h.kills, h.calls.map((c) => [c.pid, "SIGKILL"]), name);
  }
});

test("version cached per realpath+mtime; failures are not cached", async () => {
  const e = goodEntries();
  const h = harness(okScript, e);
  const runner = createRunner(h.deps);
  await runner.exportPlanning(SETTINGS);
  await runner.exportPlanning(SETTINGS);
  assert.equal(h.calls.filter((c) => c.args[0] === "--version").length, 1);
  assert.equal(h.calls.filter((c) => c.args[0] === "export").length, 2);
  e[EXE] = { kind: "file", mode: 0o755, mtimeMs: 8 };
  await runner.exportPlanning(SETTINGS);
  assert.equal(h.calls.filter((c) => c.args[0] === "--version").length, 2);

  let out = "etat-major 0.2.0\n";
  const g = harness((c) => (c.args[0] === "--version" ? { stdout: out } : { stdout: FIXTURE }));
  const r2 = createRunner(g.deps);
  assert.equal(failure(await r2.exportPlanning(SETTINGS)), "VERSION_UNSUPPORTED");
  out = "etat-major 0.1.0\n";
  assert.equal(failure(await r2.exportPlanning(SETTINGS)), "ok");
});

test("timeout 20 s kills the process group and returns TIMEOUT", async () => {
  const h = harness((c) => (c.args[0] === "--version" ? { stdout: "etat-major 0.1.0\n" } : { hang: true }));
  const p = createRunner(h.deps).exportPlanning(SETTINGS);
  await new Promise((r) => setImmediate(r));
  const t = h.timers.at(-1)!;
  assert.equal(t.ms, 20_000);
  assert.equal(t.cleared, false);
  t.fn();
  assert.deepEqual(await p, { ok: false, code: "TIMEOUT" });
  assert.deepEqual(h.kills.at(-1), [h.calls.at(-1)!.pid, "SIGKILL"]);
  assert.equal(h.kills.length, h.calls.length, "one kill per child, no double kill");
  assert.equal(h.fs.removed.length, 1);
  h.calls.at(-1)!.cb(Object.assign(new Error("killed"), { code: null }), "", ""); // late callback is ignored
});

test("version step can time out too; timers are cleared on normal completion", async () => {
  const h = harness(() => ({ hang: true }));
  const p = createRunner(h.deps).exportPlanning(SETTINGS);
  await new Promise((r) => setImmediate(r));
  h.timers[0]!.fn();
  assert.equal(failure(await p), "TIMEOUT");
  const ok = harness();
  await createRunner(ok.deps).exportPlanning(SETTINGS);
  assert.equal(ok.timers.length, 2);
  assert.ok(ok.timers.every((t) => t.cleared));
});

test("maxBuffer is 4 MiB; overflow -> OUTPUT_TOO_LARGE and group kill", async () => {
  const h = harness((c) => (c.args[0] === "--version" ? { stdout: "etat-major 0.1.0\n" } : { code: MAXBUF, stdout: "partial" }));
  assert.deepEqual(await createRunner(h.deps).exportPlanning(SETTINGS), { ok: false, code: "OUTPUT_TOO_LARGE" });
  assert.equal(h.calls.at(-1)!.options.maxBuffer, 4_194_304);
  assert.deepEqual(h.kills.at(-1), [h.calls.at(-1)!.pid, "SIGKILL"]);
  assert.equal(h.kills.length, h.calls.length, "one kill per child, no double kill");
});

test("non-zero exit -> EXPORT_FAILED; UI gets the code only, logger gets the redacted first line", async () => {
  for (const code of [2, 1, 127, null]) {
    const h = harness((c) =>
      c.args[0] === "--version" ? { stdout: "etat-major 0.1.0\n" } : { code, stderr: `\nerror: workspace ${WS}/secret/x not found\n${"y".repeat(300)}\n` });
    const r = await createRunner(h.deps).exportPlanning(SETTINGS);
    assert.deepEqual(r, { ok: false, code: "EXPORT_FAILED" });
    assert.equal(JSON.stringify(r).includes("secret"), false);
    assert.equal(h.logs.length, 1);
    const line = JSON.stringify(h.logs[0]);
    assert.ok(line.includes("EXPORT_FAILED") && line.includes("error: workspace <path> not found"), line);
    assert.equal(line.includes("/srv"), false);
  }
  const long = harness((c) => (c.args[0] === "--version" ? { stdout: "etat-major 0.1.0\n" } : { code: 2, stderr: "z".repeat(900) }));
  await createRunner(long.deps).exportPlanning(SETTINGS);
  assert.equal((long.logs[0] as { detail: string }).detail.length, 200);
});

test("spawn error at export and a throwing exec -> EXPORT_FAILED, never throws", async () => {
  const h = harness((c) => (c.args[0] === "--version" ? { stdout: "etat-major 0.1.0\n" } : { code: "EACCES" }));
  assert.equal(failure(await createRunner(h.deps).exportPlanning(SETTINGS)), "EXPORT_FAILED");
  const t = harness();
  t.deps.exec = () => {
    throw new Error("sync boom");
  };
  const r = await createRunner(t.deps).exportPlanning(SETTINGS);
  assert.equal(r.ok, false);
  const u = harness();
  u.deps.fs = { ...u.fs, mkdtemp: async () => { throw new Error("disk full"); } };
  assert.deepEqual(await createRunner(u.deps).exportPlanning(SETTINGS), { ok: false, code: "EXPORT_FAILED" });
});

test("exit 0: BAD_JSON, SCHEMA_MISMATCH, and success with issues preserved", async () => {
  const run = async (stdout: string) =>
    createRunner(harness((c) => ({ stdout: c.args[0] === "--version" ? "etat-major 0.1.0\n" : stdout })).deps).exportPlanning(SETTINGS);
  for (const s of ["", "not json", "{\"a\":", FIXTURE.slice(0, 40)]) assert.deepEqual(await run(s), { ok: false, code: "BAD_JSON" }, s);
  const obj = JSON.parse(FIXTURE);
  for (const bad of [{ ...obj, version: 2 }, { ...obj, schema: "x" }, { ...obj, tasks: "no" }, [], null, 5]) {
    assert.deepEqual(await run(JSON.stringify(bad)), { ok: false, code: "SCHEMA_MISMATCH" });
  }
  const withIssues = JSON.parse(FIXTURE);
  const r = await run(JSON.stringify(withIssues));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.exportedAt, "2026-11-25T10:00:00.000Z");
    assert.equal(r.version, "0.1.0");
    assert.deepEqual(r.data.issues.length, withIssues.issues.length);
  }
});

test("single-flight: concurrent identical calls share one child; a different key is BUSY; later call re-runs", async () => {
  const h = harness((c) => (c.args[0] === "--version" ? { stdout: "etat-major 0.1.0\n" } : { hang: true }));
  const runner = createRunner(h.deps);
  const a = runner.exportPlanning(SETTINGS);
  const b = runner.exportPlanning(SETTINGS);
  const other = runner.exportPlanning({ ...SETTINGS, project: "other" });
  await new Promise((r) => setImmediate(r));
  assert.equal(h.calls.filter((c) => c.args[0] === "export").length, 1);
  assert.deepEqual(await other, { ok: false, code: "BUSY" });
  h.calls.at(-1)!.cb(null, FIXTURE, "");
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.ok && rb.ok, true);
  assert.deepEqual(ra, rb);
  assert.equal(h.fs.removed.length, 1);
  const c = runner.exportPlanning(SETTINGS);
  await new Promise((r) => setImmediate(r));
  h.calls.at(-1)!.cb(null, FIXTURE, "");
  assert.equal((await c).ok, true);
  assert.equal(h.calls.filter((x) => x.args[0] === "export").length, 2);
});

test("every error code in shared/errors.ts is reachable (none reserved)", async () => {
  const seen = new Set<string>();
  const hit = async (script: Script, s = SETTINGS, mutate?: (e: ReturnType<typeof goodEntries>) => void) => {
    const e = goodEntries();
    mutate?.(e);
    const r = await createRunner(harness(script, e).deps).exportPlanning(s);
    if (!r.ok) seen.add(r.code);
  };
  const v = (x: Parameters<Script>[0], rest: ReturnType<Script>) => (x.args[0] === "--version" ? { stdout: "etat-major 0.1.0\n" } : rest);
  await hit(okScript, {});
  await hit(okScript, SETTINGS, (e) => void (e[EXE] = { kind: "file", mode: 0o777 }));
  await hit((c) => ({ stdout: c.args[0] === "--version" ? "etat-major 9.0.0\n" : "" }));
  await hit(okScript, { ...SETTINGS, workspace: "/nope" });
  await hit(okScript, { ...SETTINGS, prs: "/nope.json" });
  await hit((c) => v(c, { code: MAXBUF }));
  await hit((c) => v(c, { code: 2 }));
  const old = "etat-major export: error: argument action: invalid choice: 'discover' (choose from 'planning')\n";
  const missing = await createRunner(harness((c) => v(c, { code: 2, stderr: old })).deps).exportDiscover(SETTINGS);
  if (!missing.ok) seen.add(missing.code);
  await hit((c) => v(c, { stdout: "{" }));
  await hit((c) => v(c, { stdout: "{}" }));
  const h = harness((c) => v(c, { hang: true }));
  const rn = createRunner(h.deps);
  const first = rn.exportPlanning(SETTINGS);
  const busy = await rn.exportPlanning({ ...SETTINGS, project: "x" }).then((r) => (r.ok ? "ok" : r.code));
  seen.add(busy);
  await new Promise((r) => setImmediate(r));
  h.timers.at(-1)!.fn();
  const t = await first;
  if (!t.ok) seen.add(t.code);
  assert.deepEqual([...seen].sort(), [...ERROR_CODES].sort());
});

const PRS = "/srv/rec/prs.json";
const BASE_ARGS = ["export", "planning", "--json", `--workspace=${WS}`, "--project=harbor"];
const withPrs = (extra: ReturnType<typeof goodEntries> = { [PRS]: { kind: "file" } }) => ({ ...goodEntries(), ...extra });

test("exact argv with a recorded pull request file: --prs=<abs> after --project, nothing else added", async () => {
  const h = harness(okScript, withPrs());
  assert.equal((await createRunner(h.deps).exportPlanning({ ...SETTINGS, prs: PRS })).ok, true);
  assert.deepEqual(h.calls.map((c) => c.args), [["--version"], [...BASE_ARGS, `--prs=${PRS}`]]);
});

test("an empty or unset prs setting passes no flag", async () => {
  for (const prs of ["", undefined]) {
    const h = harness();
    assert.equal((await createRunner(h.deps).exportPlanning({ ...SETTINGS, prs })).ok, true);
    assert.deepEqual(h.calls.at(-1)!.args, BASE_ARGS, String(prs));
  }
});

test("a symlinked prs file is passed as its realpath", async () => {
  const h = harness(okScript, withPrs({ [PRS]: { kind: "file" }, "/srv/current.json": { kind: "link", target: PRS } }));
  await createRunner(h.deps).exportPlanning({ ...SETTINGS, prs: "/srv/current.json" });
  assert.deepEqual(h.calls.at(-1)!.args, [...BASE_ARGS, `--prs=${PRS}`]);
});

test("the prs file is validated on every call, before any spawn", async () => {
  const entries = withPrs();
  const h = harness(okScript, entries);
  const runner = createRunner(h.deps);
  const settings = { ...SETTINGS, prs: PRS };
  assert.equal((await runner.exportPlanning(settings)).ok, true);
  const spawned = h.calls.length;
  entries[PRS] = { kind: "file", size: 4 * 1024 * 1024 + 1 };
  assert.deepEqual(await runner.exportPlanning(settings), { ok: false, code: "INPUT_INVALID" });
  delete entries[PRS];
  assert.deepEqual(await runner.exportPlanning(settings), { ok: false, code: "INPUT_INVALID" });
  assert.deepEqual(await runner.exportPlanning({ ...SETTINGS, prs: "rec/prs.json" }), { ok: false, code: "INPUT_INVALID" });
  assert.equal(h.calls.length, spawned);
});

test("single-flight key includes the prs file", async () => {
  const other = "/srv/rec/other.json";
  const h = harness((c) => (c.args[0] === "--version" ? { stdout: "etat-major 0.1.0\n" } : { hang: true }), withPrs({ [PRS]: { kind: "file" }, [other]: { kind: "file" } }));
  const runner = createRunner(h.deps);
  const a = runner.exportPlanning({ ...SETTINGS, prs: PRS });
  await new Promise((r) => setImmediate(r));
  const same = runner.exportPlanning({ ...SETTINGS, prs: PRS });
  assert.deepEqual(await runner.exportPlanning(SETTINGS), { ok: false, code: "BUSY" });
  assert.deepEqual(await runner.exportPlanning({ ...SETTINGS, prs: other }), { ok: false, code: "BUSY" });
  await new Promise((r) => setImmediate(r));
  h.calls.at(-1)!.cb(null, FIXTURE, "");
  assert.deepEqual(await a, await same);
  assert.equal(h.calls.filter((c) => c.args[0] === "export").length, 1);
});

const RELEASES = "/srv/rec/releases.json";
const withBoth = (extra: ReturnType<typeof goodEntries> = {}) => withPrs({ [PRS]: { kind: "file" }, [RELEASES]: { kind: "file" }, ...extra });

test("exact argv with a recorded releases file alone, and with both files in fixed order", async () => {
  for (const [settings, flags] of [
    [{ releases: RELEASES }, [`--releases=${RELEASES}`]],
    [{ releases: RELEASES, prs: PRS }, [`--prs=${PRS}`, `--releases=${RELEASES}`]],
    [{ releases: "", prs: PRS }, [`--prs=${PRS}`]],
    [{ releases: "", prs: "" }, []],
  ] as const) {
    const h = harness(okScript, withBoth());
    assert.equal((await createRunner(h.deps).exportPlanning({ ...SETTINGS, ...settings })).ok, true);
    assert.deepEqual(h.calls.map((c) => c.args), [["--version"], [...BASE_ARGS, ...flags]]);
    assert.equal(h.calls.some((c) => c.args.some((a) => a.startsWith("--repo"))), false);
  }
});

test("a symlinked releases file is passed as its realpath", async () => {
  const h = harness(okScript, withBoth({ "/srv/rel.json": { kind: "link", target: RELEASES } }));
  await createRunner(h.deps).exportPlanning({ ...SETTINGS, releases: "/srv/rel.json" });
  assert.deepEqual(h.calls.at(-1)!.args, [...BASE_ARGS, `--releases=${RELEASES}`]);
});

test("a bad releases file is INPUT_INVALID before any spawn, also next to a good prs file", async () => {
  const h = harness(okScript, withBoth({ "/srv/rec/locked.json": { kind: "file", readable: false } }));
  const runner = createRunner(h.deps);
  for (const releases of ["/srv/rec/none.json", "/srv/rec/locked.json", "/srv/rec", "rec/releases.json"]) {
    assert.deepEqual(await runner.exportPlanning({ ...SETTINGS, prs: PRS, releases }), { ok: false, code: "INPUT_INVALID" }, releases);
  }
  assert.equal(h.calls.length, 0);
});

test("single-flight key includes the releases file and keeps it apart from prs", async () => {
  const h = harness((c) => (c.args[0] === "--version" ? { stdout: "etat-major 0.1.0\n" } : { hang: true }), withBoth());
  const runner = createRunner(h.deps);
  const a = runner.exportPlanning({ ...SETTINGS, releases: RELEASES });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(await runner.exportPlanning(SETTINGS), { ok: false, code: "BUSY" });
  assert.deepEqual(await runner.exportPlanning({ ...SETTINGS, prs: RELEASES }), { ok: false, code: "BUSY" });
  h.calls.at(-1)!.cb(null, FIXTURE, "");
  assert.equal((await a).ok, true);
});
