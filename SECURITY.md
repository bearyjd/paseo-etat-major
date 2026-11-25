# Security

- Paseo plugins run unsandboxed inside the Paseo daemon, with the daemon's privileges. Review the code before installing.
- The planned `executable` setting is an execution pointer: whatever path it names will be run by the daemon. Only point it at a binary you trust and that only you can write to. The plugin validates it, but validation is not a sandbox.
- Pin a release tag when installing from git (`git:OWNER/REPO#vX.Y.Z`) rather than tracking a branch.
- This plugin makes no network calls, reads no agent credentials or config, and starts no agent work. A test enforces this on the source.

## Accepted risks

- **Execution pointer.** The `executable` setting makes the daemon run that file as the daemon user. Any paired client that can edit plugin settings can therefore choose which program runs. The plugin validates it (absolute path, basename `etat-major`, regular file owned by the daemon user, no group/world-writable file or ancestor directory, not inside the workspace) and runs it with a scrubbed environment, but this reduces the risk and does not remove it. Treat settings access as code-execution access.
- **`setsid` escape.** The exporter runs in its own process group, which is killed on timeout and after every call. A descendant that calls `setsid` leaves the group and survives; this cannot be prevented without a sandbox.
- **BUSY cycling.** Only one export runs at a time, and a call for a different workspace or project while one runs gets `BUSY`. A paired client can keep alternating keys to starve others. This is accepted as a denial of service within the paired-client trust model.

Report problems privately to the repository owner via GitHub security advisories.
