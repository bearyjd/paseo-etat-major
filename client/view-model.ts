import type { ErrorCode } from "../shared/errors.ts";
import { TASK_STATES, UNKNOWN_STATE, type PlanningPayload, type TaskState } from "../shared/planning-schema.ts";
import { CAPS, sanitizeText } from "../shared/sanitize.ts";

// Pure mapping from the validated planning payload to view rows. Every payload string goes
// through sanitizeText here, so the screen only ever renders already-clean plain text.

export const STALE_AFTER_MS = 15 * 60_000;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const EVIDENCE_KEYS = ["generated", "committed", "tested", "reviewed", "merged", "shipped", "accepted"] as const;
export type EvidenceKey = (typeof EVIDENCE_KEYS)[number];

const LANE_LABELS: Record<TaskState, string> = {
  draft: "Draft",
  ready: "Ready",
  "in-progress": "In progress",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
  unknown: "Unrecognised",
};

export interface EvidenceRow {
  readonly key: EvidenceKey;
  readonly label: string;
  readonly unverified: boolean;
  readonly refs: readonly string[];
}
export interface TaskRow {
  // Unique per task and never rendered: displayed ids can collide after sanitizing.
  readonly key: string;
  readonly id: string;
  readonly title: string;
  readonly evidence: readonly EvidenceRow[];
  readonly unverifiedCount: number;
}
export interface LaneVm {
  readonly state: TaskState;
  readonly label: string;
  readonly count: number;
  readonly tasks: readonly TaskRow[];
  readonly emptyLine: string;
}
export interface IssueRow {
  readonly severity: string;
  readonly message: string;
  readonly path: string;
  readonly field: string | null;
  readonly blocking: boolean;
}
export interface FeatureRow {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly state: string;
  readonly outcome: string | null;
  readonly architecture: readonly { relation: string; ref: string; state: string; provenance: string }[];
}
export interface PlanningVm {
  readonly project: string;
  readonly version: string;
  readonly exportedAt: string;
  readonly exportedAtText: string;
  readonly stale: { readonly sentence: string; readonly hint: string } | null;
  readonly issues: { readonly heading: string; readonly rows: readonly IssueRow[] } | null;
  readonly lanes: readonly LaneVm[];
  readonly sources: readonly { label: string; status: string }[];
  readonly features: readonly FeatureRow[];
  readonly taskCount: number;
  readonly issueCount: number;
}

const title = (s: string): string => sanitizeText(s, CAPS.title);
const ref = (s: string): string => sanitizeText(s, CAPS.ref);
const prose = (s: string): string => sanitizeText(s, CAPS.prose);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function ageText(ageMs: number): string {
  if (ageMs < MIN) return "just now";
  if (ageMs < HOUR) return `${Math.floor(ageMs / MIN)} min ago`;
  if (ageMs < DAY) return `${Math.floor(ageMs / HOUR)} h ago`;
  return `${Math.floor(ageMs / DAY)} d ago`;
}

export function freshness(exportedAt: string, nowMs: number): Pick<PlanningVm, "exportedAtText" | "stale"> {
  const at = Date.parse(exportedAt);
  if (!Number.isFinite(at)) {
    return {
      exportedAtText: "unknown",
      stale: { sentence: "Export time unknown, so freshness cannot be checked.", hint: "Tap Try again to export again." },
    };
  }
  const age = Math.max(0, nowMs - at); // a future time (clock skew) counts as just now
  const exportedAtText = ageText(age);
  const stale =
    age > STALE_AFTER_MS
      ? { sentence: `Possibly stale: exported ${exportedAtText}.`, hint: "Tap Try again to export again." }
      : null;
  return { exportedAtText, stale };
}

function evidenceRows(evidence: PlanningPayload["tasks"][number]["evidence"]): EvidenceRow[] {
  return EVIDENCE_KEYS.map((key) => {
    const v = evidence[key];
    const refs = v === "unverified" ? [] : v.map(ref);
    return { key, label: key[0]!.toUpperCase() + key.slice(1), unverified: refs.length === 0, refs };
  });
}

function lanes(tasks: PlanningPayload["tasks"]): LaneVm[] {
  const order: readonly TaskState[] = [...TASK_STATES, UNKNOWN_STATE];
  const keyed = tasks.map((t, i) => ({ t, key: `${i}:${ref(t.id)}` }));
  return order
    .map((state): LaneVm => {
      const rows = keyed
        .filter(({ t }) => t.state === state)
        .map(({ t, key }): TaskRow => {
          const evidence = evidenceRows(t.evidence);
          return { key, id: ref(t.id), title: title(t.title), evidence, unverifiedCount: evidence.filter((e) => e.unverified).length };
        });
      const noun = state === UNKNOWN_STATE ? "unrecognised" : LANE_LABELS[state].toLowerCase().replace(" ", "-");
      return { state, label: LANE_LABELS[state], count: rows.length, tasks: rows, emptyLine: `No ${noun} tasks.` };
    })
    .filter((l) => l.state !== UNKNOWN_STATE || l.count > 0);
}

function issues(list: PlanningPayload["issues"]): PlanningVm["issues"] {
  if (list.length === 0) return null;
  const rows = list
    .map((i): IssueRow => ({
      severity: title(i.severity),
      message: prose(i.message),
      path: ref(i.path),
      field: i.field === null ? null : title(i.field),
      blocking: i.blocking,
    }))
    .sort((a, b) => Number(b.blocking) - Number(a.blocking)); // stable: blocking first, order kept otherwise
  return { heading: `${plural(rows.length, "issue")} in the workspace`, rows };
}

export interface PlanningInput {
  readonly data: PlanningPayload;
  readonly exportedAt: string;
  readonly version: string;
}

export function buildPlanningVm(input: PlanningInput, now: () => number = Date.now): PlanningVm {
  const { data } = input;
  return {
    project: title(data.project),
    version: title(input.version),
    exportedAt: input.exportedAt,
    ...freshness(input.exportedAt, now()),
    issues: issues(data.issues),
    lanes: lanes(data.tasks),
    sources: data.sources.map((s) => ({ label: title(s.label), status: title(s.status) })),
    features: data.features.map((f) => ({
      id: ref(f.id),
      title: title(f.title),
      status: title(f.status),
      state: title(f.state),
      outcome: f.outcome === null ? null : sanitizeText(f.outcome, CAPS.prose, { allowNewline: true }),
      architecture: f.architecture.map((a) => ({
        relation: title(a.relation),
        ref: ref(a.ref),
        state: title(a.state),
        provenance: title(a.provenance),
      })),
    })),
    taskCount: data.tasks.length,
    issueCount: data.issues.length,
  };
}

// Sidebar summary: nothing until data exists, then a short visible text and a spoken label.
export function footerSummary(vm: PlanningVm | null): { short: string; label: string } | null {
  if (vm === null) return null;
  const count = (state: TaskState): number => vm.lanes.find((l) => l.state === state)?.count ?? 0;
  const issueText = vm.issueCount === 0 ? "no issues" : plural(vm.issueCount, "issue");
  return {
    short: plural(vm.taskCount, "task"),
    label: `État-major: ${plural(vm.taskCount, "task")}, ${count("blocked")} blocked, ${count("ready")} ready, ${issueText}`,
  };
}

const ERROR_VIEWS: Record<ErrorCode, { sentence: string; hint: string }> = {
  NOT_CONFIGURED: { sentence: "État-major is not set up yet.", hint: "Open Settings and set the executable, workspace and project." },
  EXE_INVALID: { sentence: "The configured executable cannot be used.", hint: "Set an absolute path to etat-major in Settings. It must be a regular file that only its owner can write, inside a venv (user-site packages are not loaded)." },
  VERSION_UNSUPPORTED: { sentence: "This etat-major version is not supported.", hint: "Install a version in the range this plugin supports in a venv (user-site packages are not loaded), then tap Try again." },
  WORKSPACE_INVALID: { sentence: "The workspace folder cannot be read.", hint: "Set an absolute path to an existing workspace directory in Settings." },
  INPUT_INVALID: { sentence: "A recorded input file cannot be used.", hint: "Set absolute paths to readable JSON files of at most 4 MiB in Settings, or clear the field." },
  TIMEOUT: { sentence: "The export took too long and was stopped.", hint: "Check the workspace size, then tap Try again." },
  OUTPUT_TOO_LARGE: { sentence: "The export was larger than this plugin accepts.", hint: "Reduce the project size or run the export by hand to inspect it." },
  EXPORT_FAILED: { sentence: "The export did not finish.", hint: "Run etat-major export planning --json by hand to see the error, then tap Try again." },
  BAD_JSON: { sentence: "The export was not valid JSON.", hint: "Check that the executable is etat-major and not a wrapper that prints extra text." },
  SCHEMA_MISMATCH: { sentence: "The export has an unexpected shape.", hint: "Update the plugin or etat-major so their planning schema versions match." },
  BUSY: { sentence: "Another export is already running.", hint: "Wait a moment, then tap Try again." },
};

export const errorView = (code: ErrorCode): { sentence: string; hint: string } => ERROR_VIEWS[code];

// Shown when the call to the plugin host itself fails (not an export error code).
export const LOAD_ERROR_VIEW = {
  sentence: "Could not reach the plugin host.",
  hint: "Check that the plugin is running on the host, then tap Try again.",
} as const;

export type ErrorView = { readonly sentence: string; readonly hint: string };
export type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "vm"; readonly vm: PlanningVm; readonly refreshError?: ErrorView }
  | { readonly kind: "error"; readonly view: ErrorView; readonly code: ErrorCode | null };

// A failed "Try again" must not wipe a board that was valid and on screen: keep it and carry
// the error as a banner. Without data yet, or on a plain load, the error replaces the view.
export function settleLoad(prev: Loaded, next: Loaded, force: boolean): Loaded {
  if (force && prev.kind === "vm" && next.kind === "error") return { kind: "vm", vm: prev.vm, refreshError: next.view };
  return next;
}
