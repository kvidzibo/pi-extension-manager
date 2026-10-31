# Pi Extension Manager

Prints a startup table of extension tools and estimated tool-definition tokens.
V1 is display-only: no menus, settings, management actions, or model-facing tools.

[npm](https://www.npmjs.com/package/@kvidzibo/pi-extension-manager) ·
[GitHub](https://github.com/kvidzibo/pi-extension-manager) ·
[Pi package gallery](https://pi.dev/packages)

## Install

Requires Pi 1.4.0 or newer and Node 22.19 or newer.

Install from npm:

```sh
pi install npm:@kvidzibo/pi-extension-manager
```

Restart Pi after installing. The table prints once at interactive startup,
not on `/new`, `/reload`, or in print/JSON/RPC modes.

## What the numbers mean

- Groups currently active extension tools by their registered source.
- Estimates each original tool definition's serialized name, description, schema,
  and prompt guidelines at **four characters per token**, rounded up per tool.
- Hides inactive tools and core built-in tools. Built-in extensions such as
  codemode can appear. This package contributes no tools and does not list itself.
- Catalog-only codemode tools appear with `n/a`: the public API does not expose
  which fit its inline budget. A total containing unknown costs is also `n/a`.

These are **pre-loadout tool-definition estimates**, not actual model-context usage
or billing. Codemode and other loadout hooks can rewrite descriptions or hide
declarations. Arbitrary extension prompt injections, instruction-only extensions,
tool results, provider serialization, and later tool changes are not attributed.
An absent row does **not** prove an extension adds no instructions.

The table is stored as a native custom session entry, outside model context.
It makes no network requests, calls no models, and changes no configuration.

## Development

```sh
npm ci --ignore-scripts
npm test
npm pack --dry-run --ignore-scripts
pi -e ./index.ts
```

Tests include filtering/estimation/layout and loading the manifest through Pi's
real extension loader. Validate the running table in regular/fullscreen modes,
including narrow terminals and resizing.

## Publishing

Merges to `main` trigger `.github/workflows/publish.yml`. It runs the tests, then
publishes a new package version publicly with provenance using npm trusted
publishing (OIDC). Already-published versions are skipped; registry/auth failures
stop the job. Bump `package.json` and the lockfile together for each new release.

### One-time setup

The package must exist on npm before a trusted publisher can be configured:

1. From an authenticated checkout, run `npm ci --ignore-scripts` and
   `npm publish --access public` once to create the package.
2. In npm package settings → **Trusted publishing**, add GitHub Actions:
   - Organization/user: `kvidzibo`
   - Repository: `pi-extension-manager`
   - Workflow filename: `publish.yml`
   - Allow direct `npm publish`; leave environment unset.
3. Merge a version bump to `main` to validate the trust relationship within npm's
   two-day window. Later new-version merges publish without an npm token.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).
The `pi-package` keyword enables Pi gallery discovery after npm publication;
no separate Pi registry upload is required.
