import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const SKIP_DIRS = new Set(["node_modules", ".git", "tests", "fixtures"]);
const SOURCE = /\.(m?[jt]s|cjs|tsx?)$/;
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

// [name, pattern, sample that must match]
const FORBIDDEN: ReadonlyArray<readonly [string, RegExp, string]> = [
  ["node:http", /["'](?:node:)?http["']/, 'import h from "node:http"'],
  ["node:https", /["'](?:node:)?https["']/, 'import h from "https"'],
  ["node:http2", /["'](?:node:)?http2["']/, 'import h from "node:http2"'],
  ["node:net", /["'](?:node:)?net["']/, 'import n from "node:net"'],
  ["node:tls", /["'](?:node:)?tls["']/, 'import t from "node:tls"'],
  ["node:dns", /["'](?:node:)?dns(?:\/promises)?["']/, 'import d from "node:dns/promises"'],
  ["node:dgram", /["'](?:node:)?dgram["']/, 'import d from "node:dgram"'],
  ["node:worker_threads", /["'](?:node:)?worker_threads["']/, 'import w from "node:worker_threads"'],
  ["fetch(", /\bfetch\s*\(/, "await fetch(url)"],
  ["WebSocket", /\bWebSocket\b/, "new WebSocket(u)"],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/, "new XMLHttpRequest()"],
  ["process.binding", /\bprocess\.binding\b/, "process.binding('tcp_wrap')"],
  ["eval(", /\beval\s*\(/, "eval(x)"],
  ["new Function", /\bnew\s+Function\b/, "new Function('a')"],
  ["dynamic import(", /\bimport\s*\(/, "await import(x)"],
  ["agent. hook", /\bagent\./, "ctx.agent.send()"],
  [".createAgent", /\.createAgent\b/, "api.createAgent({})"],
  ["runAgent", /\brunAgent\b/, "runAgent()"],
  [".claude", /\.claude/, 'join(home, ".claude")'],
  [".codex", /\.codex/, '"~/.codex"'],
  ["zerosub", /zerosub/i, "zerosub"],
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

test("every forbidden pattern matches its own violation sample", () => {
  for (const [name, re, sample] of FORBIDDEN) assert.ok(re.test(sample), `pattern for ${name} missed its sample`);
});

test("child_process pattern catches ESM, CJS and .mjs-style requires", () => {
  assert.ok(CHILD.test('import { execFile } from "node:child_process";'));
  assert.ok(CHILD.test("const c = require('child_process')"));
  assert.ok(CHILD.test('const { spawn } = require("node:child_process");'));
  assert.ok(SOURCE.test("evil.mjs") && SOURCE.test("evil.cjs") && SOURCE.test("evil.js"));
});
