// The only module allowed to import node:child_process (enforced by tests/guard.test.ts).
// Runs the pinned exporter: validate -> version check -> export -> parse. Never throws to the caller.
import { spawn } from "node:child_process";
import * as nodeFs from "node:fs/promises";
import { tmpdir as osTmpdir } from "node:os";
import { join } from "node:path";
import type { ErrorCode } from "../shared/errors.ts";
import { parsePlanningJson, type PlanningPayload } from "../shared/planning-schema.ts";
import type { FsLike } from "./fs-like.ts";
import { redactStderrLine } from "./redact.ts";
import { isInside, validateExecutable } from "./validate-exe.ts";
import { isValidProject, validateWorkspace } from "./validate-input.ts";

export const TIMEOUT_MS = 20_000;
export const MAX_BUFFER = 4 * 1024 * 1024;
const VERSION_RE = /^etat-major (\d+)\.(\d+)\.(\d+)\n?$/;
const STDERR_KEEP = 64 * 1024;
const MAXBUFFER_CODE = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";

export interface ExecOptions {
  readonly shell: false;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly maxBuffer: number;
  readonly detached: true;
  readonly encoding: "utf8";
}
type ExecError = (Error & { code?: number | string | null }) | null;
export type ExecFn = (
  file: string,
  args: readonly string[],
  options: ExecOptions,
  cb: (err: ExecError, stdout: string, stderr: string) => void,
) => { readonly pid?: number | undefined };

export interface LogEvent {
  readonly code: ErrorCode;
  readonly detail?: string;
}

export interface RunnerDeps {
  exec: ExecFn;
  fs: FsLike;
  uid: number | undefined;
  tmpdir: string;
  timeoutMs: number;
  now: () => Date;
  killGroup: (pid: number, signal: "SIGKILL") => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  log: (event: LogEvent) => void;
}

export interface RunnerSettings {
  readonly executable?: string | undefined;
  readonly workspace?: string | undefined;
  readonly project?: string | undefined;
}

export type ExportResult =
  | { readonly ok: true; readonly data: PlanningPayload; readonly exportedAt: string; readonly version: string }
  | { readonly ok: false; readonly code: ErrorCode };

const fail = (code: ErrorCode): ExportResult => ({ ok: false, code });

// node's execFile silently drops `detached`, so the child would stay in our process group and a
// group kill could not reach grandchildren. spawn honours it; this adapter keeps execFile semantics
// (shell:false, bounded output, string error codes for spawn failures, numeric for exits).
const spawnExec: ExecFn = (file, args, options, cb) => {
  const child = spawn(file, [...args], {
    shell: options.shell,
    cwd: options.cwd,
    env: { ...options.env },
    detached: options.detached,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let outBytes = 0;
  let errBytes = 0;
  let finished = false;
  const finish = (e: ExecError): void => {
    if (finished) return;
    finished = true;
    cb(e, Buffer.concat(out).toString("utf8"), Buffer.concat(err).toString("utf8"));
  };
  child.stdout.on("data", (b: Buffer) => {
    outBytes += b.length;
    if (outBytes > options.maxBuffer) {
      child.kill("SIGKILL");
      return finish(Object.assign(new Error("stdout maxBuffer exceeded"), { code: MAXBUFFER_CODE }));
    }
    out.push(b);
  });
  child.stderr.on("data", (b: Buffer) => {
    // Only the first line is ever used; keep a small head and drop the rest.
    if (errBytes < STDERR_KEEP) err.push(b);
    errBytes += b.length;
  });
  child.on("error", (e: NodeJS.ErrnoException) => finish(Object.assign(new Error(e.message), { code: e.code ?? "EUNKNOWN" })));
  child.on("close", (code) => finish(code === 0 ? null : Object.assign(new Error("non-zero exit"), { code })));
  return { pid: child.pid };
};

const defaultDeps = (): RunnerDeps => ({
  exec: spawnExec,
  fs: nodeFs,
  uid: process.getuid?.(),
  tmpdir: osTmpdir(),
  timeoutMs: TIMEOUT_MS,
  now: () => new Date(),
  // Negative pid addresses the whole process group created by detached:true.
  killGroup: (pid, signal) => void process.kill(-pid, signal),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
  log: () => {},
});

type Outcome =
  | { kind: "ok"; stdout: string }
  | { kind: "exit"; stderr: string }
  | { kind: "timeout" }
  | { kind: "toolarge" }
  | { kind: "spawn" };

function runChild(d: RunnerDeps, file: string, args: readonly string[], cwd: string, home: string): Promise<Outcome> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: unknown;
    let pid: number | undefined;
    const killTree = (): void => {
      if (pid === undefined) return;
      try {
        d.killGroup(pid, "SIGKILL");
      } catch {
        // group already gone
      }
    };
    const done = (o: Outcome): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) d.clearTimer(timer);
      resolve(o);
    };
    const env = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", HOME: home, PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1" };
    const options: ExecOptions = { shell: false, cwd, env, maxBuffer: MAX_BUFFER, detached: true, encoding: "utf8" };
    try {
      const child = d.exec(file, args, options, (err, stdout, stderr) => {
        if (!err) return done({ kind: "ok", stdout });
        if (err.code === MAXBUFFER_CODE) {
          killTree();
          return done({ kind: "toolarge" });
        }
        // String codes (ENOENT, EACCES, ...) are spawn failures; numeric or null (signal) are exits.
        done(typeof err.code === "string" ? { kind: "spawn" } : { kind: "exit", stderr });
      });
      pid = child.pid;
      if (!settled) {
        timer = d.setTimer(() => {
          killTree();
          done({ kind: "timeout" });
        }, d.timeoutMs);
      }
    } catch {
      done({ kind: "spawn" });
    }
  });
}

const OUTCOME_CODE = { timeout: "TIMEOUT", toolarge: "OUTPUT_TOO_LARGE" } as const;

function parseVersion(stdout: string): string | undefined {
  const m = VERSION_RE.exec(stdout);
  if (!m) return undefined;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  // Pinned range: >=0.1.0 <0.2.0
  return major === 0 && minor === 1 ? `${m[1]}.${m[2]}.${m[3]}` : undefined;
}

export interface Runner {
  // Runs (or joins) one export. Concurrent identical calls share one child; a call for a
  // different (exe, workspace, project) while one is running returns BUSY.
  exportPlanning(settings: RunnerSettings): Promise<ExportResult>;
}

export function createRunner(overrides: Partial<RunnerDeps> = {}): Runner {
  const d: RunnerDeps = { ...defaultDeps(), ...overrides };
  const versions = new Map<string, string>();
  let inflight: { key: string; promise: Promise<ExportResult> } | undefined;

  async function checkVersion(exe: string, mtimeMs: number, cwd: string, home: string): Promise<{ version: string } | ExportResult> {
    const cacheKey = `${exe}\0${mtimeMs}`;
    const cached = versions.get(cacheKey);
    if (cached) return { version: cached };
    const o = await runChild(d, exe, ["--version"], cwd, home);
    if (o.kind === "timeout" || o.kind === "toolarge") return fail(OUTCOME_CODE[o.kind]);
    if (o.kind === "spawn") return fail("EXE_INVALID");
    const version = o.kind === "ok" ? parseVersion(o.stdout) : undefined;
    if (!version) return fail("VERSION_UNSUPPORTED");
    versions.set(cacheKey, version);
    return { version };
  }

  async function exportOnce(exe: string, mtimeMs: number, ws: string, project: string): Promise<ExportResult> {
    let home: string;
    try {
      home = await d.fs.mkdtemp(join(d.tmpdir, "etat-major-home-"));
    } catch {
      return fail("EXPORT_FAILED");
    }
    try {
      const v = await checkVersion(exe, mtimeMs, ws, home);
      if (!("version" in v)) return v;
      const args = ["export", "planning", "--json", `--workspace=${ws}`, `--project=${project}`];
      const o = await runChild(d, exe, args, ws, home);
      if (o.kind === "timeout" || o.kind === "toolarge") return fail(OUTCOME_CODE[o.kind]);
      if (o.kind !== "ok") {
        const detail = o.kind === "exit" ? redactStderrLine(o.stderr) : "spawn failed";
        d.log({ code: "EXPORT_FAILED", detail });
        return fail("EXPORT_FAILED");
      }
      const parsed = parsePlanningJson(o.stdout);
      if (!parsed.ok) return fail(parsed.code);
      return { ok: true, data: parsed.data, exportedAt: d.now().toISOString(), version: v.version };
    } finally {
      await d.fs.rm(home, { recursive: true, force: true }).catch(() => d.log({ code: "EXPORT_FAILED", detail: "temp cleanup failed" }));
    }
  }

  async function exportPlanning(s: RunnerSettings): Promise<ExportResult> {
    try {
      if (!s.executable || !s.workspace || !s.project || !isValidProject(s.project)) return fail("NOT_CONFIGURED");
      const exe = await validateExecutable(s.executable, { fs: d.fs, uid: d.uid });
      if (!exe.ok) return fail(exe.code);
      const ws = await validateWorkspace(s.workspace, { fs: d.fs });
      if (!ws.ok) return fail(ws.code);
      // Workspace content is writable by whoever edits the project; never run code from inside it.
      if (isInside(exe.realpath, ws.realpath)) return fail("EXE_INVALID");
      const key = [exe.realpath, ws.realpath, s.project].join("\0");
      if (inflight) return inflight.key === key ? inflight.promise : fail("BUSY");
      const promise = exportOnce(exe.realpath, exe.mtimeMs, ws.realpath, s.project)
        .catch((): ExportResult => fail("EXPORT_FAILED"))
        .finally(() => {
          inflight = undefined;
        });
      inflight = { key, promise };
      return await promise;
    } catch {
      return fail("EXPORT_FAILED");
    }
  }

  return { exportPlanning };
}
