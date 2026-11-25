# paseo-etat-major

Paseo plugin (SDK 0.17.4, Paseo `>=0.17.4 <0.18.0`) that shows a read-only État-major planning view: a sidebar row
"État-major" opens the Planning screen. The server half has host-scoped settings and three RPCs (below). Raw
TypeScript, no bundling.

## Planning screen
Mobile-first single column (`client/PlanningScreen.tsx`). Header: project, export age, etat-major version, and a
"Try again" button (the only refresh; disabled while an export runs; no polling). Below it, in order: an issues banner
(blocking first), a "possibly stale" banner when the export is older than 15 minutes by the local clock, then one task
lane at a time under tabs with a count each (Draft, Ready, In progress, Review, Done, Blocked, plus Unrecognised only
when the payload has a state this plugin does not know). Tapping a task shows its seven evidence fields; `unverified`
is a muted pill, never a percentage. Features and sources follow. Each error code has one fixed sentence and hint.
Settings (executable, workspace, project) open from the same screen (`initialPage=settings` param or the Settings
button). The sidebar row shows a task-count summary (with a spoken label) only after the screen has loaded data; it
never runs an export itself. The SDK's `SidebarRow` has no accessibility-label prop, so the label sits on the row's
trailing text.
All payload text goes through `shared/sanitize.ts` in `client/view-model.ts` (pure, unit tested) and is rendered as
plain `<Text>`: no Markdown, links or images. A test restricts `client/` to react, react-native, zod, the plugin SDK
and `shared/` files.

## Manual acceptance (maintainer, phone and web; record client and versions)
1. Install from a tag via `git:`; `paseo plugin ls` shows it running; no smoke plugin left.
2. Sidebar row visible (phone: open the sidebar first); tapping it opens Planning.
3. Unconfigured: a clear `NOT_CONFIGURED` hint. Bad exe path, `/bin/sh`, a writable copy: `EXE_INVALID`.
4. Configured: features, tasks, sources and evidence match `etat-major export planning --json` run by hand.
5. Refresh after editing a task file and `git pull`: the change shows after Try again; nothing refreshes without a tap.
6. Hostile workspace (from the fixtures): no styled text, no link, no reordered text, long title truncated.
7. Rename the venv: `EXE_INVALID`, then restore. Wrong workspace path: `WORKSPACE_INVALID`.
8. `ps` after a timeout test: no leftover `etat-major` child. Phone portrait is readable with no horizontal scroll.

## Settings and RPCs
Host-scoped settings, id `etat-major`, schema version 1 (`server/settings.ts`), all optional until set:
- `executable`: clean absolute path to the pinned `etat-major` executable.
- `workspace`: clean absolute path to the workspace directory.
- `project`: project id (`^[a-z0-9][a-z0-9-]{0,63}$`).
Relative paths, `..` segments and bad ids are rejected by the schema; rejection messages never echo the value.
Missing or invalid settings give `NOT_CONFIGURED` and nothing is spawned.

RPCs (`shared/contracts.ts`, wired in `server/plugin.ts`; the plugin registers settings and these three handlers only):
- `etat-major.planning.get`: returns the cached export with `exportedAt`; runs the exporter only when nothing is cached
  for the current settings. Failures are cached too, so a broken setup is not re-spawned on every screen open.
- `etat-major.planning.refresh`: the only call that re-runs the exporter over an existing cache entry.
- `etat-major.status.get`: `{version, configured, lastError}`, where `lastError` is the last export attempt's error code
  or null.
Results are `{ok:true, data, exportedAt, version}` or `{ok:false, code}` with one of the fixed codes in
`shared/errors.ts` (the UI maps one state per code). The cache is in memory only, keyed by the configured
(executable, workspace, project), and cleared by the plugin cleanup; an export that finishes after cleanup is dropped.
Runner logs carry a code and a redacted line, never a setting value.

## Development
    npm ci --ignore-scripts
    npm run typecheck
    npm test

## Unproven
PR1's explicit gate is a real `git:` install of this repo on a host, after which the sidebar row appears.
Until that happens the following are all unproven:

- The manifest `build` step `[["npm","ci","--omit=dev","--ignore-scripts"]]` has never run in a real git install.
- `--omit=dev` drops every devDependency, including `@getpaseo/plugin`, yet `shared/contracts.ts` imports
  `defineRpc` from it at runtime. The proven smoke plugin listed `@getpaseo/plugin` and `zod` both in
  devDependencies and was installed with a full `npm install`, so it only proves that a fully populated
  `node_modules` loads. Whether the host supplies `@getpaseo/plugin` itself (so devDependencies is fine) is
  unknown. If the install fails to resolve it, move `@getpaseo/plugin` to `dependencies` (still pinned 0.17.4).
  Here `@getpaseo/plugin` stays in devDependencies, matching the smoke plugin.
- The version is a constant in `shared/version.ts`, checked against `package.json` by a test (no JSON import).
- CI actions are referenced by tag, not by commit SHA (SHAs could not be verified offline).

## Layout
- `index.server.ts`, `index.client.tsx`: thin `contribute()` wiring, both return cleanup functions.
- `client/`: the Planning screen, settings page, pure `view-model.ts`, and the summary store behind the sidebar row.
- `shared/`: RPC contracts, the fixed error codes, the zod schema for the `etat-major/planning@1` export
  (`planning-schema.ts`; rejects other markers and `version` other than 1, strips unknown keys; an unrecognised task
  `state` is kept and mapped to `"unknown"` so the screen can show an Unrecognised lane)
  and `sanitize.ts` (pure stripping of controls, bidi, invisible, tag and variation characters; caps; coerces
  non-strings to an empty string).
- `fixtures/`: a synthetic workspace, exports recorded from the real exporter and a hand-crafted hostile payload;
  see `fixtures/README.md`.
- `tests/`: `node --test --experimental-strip-types`, including a static guard over all source files.

## Sanitization limits
`sanitize.ts` strips ZWNJ and ZWJ (U+200C, U+200D) and variation selectors. Persian, Urdu and Kurdish orthography
that needs ZWNJ, and ZWJ emoji sequences, therefore render degraded. That is acceptable for plain-text titles; revisit
if non-Latin projects appear.

See `SECURITY.md`. License: MIT.
