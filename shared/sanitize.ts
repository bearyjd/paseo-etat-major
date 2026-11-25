// Pure string cleaning for untrusted payload text. Never throws.
// Rendering as plain text is the real defence; this removes characters that can
// reorder, hide or stack text and bounds the length. Titles are plain text, so ZWJ is
// stripped too (ZWJ emoji sequences fall apart into their parts by design).

export const CAPS = { title: 200, prose: 2000, ref: 256 } as const;

const DEFAULT_CAP = CAPS.title;
const MAX_COMBINING_RUN = 3;
const ELLIPSIS = String.fromCharCode(0x2026);
const REPLACEMENT = String.fromCharCode(0xfffd);
const COMBINING = /^\p{M}$/u;
const INVISIBLE_CATEGORY = /^[\p{Cf}\p{Cc}\p{Zl}\p{Zp}]$/u; // catches format characters the list below misses

export interface SanitizeOptions {
  readonly allowNewline?: boolean;
}

function isStripped(cp: number): boolean {
  return (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) || // DEL and C1 controls
    cp === 0xad || // soft hyphen
    cp === 0x34f || // combining grapheme joiner
    cp === 0x61c || // Arabic letter mark
    cp === 0x115f || cp === 0x3164 || // Hangul fillers
    cp === 0x180e || // Mongolian vowel separator
    (cp >= 0x200b && cp <= 0x200f) || // zero-width, ZWNJ, ZWJ, LRM, RLM
    cp === 0x2028 || cp === 0x2029 ||
    (cp >= 0x202a && cp <= 0x202e) || // bidi embeddings and overrides
    (cp >= 0x2060 && cp <= 0x206f) || // word joiner, invisible operators, isolates, deprecated formats
    (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors
    cp === 0xfeff ||
    (cp >= 0xfff9 && cp <= 0xfffc) || // interlinear annotation, object replacement
    cp === 0xfffe || cp === 0xffff ||
    (cp >= 0xe0000 && cp <= 0xe007f) || // tag characters
    (cp >= 0xe0100 && cp <= 0xe01ef) // variation selectors supplement
  );
}

export function sanitizeText(input: unknown, maxLength: number, options: SanitizeOptions = {}): string {
  if (typeof input !== "string") return "";
  const keepNewline = options.allowNewline === true;
  const max = Number.isFinite(maxLength) && maxLength >= 0 ? Math.floor(maxLength) : DEFAULT_CAP;
  const kept: string[] = [];
  let marks = 0;
  let newlines = 0;
  for (const ch of input) {
    const cp = ch.codePointAt(0) ?? 0;
    let out: string;
    if (cp >= 0xd800 && cp <= 0xdfff) out = REPLACEMENT; // lone surrogate
    else if (cp === 0x09 || cp === 0x85 || cp === 0x2028 || cp === 0x2029) out = " "; // whitespace-like: one space, not deletion
    else if (cp === 0x0a && keepNewline) out = ch;
    else if (isStripped(cp) || INVISIBLE_CATEGORY.test(ch)) continue;
    else out = ch;
    newlines = out === "\n" ? newlines + 1 : 0;
    if (newlines > 2) continue;
    marks = COMBINING.test(out) ? marks + 1 : 0;
    if (marks > MAX_COMBINING_RUN) continue;
    kept.push(out);
  }
  if (kept.length <= max) return kept.join("");
  if (max === 0) return "";
  return kept.slice(0, max - 1).join("") + ELLIPSIS;
}
