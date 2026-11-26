import type { DiscoverPayload } from "../shared/discover-schema.ts";
import type { ErrorCode } from "../shared/errors.ts";
import { CAPS, sanitizeText } from "../shared/sanitize.ts";
import { errorView, freshness, type ErrorView, type PlanningVm } from "./view-model.ts";

// Pure mapping from the validated Discover payload to view rows. Every payload string goes
// through sanitizeText here, so the screen only ever renders already-clean plain text.

type Research = DiscoverPayload["research"][number];
type Decision = DiscoverPayload["decisions"][number];

export interface CiteRow {
  readonly key: string;
  readonly ref: string;
  readonly detail: string;
  readonly needsCheck: boolean;
}
export interface DecisionRow {
  // Unique per row and never rendered: displayed ids can collide after sanitizing.
  readonly key: string;
  readonly id: string;
  readonly question: string;
  readonly statusText: string;
  readonly tone: "rejected" | "pending" | "plain";
  readonly dateText: string;
  readonly chosen: string | null;
  readonly rationale: string | null;
  readonly alternatives: readonly { readonly option: string; readonly whyNot: string }[];
  readonly cites: readonly CiteRow[];
  readonly evidenceText: string;
  readonly evidenceNeedsCheck: boolean;
  readonly features: readonly string[];
  readonly omitted: readonly string[];
}
export interface FindingRow {
  readonly key: string;
  readonly id: string;
  readonly text: string;
  readonly unsourced: boolean;
  // Shown as plain text only; never opened or turned into a link.
  readonly sourceUrl: string | null;
  readonly sourceDate: string | null;
}
export interface ResearchRow {
  readonly key: string;
  readonly id: string;
  readonly title: string;
  readonly statusText: string;
  readonly provenanceText: string;
  readonly needsCheck: boolean;
  readonly project: string;
  readonly findings: readonly FindingRow[];
  readonly findingsText: string;
  readonly features: readonly string[];
  readonly omitted: readonly string[];
}
export interface DiscoverVm {
  readonly version: string;
  readonly exportedAt: string;
  readonly exportedAtText: string;
  readonly stale: PlanningVm["stale"];
  readonly notices: readonly string[];
  readonly decisionsLabel: string;
  readonly researchLabel: string;
  readonly decisions: readonly DecisionRow[];
  readonly research: readonly ResearchRow[];
}

const DECISION_STATUS: Record<Decision["status"], string> = {
  proposed: "Proposed (not decided)",
  approved: "Approved",
  rejected: "Rejected",
  postponed: "Postponed",
  superseded: "Superseded",
};
const RESEARCH_STATUS: Record<Research["status"], string> = {
  unreviewed: "Unreviewed",
  reviewed: "Reviewed",
  superseded: "Superseded",
};
const PROVENANCE: Record<Research["provenance"], string> = {
  verified: "Verified",
  inferred: "Inferred",
  "ai-generated": "AI-generated",
  human: "Human",
};

const title = (s: string): string => sanitizeText(s, CAPS.title);
const ref = (s: string): string => sanitizeText(s, CAPS.ref);
const prose = (s: string): string => sanitizeText(s, CAPS.prose, { allowNewline: true });
// Absent when null, or when nothing visible is left after cleaning.
const optional = (s: string | null, clean: (v: string) => string): string | null => {
  const out = s === null ? "" : clean(s);
  return out.trim() === "" ? null : out;
};
const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const omitted = (n: number, one: string, many = `${one}s`, where = ""): string[] =>
  n === 0 ? [] : [`${count(n, one, many)} ${n === 1 ? "is" : "are"} not included${where}.`];
// A cited record's own words when known; an empty or unrecognised value is shown cleaned.
const label = (names: Readonly<Record<string, string>>, value: string): string =>
  Object.hasOwn(names, value) ? names[value]! : title(value) || "unknown";

function citeRow(c: Decision["cites"][number], i: number): CiteRow {
  return {
    key: `${i}:${ref(c.ref)}`,
    ref: ref(c.ref),
    detail: `Evidence: ${c.state}. Status: ${label(RESEARCH_STATUS, c.status)}. Provenance: ${label(PROVENANCE, c.provenance)}.`,
    needsCheck: c.state !== "ok" || c.status !== "reviewed",
  };
}

function evidence(cites: readonly CiteRow[], hidden: number): Pick<DecisionRow, "evidenceText" | "evidenceNeedsCheck"> {
  const total = cites.length + hidden;
  if (total === 0) return { evidenceText: "No evidence cited", evidenceNeedsCheck: true };
  const flagged = cites.filter((c) => c.needsCheck).length;
  const parts = [
    count(total, "citation"),
    ...(flagged === 0 ? [] : [`${flagged} need${flagged === 1 ? "s" : ""} checking`]),
    ...(hidden === 0 ? [] : [`${hidden} not shown`]),
  ];
  return { evidenceText: parts.join(", "), evidenceNeedsCheck: flagged > 0 || hidden > 0 };
}

function decisionRow(d: Decision, i: number): DecisionRow {
  const cites = d.cites.map(citeRow);
  const date = optional(d.decided_on, title);
  return {
    key: `${i}:${ref(d.id)}`,
    id: ref(d.id),
    question: title(d.question),
    statusText: `Status: ${DECISION_STATUS[d.status]}`,
    tone: d.status === "rejected" ? "rejected" : d.status === "proposed" ? "pending" : "plain",
    dateText: date === null ? "No decision date" : `Decided ${date}`,
    chosen: optional(d.chosen, prose),
    rationale: optional(d.rationale, prose),
    alternatives: d.alternatives.map(([option, whyNot]) => ({ option: prose(option), whyNot: prose(whyNot) })),
    cites,
    ...evidence(cites, d.omitted_cites),
    features: d.features.map(ref),
    omitted: [...omitted(d.omitted_alternatives, "alternative"), ...omitted(d.omitted_cites, "citation")],
  };
}

function findingRow(f: Research["findings"][number], i: number): FindingRow {
  const sourceUrl = optional(f.source, (s) => sanitizeText(s, CAPS.prose));
  const sourceDate = optional(f.source_date, title);
  return {
    key: `${i}:${ref(f.id)}`,
    id: ref(f.id),
    text: prose(f.text),
    // Without both a URL and a date a finding is unsourced, whatever the flag says.
    unsourced: f.unsourced || sourceUrl === null || sourceDate === null,
    sourceUrl,
    sourceDate,
  };
}

function researchRow(r: Research, i: number): ResearchRow {
  const findings = r.findings.map(findingRow);
  const unsourced = findings.filter((f) => f.unsourced).length;
  const total = count(findings.length + r.omitted_findings, "finding");
  const project = optional(r.project, ref);
  return {
    key: `${i}:${ref(r.id)}`,
    id: ref(r.id),
    title: title(r.title),
    statusText: `Status: ${RESEARCH_STATUS[r.status]}`,
    provenanceText: `Provenance: ${PROVENANCE[r.provenance]}`,
    needsCheck: r.status !== "reviewed",
    project: project === null ? "Cross-project" : `Project ${project}`,
    findings,
    findingsText: unsourced === 0 ? total : `${total}, ${unsourced} unsourced`,
    features: r.features.map(ref),
    omitted: omitted(r.omitted_findings, "finding"),
  };
}

function notices(data: DiscoverPayload): string[] {
  const failed = data.issue_count;
  return [
    ...(failed === 0
      ? []
      : [`${count(failed, "research or decision record")} failed to load. Run etat-major workspace validate on the host for details.`]),
    ...omitted(data.omitted_decisions, "decision", "decisions", " in this export"),
    ...omitted(data.omitted_research, "research record", "research records", " in this export"),
  ];
}

export interface DiscoverInput {
  readonly data: DiscoverPayload;
  readonly exportedAt: string;
  readonly version: string;
}

export function buildDiscoverVm(input: DiscoverInput, now: () => number = Date.now): DiscoverVm {
  const { data } = input;
  const rejected = data.decisions.filter((d) => d.status === "rejected").length;
  return {
    version: title(input.version),
    exportedAt: input.exportedAt,
    ...freshness(input.exportedAt, now()),
    notices: notices(data),
    decisionsLabel: `Decisions ${data.decisions.length}${rejected === 0 ? "" : ` (${rejected} rejected)`}`,
    researchLabel: `Research ${data.research.length}`,
    decisions: data.decisions.map(decisionRow),
    research: data.research.map(researchRow),
  };
}

// The shared error views name the planning export in places; these replace that wording.
const DISCOVER_ERRORS: Partial<Record<ErrorCode, ErrorView>> = {
  EXPORT_FAILED: {
    sentence: "The export did not finish.",
    hint: "Check that the project has planning records, then run etat-major export discover --json by hand to see the error and tap Try again.",
  },
  SCHEMA_MISMATCH: {
    sentence: "The export has an unexpected shape.",
    hint: "Update the plugin or etat-major so their Discover schema versions match.",
  },
};

export const discoverErrorView = (code: ErrorCode): ErrorView => DISCOVER_ERRORS[code] ?? errorView(code);
