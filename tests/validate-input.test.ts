import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import * as realFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isValidProject, validateWorkspace } from "../server/validate-input.ts";
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
