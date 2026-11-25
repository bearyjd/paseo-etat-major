import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trustedTmpBase } from "./tmp-base.ts";
import { createRunner } from "../server/runner.ts";

const FIXTURE_PATH = new URL("../fixtures/exports/harbor.json", import.meta.url).pathname;

function setup(exportBody: string) {
  const root = realpathSync(mkdtempSync(join(trustedTmpBase(), "pem-real-")));
  const bin = join(root, "bin");
  const ws = join(root, "ws");
  mkdirSync(bin);
  mkdirSync(ws);
  chmodSync(root, 0o755);
  chmodSync(bin, 0o755);
  chmodSync(ws, 0o755);
  const exe = join(bin, "etat-major");
  writeFileSync(exe, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "etat-major 0.1.0"; exit 0; fi\n${exportBody}\n`);
  chmodSync(exe, 0o755);
  return { root, ws, settings: { executable: exe, workspace: ws, project: "harbor" } };
}

const alive = (pid: number): boolean => {
  try {
    return !readFileSync(`/proc/${pid}/stat`, "utf8").replace(/^.*\) /, "").startsWith("Z");
  } catch {
    return false;
  }
};

test("real child: scrubbed env, cwd, fresh HOME removed afterwards, payload parsed", { skip: !existsSync("/proc") }, async () => {
  process.env["PEM_CANARY"] = "leaked";
  const t = setup(`pwd > pwd.txt\nprintf '%s' "$HOME" > home.txt\nenv > env.txt\ncat "${FIXTURE_PATH}"`);
  try {
    const r = await createRunner().exportPlanning(t.settings);
    assert.equal(r.ok, true);
    assert.equal(readFileSync(join(t.ws, "pwd.txt"), "utf8").trim(), t.ws);
    const env = readFileSync(join(t.ws, "env.txt"), "utf8");
    assert.equal(env.includes("PEM_CANARY") || env.includes("leaked"), false);
    for (const line of ["PATH=/usr/bin:/bin", "LANG=C.UTF-8", "PYTHONNOUSERSITE=1", "PYTHONDONTWRITEBYTECODE=1"]) {
      assert.ok(env.split("\n").includes(line), line);
    }
    const home = readFileSync(join(t.ws, "home.txt"), "utf8");
    assert.ok(home.startsWith(join(tmpdir(), "etat-major-home-")), home);
    assert.equal(existsSync(home), false);
  } finally {
    delete process.env["PEM_CANARY"];
    rmSync(t.root, { recursive: true, force: true });
  }
});

test("real child: timeout kills the whole process group", { skip: !existsSync("/proc") }, async () => {
  const t = setup(`sleep 30 &\necho $! > sleep.pid\nwait`);
  try {
    const started = Date.now();
    const r = await createRunner({ timeoutMs: 400 }).exportPlanning(t.settings);
    assert.deepEqual(r, { ok: false, code: "TIMEOUT" });
    assert.ok(Date.now() - started < 5000);
    const pid = Number(readFileSync(join(t.ws, "sleep.pid"), "utf8"));
    assert.ok(pid > 1);
    for (let i = 0; i < 40 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(alive(pid), false, "grandchild must be killed with the group");
  } finally {
    rmSync(t.root, { recursive: true, force: true });
  }
});

test("real child: exit 2 and oversized output", async () => {
  const bad = setup(`echo "usage error in $PWD" >&2\nexit 2`);
  const logs: unknown[] = [];
  try {
    assert.deepEqual(await createRunner({ log: (e) => void logs.push(e) }).exportPlanning(bad.settings), { ok: false, code: "EXPORT_FAILED" });
    assert.equal(JSON.stringify(logs).includes(bad.ws), false);
    assert.ok(JSON.stringify(logs).includes("usage error in <path>"));
  } finally {
    rmSync(bad.root, { recursive: true, force: true });
  }
  const big = setup(`head -c 5000000 /dev/zero | tr '\\0' 'a'`);
  try {
    assert.deepEqual(await createRunner().exportPlanning(big.settings), { ok: false, code: "OUTPUT_TOO_LARGE" });
  } finally {
    rmSync(big.root, { recursive: true, force: true });
  }
});
