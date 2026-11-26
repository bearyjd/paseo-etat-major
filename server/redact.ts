export const STDERR_LINE_CAP = 200;

// Start of a path-like token: absolute, ~/, ./ or ../, a drive letter, or a UNC share.
const START = String.raw`(?:[A-Za-z]:[\\/]|\\\\|~\/|\.{1,2}\/|\/)`;
const BOUNDARY = String.raw`[\s'"(\[{=:,;<@]`;
const TOKEN_CHAR = String.raw`[^\s'")\]}<>,;:]`;
const QUOTED = /(["'])((?:(?!\1).)*)\1/g;
const HAS_PATH = new RegExp(`(?:^|${BOUNDARY})${START}`);
const PATH = new RegExp(`(^|${BOUNDARY})${START}(?:${TOKEN_CHAR}|:(?=${TOKEN_CHAR}))*`, "g");

// First non-empty stderr line with paths replaced and control characters removed, capped at
// STDERR_LINE_CAP characters. A quoted span that contains a path is replaced whole, so paths with
// spaces cannot leak their tail. For logs only; never shown in the UI.
export function redactStderrLine(stderr: string): string {
  const first = stderr.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return first
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(QUOTED, (m, q: string, inner: string) => (HAS_PATH.test(inner) ? `${q}<path>${q}` : m))
    .replace(PATH, "$1<path>")
    .trim()
    .slice(0, STDERR_LINE_CAP);
}
