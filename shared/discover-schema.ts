import { z } from "zod";
import type { ErrorCode } from "./errors.ts";

// Mirrors the exporter's Discover payload interface (marker etat-major/discover@1).
// z.object strips unknown keys. The marker and version are the compatibility gate, and the
// status, provenance and citation values are closed: an unrecognised one is a mismatch, so a
// review state can never be shown under the wrong name.

export const DISCOVER_SCHEMA_MARKER = "etat-major/discover@1";

export const RESEARCH_STATUSES = ["unreviewed", "reviewed", "superseded"] as const;
export const PROVENANCES = ["verified", "inferred", "ai-generated", "human"] as const;
export const DECISION_STATUSES = ["proposed", "approved", "rejected", "postponed", "superseded"] as const;
export const CITE_STATES = ["ok", "unsourced", "missing"] as const;

const NullableString = z.string().nullable();
const Count = z.number().int().min(0);
const Strings = z.array(z.string());

const Finding = z.object({
  id: z.string(),
  text: z.string(),
  source: NullableString,
  source_date: NullableString,
  unsourced: z.boolean(),
});

const Research = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(RESEARCH_STATUSES),
  provenance: z.enum(PROVENANCES),
  project: NullableString,
  findings: z.array(Finding),
  omitted_findings: Count,
  features: Strings,
});

// Status and provenance are empty strings when the cited record is missing.
const Cite = z.object({
  ref: z.string(),
  state: z.enum(CITE_STATES),
  status: z.string(),
  provenance: z.string(),
});

const Decision = z.object({
  id: z.string(),
  question: z.string(),
  status: z.enum(DECISION_STATUSES),
  decided_on: NullableString,
  chosen: NullableString,
  rationale: NullableString,
  // Pairs of [option, why not].
  alternatives: z.array(z.tuple([z.string(), z.string()])),
  omitted_alternatives: Count,
  cites: z.array(Cite),
  omitted_cites: Count,
  features: Strings,
});

export const DiscoverPayload = z.object({
  schema: z.literal(DISCOVER_SCHEMA_MARKER),
  version: z.literal(1),
  research: z.array(Research),
  decisions: z.array(Decision),
  omitted_research: Count,
  omitted_decisions: Count,
  issue_count: Count,
  query: z.string(),
});
export type DiscoverPayload = z.infer<typeof DiscoverPayload>;

export type DiscoverParse =
  | { readonly ok: true; readonly data: DiscoverPayload }
  | { readonly ok: false; readonly code: Extract<ErrorCode, "BAD_JSON" | "SCHEMA_MISMATCH"> };

export function parseDiscoverJson(text: string): DiscoverParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: "BAD_JSON" };
  }
  const result = DiscoverPayload.safeParse(raw);
  return result.success ? { ok: true, data: result.data } : { ok: false, code: "SCHEMA_MISMATCH" };
}
