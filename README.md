# paseo-etat-major

Paseo plugin (SDK 0.17.4, Paseo `>=0.17.4 <0.18.0`) that will show an État-major planning view. This is the skeleton:
a sidebar row "État-major" opening a "Not configured yet" screen. The server half has host-scoped settings and
three RPCs (below). Raw TypeScript, no bundling.

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
