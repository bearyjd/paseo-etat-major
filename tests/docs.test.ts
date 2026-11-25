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
  for (const h of ["## Install, update and uninstall", "## Deployment host", "## Manual acceptance", "## Unproven"]) {
    assert.ok(readme.includes(h), h);
  }
});

test("README installs by tag with --ref and removes before reinstalling", () => {
  assert.match(readme, /paseo plugin install git:bearyjd\/paseo-etat-major --ref v\d+\.\d+\.\d+/);
  assert.match(readme, /paseo plugin remove etat-major\b/);
  assert.match(readme, /never a branch/i);
});

test("README documents the env -i version check and a read-only workspace clone", () => {
  assert.match(readme, /env -i PATH=\/usr\/bin:\/bin LANG=C\.UTF-8 HOME="\$\(mktemp -d\)" PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1 .*--version/);
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
    assert.doesNotMatch(text, /\bssh\s|\.local\b|\.lan\b|\bAlto\b/, `${name}: host`);
  }
});

test("README states every executable rule and scopes the unproven claims honestly", () => {
  assert.match(readme, /owned by the user the Paseo daemon runs as/);
  assert.match(readme, /every ancestor directory owned by that user or root/);
  assert.match(readme, /not inside the workspace/);
  assert.match(readme, /created as the daemon user/);
  assert.match(readme, /Proven on the tested host only/);
  assert.match(readme, /export run by the plugin's runner on the deployment host/);
  assert.doesNotMatch(readme, /resolves @getpaseo\/plugin \(a devDependency\) at runtime on the host that was tested/);
});

test("SECURITY.md states the final trust points", () => {
  assert.match(security, /unsandboxed/i);
  assert.match(security, /execution pointer/i);
  assert.match(security, /git:bearyjd\/paseo-etat-major --ref vX\.Y\.Z/);
  assert.match(security, /read-only/i);
  assert.doesNotMatch(security, /\bplanned\b/i);
});

test("README says 0.1.0 passes no PR input, so In progress and Review stay empty", () => {
  assert.match(readme, /0\.1\.0 never passes `--prs`, `--releases` or `--repo`/);
  assert.match(readme, /`In progress` and `Review` stay empty/);
});
