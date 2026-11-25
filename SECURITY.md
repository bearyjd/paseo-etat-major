# Security

- Paseo plugins run unsandboxed inside the Paseo daemon, with the daemon's privileges. Review the code before installing.
- The planned `executable` setting is an execution pointer: whatever path it names will be run by the daemon. Only point it at a binary you trust and that only you can write to. The plugin validates it, but validation is not a sandbox.
- Pin a release tag when installing from git (`git:OWNER/REPO#vX.Y.Z`) rather than tracking a branch.
- This plugin makes no network calls, reads no agent credentials or config, and starts no agent work. A test enforces this on the source.

Report problems privately to the repository owner via GitHub security advisories.
