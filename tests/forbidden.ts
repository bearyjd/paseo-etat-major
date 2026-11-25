// Independent oracle for tests: Unicode general categories plus an explicit list of
// extra classes. Deliberately NOT derived from shared/sanitize.ts.

const cp = (n: number): string => String.fromCodePoint(n);

// [name, one example character]
export const STRIPPED_EXAMPLES: ReadonlyArray<readonly [string, string]> = [
  ["ALM U+061C", cp(0x61c)],
  ["soft hyphen U+00AD", cp(0xad)],
  ["CGJ U+034F", cp(0x34f)],
  ["Hangul filler U+115F", cp(0x115f)],
  ["Hangul filler U+3164", cp(0x3164)],
  ["Mongolian vowel sep U+180E", cp(0x180e)],
  ["ZWSP U+200B", cp(0x200b)],
  ["ZWNJ U+200C", cp(0x200c)],
  ["ZWJ U+200D", cp(0x200d)],
  ["LRM U+200E", cp(0x200e)],
  ["RLM U+200F", cp(0x200f)],
  ["LS U+2028", cp(0x2028)],
  ["PS U+2029", cp(0x2029)],
  ["LRE U+202A", cp(0x202a)],
  ["RLE U+202B", cp(0x202b)],
  ["PDF U+202C", cp(0x202c)],
  ["LRO U+202D", cp(0x202d)],
  ["RLO U+202E", cp(0x202e)],
  ["word joiner U+2060", cp(0x2060)],
  ["invisible times U+2062", cp(0x2062)],
  ["invisible plus U+2064", cp(0x2064)],
  ["LRI U+2066", cp(0x2066)],
  ["RLI U+2067", cp(0x2067)],
  ["FSI U+2068", cp(0x2068)],
  ["PDI U+2069", cp(0x2069)],
  ["inhibit swap U+206A", cp(0x206a)],
  ["nominal digit shapes U+206F", cp(0x206f)],
  ["variation selector U+FE00", cp(0xfe00)],
  ["variation selector U+FE0F", cp(0xfe0f)],
  ["BOM U+FEFF", cp(0xfeff)],
  ["interlinear anchor U+FFF9", cp(0xfff9)],
  ["interlinear terminator U+FFFB", cp(0xfffb)],
  ["object replacement U+FFFC", cp(0xfffc)],
  ["noncharacter U+FFFE", cp(0xfffe)],
  ["noncharacter U+FFFF", cp(0xffff)],
  ["tag space U+E0020", cp(0xe0020)],
  ["tag latin A U+E0041", cp(0xe0041)],
  ["cancel tag U+E007F", cp(0xe007f)],
  ["variation selector U+E0100", cp(0xe0100)],
  ["variation selector U+E01EF", cp(0xe01ef)],
];

const EXTRA = STRIPPED_EXAMPLES.map(([, c]) => c).join("");
export const INDEPENDENT_FORBIDDEN = new RegExp(
  `[\\p{Cf}\\p{Cc}\\p{Zl}\\p{Zp}\\p{Cs}\\u{E0000}-\\u{E007F}\\u{FE00}-\\u{FE0F}\\u{E0100}-\\u{E01EF}\\u{FFF9}-\\u{FFFC}\\u{FFFE}\\u{FFFF}\\u{34F}\\u{115F}\\u{3164}\\u{180E}\\u{AD}${EXTRA}]`,
  "u",
);
