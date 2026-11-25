import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const clientDir = join(root, "client");

const ALLOWED_PACKAGES = new Set([
  "react",
  "react-native",
  "zod",
  "@getpaseo/plugin",
  "@getpaseo/plugin/client",
  "@getpaseo/plugin/client/ui",
]);
// Relative imports may reach client/ and shared/ only: never server/ (it pulls node built-ins).
const ALLOWED_DIRS = [clientDir, join(root, "shared")];

const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^"';]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;

function specifiers(text: string): string[] {
  return [...text.matchAll(IMPORT)].map((m) => (m[1] ?? m[2])!);
}

function importProblem(file: string, spec: string): string | null {
  if (spec.startsWith(".")) {
    const target = normalize(join(dirname(file), spec));
    return ALLOWED_DIRS.some((d) => target.startsWith(d + "/")) ? null : `relative import leaves client/ and shared/: ${spec}`;
  }
  return ALLOWED_PACKAGES.has(spec) ? null : `package not allowed: ${spec}`;
}

const files = readdirSync(clientDir).filter((f) => /\.tsx?$/.test(f)).map((f) => join(clientDir, f));

test("the client directory holds the screen, the view model and nothing unexpected", () => {
  const names = files.map((f) => relative(clientDir, f)).sort();
  assert.ok(names.includes("PlanningScreen.tsx"));
  assert.ok(names.includes("view-model.ts"));
});

test("client modules import only allowed packages and client/shared files", () => {
  const problems = files.flatMap((f) =>
    specifiers(readFileSync(f, "utf8")).flatMap((s) => {
      const p = importProblem(f, s);
      return p ? [`${relative(root, f)}: ${p}`] : [];
    }),
  );
  assert.deepEqual(problems, []);
});

test("the import checker rejects node built-ins, server files and unknown packages", () => {
  const f = join(clientDir, "x.ts");
  assert.ok(importProblem(f, "node:child_process"));
  assert.ok(importProblem(f, "node:fs"));
  assert.ok(importProblem(f, "../server/runner.ts"));
  assert.ok(importProblem(f, "left-pad"));
  assert.ok(importProblem(f, "@getpaseo/client"));
  assert.equal(importProblem(f, "../shared/sanitize.ts"), null);
  assert.equal(importProblem(f, "./view-model.ts"), null);
  assert.deepEqual(specifiers('import { a } from "node:fs";\nimport "left-pad";\nexport * from "./x.ts";'), ["node:fs", "left-pad", "./x.ts"]);
});
