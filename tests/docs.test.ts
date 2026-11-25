import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VERSION } from "../shared/version.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const readme = read("README.md");
const security = read("SECURITY.md");
const changelog = read("CHANGELOG.md");
const docs: ReadonlyArray<readonly [string, string]> = [["README.md", readme], ["SECURITY.md", security], ["CHANGELOG.md", changelog]];

test("release version is 0.1.0 in package.json and shared/version.ts", () => {
  assert.equal(VERSION, "0.1.0");
  assert.equal(JSON.parse(read("package.json")).version, "0.1.0");
});

test("CHANGELOG has a 0.1.0 entry", () => {
  assert.match(changelog, /^## 0\.1\.0\b/m);
});

test("README has the release sections", () => {
  for (const h of ["## Install, update and uninstall", "## Alto deployment", "## Manual acceptance", "## Unproven"]) {
    assert.ok(readme.includes(h), h);
  }
});

test("README installs by tag with --ref and removes before reinstalling", () => {
  assert.match(readme, /paseo plugin install git:bearyjd\/paseo-etat-major --ref v\d+\.\d+\.\d+/);
  assert.match(readme, /paseo plugin remove etat-major\b/);
  assert.match(readme, /never a branch/i);
});

test("README documents the env -i version check and a read-only workspace clone", () => {
  assert.match(readme, /env -i PATH=\/usr\/bin:\/bin HOME=\/nonexistent .*--version/);
  assert.match(readme, /read-only clone/i);
});

test("no install instruction pins a branch ref", () => {
  for (const [name, text] of docs) {
    for (const m of text.matchAll(/--ref\s+(\S+)/g)) {
      assert.match(m[1]!, /^v(\d|X)|^<tag>/, `${name}: ${m[0]}`);
    }
  }
});

test("docs carry no personal paths, emails or hostnames", () => {
  for (const [name, text] of docs) {
    assert.doesNotMatch(text, /\/home\/|\/var\/home\/|\/Users\//, `${name}: personal path`);
    assert.doesNotMatch(text, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, `${name}: email`);
    assert.doesNotMatch(text, /\bssh\s|\.local\b|\.lan\b/, `${name}: host`);
  }
});

test("SECURITY.md states the final trust points", () => {
  assert.match(security, /unsandboxed/i);
  assert.match(security, /execution pointer/i);
  assert.match(security, /git:bearyjd\/paseo-etat-major --ref vX\.Y\.Z/);
  assert.match(security, /read-only/i);
  assert.doesNotMatch(security, /\bplanned\b/i);
});
