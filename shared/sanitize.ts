// Pure string cleaning for untrusted payload text. Never throws on any string.
// Rendering as plain text is the real defence; this removes characters that can
// reorder or hide text and bounds the length.

export const CAPS = { title: 200, prose: 2000, ref: 256 } as const;

const ELLIPSIS = "\u2026";
const REPLACEMENT = "\ufffd";

export interface SanitizeOptions {
  readonly allowNewline?: boolean;
}

function isStripped(cp: number): boolean {
  return (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) || // DEL and C1 controls
    cp === 0x061c || // Arabic letter mark
    cp === 0x200e || cp === 0x200f ||
    cp === 0x2028 || cp === 0x2029 ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    cp === 0xfeff
  );
}

export function sanitizeText(input: string, maxLength: number, options: SanitizeOptions = {}): string {
  const keepNewline = options.allowNewline === true;
  const max = Math.max(0, Math.floor(maxLength));
  const kept: string[] = [];
  for (const ch of String(input)) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0xd800 && cp <= 0xdfff) kept.push(REPLACEMENT); // lone surrogate
    else if (cp === 0x0a && keepNewline) kept.push(ch);
    else if (!isStripped(cp)) kept.push(ch);
  }
  if (kept.length <= max) return kept.join("");
  if (max === 0) return "";
  return kept.slice(0, max - 1).join("") + ELLIPSIS;
}
