# Adapting a system to Play on Mobile

The companion sheet doesn't have Vagabond's layout hardcoded. It's built from a per-system **descriptor**: a JSON file that says what to show and how to trigger the system's own rolls, plus (optionally) a tiny JavaScript file for the handful of things JSON can't express.

If you just want the formal shape, see [descriptor.schema.json](descriptor.schema.json). This doc is the walkthrough. The full design rationale — precedence order, why the format is JSON-plus-escape-hatch rather than pure JSON, dialog handling — lives in [system-adapters-plan.md](system-adapters-plan.md) if you want the deeper why.

## How a descriptor gets picked up

The module looks for a descriptor in this order, first match wins:

1. **World setting override** — pasted by a GM into **Configure Settings → Play on Mobile → System Descriptor Override**. Scoped to whichever `system` it declares, so it only applies in a world actually running that system.
2. **`api.registerSystem(descriptor)`** — called by another module or by the system itself, from its own `init` or `setup` hook:
   ```js
   Hooks.once("init", () => {
     game.modules.get("play-on-mobile").api.registerSystem(myDescriptor);
   });
   ```
3. **Shipped descriptors** — bundled in this module's `systems/*.json` (currently just Vagabond).
4. **Generic fallback** — no descriptor found. Flattened `actor.system` fields, read-only, plus a raw-formula roll box.

If you're building for your own table, the world setting override is the fastest way to iterate — paste JSON, hit Validate, hit Save, reload. If you maintain a system or a module and want it to ship with proper support out of the box, use `registerSystem()`.

## The shape of a descriptor

```json
{
  "formatVersion": 1,
  "system": "dnd5e",
  "label": "D&D Fifth Edition",
  "invokeModule": "modules/my-module/adapters/dnd5e.mjs",

  "header": {
    "subtitle": ["@system.details.level", "@items.race.name", "@items.class.name"]
  },

  "sections": []
}
```

- `system` — must match `game.system.id` exactly.
- `invokeModule` — optional path to a JS module exporting custom predicates/invokes/snapshot functions (see below). Omit it if everything is expressible in plain JSON.
- `header.subtitle` — small text under the actor's name. Each entry is either a bare expression, or `{ "label": "Level", "value": "@snap.level" }` when you need a literal prefix on a derived number.
- `sections` — the actual sheet content, in order. This is most of the file.

## Expressions

Descriptors read data with a small `@`-prefixed expression language — deliberately not a real language. No conditionals, no `eval`. Anything that needs a conditional belongs in `invokeModule` instead.

| Form | Meaning |
|---|---|
| `@system.foo.bar` | `actor.system.foo.bar` |
| `@snap.foo.bar` | A path on the descriptor's `snapshot` (see below) instead of raw `actor.system` |
| `@items.<type>` | The actor's first embedded item of that type |
| `@items.<type>.foo` | A path read off that item |
| `@itemsOfType.<type>` | *Every* embedded item of that type, as an array |
| `@item.foo` | A path on the current item, inside `item-list` |
| `@.foo` | The current entry, relative, inside a `source` iteration |
| `@` | The current entry itself |
| anything without `@` | A literal string, unchanged |
| `{key}` | Inside an `invoke`, templated to the current iteration key |

## Filtering with `where`

```json
{ "type": ["weapon", "equipment"], "system.equipped": false, "level": { "lte": "@snap.level" } }
```

Every key is AND'ed together. A bare value means equality; a bare array means "one of". Comparators: `eq ne lt lte gt gte in nin`. A comparator's expected value can itself be an expression (`"@snap.level"`), resolved live against the current actor. `"custom": "someName"` calls a predicate function of that name exported from `invokeModule`.

## Labels

Every system stores labels differently — a plain string in `CONFIG`, an object with a `label` or `name` field, or something needing localization. One field handles all three:

```json
{ "config": "DND5E.skills", "field": "label", "localize": true }
```

Resolution: look up `CONFIG[config][key]` → if it's a string, use it as-is → if it's an object, take `field` (falls back to `label`, then `name`) → localize the result if `localize: true`.

## Sections and renderers

Every section needs a unique `id` and a `render` type. There are six renderers, covering everything the Vagabond sheet needs:

**`resources`** — value/max pairs with tap-to-increment/decrement steppers (HP, Fatigue, a resource pool). `value` is a *read* expression; `write` is the actual settable path used by the steppers — don't conflate the two, it's the easiest mistake to make here.

```json
{
  "id": "vitals",
  "render": "resources",
  "entries": [
    { "key": "hp", "label": "HP", "value": "@system.attributes.hp.value", "max": "@system.attributes.hp.max", "write": "system.attributes.hp.value", "min": 0, "editable": true },
    { "key": "speed", "label": "Speed", "value": "@system.attributes.movement.walk" }
  ]
}
```

Add `"when": "@snap.mana"` on an entry to make it vanish entirely for actors that don't have that pool at all — distinct from a value of `0`.

**`stat-row`** — a row of abbreviation/value chips (ability scores).

```json
{ "id": "abilities", "render": "stat-row", "source": "@system.abilities", "value": "@.value", "abbr": { "config": "DND5E.abilities", "field": "abbreviation" } }
```

**`check-grid`** — label/value entries that roll on tap (skills, saves).

```json
{
  "id": "skills",
  "label": "Skills",
  "render": "check-grid",
  "source": "@system.skills",
  "value": "@.total",
  "labelFrom": { "config": "DND5E.skills", "field": "label" },
  "invoke": { "kind": "actorMethod", "path": "rollSkill", "args": [{ "skill": "{key}" }] }
}
```

**`item-list`** — image/name/quantity rows over `actor.items`, filtered by `where`; tap invokes, long-press opens an action accordion.

```json
{
  "id": "inventory",
  "label": "Inventory",
  "render": "item-list",
  "collapsible": true,
  "where": { "type": ["weapon", "equipment", "consumable"], "system.equipped": false },
  "qty": "@item.system.quantity",
  "description": "@item.system.description.value",
  "invoke": { "kind": "itemMethod", "path": "use" },
  "actions": ["use", "toChat", { "action": "toggle", "label": "Equip", "path": "system.equipped" }, "edit", "delete"]
}
```

**`entry-list`** — name + description accordion over an embedded array that isn't a full item document (class features, traits).

```json
{ "id": "features", "label": "Features", "render": "entry-list", "icon": "@items.class.img", "source": "@items.class.system.levelFeatures", "name": "@.name", "description": "@.description", "where": { "level": { "lte": "@system.level" } } }
```

**`fields`** — a read-only key/value dump. This is what the generic fallback uses; useful as a stopgap section for data you haven't mapped yet.

Common to every section: `label` (heading text, omit for none), `collapsible`/`defaultOpen`, `icon` (an expression resolving to an image path shown beside the heading), `badge` (`{label, value, max, when}` — a small "3/5" counter next to the heading), `revealWith: "header"` (only shown once the actor-name accordion is open), and `hideIfEmpty` (defaults to `true`).

## Item actions

The icon row on an expanded item-list entry:

| Form | Behavior |
|---|---|
| `"use"` | Runs the section's own `invoke` |
| `"toChat"` | Posts the item's name as a chat message |
| `"edit"` | Opens the item's own sheet |
| `"delete"` | Deletes the item, behind a confirm dialog |
| `{ "action": "toggle", "path": "system.equipped", "label": "Equip" }` | Flips a boolean, label swaps between `label`/`offLabel` |
| `{ "action": "invoke", "invoke": {...} }` | Runs an arbitrary invoke |
| `{ "custom": "itemActions" }` | Whole action list built by a function in `invokeModule` — use this when the rule has real branching |

## Invokes — how a tap actually does something

This is the part that matters most: instead of reimplementing a system's dice math as JSON, an invoke calls the system's *own* method, so the resulting chat card looks exactly like the one the real desktop sheet would have produced.

```json
{ "kind": "actorMethod", "path": "rollSkill", "args": [{ "skill": "{key}" }] }
{ "kind": "itemMethod",  "path": "use" }
{ "kind": "propMethod",  "path": "skills.{key}", "call": "roll" }
{ "kind": "formula",     "formula": "1d20 + @skills.{key}.mod", "flavor": "Strength check" }
{ "kind": "update",      "target": "item", "set": { "system.equipped": true } }
{ "kind": "sheetClick",  "selector": "[data-action='roll'][data-key='{key}']" }
{ "kind": "custom",      "fn": "rollWeapon" }
```

- `actorMethod` / `itemMethod` — call a method on the actor or item document directly. Covers a huge fraction of systems (`item.use()` alone handles most 5e-likes).
- `propMethod` — call a method on something nested off the actor (`actor.skills.strength.roll()`).
- `formula` — evaluate a raw Roll formula. Use only when there's genuinely no system method to call — the resulting card won't match the system's own styling.
- `update` — a plain document update.
- `sheetClick` — renders the system's real sheet off-screen and clicks a button on it, then closes it. Universal but fragile: it breaks the moment that system changes its markup. Documented as a last resort for systems with no scriptable API at all.
- `custom` — calls a named function from `invokeModule`. The escape hatch for anything genuinely irregular.

Every invoke also accepts `event: { shiftKey, ctrlKey, altKey }` (to fast-forward a roll dialog, for example) and `options: {}` (passed through to the underlying call).

## `invokeModule` — the code escape hatch

Most of a descriptor is JSON, but real systems have at least a few things that need actual logic: a filter that depends on more than a flat field comparison, an action list with real branching, or a derived-data read that a system already computes for its own sheet. `invokeModule` is a plain ES module, imported once and cached, exporting whatever named functions your descriptor's `"custom"` references point at:

```js
// modules/my-module/adapters/dnd5e.mjs
export function isWeaponSkill(entry, ctx) { /* ... */ }
export function itemActions(item, itemCtx) { /* ... */ }
export function rollWeapon({ actor, item, event }) { /* ... */ }
export function readSnapshot(actor) { /* ... */ }
```

- A `where.custom` name resolves to a predicate: `(subject, ctx) => boolean`.
- An `actions[].custom` name resolves to a function returning an array of `{icon, label, onSelect}` rows.
- An `invoke.kind: "custom"` `fn` name resolves to `(ctx) => any`, called with the resolved actor/item/entry/event context.
- The descriptor's top-level `"snapshot": { "custom": "readSnapshot" }` field names a function run once per render, given the actor, whose return value is exposed to every expression as `@snap.*`. Use this when the system already has its own derived-data read (unwrapping/renaming fields in ways a plain `@system.foo` path can't express) — delegate to it rather than re-deriving that logic as JSON.

## Validating

Before saving a descriptor into the world override or shipping it via `registerSystem()`, validate it:

```
node tools/validate-descriptor.mjs path/to/my-descriptor.json
```

The same check runs behind the Validate button in the in-Foundry System Descriptor Override editor, and eagerly the moment `registerSystem()` is called — a bad descriptor fails loudly for whoever registers it, not silently for the first player who opens the companion panel.

## Worked reference

The shipped Vagabond descriptor ([systems/vagabond.json](../systems/vagabond.json)) and its invoke module ([scripts/adapters/invokes/vagabond.mjs](../scripts/adapters/invokes/vagabond.mjs)) are a complete, real-world example — resources with `when`-gated pools, `check-grid` skills split into weapon/non-weapon groups via a custom predicate, item actions with real branching, and a `snapshot` delegating to the system's own derived-data read. Reading those two files alongside this guide is the fastest way to see the full format in context.
