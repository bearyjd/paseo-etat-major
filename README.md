# paseo-etat-major

Paseo plugin (SDK 0.17.4, Paseo `>=0.17.4 <0.18.0`) that will show an État-major planning view. This is the skeleton:
a sidebar row "État-major" opening a "Not configured yet" screen, and one server RPC `status.get`
returning `{version, configured:false}`. Raw TypeScript, no bundling.

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
  (`planning-schema.ts`; rejects other markers, `version` other than 1 and unknown task states, strips unknown keys)
  and `sanitize.ts` (pure control and bidi stripping with length caps).
- `fixtures/`: a synthetic workspace, exports recorded from the real exporter and a hand-crafted hostile payload;
  see `fixtures/README.md`.
- `tests/`: `node --test --experimental-strip-types`, including a static guard over all source files.

See `SECURITY.md`. License: MIT.
