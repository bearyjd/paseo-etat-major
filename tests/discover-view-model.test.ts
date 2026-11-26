import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DiscoverPayload } from "../shared/discover-schema.ts";
import { ERROR_CODES } from "../shared/errors.ts";
import { CAPS } from "../shared/sanitize.ts";
import { buildDiscoverVm, discoverErrorView } from "../client/discover-view-model.ts";
import { errorView, settleLoad, type Loaded } from "../client/view-model.ts";
import type { DiscoverVm } from "../client/discover-view-model.ts";
import { INDEPENDENT_FORBIDDEN } from "./forbidden.ts";

const parse = (name: string) => DiscoverPayload.parse(JSON.parse(readFileSync(new URL(`../fixtures/exports/${name}`, import.meta.url), "utf8")));
const exportedAt = "2026-11-25T10:00:00.000Z";
const T0 = Date.parse(exportedAt);
const vm = (data = parse("harbor-discover.json"), now = T0): DiscoverVm => buildDiscoverVm({ data, exportedAt, version: "0.1.0" }, () => now);

test("header facts, section labels with counts (rejected named), exporter order kept", () => {
  const v = vm();
  assert.equal(v.version, "0.1.0");
  assert.equal(v.exportedAt, exportedAt);
  assert.equal(v.exportedAtText, "just now");
  assert.equal(v.stale, null);
  assert.equal(v.decisionsLabel, "Decisions 4 (1 rejected)");
  assert.equal(v.researchLabel, "Research 3");
  assert.deepEqual(v.decisions.map((d) => d.id), ["0001", "0002", "0003", "0004"]);
  assert.deepEqual(v.research.map((r) => r.id), ["0001", "0002", "0003"]);
  assert.deepEqual(v.notices, []);
  assert.ok(vm(undefined, T0 + 3_600_000).stale);
});

test("decision status is always spelled out; rejected has its own tone and says so", () => {
  const [approved, rejected, proposed, postponed] = vm().decisions;
  assert.equal(approved!.statusText, "Status: Approved");
  assert.equal(approved!.tone, "plain");
  assert.equal(rejected!.statusText, "Status: Rejected");
  assert.equal(rejected!.tone, "rejected");
  assert.equal(proposed!.statusText, "Status: Proposed (not decided)");
  assert.equal(proposed!.tone, "pending");
  assert.equal(postponed!.statusText, "Status: Postponed");
  assert.equal(postponed!.tone, "plain");
  assert.equal(approved!.dateText, "Decided 2026-10-20");
  assert.equal(proposed!.dateText, "No decision date");
  assert.equal(rejected!.chosen, null);
  assert.deepEqual(rejected!.alternatives.map((a) => a.option), ["One text message per silent sensor", "One daily summary message"]);
});

test("each citation states its resolution, review status and provenance", () => {
  const [approved, rejected, , postponed] = vm().decisions;
  assert.deepEqual(approved!.cites.map((c) => [c.ref, c.detail, c.needsCheck]), [
    ["research:0001#f1", "Evidence: ok. Status: Reviewed. Provenance: AI-generated.", false],
  ]);
  assert.equal(approved!.evidenceText, "1 citation");
  assert.equal(approved!.evidenceNeedsCheck, false);
  assert.deepEqual(rejected!.cites.map((c) => [c.detail, c.needsCheck]), [
    ["Evidence: ok. Status: Unreviewed. Provenance: AI-generated.", true],
    ["Evidence: unsourced. Status: Unreviewed. Provenance: AI-generated.", true],
  ]);
  assert.equal(rejected!.evidenceText, "2 citations, 2 need checking");
  assert.equal(rejected!.evidenceNeedsCheck, true);
  assert.equal(postponed!.evidenceText, "No evidence cited");
  assert.equal(postponed!.evidenceNeedsCheck, true);
});

test("a missing citation or a superseded source needs checking; blank status and provenance read as unknown", () => {
  const data = parse("harbor-discover.json");
  data.decisions[0]!.cites = [
    { ref: "research:0009#f1", state: "missing", status: "", provenance: "" },
    { ref: "research:0003#f1", state: "ok", status: "superseded", provenance: "human" },
  ];
  const cites = vm(data).decisions[0]!.cites;
  assert.deepEqual(cites.map((c) => c.detail), [
    "Evidence: missing. Status: unknown. Provenance: unknown.",
    "Evidence: ok. Status: Superseded. Provenance: Human.",
  ]);
  assert.deepEqual(cites.map((c) => c.needsCheck), [true, true]);
});

test("an unsourced or missing citation of a reviewed record still needs checking", () => {
  for (const state of ["unsourced", "missing"] as const) {
    const data = parse("harbor-discover.json");
    data.decisions[0]!.cites = [{ ref: "research:0001#f9", state, status: "reviewed", provenance: "human" }];
    const d = vm(data).decisions[0]!;
    assert.equal(d.cites[0]!.needsCheck, true, state);
    assert.equal(d.evidenceNeedsCheck, true, state);
    assert.equal(d.evidenceText, "1 citation, 1 needs checking", state);
  }
});

test("research always carries review status and provenance", () => {
  const [reviewed, unreviewed, superseded] = vm().research;
  assert.deepEqual([reviewed!.statusText, reviewed!.provenanceText, reviewed!.needsCheck], ["Status: Reviewed", "Provenance: AI-generated", false]);
  assert.deepEqual([unreviewed!.statusText, unreviewed!.provenanceText, unreviewed!.needsCheck], ["Status: Unreviewed", "Provenance: AI-generated", true]);
  assert.deepEqual([superseded!.statusText, superseded!.provenanceText, superseded!.needsCheck], ["Status: Superseded", "Provenance: Human", true]);
  assert.equal(reviewed!.project, "Cross-project");
  assert.equal(unreviewed!.project, "Project harbor");
  assert.equal(unreviewed!.findingsText, "2 findings, 1 unsourced");
  assert.equal(reviewed!.findingsText, "1 finding");
});

test("a finding is unsourced when flagged, or when its URL or date is absent", () => {
  const findings = vm().research[1]!.findings;
  assert.deepEqual(findings.map((f) => f.unsourced), [false, true]);
  assert.equal(findings[0]!.sourceUrl, "https://example.org/harbor/notes/2");
  assert.equal(findings[0]!.sourceDate, "2026-10-09");
  assert.equal(findings[1]!.sourceUrl, null);
  for (const patch of [{ source: null }, { source_date: null }, { source: "" }, { source: "​" }, { source: "  \t" }, { source_date: " " }, { unsourced: true }]) {
    const data = parse("harbor-discover.json");
    Object.assign(data.research[0]!.findings[0]!, patch);
    assert.equal(vm(data).research[0]!.findings[0]!.unsourced, true, JSON.stringify(patch));
  }
});

test("omitted records and load failures are stated, never hidden", () => {
  const data = parse("harbor-discover.json");
  data.omitted_research = 2;
  data.omitted_decisions = 1;
  data.issue_count = 3;
  data.research[0]!.omitted_findings = 4;
  data.decisions[0]!.omitted_alternatives = 1;
  data.decisions[0]!.omitted_cites = 2;
  const v = vm(data);
  assert.deepEqual(v.notices, [
    "3 research or decision records failed to load. Run etat-major workspace validate on the host for details.",
    "1 decision is not included in this export.",
    "2 research records are not included in this export.",
  ]);
  assert.deepEqual(v.research[0]!.omitted, ["4 findings are not included."]);
  assert.deepEqual(v.decisions[0]!.omitted, ["1 alternative is not included.", "2 citations are not included."]);
  assert.equal(v.decisions[0]!.evidenceText, "3 citations, 2 not shown");
  assert.equal(v.decisions[0]!.evidenceNeedsCheck, true);
});

test("row keys stay unique when ids collide after sanitizing", () => {
  const data = parse("harbor-discover.json");
  data.decisions[0]!.id = "1\u0007";
  data.decisions[1]!.id = "1\u0008";
  data.research[0]!.id = "1\u0007";
  data.research[1]!.id = "1\u0008";
  const v = vm(data);
  assert.equal(v.decisions[0]!.id, v.decisions[1]!.id);
  assert.equal(new Set(v.decisions.map((d) => d.key)).size, 4);
  assert.equal(new Set(v.research.map((r) => r.key)).size, 3);
});

test("hostile payload: every string in the view model is clean and bounded", () => {
  const v = vm(parse("discover-hostile.handcrafted.json"));
  let strings = 0;
  const walk = (x: unknown, path: string): void => {
    if (typeof x === "string") {
      strings += 1;
      assert.doesNotMatch(x.replaceAll("\n", ""), INDEPENDENT_FORBIDDEN, path);
      assert.doesNotMatch(x, /\p{M}{4}/u, path);
      assert.doesNotMatch(x, /\n{3}/, path);
      assert.ok(Array.from(x).length <= CAPS.prose + 200, path);
    } else if (Array.isArray(x)) x.forEach((y, i) => walk(y, `${path}[${i}]`));
    else if (x && typeof x === "object") for (const [k, y] of Object.entries(x)) walk(y, `${path}.${k}`);
  };
  walk(v, "vm");
  assert.ok(strings > 25);
  assert.equal(Array.from(v.research[0]!.title).length, CAPS.title);
  assert.equal(Array.from(v.research[0]!.findings[0]!.sourceUrl!).length, CAPS.prose);
  assert.equal(v.decisions[0]!.tone, "rejected");
});

test("error views: fixed update hint for an old exporter, discover wording where planning would mislead", () => {
  const old = discoverErrorView("DISCOVER_UNSUPPORTED");
  assert.equal(old.sentence, "This etat-major version has no Discover export.");
  assert.match(old.hint, /^Update etat-major/);
  for (const code of ERROR_CODES) {
    const view = discoverErrorView(code);
    assert.ok(view.sentence.length > 10 && view.hint.length > 10, code);
    assert.doesNotMatch(`${view.sentence} ${view.hint}`, /planning (--json|schema)|export planning/, code);
  }
  assert.match(discoverErrorView("EXPORT_FAILED").hint, /export discover --json/);
  assert.match(discoverErrorView("EXPORT_FAILED").hint, /planning records/);
  assert.deepEqual(discoverErrorView("TIMEOUT"), errorView("TIMEOUT"));
});

test("a failed forced refresh keeps the loaded Discover records", () => {
  const prev: Loaded<DiscoverVm> = { kind: "vm", vm: vm() };
  const failed: Loaded<DiscoverVm> = { kind: "error", view: discoverErrorView("BUSY"), code: "BUSY" };
  const kept = settleLoad(prev, failed, true);
  assert.equal(kept.kind === "vm" && kept.vm, prev.kind === "vm" && prev.vm);
});

test("recorded multi-line YAML values: prose shows real line breaks, titles one line, no trailing break", () => {
  const rejected = vm().decisions[1]!;
  assert.equal(rejected.question, "Should Harbor send a text message for every silent sensor?");
  assert.equal(rejected.rationale, "Repeated single alerts get ignored, and the summary needs new infrastructure.");
  assert.equal(rejected.alternatives[0]!.whyNot, "Operators would mute the number within days.\nMuted numbers miss real outages.");
});

test("the exporter's escaped newline is undone before cleaning in every prose and title field", () => {
  const NL = "\\u000a"; // six literal characters, as the exporter writes a newline
  const data = parse("harbor-discover.json");
  const two = `one${NL}two${NL}`;
  Object.assign(data.decisions[0]!, { question: two, chosen: two, rationale: two, alternatives: [[two, two]] });
  data.research[0]!.title = two;
  data.research[0]!.findings[0]!.text = two;
  data.decisions[1]!.chosen = `${NL}${NL}`;
  data.decisions[1]!.rationale = `a${NL}${NL}${NL}${NL}b`;
  const v = vm(data);
  const d = v.decisions[0]!;
  for (const prose of [d.chosen, d.rationale, d.alternatives[0]!.option, d.alternatives[0]!.whyNot, v.research[0]!.findings[0]!.text]) assert.equal(prose, "one\ntwo");
  assert.equal(d.question, "one two");
  assert.equal(v.research[0]!.title, "one two");
  assert.equal(v.decisions[1]!.chosen, null, "only line breaks means absent");
  assert.equal(v.decisions[1]!.rationale, "a\n\nb", "the newline run limit still applies");
});
