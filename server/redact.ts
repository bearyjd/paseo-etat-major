export const STDERR_LINE_CAP = 200;

// First non-empty stderr line with absolute paths replaced and control characters removed,
// capped at STDERR_LINE_CAP characters. For logs only; never shown in the UI.
export function redactStderrLine(stderr: string): string {
  const first = stderr.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return first
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/(^|[\s'"(=:,;<])\/(?:[^\s'")<>,;:]|:(?=[^\s'")<>,;:]))*/g, "$1<path>")
    .trim()
    .slice(0, STDERR_LINE_CAP);
}
