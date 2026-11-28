import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as contracts from "../shared/contracts.ts";
import { DiscoverPayload } from "../shared/discover-schema.ts";
import * as discoverModel from "../client/discover-view-model.ts";
import * as viewModel from "../client/view-model.ts";
import * as styles from "../client/styles.ts";
import * as summaryStore from "../client/summary-store.ts";
import { sentinelTheme } from "./sentinel-theme.ts";
import { hookRuntime, hosts, load, press, texts, type Node, type Props } from "./ui-harness.ts";

const GET = "etat-major.discover.get";
const REFRESH = "etat-major.discover.refresh";
const recorded = () => DiscoverPayload.parse(JSON.parse(readFileSync(new URL("../fixtures/exports/harbor-discover.json", import.meta.url), "utf8")));
const ok = (data = recorded()) => ({ ok: true, data, exportedAt: new Date().toISOString(), version: "0.1.0" });
const failed = (code: string) => ({ ok: false, code });

// A hooks runtime plus a useRpc that records the contract name of every call.
function host(reply: (name: string) => unknown) {
  const rt = hookRuntime();
  const calls: string[] = [];
  const client = { useRpc: (c: { name: string }) => async () => (calls.push(c.name), reply(c.name)) };
  const modules = {
    react: rt.react,
    "@getpaseo/plugin/client": client,
    "../shared/contracts.ts": contracts,
    "./view-model.ts": viewModel,
    "./controls.tsx": load("controls.tsx"),
  };
  return { rt, calls, modules };
}

function discoverView(reply: (name: string) => unknown) {
  const h = host(reply);
  const { DiscoverView } = load("DiscoverView.tsx", {
    ...h.modules,
    "./discover-view-model.ts": discoverModel,
    "./DiscoverBoard.tsx": load("DiscoverBoard.tsx", { "./controls.tsx": h.modules["./controls.tsx"] }),
  });
  const opened: string[] = [];
  const props: Props = { styles: styles.makeStyles(sentinelTheme, { compact: true }), nowMs: Date.now(), onOpenSettings: () => opened.push("settings") };
  return { ...h, opened, render: () => h.rt.render(DiscoverView, props), settle: () => h.rt.settle(DiscoverView, props) };
}
const alerts = (tree: Node[]) => tree.filter((n) => n.props.accessibilityRole === "alert").map((n) => texts(hosts(n.props.children)));

test("DiscoverView says it is loading, calls get once, then draws the records", async () => {
  const v = discoverView(() => ok());
  assert.ok(texts(v.render()).includes("Loading the Discover export."));
  const tree = await v.settle();
  assert.deepEqual(v.calls, [GET]);
  assert.ok(texts(tree).includes("Status: Rejected"));
  assert.equal(texts(tree).includes("Loading the Discover export."), false);
  assert.deepEqual(alerts(tree), []);
});

test("DiscoverView Try again calls refresh, not get", async () => {
  const v = discoverView(() => ok());
  press(await v.settle(), "Try again");
  await v.settle();
  assert.deepEqual(v.calls, [GET, REFRESH]);
});

test("DiscoverView shows failed and omitted records as an alert", async () => {
  const data = recorded();
  data.issue_count = 2;
  data.omitted_decisions = 1;
  data.omitted_research = 3;
  const v = discoverView(() => ok(data));
  assert.deepEqual(alerts(await v.settle()), [[
    "2 research or decision records failed to load. Run etat-major workspace validate on the host for details.",
    "1 decision is not included in this export.",
    "3 research records are not included in this export.",
  ]]);
});

test("DiscoverView shows the Discover wording of an error", async () => {
  const v = discoverView(() => failed("EXPORT_FAILED"));
  const all = texts(await v.settle());
  const { sentence, hint } = discoverModel.discoverErrorView("EXPORT_FAILED");
  assert.ok(all.includes(sentence), sentence);
  assert.ok(all.includes(hint), hint);
  assert.equal(all.includes("Open Settings"), false);
});

test("DiscoverView offers Settings when not configured", async () => {
  const v = discoverView(() => failed("NOT_CONFIGURED"));
  press(await v.settle(), "Open Settings");
  assert.deepEqual(v.opened, ["settings"]);
});

test("DiscoverView keeps the records and says why when a refresh fails", async () => {
  const v = discoverView((name) => (name === GET ? ok() : failed("BUSY")));
  press(await v.settle(), "Try again");
  const tree = await v.settle();
  assert.ok(texts(tree).includes("Status: Rejected"));
  assert.equal(alerts(tree)[0]![0], discoverModel.discoverErrorView("BUSY").sentence);
});

test("the Planning screen switches to the Discover view and back, and from there to settings", async () => {
  const h = host(() => failed("NOT_CONFIGURED"));
  let discoverProps: Props = {};
  const { PlanningScreen } = load(
    "PlanningScreen.tsx",
    {
      ...h.modules,
      "@getpaseo/plugin/client/ui": { ScrollView: "ScrollView" },
      "./DiscoverView.tsx": { DiscoverView: (p: Props) => ((discoverProps = p), { type: "DiscoverViewStub", props: {} }) },
      "./SettingsPage.tsx": { SettingsPage: () => ({ type: "SettingsPageStub", props: {} }) },
      "./styles.ts": styles,
      "./summary-store.ts": summaryStore,
    },
    { setInterval: () => 0, clearInterval: () => {} },
  );
  const props: Props = { params: {}, theme: sentinelTheme, layout: { compact: true } };
  const shows = (tree: Node[], type: string) => tree.some((n) => n.type === type);

  let tree = await h.rt.settle(PlanningScreen, props);
  assert.equal(shows(tree, "DiscoverViewStub"), false);
  press(tree, "Discover");
  tree = await h.rt.settle(PlanningScreen, props);
  assert.ok(shows(tree, "DiscoverViewStub"));
  assert.equal(typeof discoverProps.nowMs, "number");
  assert.equal(texts(tree).includes("Try again"), false, "the planning refresh button is not shown on Discover");

  press(tree, "Planning");
  tree = await h.rt.settle(PlanningScreen, props);
  assert.equal(shows(tree, "DiscoverViewStub"), false);

  press(tree, "Discover");
  await h.rt.settle(PlanningScreen, props);
  (discoverProps.onOpenSettings as () => void)();
  assert.ok(shows(await h.rt.settle(PlanningScreen, props), "SettingsPageStub"));
});
