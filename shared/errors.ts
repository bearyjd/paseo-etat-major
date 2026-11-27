import { z } from "zod";

// Fixed error codes; the UI shows exactly one state per code.
export const ERROR_CODES = [
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
] as const;

export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;
