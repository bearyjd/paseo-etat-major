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
  assert.equal(redactStderrLine("no such file '/tmp/a b'"), "no such file '<path>'");
  assert.ok(!redactStderrLine("a:/one,/two;/three").includes("one"));
});

test("leaves non-path slashes alone", () => {
  assert.equal(redactStderrLine("use and/or 1/2"), "use and/or 1/2");
});

test("strips control characters and caps at 200", () => {
  assert.equal(redactStderrLine("a\u001b[31mb\u0007c"), "a [31mb c");
  assert.equal(redactStderrLine("x".repeat(500)).length, 200);
});

test("redacts home, windows, UNC, relative, bracketed and @-prefixed paths", () => {
  const cases: Array<[string, string]> = [
    ["cannot open ~/notes/x.md", "cannot open <path>"],
    ["cannot open ~/", "cannot open <path>"],
    ["bad C:\\Users\\me\\ws\\a.md here", "bad <path> here"],
    ["bad D:/data/ws here", "bad <path> here"],
    ["share \\\\srv\\share\\x failed", "share <path> failed"],
    ["see ./rel/file.md now", "see <path> now"],
    ["see ../up/file.md now", "see <path> now"],
    ["in [/srv/data/ws] failed", "in [<path>] failed"],
    ["in {/srv/data/ws} failed", "in {<path>} failed"],
    ["in (/srv/data/ws) failed", "in (<path>) failed"],
    ["user@/srv/data failed", "user@<path> failed"],
    ["x=[~/a] y", "x=[<path>] y"],
  ];
  for (const [input, want] of cases) assert.equal(redactStderrLine(input), want, input);
});

test("quoted spans containing spaces are redacted as one unit", () => {
  assert.equal(redactStderrLine('cannot read "/home/me/My Documents/plan.md" today'), 'cannot read "<path>" today');
  assert.equal(redactStderrLine("cannot read 'C:\\Program Files\\x' today"), "cannot read '<path>' today");
  assert.equal(redactStderrLine("cannot read '~/My Notes/a' today"), "cannot read '<path>' today");
  assert.equal(redactStderrLine('unexpected "and/or" token'), 'unexpected "and/or" token');
});
