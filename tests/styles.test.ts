import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStyles } from "../client/styles.ts";
import { sentinelTheme } from "./sentinel-theme.ts";

const { colors } = sentinelTheme;
const palette = new Set<unknown>(Object.values(colors));
const wide = makeStyles(sentinelTheme, { compact: false });
const narrow = makeStyles(sentinelTheme, { compact: true });

type Style = Record<string, unknown>;

// Every [path, value] pair whose key names a color, at any depth (including placeholderTextColor).
function colorEntries(node: object, path = ""): [string, unknown][] {
  return Object.entries(node).flatMap(([k, v]): [string, unknown][] => {
    const p = path ? `${path}.${k}` : k;
    if (typeof v === "object" && v !== null) return colorEntries(v, p);
    return /color/i.test(k) ? [[p, v]] : [];
  });
}

test("every color value comes from the theme palette", () => {
  for (const styles of [wide, narrow]) {
    const entries = colorEntries(styles);
    assert.ok(entries.length > 20);
    assert.deepEqual(entries.filter(([, v]) => !palette.has(v)), []);
  }
});

test("every text style sets a text color from the palette", () => {
  const texts = Object.entries(wide.text) as [string, Style][];
  assert.ok(texts.length > 0);
  for (const [name, s] of texts) assert.ok(palette.has(s.color), `text.${name} has no theme color`);
});

test("every view style paints a theme background", () => {
  const { text: _text, ...views } = wide;
  for (const [name, s] of Object.entries(views) as [string, Style][]) {
    assert.ok(palette.has(s.backgroundColor), `${name} has no theme background`);
  }
});

test("every drawn border has a theme color", () => {
  const all = [...Object.entries(wide), ...Object.entries(wide.text)] as [string, Style][];
  for (const [name, s] of all) {
    if (s.borderWidth || s.borderBottomWidth) {
      assert.ok(palette.has(s.borderColor), `${name} draws a border without a theme color`);
    }
  }
});

test("surfaces: screen surface0, cards surface1 with a border, tabs surface2 and accent when selected", () => {
  assert.equal(wide.screen.backgroundColor, colors.surface0);
  assert.equal(wide.card.backgroundColor, colors.surface1);
  assert.equal(wide.card.borderColor, colors.border);
  assert.equal(wide.tab.backgroundColor, colors.surface2);
  assert.equal(wide.tabSelected.backgroundColor, colors.accent);
  assert.equal(wide.text.tabSelected.color, colors.accentForeground);
});

test("text roles: body foreground, secondary and unverified pill muted, status colors for issues", () => {
  assert.equal(wide.text.body.color, colors.foreground);
  assert.equal(wide.text.muted.color, colors.foregroundMuted);
  assert.equal(wide.text.pill.color, colors.foregroundMuted);
  assert.equal(wide.text.danger.color, colors.statusDanger);
  assert.equal(wide.text.warning.color, colors.statusWarning);
  assert.equal(wide.text.success.color, colors.statusSuccess);
  assert.equal(wide.cardDanger.borderColor, colors.statusDanger);
  assert.equal(wide.cardWarning.borderColor, colors.statusWarning);
});

test("buttons use accent, and look muted when disabled", () => {
  assert.equal(wide.button.backgroundColor, colors.accent);
  assert.equal(wide.text.button.color, colors.accentForeground);
  assert.equal(wide.buttonDisabled.backgroundColor, colors.surface2);
  assert.equal(wide.text.buttonDisabled.color, colors.foregroundMuted);
});

test("compact layout tightens the screen padding; tap targets stay at least 44", () => {
  assert.equal(wide.content.padding, 24);
  assert.equal(narrow.content.padding, 12);
  for (const s of [narrow.button, narrow.buttonDisabled, narrow.tab, narrow.tabSelected, narrow.taskRow]) {
    assert.ok(s.minHeight >= 44);
  }
});

test("makeStyles follows the theme it is given and does not mutate it", () => {
  const before = JSON.stringify(sentinelTheme);
  const other = { colors: { ...colors, foreground: "sentinel:other" } };
  assert.equal(makeStyles(other, { compact: false }).text.body.color, "sentinel:other");
  assert.equal(wide.text.body.color, colors.foreground);
  assert.equal(JSON.stringify(sentinelTheme), before);
});
