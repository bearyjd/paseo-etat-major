import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPS, sanitizeText } from "../shared/sanitize.ts";

const BIDI = ["\u200e", "\u200f", "\u202a", "\u202b", "\u202c", "\u202d", "\u202e", "\u2066", "\u2067", "\u2068", "\u2069", "\ufeff"];
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff\ud800-\udfff]/u;

test("caps are 200 / 2000 / 256", () => {
  assert.deepEqual({ ...CAPS }, { title: 200, prose: 2000, ref: 256 });
});

test("strips every C0 and C1 control, newline included by default", () => {
  for (let c = 0; c <= 0x9f; c++) {
    if (c > 0x1f && c < 0x7f) continue;
    assert.equal(sanitizeText(`a${String.fromCharCode(c)}b`, 50), "ab", `U+${c.toString(16)}`);
  }
});

test("keeps only \\n when allowNewline is set", () => {
  assert.equal(sanitizeText("a\nb\r\nc\td", 50, { allowNewline: true }), "a\nb\ncd");
  assert.equal(sanitizeText("a\nb", 50), "ab");
});

test("strips bidi and format characters", () => {
  for (const ch of BIDI) assert.equal(sanitizeText(`a${ch}b`, 50), "ab", `U+${ch.charCodeAt(0).toString(16)}`);
  assert.equal(sanitizeText("x\u202egnp.exe\u202c", 50), "xgnp.exe");
});

test("leaves ordinary text, accents and emoji alone", () => {
  assert.equal(sanitizeText("\u00c9tat-major \u65e5\u672c \ud83d\udc69\u200d\ud83d\udcbb <b>[x](y)</b>", 100), "\u00c9tat-major \u65e5\u672c \ud83d\udc69\u200d\ud83d\udcbb <b>[x](y)</b>");
});

test("caps length with a visible ellipsis, total length within the cap", () => {
  const out = sanitizeText("x".repeat(10000), CAPS.title);
  assert.equal(out.length, CAPS.title);
  assert.ok(out.endsWith("\u2026"));
  assert.equal(sanitizeText("x".repeat(200), 200), "x".repeat(200));
});

test("cap counts code points and never splits a surrogate pair", () => {
  const out = sanitizeText("\ud83d\ude00".repeat(50), 10);
  assert.equal(Array.from(out).length, 10);
  assert.ok(out.endsWith("\u2026"));
  assert.doesNotMatch(out, /[\ud800-\udfff]/u);
});

test("lone surrogates become U+FFFD", () => {
  assert.equal(sanitizeText("a\ud800b\udc00c", 50), "a\ufffdb\ufffdc");
});

test("stripping happens before the cap", () => {
  assert.equal(sanitizeText("\u202e".repeat(500) + "ok", 10), "ok");
});

test("tiny caps still obey the cap", () => {
  assert.equal(sanitizeText("abc", 1), "\u2026");
  assert.equal(sanitizeText("abc", 0), "");
});

test("property: never throws, never emits forbidden characters, respects the cap", () => {
  let seed = 0x2545f491;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const pools = [0x1f, 0x9f, 0x2fff, 0xd7ff, 0xdfff, 0xffff, 0x10ffff];
  for (let i = 0; i < 2000; i++) {
    const n = Math.floor(rnd() * 120);
    let s = "";
    for (let j = 0; j < n; j++) {
      const max = pools[Math.floor(rnd() * pools.length)];
      const cp = Math.floor(rnd() * (max + 1));
      s += cp >= 0xd800 && cp <= 0xdfff ? String.fromCharCode(cp) : String.fromCodePoint(cp);
    }
    for (const allowNewline of [false, true]) {
      const cap = 1 + Math.floor(rnd() * 60);
      const out = sanitizeText(s, cap, { allowNewline });
      assert.ok(Array.from(out).length <= cap);
      assert.doesNotMatch(allowNewline ? out.replaceAll("\n", "") : out, FORBIDDEN);
    }
  }
  assert.doesNotMatch("ok", CONTROL);
});
