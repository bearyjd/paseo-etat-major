import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const SKIP_DIRS = new Set(["node_modules", ".git", "tests", "fixtures"]);
const SOURCE = /\.(ts|tsx)$/;
const RUNNER = "server/runner.ts";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : sources(p);
    return SOURCE.test(e.name) ? [p] : [];
  });
}

const files = sources(root).map((p) => ({ rel: relative(root, p), text: readFileSync(p, "utf8") }));

const CHILD = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["'](?:node:)?child_process["']/;

const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ["node:http", /["'](?:node:)?http["']/],
  ["node:https", /["'](?:node:)?https["']/],
  ["node:net", /["'](?:node:)?net["']/],
  ["node:dgram", /["'](?:node:)?dgram["']/],
  ["fetch(", /\bfetch\s*\(/],
  ["eval(", /\beval\s*\(/],
  ["new Function", /\bnew\s+Function\b/],
  ["dynamic import(", /\bimport\s*\(/],
  ["agent. hook", /\bagent\./],
  [".createAgent", /\.createAgent\b/],
  ["runAgent", /\brunAgent\b/],
  [".claude", /\.claude/],
  [".codex", /\.codex/],
  ["zerosub", /zerosub/i],
];

test("guard scans at least the entry files", () => {
  const rels = files.map((f) => f.rel);
  assert.ok(rels.includes("index.server.ts"));
  assert.ok(rels.includes("index.client.tsx"));
});

test("child_process is imported only from server/runner.ts", () => {
  const offenders = files.filter((f) => f.rel !== RUNNER && CHILD.test(f.text)).map((f) => f.rel);
  assert.deepEqual(offenders, []);
});

for (const [name, re] of FORBIDDEN) {
  test(`no source uses ${name}`, () => {
    const offenders = files.filter((f) => re.test(f.text)).map((f) => f.rel);
    assert.deepEqual(offenders, []);
  });
}

test("guard regexes actually detect violations", () => {
  assert.ok(CHILD.test('import { execFile } from "node:child_process";'));
  assert.ok(CHILD.test("const c = require('child_process')"));
  for (const [, re] of FORBIDDEN) assert.ok(re.source.length > 0);
  const sample: Record<string, string> = {
    "node:http": 'import h from "node:http"',
    "node:https": 'import h from "https"',
    "node:net": 'import n from "node:net"',
    "node:dgram": 'import d from "node:dgram"',
    "fetch(": "await fetch(url)",
    "eval(": "eval(x)",
    "new Function": "new Function('a')",
    "dynamic import(": "await import(x)",
    "agent. hook": "ctx.agent.send()",
    ".createAgent": "api.createAgent({})",
    runAgent: "runAgent()",
    ".claude": 'join(home, ".claude")',
    ".codex": '"~/.codex"',
    zerosub: "zerosub",
  };
  for (const [name, re] of FORBIDDEN) {
    const s = sample[name === "runAgent" ? "runAgent" : name];
    assert.ok(s && re.test(s), `regex for ${name} must match its sample`);
  }
});
