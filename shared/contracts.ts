import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { ErrorCode } from "./errors.ts";
import { PlanningPayload } from "./planning-schema.ts";

export const status = defineRpc({
  name: "etat-major.status.get",
  input: z.object({}),
  output: z.object({
    version: z.string(),
    configured: z.boolean(),
    // Code of the most recent export attempt; null after a success or before any attempt.
    lastError: ErrorCode.nullable(),
  }),
});

// One UI state per result: data with the time it was exported, or exactly one error code.
export const PlanningResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: PlanningPayload, exportedAt: z.string(), version: z.string() }),
  z.object({ ok: z.literal(false), code: ErrorCode }),
]);

// Serves the cached export; runs the exporter only when nothing is cached for the current settings.
export const planningGet = defineRpc({ name: "etat-major.planning.get", input: z.object({}), output: PlanningResult });

// The only call that re-runs the exporter over an existing cache entry.
export const planningRefresh = defineRpc({ name: "etat-major.planning.refresh", input: z.object({}), output: PlanningResult });
