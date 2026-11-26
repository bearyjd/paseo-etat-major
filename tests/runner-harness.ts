import { readFileSync } from "node:fs";
import type { ExecFn, ExecOptions, RunnerDeps, RunnerSettings } from "../server/runner.ts";
import { fakeFs, type Entry } from "./fake-fs.ts";

export const EXE = "/opt/venv/bin/etat-major";
export const WS = "/srv/ws";
export const SETTINGS: RunnerSettings = { executable: EXE, workspace: WS, project: "harbor" };
export const FIXTURE = readFileSync(new URL("../fixtures/exports/harbor.json", import.meta.url), "utf8");

export interface Call {
  file: string;
  args: readonly string[];
  options: ExecOptions;
  pid: number;
  cb: Parameters<ExecFn>[3];
}

export const goodEntries = (): Record<string, Entry> => ({
  "/opt/venv": { kind: "dir" },
  "/opt/venv/bin": { kind: "dir" },
  [EXE]: { kind: "file", mode: 0o755, mtimeMs: 7 },
  [WS]: { kind: "dir" },
  "/sandbox": { kind: "dir" },
});

type Reply = { stdout?: string; stderr?: string; code?: number | string | null; hang?: boolean };
export type Script = (call: Call) => Reply;

export const okScript: Script = (c) => ({ stdout: c.args[0] === "--version" ? "etat-major 0.1.3\n" : FIXTURE });

export function harness(script: Script = okScript, entries: Record<string, Entry> = goodEntries()) {
  const calls: Call[] = [];
  const kills: Array<[number, string]> = [];
  const logs: unknown[] = [];
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const fs = fakeFs(entries);
  let pid = 100;
  const exec: ExecFn = (file, args, options, cb) => {
    const call: Call = { file, args, options, pid: ++pid, cb };
    calls.push(call);
    const r = script(call);
    if (!r.hang) {
      const err = r.code === undefined || r.code === 0 ? null : Object.assign(new Error("failed"), { code: r.code });
      queueMicrotask(() => cb(err, r.stdout ?? "", r.stderr ?? "")); // like the real exec: async
    }
    return { pid: call.pid };
  };
  const deps: Partial<RunnerDeps> = {
    exec,
    fs,
    uid: 1000,
    tmpdir: "/sandbox",
    now: () => new Date("2026-11-25T10:00:00.000Z"),
    killGroup: (p, s) => void kills.push([p, s]),
    setTimer: (fn, ms) => timers.push({ fn, ms, cleared: false }) - 1,
    clearTimer: (h) => void (timers[h as number]!.cleared = true),
    log: (e) => void logs.push(e),
  };
  return { deps, calls, kills, logs, timers, fs };
}
