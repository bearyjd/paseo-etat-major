import { test } from "node:test";
import assert from "node:assert/strict";
import { ERROR_CODES, ErrorCode } from "../shared/errors.ts";

test("exactly the eleven fixed error codes, in order", () => {
  assert.deepEqual([...ERROR_CODES], [
    "NOT_CONFIGURED",
    "EXE_INVALID",
    "VERSION_UNSUPPORTED",
    "WORKSPACE_INVALID",
    "INPUT_INVALID",
    "TIMEOUT",
    "OUTPUT_TOO_LARGE",
    "EXPORT_FAILED",
    "BAD_JSON",
    "SCHEMA_MISMATCH",
    "BUSY",
  ]);
});

test("zod enum accepts each code and rejects others", () => {
  for (const c of ERROR_CODES) assert.equal(ErrorCode.parse(c), c);
  assert.equal(ErrorCode.safeParse("NOPE").success, false);
});
