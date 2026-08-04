# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Foundry VTT v14 module. Turns a player's phone into a companion device: a stripped-down, tap-friendly actor sheet docked beside a live, touch-pannable canvas. Not a general-purpose mobile UI for Foundry — deliberately narrow scope (see README.md "What it actually does").

No build step. `esmodules`/`styles` in [module.json](module.json) point straight at source under `scripts/`/`styles/`. CSS is auto-built by the environment — never try to compile or re-read it to check output.

## Commands

- `npm test` — runs `node --test tests/*.test.mjs` (plain Node test runner, no Foundry runtime needed — see "Testable core" below).
- `node tools/validate-manifest.mjs` — sanity-checks `module.json` (required fields, id-matches-folder, referenced file paths exist on disk).
- `node tools/validate-descriptor.mjs path/to/descriptor.json` — validates a system descriptor JSON file against the schema; same check runs live in the in-Foundry System Descriptor Override editor and eagerly on `registerSystem()`.
- Run a single test file: `node --test tests/resolve.test.mjs`.
- Release is automated: pushing a `module.json` version bump to `main` triggers [.github/workflows/release.yml](.github/workflows/release.yml), which zips `module.json scripts styles templates lang static systems service-worker.js` and cuts a GitHub release. No manual release steps.
- Live-testing the actual UI (not just unit tests) is done by driving a real running Foundry instance via Playwright — see memory `reference_foundry-live-testing-technique` for login/port/ApplicationV2 specifics. Prefer this over claiming a render-pipeline change works from unit tests alone.

## Architecture

### Entry point and lifecycle

[scripts/play-on-mobile.mjs](scripts/play-on-mobile.mjs) is the only file `module.json` loads. On `init` it registers settings, registers GM menus (Device Control, Descriptor Override, Settings Preset, Refresh), exposes `game.modules.get("play-on-mobile").api = { registerSystem, getDescriptor }`, and loads templates via `foundry.applications.handlebars.loadTemplates()` (namespaced API, not the deprecated global). On `ready` it activates the companion (`CompanionController.maybeActivate()`), which requires `game.system.id` / system globals to exist — hence `ready`, not `init`.

### The descriptor system (the core architectural idea)

The companion sheet has no hardcoded layout. It's driven by a per-system JSON **descriptor** describing what to show and how to invoke the system's own roll methods, resolved through this precedence chain (first match wins, see [scripts/adapters/adapter-registry.mjs](scripts/adapters/adapter-registry.mjs)):

1. World setting override (`systemDescriptorOverride`, GM-pasted JSON, scoped to the system it declares)
2. `api.registerSystem(descriptor)` — called by another module/system from its own `init`/`setup` hook, before `ready`
3. Shipped descriptors in `systems/*.json` (currently only `vagabond.json`)
4. `GenericAdapter` fallback — flattened `actor.system` fields, read-only, plus raw-formula rolling

Descriptors use a small `@`-prefixed expression language (`@system.foo`, `@snap.foo`, `@items.<type>`, `@item.foo`, `@.foo` — see [scripts/adapters/resolve.mjs](scripts/adapters/resolve.mjs)) — deliberately not a real language; anything needing a conditional goes in `invokeModule` (a companion `.mjs` escape hatch exporting named predicate/action/invoke/snapshot functions) instead of JSON.

Six section renderers cover every sheet layout need: `resources`, `stat-row`, `check-grid`, `item-list`, `entry-list`, `fields`. Taps drive real system behavior via **invokes** (`actorMethod`, `itemMethod`, `propMethod`, `formula`, `update`, `sheetClick`, `custom`) rather than reimplementing dice math — the resulting chat card matches what the system's own desktop sheet would have produced.

Full spec: [docs/adapting-a-system.md](docs/adapting-a-system.md) (walkthrough) and [docs/descriptor.schema.json](docs/descriptor.schema.json) (formal schema). Design rationale (precedence order, why JSON-plus-escape-hatch, dialog handling): [docs/system-adapters-plan.md](docs/system-adapters-plan.md). Worked reference implementation: [systems/vagabond.json](systems/vagabond.json) + [scripts/adapters/invokes/vagabond.mjs](scripts/adapters/invokes/vagabond.mjs).

### Testable core vs. Foundry-dependent shell

`scripts/adapters/resolve.mjs` and `descriptor-engine.mjs` take `CONFIG`/i18n/actor through an explicit `ctx` object rather than reading Foundry globals directly — this is what makes them unit-testable with plain `node --test` outside a running Foundry instance ([tests/](tests/)). The same code path runs unchanged in production once `ctx.CONFIG` is the real Foundry global. Keep this separation when touching descriptor-resolution logic: don't reach for `game`/`CONFIG` globals inside `resolve.mjs`/`descriptor-engine.mjs`.

### Directory map

- `scripts/companion/` — the companion `ApplicationV2` sheet itself, activation controller, mobile-detection prompt.
- `scripts/adapters/` — descriptor engine, registry/precedence, generic fallback, validation, per-system invoke modules.
- `scripts/gestures/` — touch-to-desktop-equivalent input handling on the live canvas (tap/pan/pinch/long-press) and dialogs.
- `scripts/gm/` — GM-only tooling: remote device control (via socket), descriptor override editor, settings-preset editor/applier.
- `scripts/pwa/` — service worker registration, reconnect overlay, wake lock (installable-PWA behaviors).
- `systems/` — shipped descriptor JSON, one file per first-class-supported system.
- `templates/` — Handlebars templates for the companion sheet and the three GM ApplicationV2 apps.
- `docs/` — descriptor authoring guide, JSON schema, and the full system-adapters design doc.

## Conventions (from user's global instructions, applies here)

- Use `foundry.applications.handlebars.loadTemplates()`, not the deprecated global `loadTemplates()`.
- Scene control tools (`getSceneControlButtons`): click handler is `onChange`, not `onClick`, for both `toggle` and `button` tools.
- CSS builds automatically — don't compile it or re-read build output to verify changes.
- Player-facing strings say "Mobile Mode", never "Companion Mode" — internal identifiers/code keep "companion".
- Tab labels and section-label names in sheets are plain hardcoded text, never run through `localize()`.
