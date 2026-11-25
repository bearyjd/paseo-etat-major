import { z } from "zod";
import type { ErrorCode } from "./errors.ts";

// Mirrors the exporter's planning payload interface (marker etat-major/planning@1).
// z.object strips unknown keys. The marker and version are the compatibility gate.

export const PLANNING_SCHEMA_MARKER = "etat-major/planning@1";

export const TASK_STATES = ["draft", "ready", "in-progress", "review", "done", "blocked"] as const;
export const TaskState = z.enum(TASK_STATES);
export type TaskState = z.infer<typeof TaskState>;

const NullableString = z.string().nullable();
const Rung = z.union([z.literal("unverified"), z.array(z.string())]);

const ArchRow = z.object({
  ref: z.string(),
  relation: z.string(),
  state: z.string(),
  provenance: z.string(),
  target: NullableString,
});

const Feature = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  state: z.string(),
  outcome: NullableString,
  tasks: z.array(z.string()),
  architecture: z.array(ArchRow),
});

const Component = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.string(),
  paths: z.array(z.string()),
  parent: NullableString,
  provenance: z.string(),
  owner: NullableString,
  summary: NullableString,
  summary_provenance: NullableString,
  reviewed: z.boolean(),
});

const Evidence = z.object({
  generated: Rung,
  committed: Rung,
  tested: Rung,
  reviewed: Rung,
  merged: Rung,
  shipped: Rung,
  accepted: Rung,
});

const Task = z.object({
  id: z.string(),
  title: z.string(),
  state: TaskState,
  evidence: Evidence,
});

const Source = z.object({
  label: z.string(),
  status: z.string(),
});

const Issue = z.object({
  path: z.string(),
  field: NullableString,
  message: z.string(),
  severity: z.string(),
  blocking: z.boolean(),
});

const Meute = z.object({
  version: z.literal(1),
  project: z.string(),
  exported_at: z.string(),
  reports: z.array(
    z.object({
      ref: z.string(),
      recorded_at: z.string(),
      outcome: z.string(),
      task: NullableString,
      linked: z.boolean(),
    }),
  ),
});

const ManualReview = z.object({
  version: z.number().int(),
  source: z.literal("manual-anthropic-api-review"),
  task: z.string(),
  ref: z.string(),
  recorded_at: z.string(),
  outcome: z.string(),
  commit: z.string(),
  report_sha256: z.string(),
});

const ExecutionLinks = z.object({
  version: z.literal(1),
  project: z.string(),
  links: z.array(
    z.object({
      task: z.string(),
      kind: z.enum(["codeman-session", "meute-job"]),
      ref: z.string(),
      seen_at: z.string(),
      url: NullableString,
    }),
  ),
});

export const PlanningPayload = z.object({
  schema: z.literal(PLANNING_SCHEMA_MARKER),
  version: z.literal(1),
  project: z.string(),
  features: z.array(Feature),
  components: z.array(Component),
  tasks: z.array(Task),
  sources: z.array(Source),
  issues: z.array(Issue),
  meute: Meute.optional(),
  manual_review: ManualReview.optional(),
  execution_links: ExecutionLinks.optional(),
});
export type PlanningPayload = z.infer<typeof PlanningPayload>;

export type PlanningParse =
  | { readonly ok: true; readonly data: PlanningPayload }
  | { readonly ok: false; readonly code: Extract<ErrorCode, "BAD_JSON" | "SCHEMA_MISMATCH"> };

export function parsePlanningJson(text: string): PlanningParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: "BAD_JSON" };
  }
  const result = PlanningPayload.safeParse(raw);
  return result.success ? { ok: true, data: result.data } : { ok: false, code: "SCHEMA_MISMATCH" };
}
