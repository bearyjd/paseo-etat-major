import { test } from "node:test";
import assert from "node:assert/strict";
import { redactStderrLine } from "../server/redact.ts";

test("keeps only the first non-empty line", () => {
  assert.equal(redactStderrLine("\n\nerror: bad flag\nTraceback..."), "error: bad flag");
  assert.equal(redactStderrLine(""), "");
});

test("replaces absolute paths in common positions", () => {
  assert.equal(redactStderrLine("error: cannot read /home/someone/ws/x.md"), "error: cannot read <path>");
  assert.equal(redactStderrLine("File \"/opt/venv/lib/a.py\", line 3"), 'File "<path>", line 3');
  assert.equal(redactStderrLine("bad --workspace=/srv/data/ws (not found)"), "bad --workspace=<path> (not found)");
  assert.equal(redactStderrLine("/usr/bin/x: failed"), "<path>: failed");
  assert.equal(redactStderrLine("no such file '/tmp/a b'"), "no such file '<path> b'");
  assert.ok(!redactStderrLine("a:/one,/two;/three").includes("one"));
});

test("leaves non-path slashes alone", () => {
  assert.equal(redactStderrLine("use and/or 1/2"), "use and/or 1/2");
});

test("strips control characters and caps at 200", () => {
  assert.equal(redactStderrLine("a\u001b[31mb\u0007c"), "a [31mb c");
  assert.equal(redactStderrLine("x".repeat(500)).length, 200);
});
