# paseo-etat-major

Paseo plugin (SDK 0.17.4, Paseo `>=0.17.4 <0.18.0`) that will show an État-major planning view. This is the skeleton:
a sidebar row "État-major" opening a "Not configured yet" screen, and one server RPC `status.get`
returning `{version, configured:false}`. Raw TypeScript, no bundling.

## Development
    npm ci --ignore-scripts
    npm run typecheck
    npm test

## Install-time dependency resolution (UNPROVEN)
`zod` is a runtime dependency, so `paseo-plugin.json` declares
`"build": [["npm","ci","--omit=dev","--ignore-scripts"]]`. This build step is UNPROVEN: it has not been
exercised by a real `git:` install. It is validated only once installed via git on the target host and the
sidebar row appears. Until then treat any `zod` resolution error at install time as the known risk.
`index.server.ts` also imports `package.json` (JSON import) for the version; that is likewise unproven under
the daemon's loader.

## Layout
- `index.server.ts`, `index.client.tsx`: thin `contribute()` wiring, both return cleanup functions.
- `shared/`: RPC contracts and the fixed error codes.
- `tests/`: `node --test --experimental-strip-types`, including a static guard over all source files.

See `SECURITY.md`. License: MIT.
