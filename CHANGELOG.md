# Changelog

## Unreleased

- Optional `prs` setting: the absolute path of a pull request JSON file recorded by hand, validated on every export and
  passed to the exporter as `--prs`, so the In progress and Review lanes can populate. Nothing is fetched.
- New error code `INPUT_INVALID` for a missing, unreadable, non-regular or oversized file.
- No releases setting: without `--repo`, which the plugin never passes, `--releases` adds no evidence.

## 0.1.0

First release. Read-only État-major planning view for Paseo (SDK 0.17.4, Paseo `>=0.17.4 <0.18.0`).

- Sidebar row and a mobile-first Planning screen: issues banner, stale banner, task lanes with counts, evidence detail,
  features and sources.
- Screen, settings page messages and sidebar summary take their colors from the host theme.
- Host-scoped settings (`executable`, `workspace`, `project`) and three RPCs: `etat-major.planning.get`,
  `etat-major.planning.refresh`, `etat-major.status.get`.
- Runner for the pinned `etat-major` executable: validated path, scrubbed environment, no shell, timeouts, process-group
  cleanup, one export at a time, in-memory cache, rate-limited refresh.
- Zod schema for the `etat-major/planning@1` export; all payload text sanitized and rendered as plain text.
- Fixed error codes with one sentence and hint each.
- Tests include a static guard: no network, no agent hooks, `child_process` only in `server/runner.ts`.
- Not included: tag, GitHub release, live-host acceptance (see README "Unproven").
