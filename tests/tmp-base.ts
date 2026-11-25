import { statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";

// Executable validation requires root-owned (or daemon-owned) ancestors. Some sandboxes own /tmp as a
// non-root user, so real-filesystem tests fall back to the home directory in that case.
export function trustedTmpBase(): string {
  const t = tmpdir();
  return statSync(t).uid === 0 ? t : homedir();
}
