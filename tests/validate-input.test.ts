import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import * as realFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isValidProject, validateWorkspace, MAX_INPUT_BYTES, validateInputFile } from "../server/validate-input.ts";
import { fakeFs } from "./fake-fs.ts";

test("project charset", () => {
  for (const ok of ["netlens", "a", "0abc", "a-b-c", "a".repeat(64)]) assert.equal(isValidProject(ok), true, ok);
  const bad = ["", "-a", "A", "a_b", "a b", "a/b", "../x", "--workspace=/x", "a".repeat(65), "a\n", "é", 5, undefined];
  for (const b of bad) assert.equal(isValidProject(b), false, String(b));
});

test("workspace: relative, dotdot, non-string rejected", async () => {
  const fs = fakeFs({ "/w": { kind: "dir" } });
  for (const p of ["w", "./w", "", "/w/../w", undefined, 3]) {
    assert.deepEqual(await validateWorkspace(p, { fs }), { ok: false, code: "WORKSPACE_INVALID" }, String(p));
  }
});

test("workspace: directory ok, file/missing/unreadable rejected, symlink resolved", async () => {
  const fs = fakeFs({
    "/w": { kind: "dir" },
    "/f": { kind: "file" },
    "/locked": { kind: "dir", readable: false },
    "/l": { kind: "link", target: "/w" },
  });
  assert.deepEqual(await validateWorkspace("/w", { fs }), { ok: true, realpath: "/w" });
  assert.deepEqual(await validateWorkspace("/l", { fs }), { ok: true, realpath: "/w" });
  for (const p of ["/f", "/missing", "/locked"]) assert.equal((await validateWorkspace(p, { fs })).ok, false, p);
});

test("workspace: real filesystem", async () => {
  const root = mkdtempSync(join(tmpdir(), "pem-ws-"));
  try {
    writeFileSync(join(root, "file"), "x");
    symlinkSync(root, join(root, "ln"));
    assert.equal((await validateWorkspace(root, { fs: realFs })).ok, true);
    assert.equal((await validateWorkspace(join(root, "ln"), { fs: realFs })).ok, true);
    assert.equal((await validateWorkspace(join(root, "file"), { fs: realFs })).ok, false);
    if (process.getuid?.() !== 0) {
      chmodSync(root, 0o000);
      assert.equal((await validateWorkspace(root, { fs: realFs })).ok, false);
      chmodSync(root, 0o755);
    }
  } finally {
    chmodSync(root, 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

test("validateInputFile: a readable regular file up to the 4 MiB cap resolves to its realpath", async () => {
  assert.equal(MAX_INPUT_BYTES, 4 * 1024 * 1024);
  const fs = fakeFs({
    "/srv/rec/prs.json": { kind: "file", size: MAX_INPUT_BYTES },
    "/srv/link.json": { kind: "link", target: "/srv/rec/prs.json" },
  });
  for (const p of ["/srv/rec/prs.json", "/srv/link.json"]) {
    assert.deepEqual(await validateInputFile(p, { fs }), { ok: true, realpath: "/srv/rec/prs.json" }, p);
  }
});

test("validateInputFile rejects unclean paths, missing, non-regular, unreadable and oversized files", async () => {
  const fs = fakeFs({
    "/srv/dir": { kind: "dir" },
    "/srv/big.json": { kind: "file", size: MAX_INPUT_BYTES + 1 },
    "/srv/locked.json": { kind: "file", readable: false },
    "/srv/to-dir.json": { kind: "link", target: "/srv/dir" },
    "/srv/dangling.json": { kind: "link", target: "/srv/gone.json" },
    "/srv/ok.json": { kind: "file" },
  });
  const bad: unknown[] = [undefined, 5, "", "srv/ok.json", "/srv/dir/../ok.json", "/srv/ok.json\0", `/${"a".repeat(4096)}`,
    "/srv/missing.json", "/srv/dir", "/srv/big.json", "/srv/locked.json", "/srv/to-dir.json", "/srv/dangling.json"];
  for (const p of bad) {
    assert.deepEqual(await validateInputFile(p, { fs }), { ok: false, code: "INPUT_INVALID" }, String(p));
  }
});
