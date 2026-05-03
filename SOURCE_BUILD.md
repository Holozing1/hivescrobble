# Hive Scrobbler — Build from source (for AMO reviewers)

This document explains how to reproduce the bundle in `hive-scrobbler-firefox.zip` from the matching `hive-scrobbler-src.zip` source archive.

The submission is built from a clean checkout of the source archive — there is no obfuscation, only standard minification by Vite/esbuild.

## Environment

- **Node.js**: v18 or newer (CI uses the version pinned in `.nvmrc`)
- **npm**: bundled with Node
- **OS**: Linux, macOS, or Windows. Tested most recently on Windows 11.
- **Network**: required for `npm ci` (dependency install)

## Reproduce the build

```bash
unzip hive-scrobbler-src.zip -d hive-scrobbler-src
cd hive-scrobbler-src
npm ci
npm run dist:firefox
```

The output is written to:

- `build/firefox/` — the unpacked extension (matches the contents of the submitted `.zip`)
- `hive-scrobbler-firefox.zip` — the submitted bundle, byte-identical except for zip-archive timestamps
- `hive-scrobbler-src.zip` — the source archive (re-creates this submission)

## What the build does

1. `tsx build.ts dist firefox` invokes Vite three times in parallel:
   - **Background** (`vite.configs.ts → buildBackground`) — bundles `src/core/background/main.ts`
   - **Content scripts** (`buildContent`) — bundles `src/core/content/main.ts` and the connector files in `src/connectors/*.ts`
   - **Popup + options UI** (`buildStart`) — bundles the Solid.js UI under `src/ui/`
2. `make-manifest.ts` writes the Firefox manifest from `manifest.config.ts → firefoxManifest`
3. `create-distributable.ts` zips `build/firefox/` into `hive-scrobbler-firefox.zip` and `git archive HEAD` into `hive-scrobbler-src.zip`

No code generation, no transformations beyond standard TS → JS, JSX → JS, and SCSS → CSS via Vite's built-in pipeline. esbuild minification is enabled by Vite's default production settings; no obfuscation tools are used.

## Linting

```bash
npm run lint:firefox
```

Runs `web-ext lint` against `build/firefox/`. Current build reports **0 errors, 7 warnings**. The warnings are all `UNSAFE_VAR_ASSIGNMENT` from Solid.js's compiled output (innerHTML for the popup/options UI templates and dynamic `import()` for code splitting). No external content is ever assigned to these — they are reactive bindings produced by the Solid compiler.

## Source layout (in `hive-scrobbler-src.zip`)

- `src/core/background/` — service-worker / event-page background script (Hive broadcaster, scrobble cache)
- `src/core/content/` — content scripts injected per-tab (`controller.ts` orchestrates a connector, `hive-relay.js` is the MAIN-world bridge to Hive Keychain)
- `src/core/scrobbler/hive/` — `hive-scrobbler.ts` builds and signs `custom_json` operations
- `src/connectors/` — per-site DOM scrapers (one file per supported music/video service)
- `src/ui/popup/`, `src/ui/options/` — Solid.js UIs
- `manifest.config.ts` — single source of truth for the manifest (Chrome / Firefox / Safari variants)

## Hive Keychain dependency

For broadcast-time signing, the user must also install [Hive Keychain for Firefox](https://addons.mozilla.org/firefox/addon/hive-keychain/). Hive Scrobbler **never sees the user's private keys** — it injects a tiny relay (`src/core/content/hive-relay.js`) into the active tab's MAIN world, calls `window.hive_keychain.requestCustomJson(...)`, and receives only a success/failure boolean. Keys never leave Hive Keychain's own context.

## Upstream

This is a fork of [Web Scrobbler](https://github.com/web-scrobbler/web-scrobbler) (MIT). The Hive-specific additions are confined to:

- `src/core/scrobbler/hive/` (new)
- `src/core/content/hive-relay.js` (new)
- The `Hive` scrobbler entry in `src/core/scrobbler/scrobbler-manager.ts`
- Manifest rebrand in `manifest.config.ts`

Everything else — connectors, UI shell, scrobble pipeline, controller — is upstream.
