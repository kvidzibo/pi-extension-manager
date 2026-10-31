# Pi Extension Manager

See which Pi extensions contribute context and inspect their content and estimated
tokens with `/pi-extensions`. A compact tool-definition table appears at startup.

[npm](https://www.npmjs.com/package/@kvidzibo/pi-extension-manager) ·
[GitHub](https://github.com/kvidzibo/pi-extension-manager) ·
[Pi package gallery](https://pi.dev/packages)

## Install

Requires Pi 1.4.0 or newer and Node 22.19 or newer.

Install from npm:

```sh
pi install npm:@kvidzibo/pi-extension-manager
```

Restart Pi to see the table, or `/reload` to load the command in an existing
session. The table prints once at interactive startup, not on `/new` or `/reload`.
Both views are interactive-only; print/JSON/RPC modes remain quiet.

## Inspect context

Run **`/pi-extensions`**, type to search by extension, tool, or source path, and
select a source to see its contributions. Select a contribution to inspect the
exposed text or JSON. Arrow keys scroll; Home/End jump within content. Escape
returns one level, preserving the search and selection. Page Up/Down page through
content in regular mode; Pi reserves them for the transcript in fullscreen.
Fullscreen also supports clicking list items and scrolling with the mouse.
Navigation follows Pi's configured keybindings.

- After a model request, the inspector shows the **last observed request** at this
  extension's `context_with_system` hook: declarations after loadout rewrites,
  instructions, tool calls/results, and conversation messages. Later hooks and
  provider conversion may still change that snapshot.
- Before a request is observed, it shows **registered definitions before loadout**,
  the current system prompt, and resolved branch messages, respecting compaction
  and context edits. Session starts, tree navigation and compaction reset the
  observed snapshot. Run another model turn to observe a fresh request.
- Tool content is grouped by its **current registered source/name**, not historical
  ownership. Nested tool results are visible only in the outer result's content.
- **Unattributed / shared context** contains the combined system instructions,
  custom messages and ordinary conversation. Pi exposes no reliable ownership for
  arbitrary prompt injections. Sources with tools or commands can be listed;
  instruction-only extensions without either may be absent. Absence or “none
  observed” does not mean zero context.

The inspector is read-only, adds no model-facing tools or messages, and changes no
configuration. Request snapshots stay in memory only; they are not saved by this
package. Content may be sensitive. Terminal controls are shown as escapes and
image data is omitted explicitly.

## What the numbers mean

All token counts are **estimates: serialized characters / 4**, rounded up per
contribution—not a model tokenizer, actual context usage, or billing. They count
exposed text/JSON, not provider framing. Image token costs are unavailable.
Known subtotals exclude unavailable costs and are **not complete per-extension
or request totals**. Repeated instruction/tool updates may be represented
differently by different providers.

The startup table is a historical snapshot of active extension tool definitions,
including registered prompt guidelines, before loadout rewrites. Core tools are
omitted. Catalog-only codemode costs are `n/a` because Pi does not expose its
inline catalog budget. The table shows up to eight sources and a known subtotal
plus the number of unknown sources; the inspector has no source cap.

The startup table is a native custom session entry, outside model context.

## Development

```sh
npm ci --ignore-scripts
npm test
npm pack --dry-run --ignore-scripts
pi -e ./index.ts
```

Tests cover attribution boundaries, estimates, safe content inspection, native
menu navigation/layout, and manifest loading through Pi's real extension loader.
Validate the running table and inspector against Pi's built-in menus in regular
and fullscreen modes, including search, drill-down/back, scrolling, narrow
terminals, resizing, and `/reload`.

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
