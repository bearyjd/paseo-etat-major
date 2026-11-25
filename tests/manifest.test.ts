import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const manifest = read("paseo-plugin.json");
const pkg = read("package.json");

test("manifest identity and requirements", () => {
  assert.equal(manifest.id, "etat-major");
  assert.equal(manifest.name, "État-major");
  assert.equal(manifest.requirements.paseo, ">=0.17.4 <0.18.0");
});

test("manifest has no entries key (raw TS entry files by convention)", () => {
  assert.equal("entries" in manifest, false);
});

test("build step is exactly npm ci --omit=dev --ignore-scripts", () => {
  assert.deepEqual(manifest.build, [["npm", "ci", "--omit=dev", "--ignore-scripts"]]);
});

test("build step only present with zod in dependencies and a lockfile", () => {
  assert.ok(pkg.dependencies?.zod, "zod must be in dependencies");
  assert.ok(existsSync(new URL("../package-lock.json", import.meta.url)), "lockfile required");
});

test("SDK is pinned exactly", () => {
  assert.equal(pkg.devDependencies["@getpaseo/plugin"], "0.17.4");
});
