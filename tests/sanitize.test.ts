import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPS, sanitizeText } from "../shared/sanitize.ts";
import { INDEPENDENT_FORBIDDEN, STRIPPED_EXAMPLES } from "./forbidden.ts";

const ch = (...cps: number[]): string => String.fromCodePoint(...cps);
const range = (a: number, b: number): string[] => Array.from({ length: b - a + 1 }, (_, i) => ch(a + i));

test("caps are 200 / 2000 / 256", () => {
  assert.deepEqual({ ...CAPS }, { title: 200, prose: 2000, ref: 256 });
});

test("strips every C0 and C1 control, newline included by default", () => {
  for (let c = 0; c <= 0x9f; c++) {
    if (c > 0x1f && c < 0x7f) continue;
    assert.equal(sanitizeText(`a${ch(c)}b`, 50), "ab", `U+${c.toString(16)}`);
  }
});

test("keeps only newline when allowNewline is set", () => {
  assert.equal(sanitizeText("a\nb\r\nc\td", 50, { allowNewline: true }), "a\nb\ncd");
  assert.equal(sanitizeText("a\nb", 50), "ab");
});

test("strips every bidi, format, invisible and tag class", () => {
  for (const [name, c] of STRIPPED_EXAMPLES) assert.equal(sanitizeText(`a${c}b`, 50), "ab", name);
  for (const c of [...range(0x200b, 0x200f), ...range(0x202a, 0x202e), ...range(0x2060, 0x206f), ...range(0xfe00, 0xfe0f), ...range(0xfff9, 0xfffc)])
    assert.equal(sanitizeText(`a${c}b`, 50), "ab", c.codePointAt(0)!.toString(16));
  assert.equal(sanitizeText(`x${ch(0x202e)}gnp.exe${ch(0x202c)}`, 50), "xgnp.exe");
  assert.equal(sanitizeText(`a${ch(0xe0041, 0xe007f, 0xe0100, 0xe01ef)}b`, 50), "ab");
});

test("ZWJ is stripped: titles are plain text, so ZWJ emoji sequences fall apart by design", () => {
  const family = ch(0x1f469, 0x200d, 0x1f4bb);
  assert.equal(sanitizeText(family, 50), ch(0x1f469, 0x1f4bb));
});

test("leaves ordinary text, accents, CJK and plain emoji alone", () => {
  const s = `${ch(0xc9)}tat-major ${ch(0x65e5, 0x672c)} ${ch(0x1f600)} <b>[x](y)</b>`;
  assert.equal(sanitizeText(s, 100), s);
});

test("caps combining-mark runs at 3", () => {
  const mark = ch(0x301);
  assert.equal(sanitizeText(`e${mark.repeat(10)}x`, 50), `e${mark.repeat(3)}x`);
  assert.equal(sanitizeText(`e${mark.repeat(2)}x${mark.repeat(3)}`, 50), `e${mark.repeat(2)}x${mark.repeat(3)}`);
});

test("collapses 3+ newlines to 2 in prose, after stripping", () => {
  assert.equal(sanitizeText("a\n\n\n\n\nb\n\nc", 50, { allowNewline: true }), "a\n\nb\n\nc");
  assert.equal(sanitizeText(`a\n${ch(0x200b)}\n\n\nb`, 50, { allowNewline: true }), "a\n\nb");
});

test("coerces non-strings safely", () => {
  for (const v of [undefined, null, {}, [], { toString: () => "x" }, () => 1, Symbol("s"), 5, true, 10n])
    assert.equal(sanitizeText(v, 50), "", String(typeof v));
});

test("cap: NaN, negative and infinite fall back to the default cap; 0 yields empty", () => {
  for (const cap of [Number.NaN, -1, -Infinity, Infinity, undefined as unknown as number]) {
    const out = sanitizeText("x".repeat(10000), cap);
    assert.equal(out.length, CAPS.title, String(cap));
    assert.ok(out.endsWith(ch(0x2026)));
  }
  assert.equal(sanitizeText("abc", 0), "");
});

test("caps length with a visible ellipsis, total length within the cap", () => {
  const out = sanitizeText("x".repeat(10000), CAPS.title);
  assert.equal(out.length, CAPS.title);
  assert.ok(out.endsWith(ch(0x2026)));
  assert.equal(sanitizeText("x".repeat(200), 200), "x".repeat(200));
  assert.equal(sanitizeText("abc", 1), ch(0x2026));
});

test("cap counts code points and never splits a surrogate pair", () => {
  const out = sanitizeText(ch(0x1f600).repeat(50), 10);
  assert.equal(Array.from(out).length, 10);
  assert.ok(out.endsWith(ch(0x2026)));
  assert.doesNotMatch(out, /\p{Cs}/u);
});

test("lone surrogates become U+FFFD", () => {
  const lone = String.fromCharCode(0xd800);
  const loneLow = String.fromCharCode(0xdc00);
  assert.equal(sanitizeText(`a${lone}b${loneLow}c`, 50), `a${ch(0xfffd)}b${ch(0xfffd)}c`);
});

test("stripping happens before the cap", () => {
  assert.equal(sanitizeText(ch(0x202e).repeat(500) + "ok", 10), "ok");
});

test("property: never throws, never emits forbidden characters, respects the cap", () => {
  let seed = 0x2545f491;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const pools = [0x1f, 0x9f, 0x2fff, 0xd7ff, 0xdfff, 0xffff, 0x10ffff];
  const specials = STRIPPED_EXAMPLES.map(([, c]) => c).concat([ch(0x301), ch(0x301), "\n", "\n"]);
  for (let i = 0; i < 3000; i++) {
    const n = Math.floor(rnd() * 120);
    let s = "";
    for (let j = 0; j < n; j++) {
      if (rnd() < 0.25) {
        s += specials[Math.floor(rnd() * specials.length)];
        continue;
      }
      const max = pools[Math.floor(rnd() * pools.length)];
      const cp = Math.floor(rnd() * (max + 1));
      s += cp >= 0xd800 && cp <= 0xdfff ? String.fromCharCode(cp) : String.fromCodePoint(cp);
    }
    for (const allowNewline of [false, true]) {
      const cap = 1 + Math.floor(rnd() * 60);
      const out = sanitizeText(s, cap, { allowNewline });
      assert.ok(Array.from(out).length <= cap);
      assert.doesNotMatch(allowNewline ? out.replaceAll("\n", "") : out, INDEPENDENT_FORBIDDEN);
      assert.doesNotMatch(out, /\p{M}{4}/u);
      assert.doesNotMatch(out, /\n{3}/);
    }
  }
});
