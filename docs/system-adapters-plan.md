# Play on Mobile — System Adapter Layer

Plan of record for making the companion sheet adaptable to game systems other
than `vagabond`. Written against v0.1.0.

---

## 1. Goal

Today the companion sheet is vagabond-shaped from the template down. Adding a
second system means forking the template. After this work, a system is described
by a JSON **descriptor** — read paths, section layout, and how to invoke the
system's own rolls — with a code escape hatch for the parts JSON cannot express.

**Non-goals for this round:** shipping descriptors for dnd5e/pf2e/etc, and the
visual System Mapper editor. Both are follow-on work that depends on the schema
being settled first.

---

## 2. Two framing answers

**Does it still work like v0.1.0?** For vagabond, yes — bit-for-bit. Two
regression gates (§7) enforce pixel-identical output. For every other system,
behavior is *unchanged from today* (the generic flat-field fallback) until
someone writes a descriptor. This round buys the ability, not the content.

**Does `module.json` change?** Yes, and it's a blocker:

```json
"relationships": {
  "systems": [ { "id": "vagabond", "type": "system", "compatibility": {} } ]
}
```

Foundry gates package availability on `relationships.systems`. In a world running
any other system the module shows as unavailable in Module Management and cannot
be enabled. The `systems` array must be removed. See §9.

---

## 3. Where the coupling actually lives

Three places, not one. Swapping adapters alone achieves nothing.

| File | Coupling |
|---|---|
| `scripts/adapters/vagabond-adapter.mjs` | Data reads + behavior calls. Expected; this is what an adapter is for. |
| `templates/companion-sheet.hbs` | **The real blocker.** Hardcodes Level/ancestry/class, Speed, Luck, XP, Equipped, Spells+Focus, Saves, Skills, Attack Skills, Inventory+slots, Magic, Traits, Features, Perks. Any new system must fit that exact shape or render nothing. |
| `scripts/companion/companion-app.mjs` | `_prepareContext` hardcodes list names for accordion state (L150–160); five separate press handlers keyed to fixed source names. |

---

## 4. Core design split: data vs behavior

An adapter does two jobs of different nature:

| Job | Example | Expressible as JSON? |
|---|---|---|
| **Read** | `system.health.value`, filter `item.type === "spell"` | Yes |
| **Invoke** | `rollHandler.roll(evt, {dataset})`, `EquipmentHelper.equipWithHandLimit()` | No — arbitrary code |

The vagabond adapter's entire value is the invoke half: it never reimplements
dice, it calls the system's own handlers so chat cards are identical to using the
real sheet. A pure-JSON adapter loses that and degrades to `new Roll(formula)`,
producing different cards than the system's own sheet.

**Therefore: not JSON *or* code. JSON layout plus a small invoke vocabulary,
with code as a declared escape hatch.**

### Adapter tiers

- **Tier 0 — generic fallback.** No descriptor. Current flat-field behavior,
  untouched this round.
- **Tier 1 — JSON descriptor.** Expected to cover most systems.
- **Tier 2 — descriptor + `invokeModule`.** JSON layout, JS for the tricky
  invokes/filters/actions. Vagabond lands here.

---

## 5. Descriptor format

### 5.1 Top level

```json
{
  "formatVersion": 1,
  "system": "dnd5e",
  "label": "D&D Fifth Edition",
  "invokeModule": "modules/play-on-mobile/scripts/adapters/invokes/dnd5e.mjs",

  "header": {
    "subtitle": ["@system.details.level", "@items.race.name", "@items.class.name"]
  },

  "fastForward": { "event": { "shiftKey": true }, "options": { "configure": false } },

  "dialogs": {
    "selfPositioned": [".spell-cast-dialog"],
    "dragHandle": { ".my-frameless-dialog": ".dlg-titlebar" },
    "collapsePanel": true
  },

  "sections": []
}
```

`name` and `img` are always taken from the actor; they are not descriptor fields.

### 5.2 Expressions

Deliberately not a programming language. No `eval`. Anything requiring
conditionals belongs in `invokeModule`.

| Form | Meaning |
|---|---|
| `@system.foo.bar` | `foundry.utils.getProperty(actor, "system.foo.bar")` |
| `@items.<type>` | First embedded item of that `type` |
| `@.foo` | Relative — the current entry, inside a `source` iteration |
| `@item.foo` | The current item, inside `item-list` |
| anything without `@` | Literal string |
| `{key}` | Templated into invoke args — the iteration key |

### 5.3 `where` filters

```json
{
  "type": ["weapon", "equipment"],
  "system.equipped": false,
  "level": { "lte": "@system.details.level" },
  "custom": "isWeaponSkill"
}
```

Comparators: `eq ne lt lte gt gte in nin`. A bare value means `eq`. All keys AND
together. `custom` names a predicate exported from `invokeModule`.

### 5.4 `labelFrom`

Systems store labels three different ways; one field handles all.

```json
{ "config": "DND5E.skills", "field": "label", "localize": true }
```

Resolution order: `CONFIG[config][key]` → if string, use it; if object, take
`field` (default `label`, then `name`); then `localize` if requested.

### 5.5 Section common fields

| Field | Meaning |
|---|---|
| `id` | Required, unique. Namespaces accordion state. |
| `label` | Section heading. Omit for no heading. |
| `render` | One of the six renderers (§5.6). |
| `collapsible` / `defaultOpen` | Accordion behavior for the whole section. |
| `icon` | Expression yielding an `img` src shown beside the heading. |
| `badge` | `{ label, value, max }` — the "Focus 3/5" / "4/10 slots" slot. |
| `revealWith` | `"header"` — only visible when the name accordion is expanded. |
| `hideIfEmpty` | Default `true`. |

### 5.6 Renderers

Six. Every current vagabond section maps onto one.

**`resources`** — value/max with ± steppers.
```json
{ "id": "vitals", "render": "resources", "entries": [
  { "key": "hp", "label": "HP",
    "value": "@system.attributes.hp.value",
    "max":   "@system.attributes.hp.max",
    "write": "system.attributes.hp.value",
    "min": 0, "editable": true },
  { "key": "speed", "label": "Speed", "value": "@system.attributes.movement.walk" }
]}
```
Note `value` is a read *expression*, `write` is a real settable *path*. Steppers
need both; conflating them is the single easiest schema mistake here.

**`stat-row`** — abbreviation/value chips.
```json
{ "id": "abilities", "render": "stat-row", "revealWith": "header",
  "source": "@system.abilities", "value": "@.value",
  "abbr": { "config": "DND5E.abilities", "field": "abbreviation" } }
```

**`check-grid`** — label/value, tap to roll.
```json
{ "id": "skills", "label": "Skills", "render": "check-grid",
  "source": "@system.skills", "value": "@.total",
  "labelFrom": { "config": "DND5E.skills", "field": "label" },
  "invoke": { "kind": "actorMethod", "path": "rollSkill", "args": [{ "skill": "{key}" }] } }
```

**`item-list`** — img/name/qty; tap invokes, long-press opens the action accordion.
```json
{ "id": "inventory", "label": "Inventory", "render": "item-list", "collapsible": true,
  "where": { "type": ["weapon","equipment","consumable"], "system.equipped": false },
  "qty": "@item.system.quantity",
  "description": "@item.system.description.value",
  "invoke": { "kind": "itemMethod", "path": "use" },
  "actions": ["use", "toChat",
              { "action": "toggle", "label": "Equip", "path": "system.equipped" },
              "edit", "delete"] }
```

**`entry-list`** — name + description accordion over an embedded array (not items).
```json
{ "id": "features", "label": "Features", "render": "entry-list",
  "icon": "@items.class.img",
  "source": "@items.class.system.levelFeatures",
  "name": "@.name", "description": "@.description",
  "where": { "level": { "lte": "@system.level" } } }
```

**`fields`** — readonly key/value. The generic-fallback renderer.

### 5.7 Item actions

Builtin vocabulary plus escapes:

| Form | Behavior |
|---|---|
| `"use"` | Runs the section's `invoke` |
| `"toChat"` | Posts name + description as a ChatMessage (no universal system API exists) |
| `"edit"` / `"delete"` | Core Foundry; `delete` keeps a confirm dialog |
| `{ "action": "toggle", "path": "..." }` | Flips a boolean, label swaps |
| `{ "action": "invoke", "invoke": {...} }` | Arbitrary declared invoke |
| `{ "custom": "itemActions" }` | Whole list built in code |

### 5.8 Invoke kinds

The vocabulary that makes JSON viable at all.

```json
{ "kind": "actorMethod", "path": "rollSkill", "args": [{ "skill": "{key}" }] }
{ "kind": "itemMethod",  "path": "use" }
{ "kind": "propMethod",  "path": "skills.{key}", "call": "roll" }
{ "kind": "formula",     "formula": "1d20 + @skills.{key}.mod", "flavor": "..." }
{ "kind": "update",      "target": "item", "set": { "system.equipped": "{!current}" } }
{ "kind": "sheetClick",  "selector": "[data-action='roll'][data-key='{key}']" }
{ "kind": "custom",      "fn": "rollWeapon" }
```

Every kind also accepts `event: { shiftKey, ctrlKey, altKey }` and `options: {}`.

`itemMethod: use` alone covers item taps in dnd5e, pf2e, sw5e, a5e.
`sheetClick` renders the system's own sheet offscreen and clicks its real button
— fragile across system updates, documented as last resort, but universal.

---

## 6. Dialog layer

Already largely system-agnostic in v0.1.0 and worth stating so it does not get
re-solved: `companion.css:517` full-screens any `.application:not(.pom-companion-app)`,
`companion.css:543` puts `touch-action:none` on `.window-header` (covers every
framed AppV2 drag), and `dialog-scroll.mjs` is scoped to `.application` with no
vagabond knowledge. Four gaps:

**6.1 `:not(.spell-cast-dialog)` is un-extensible.** A hardcoded vagabond class in
a static stylesheet; a runtime-registered descriptor cannot edit CSS. Invert it —
tag at render time and let CSS key off the tag:

```js
Hooks.on("renderApplicationV2", (app, el) => {
  if (el.classList.contains("pom-companion-app")) return;
  const native = descriptor.dialogs?.selfPositioned ?? [];
  el.classList.add(native.some(s => el.matches(s)) ? "pom-dialog-native" : "pom-dialog-fit");
});
```

**6.2 Frameless dialogs.** `window: { frame: false }` dialogs hand-roll their own
drag; vagabond's fix lives in *vagabond's source*, which is not an option for a
third-party system. Module-side generic pointer drag, keyed off
`dialogs.dragHandle`, with a heuristic fallback (`.application` lacking
`.window-header` → drag from its first element child).

**6.3 Invokes open dialogs by design.** `actor.rollSkill()` in dnd5e pops a roll
config dialog; pf2e pops modifiers. Correct — it matches desktop — but a config
dialog per tap is miserable on a phone. Hence `fastForward` in the descriptor and
a **Fast Rolls** toggle in the companion Settings tab: on, every invoke gets the
declared fast-forward modifier; long-press an entry to roll *with* the dialog.
This deliberately inverts the desktop convention, because on mobile the dialog is
the expensive path. Engine must `await` invokes and ignore return values.

**6.4 Panel does not yield.** A dialog opening while the panel is expanded lands
underneath it. Same render hook collapses the panel. Independent of everything
else here and could land standalone.

---

## 7. Phases

Deliberately split so the template refactor and the descriptor engine are never
in flight together — two small identical-output gates instead of one large one.
If Gate 2 fails you know it is the engine, not the template.

### Phase A — Engine, dormant

New files, nothing wired in.

- `scripts/adapters/resolve.mjs` — expressions, `where`, `labelFrom`
- `scripts/adapters/invokes.mjs` — invoke-kind dispatch
- `scripts/adapters/descriptor-engine.mjs` — descriptor → sheetData
- `docs/descriptor.schema.json`
- `tools/validate-descriptor.mjs`

**Expected result: zero user-visible change.** v0.1.0 behavior exactly.
**Size:** small. **Risk:** none — dead code until Phase C.

### Phase B — Section-driven template  ⚠ highest risk

Template becomes generic; vagabond adapter is rewritten to *emit* the section
array but stays JavaScript. No descriptor involved yet.

- `templates/parts/section-{resources,stat-row,check-grid,item-list,entry-list,fields}.hbs`
- `templates/companion-sheet.hbs` — sheet tab becomes `{{#each sections}}`
- `scripts/companion/companion-app.mjs` — five press handlers collapse to three
- `scripts/adapters/vagabond-adapter.mjs` — emits sections

Action contract change:

| v0.1.0 | After |
|---|---|
| `checkRoll` + `data-source` | `entryPress` + `data-section-id` + `data-entry-id` |
| `weaponRoll` / `spellCast` / `itemUse` | same `entryPress` |
| `itemAction` + `data-item-source` | `entryAction` + section/entry/index |
| `resourceDelta` + `data-key` | `entryDelta` |

`_onCheckRoll`, `_onWeaponRoll`, `_onSpellCast`, `_onItemUse` and
`_onResourceDelta` are deleted. Accordion ids namespace to
`${sectionId}:${entryId}` — collision becomes a real risk once sections are
user-defined.

Speed / Luck / XP stop being hardcoded siblings and become ordinary `resources`
entries. The generic version is shorter than what it replaces.

**Gate 1: vagabond sheet pixel-identical** — section order, badges, accordion
state, item action rows, theme classes, scroll restore.

**Expected result: zero user-visible change.** **Size:** large.

### Phase C — Vagabond becomes a descriptor

- `systems/vagabond.json`
- `scripts/adapters/invokes/vagabond.mjs` — `itemActions`, `isWeaponSkill`,
  `rollWeapon`, `castSpell`, `useItem`, `equipToggle`
- `scripts/adapters/vagabond-adapter.mjs` — deleted

**Actual outcome — implemented and verified live (Gate 2, §7):** the port needed
more than the four items forecast here. Kept for the record; superseded by what
shipped:

1. **`badge`**, with a `when` gate added once it was clear "Focus 3/5" must
   disappear entirely (not show "Focus undefined") for classes without a focus
   pool.
2. **`@items.<type>`** (and, for perks, its plural sibling `@itemsOfType.<type>`
   — an entry-list sourced straight from `actor.items` rather than an array
   embedded on one item).
3. **Comparators in `where`**, plus threading the iteration `key` into the
   filter ctx — a `where.custom` predicate (`isWeaponSkill`) needs to classify
   by the skill's *key*, not the shape of its value.
4. **Escape hatches on filters and actions.** `itemActions` (armor/gear/
   consumable/handsRequired branching) and `isEquipped`/`isStashItem`/
   `isStashRelic` (mirroring `EquipmentHelper`'s own equipped-state logic
   rather than re-guessing it) are exactly the tier-2 boundary this was meant
   to test.
5. **`@snap.*` + descriptor `snapshot` field** — not forecast at all.
   `VagabondActor.read()` unwraps/renames fields (`stats[key].total` → a bare
   number, `fatigue`+`fatigueMax` → one `{value,max}` pair, character-vs-NPC
   speed shapes → one `{base}` shape) in ways no `@system` path can express.
   Reimplementing that unwrapping as JSON would be the exact anti-pattern the
   adapter already avoids for dice — so the descriptor calls the system's own
   derived-data read once per render instead, exposed as `@snap.*`.
6. **`when` on resource entries** — Mana/Luck must vanish entirely for actors
   without that pool (HP/Fatigue/Speed/XP are unconditional; only these two
   are genuinely optional), distinct from a value of 0.
7. **`sectionId` on item ctx** — a custom action fn needs to know which
   section it fired from: the "Use" action on an equipped attack item attacks;
   the identical action on the same item type in Inventory never does, since
   equipped weapons never appear there.
8. **Object-form header subtitle items** (`{label, value}`) — "Level 3" is a
   literal label plus a derived number; plain bare-expression subtitle items
   can't express the label half.

Two real engine bugs only surfaced by the live diff, not by unit tests written
before the port: `buildSection` never copied `section.cssClass` through to its
output, and `buildKeyValueEntry` (stat-row/check-grid) never set `.id`, so
check-grid buttons rendered `data-entry-id=""`. Both are now covered by
regression tests in tests/descriptor-engine.test.mjs.

**Perf constraint:** description enrichment is async per item and currently
`Promise.all`-batched. The engine must batch identically or mobile render time
regresses badly.

**Gate 2: pixel-identical again.**

**Expected result: zero user-visible change.** Vagabond is now the proof the
format is sufficient. **Size:** medium.

### Phase D — Sources, API, dialogs

- `scripts/adapters/adapter-registry.mjs` — rewritten for precedence
- `scripts/play-on-mobile.mjs` — `api` export
- `scripts/settings.mjs` — `systemDescriptor` (world, `config: false`),
  `fastRolls` (client)
- Descriptor editor menu — textarea + Validate button
- Dialog tagging hook, generic frameless drag, panel collapse (§6)
- `module.json` — see §9

Precedence:

```
world setting  >  api.registerSystem()  >  systems/*.json  >  generic fallback
```

```js
game.modules.get("play-on-mobile").api = {
  registerSystem(descriptor),
  registerInvokes(systemId, fns),
  getDescriptor()
};
```

Documented gotcha: registration must happen on `init` or `setup` —
`play-on-mobile.mjs:47` activates the companion on `ready`.

The world setting exists so a broken mapping is fixable by a GM without a module
release. Empty string falls through to the next tier.

**Expected result: first user-visible changes.** Fast Rolls toggle appears in the
Settings tab; dialogs behave correctly on every system; the module installs and
enables in any world. **Size:** medium.

---

## 8. Expected end state

| Situation | v0.1.0 | After Phase D |
|---|---|---|
| vagabond sheet | Full | **Identical** |
| dnd5e / pf2e / anything else | Generic flat-field dump | **Still the generic dump** — until a descriptor is written |
| Installing in a non-vagabond world | Blocked by `relationships.systems` | Works |
| Dialogs on a non-vagabond system | Framed dialogs OK; frameless and self-positioning ones broken | Handled generically |
| Cost of adding a system | Fork, write a JS adapter, PR, release | Write JSON; paste into a world setting; live immediately |
| Cost of a *hard* system | Same | JSON + one small `invokeModule` |

The honest summary: this round ships capability, not coverage. The next round
(shipped `systems/*.json` for two real systems, then the System Mapper editor)
ships coverage.

---

## 9. `module.json` changes

```diff
- "relationships": {
-   "systems": [ { "id": "vagabond", "type": "system", "compatibility": {} } ]
- },
```

Foundry gates package availability on `relationships.systems`; leaving it set
makes the module unavailable in every non-vagabond world. Drop the `systems`
array entirely.

Also:
- `description` — currently "First-class support for the vagabond system; other
  systems get a generic read-only fallback." Rewrite for descriptor-based support.
- `version` → `0.2.0`; `download` URL is pinned to `v0.1.0` (release chore).

---

## 10. Risks

- **Descriptor sprawl.** Every "just one more field" grows the schema until it is
  a bad programming language. Guard: anything needing conditionals goes to
  `invokeModule`, no exceptions.
- **Phase B.** It rewrites working, polished code and carries the whole visual
  regression risk of the project. Gate 1 is the only defense.
- **`sheetClick` fragility.** Breaks whenever a system changes its markup.
  Shipped, but labeled last resort.
- **Label heterogeneity.** `CONFIG.X` holds strings, `{label}` objects, `{name}`
  objects, and pre-localized values depending on the system. `labelFrom` must
  handle all four or descriptors get unreadable.
- **Accordion id collisions** once section ids are user-authored. Namespacing in
  Phase B is the mitigation; the validator should also reject duplicate ids.
- **Perf.** Async description enrichment must stay batched (Phase C).

---

## 11. Deferred

- Shipped descriptors for real systems (dnd5e, one other) — validates the
  vocabulary against systems not designed around.
- **System Mapper editor.** Its value is not the form, it is live binding:
  a tree of `actor.system` on a real selected actor with resolved values shown
  (`attributes.hp.value = 24`), click a node to bind it into a slot, introspect
  the actor prototype chain for `roll*`/`use*`/`cast*` methods, and a Test button
  that fires the invoke and shows the resulting chat card inline. Bind → test is
  the whole product. Purely additive over the same JSON, which is why it is
  correct to build last.
- Tier 0 auto-probe — guess `system.attributes.hp` / `system.health` /
  `system.abilities`, group items by `type`, tap → `item.use?.()`. Cheap upgrade
  over the current flat dump for systems with no descriptor.
