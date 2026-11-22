import { test } from "node:test";
import assert from "node:assert/strict";
import { createDescriptorAdapter, resolveModulePath } from "../scripts/adapters/descriptor-engine.mjs";

function makeActor(overrides = {}) {
  const state = {
    name: "Aria",
    img: "aria.webp",
    system: {
      attributes: { hp: { value: 8, max: 12 } },
      details: { level: 3 },
      abilities: { str: { value: 14 }, dex: { value: 16 } },
      skills: { athletics: { total: 5 }, stealth: { total: 7 } },
    },
    items: [
      { id: "i1", type: "class", name: "Rogue", img: "rogue.webp", system: { levelFeatures: [
        { name: "Sneak Attack", level: 1, description: "Extra damage." },
        { name: "Evasion", level: 7, description: "Half damage on saves." },
      ] } },
      { id: "i2", type: "weapon", name: "Dagger", img: "dagger.webp", system: { equipped: true, quantity: 1 } },
      { id: "i3", type: "weapon", name: "Shortbow", img: "shortbow.webp", system: { equipped: false, quantity: 1 } },
    ],
    updateCalls: [],
    async update(data) {
      this.updateCalls.push(data);
      for (const [path, value] of Object.entries(data)) {
        let cur = this;
        const parts = path.split(".");
        const last = parts.pop();
        for (const p of parts) cur = cur[p] ??= {};
        cur[last] = value;
      }
    },
    ...overrides,
  };
  return state;
}

const enrichHTML = async (html) => `<enriched>${html}</enriched>`;

test("descriptor-engine: resources renderer resolves value/max and onDelta clamps + updates via the write path", async () => {
  const actor = makeActor();
  const descriptor = {
    formatVersion: 1,
    system: "test",
    sections: [
      { id: "vitals", render: "resources", entries: [
        { key: "hp", label: "HP", value: "@system.attributes.hp.value", max: "@system.attributes.hp.max",
          write: "system.attributes.hp.value", min: 0, editable: true },
      ] },
    ],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML });
  const data = await adapter.buildSheetData({ actor });
  const hp = data.sections[0].entries[0];
  assert.equal(hp.value, 8);
  assert.equal(hp.max, 12);

  await hp.onDelta(-20); // clamps at min
  assert.equal(actor.system.attributes.hp.value, 0);

  await hp.onDelta(999); // clamps at max
  assert.equal(actor.system.attributes.hp.value, 12);
});

test("descriptor-engine: check-grid resolves labelFrom and wires invoke through runInvoke", async () => {
  const actor = makeActor();
  const calls = [];
  const runtime = { actorMethod: async (ctx, invoke) => calls.push({ path: invoke.path, args: invoke.args }) };
  const descriptor = {
    formatVersion: 1,
    system: "test",
    sections: [
      { id: "skills", label: "Skills", render: "check-grid", source: "@system.skills", value: "@.total",
        labelFrom: { config: "TEST.skills" },
        invoke: { kind: "actorMethod", path: "rollSkill", args: [{ skill: "{key}" }] } },
    ],
  };
  const adapter = createDescriptorAdapter(descriptor, {
    enrichHTML,
    runtime,
    CONFIG: { TEST: { skills: { athletics: "Athletics", stealth: "Stealth" } } },
  });
  const data = await adapter.buildSheetData({ actor });
  const skills = data.sections[0].entries;
  assert.equal(skills.length, 2);
  const athletics = skills.find((s) => s.key === "athletics");
  assert.equal(athletics.id, "athletics"); // template looks entries up by .id, not .key — must be set
  assert.equal(athletics.label, "Athletics");
  assert.equal(athletics.value, 5);

  await athletics.onPress();
  assert.deepEqual(calls, [{ path: "rollSkill", args: [{ skill: "athletics" }] }]);
});

test("descriptor-engine: item-list filters by where, resolves qty/description, batches enrichment", async () => {
  const actor = makeActor();
  let enrichCallCount = 0;
  const countingEnrich = async (html) => {
    enrichCallCount++;
    return `<p>${html}</p>`;
  };
  const descriptor = {
    formatVersion: 1,
    system: "test",
    sections: [
      { id: "inventory", label: "Inventory", render: "item-list",
        where: { type: "weapon", "system.equipped": false },
        qty: "@item.system.quantity",
        qtyLabel: ["@item.system.ammoLabel", "Ammo"],
        description: "@item.name",
        invoke: { kind: "itemMethod", path: "use" },
        actions: ["edit"] },
    ],
  };
  const runtime = { itemMethod: async () => "used" };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML: countingEnrich, runtime });
  const data = await adapter.buildSheetData({ actor });
  const entries = data.sections[0].entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].label, "Shortbow");
  assert.equal(entries[0].qty, 1);
  assert.equal(entries[0].qtyLabel, "Ammo");
  assert.equal(entries[0].description, "<p>Shortbow</p>");
  assert.equal(enrichCallCount, 1);
  assert.equal(entries[0].actions.length, 1);
  assert.equal(entries[0].actions[0].label, "Edit");
});

test("descriptor-engine: tracks give one clamped +/- stepper each, per-track `when`, hidden when max<=min", async () => {
  const actor = makeActor();
  const dagger = actor.items.find((i) => i.id === "i2"); // equipped: true
  dagger.system.ammo = { value: 1, max: 3 };
  dagger.system.secondary = { value: 2, max: 4 };
  dagger.update = async (data) => {
    for (const [path, value] of Object.entries(data)) {
      const parts = path.split(".");
      const last = parts.pop();
      let cur = dagger;
      for (const p of parts) cur = cur[p];
      cur[last] = value;
    }
  };
  const shortbow = actor.items.find((i) => i.id === "i3"); // equipped: false
  shortbow.system.ammo = { value: 0, max: 0 }; // no room to move — melee-style
  shortbow.system.secondary = { value: 1, max: 4 }; // has room, but gated by `when` below
  const descriptor = {
    formatVersion: 1,
    system: "test",
    sections: [
      { id: "weapons", render: "item-list", where: { type: "weapon" },
        tracks: [
          { label: "Ammo", value: "@item.system.ammo.value", write: "system.ammo.value", min: 0, max: "@item.system.ammo.max" },
          { label: "Secondary", value: "@item.system.secondary.value", write: "system.secondary.value", min: 0, max: "@item.system.secondary.max", when: "@item.system.equipped" },
        ] },
    ],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML });
  const data = await adapter.buildSheetData({ actor });
  const entries = data.sections[0].entries;
  const daggerEntry = entries.find((e) => e.label === "Dagger");
  const shortbowEntry = entries.find((e) => e.label === "Shortbow");

  // Dagger is equipped: both tracks present.
  assert.deepEqual(daggerEntry.qtyTracks.map((t) => t.label), ["Ammo", "Secondary"]);
  // Shortbow is unequipped: Secondary is gated off by `when`, Ammo is dropped for max===min.
  assert.equal(shortbowEntry.qtyTracks.length, 0);

  const [ammoTrack, secondaryTrack] = daggerEntry.qtyTracks;
  await ammoTrack.onDelta(1);
  assert.equal(dagger.system.ammo.value, 2);
  await ammoTrack.onDelta(5); // clamps at max
  assert.equal(dagger.system.ammo.value, 3);
  await ammoTrack.onDelta(-10); // clamps at min
  assert.equal(dagger.system.ammo.value, 0);

  await secondaryTrack.onDelta(-1);
  assert.equal(dagger.system.secondary.value, 1);
});

test("descriptor-engine: toggle action flips a boolean item path and swaps label", async () => {
  const actor = makeActor();
  const dagger = actor.items.find((i) => i.id === "i2");
  dagger.update = async (data) => Object.assign(dagger.system, data["system.equipped"] !== undefined ? { equipped: data["system.equipped"] } : {});
  const descriptor = {
    formatVersion: 1,
    system: "test",
    sections: [
      { id: "equipped", render: "item-list", where: { type: "weapon", "system.equipped": true },
        actions: [{ action: "toggle", path: "system.equipped", label: "Equip", offLabel: "Unequip" }] },
    ],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML });
  const data = await adapter.buildSheetData({ actor });
  const entry = data.sections[0].entries[0];
  assert.equal(entry.label, "Dagger");
  assert.equal(entry.actions[0].label, "Unequip"); // currently equipped=true -> shows the "turn off" label
  await entry.actions[0].onSelect();
  assert.equal(dagger.system.equipped, false);
});

test("descriptor-engine: entry-list filters an embedded array by a live-actor comparator (@expr in where)", async () => {
  const actor = makeActor();
  const descriptor = {
    formatVersion: 1,
    system: "test",
    sections: [
      { id: "features", label: "Features", render: "entry-list",
        icon: "@items.class.img",
        source: "@items.class.system.levelFeatures",
        name: "@.name", description: "@.description",
        where: { level: { lte: "@system.details.level" } } },
    ],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML });
  const data = await adapter.buildSheetData({ actor });
  const features = data.sections[0];
  assert.equal(features.icon, "rogue.webp");
  assert.equal(features.entries.length, 1); // level 1 <= 3, level 7 filtered out
  assert.equal(features.entries[0].name, "Sneak Attack");
  assert.equal(features.entries[0].description, "<enriched>Extra damage.</enriched>");
});

test("descriptor-engine: section.cssClass passes through to the built section (drives the grid's CSS class)", async () => {
  const actor = makeActor();
  const descriptor = {
    formatVersion: 1,
    system: "test",
    sections: [
      { id: "skills", render: "check-grid", source: "@system.skills", cssClass: "pom-grid-skills" },
    ],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML });
  const data = await adapter.buildSheetData({ actor });
  assert.equal(data.sections[0].cssClass, "pom-grid-skills");
});

test("descriptor-engine: hideIfEmpty (default true) drops sections with no entries", async () => {
  const actor = makeActor();
  const descriptor = {
    formatVersion: 1,
    system: "test",
    sections: [{ id: "magic", label: "Magic", render: "item-list", where: { type: "spell" } }],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML });
  const data = await adapter.buildSheetData({ actor });
  assert.equal(data.sections.length, 0);
});

test("descriptor-engine: badge resolves label/value/max expressions", async () => {
  const actor = makeActor({ system: { focus: { current: 3, max: 5 }, skills: {} } });
  const descriptor = {
    formatVersion: 1,
    system: "test",
    sections: [
      { id: "spells", render: "item-list", where: { type: "spell" }, hideIfEmpty: false,
        badge: { label: "Focus", value: "@system.focus.current", max: "@system.focus.max" } },
    ],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML });
  const data = await adapter.buildSheetData({ actor });
  assert.deepEqual(data.sections[0].badge, { label: "Focus", value: 3, max: 5 });
});

test("descriptor-engine: header subtitle resolves and drops empty parts", async () => {
  const actor = makeActor();
  const descriptor = {
    formatVersion: 1,
    system: "test",
    header: { subtitle: ["@system.details.level", "@items.class.name", "@items.race.name"] },
    sections: [],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML });
  const data = await adapter.buildSheetData({ actor });
  assert.deepEqual(data.header.subtitle, [3, "Rogue"]); // race item absent -> filtered
});

test("descriptor-engine: fields renderer flattens primitive leaves of the resolved source", async () => {
  const actor = makeActor({ system: { hp: 8, level: 3, nested: { a: 1 } } });
  const descriptor = {
    formatVersion: 1,
    system: "test",
    sections: [{ id: "fields", render: "fields" }],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML });
  const data = await adapter.buildSheetData({ actor });
  const entries = data.sections[0].entries;
  assert.deepEqual(entries.sort((a, b) => a.key.localeCompare(b.key)), [
    { key: "hp", value: "8" },
    { key: "level", value: "3" },
  ]);
});

test("descriptor-engine: invokeModule is loaded once via importModule and cached on phoneApp", async () => {
  let importCount = 0;
  const custom = { isWeaponSkill: () => true };
  const importModule = async () => {
    importCount++;
    return custom;
  };
  const descriptor = {
    formatVersion: 1,
    system: "test",
    invokeModule: "modules/play-on-mobile/scripts/adapters/invokes/test.mjs",
    sections: [
      { id: "skills", render: "check-grid", source: "@system.skills", value: "@.total",
        where: { custom: "isWeaponSkill" } },
    ],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML, importModule });
  const phoneApp = { actor: makeActor() };
  await adapter.initHandlers(phoneApp);
  await adapter.buildSheetData(phoneApp);
  await adapter.buildSheetData(phoneApp);
  assert.equal(importCount, 1);
});

test("descriptor-engine: snapshot custom fn is computed once and exposed as @snap.*", async () => {
  const actor = makeActor();
  let calls = 0;
  const custom = { readSnapshot: (a) => { calls++; return { fatigue: { value: 1, max: 5 } }; } };
  const descriptor = {
    formatVersion: 1,
    system: "test",
    invokeModule: "irrelevant-in-test",
    snapshot: { custom: "readSnapshot" },
    sections: [
      { id: "vitals", render: "resources", hideIfEmpty: false, entries: [
        { key: "fatigue", label: "Fatigue", value: "@snap.fatigue.value", max: "@snap.fatigue.max" },
      ] },
    ],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML, importModule: async () => custom });
  const data = await adapter.buildSheetData({ actor });
  assert.equal(data.sections[0].entries[0].value, 1);
  assert.equal(data.sections[0].entries[0].max, 5);
  assert.equal(calls, 1);
});

test("descriptor-engine: resource entry with 'when' is omitted when the expression is falsy, kept when truthy", async () => {
  const actor = makeActor();
  const descriptor = {
    formatVersion: 1,
    system: "test",
    sections: [
      { id: "vitals", render: "resources", hideIfEmpty: false, entries: [
        { key: "hp", label: "HP", value: "@system.attributes.hp.value" },
        { key: "mana", label: "Mana", value: "@system.mana.current", when: "@system.mana" },
      ] },
    ],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML });
  const data = await adapter.buildSheetData({ actor }); // actor has no system.mana
  assert.deepEqual(data.sections[0].entries.map((e) => e.key), ["hp"]);
});

test("descriptor-engine: header subtitle supports {label, value} objects alongside bare expressions", async () => {
  const actor = makeActor();
  const descriptor = {
    formatVersion: 1,
    system: "test",
    header: { subtitle: [{ label: "Level", value: "@system.details.level" }, "@items.class.name"] },
    sections: [],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML });
  const data = await adapter.buildSheetData({ actor });
  assert.deepEqual(data.header.subtitle, ["Level 3", "Rogue"]);
});

test("descriptor-engine: where.custom predicates receive the iteration key, not just the value shape", async () => {
  const actor = makeActor();
  const customPredicates = { isWeaponSkill: (subject, ctx) => ["stealth"].includes(ctx.key) };
  const descriptor = {
    formatVersion: 1,
    system: "test",
    invokeModule: "irrelevant-in-test",
    sections: [
      { id: "attackSkills", render: "check-grid", source: "@system.skills", value: "@.total",
        where: { custom: "isWeaponSkill" } },
    ],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML, importModule: async () => customPredicates });
  const data = await adapter.buildSheetData({ actor });
  assert.deepEqual(data.sections[0].entries.map((e) => e.key), ["stealth"]);
});

test("descriptor-engine: entry-list can source directly from actor.items via @itemsOfType (vagabond perks)", async () => {
  const actor = makeActor();
  actor.items.push(
    { id: "perk1", type: "perk", name: "Gish", system: { description: "Mixes magic and steel." } },
  );
  const descriptor = {
    formatVersion: 1,
    system: "test",
    sections: [
      { id: "perks", label: "Perks", render: "entry-list",
        source: "@itemsOfType.perk", name: "@.name", description: "@.system.description" },
    ],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML });
  const data = await adapter.buildSheetData({ actor });
  assert.equal(data.sections[0].entries.length, 1);
  assert.equal(data.sections[0].entries[0].id, "perk1");
  assert.equal(data.sections[0].entries[0].name, "Gish");
  assert.equal(data.sections[0].entries[0].description, "<enriched>Mixes magic and steel.</enriched>");
});

test("descriptor-engine: badge.when hides the badge entirely (not just its value) when falsy", async () => {
  const actor = makeActor({ system: { focus: null, skills: {} } });
  const descriptor = {
    formatVersion: 1,
    system: "test",
    sections: [
      { id: "spells", render: "item-list", where: { type: "spell" }, hideIfEmpty: false,
        badge: { label: "Focus", value: "@system.focus.current", when: "@system.focus" } },
    ],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML });
  const data = await adapter.buildSheetData({ actor });
  assert.equal(data.sections[0].badge, undefined);
});

test("descriptor-engine: item entries carry sectionId so a custom action/invoke fn can behave differently per section", async () => {
  const actor = makeActor();
  const seenSectionIds = [];
  const custom = {
    press: (ctx) => seenSectionIds.push(ctx.sectionId),
  };
  const descriptor = {
    formatVersion: 1,
    system: "test",
    invokeModule: "irrelevant-in-test",
    sections: [
      { id: "equipped", render: "item-list", where: { type: "weapon", "system.equipped": true },
        invoke: { kind: "custom", fn: "press" } },
    ],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML, importModule: async () => custom });
  const data = await adapter.buildSheetData({ actor });
  await data.sections[0].entries[0].onPress();
  assert.deepEqual(seenSectionIds, ["equipped"]);
});

test("descriptor-engine: isAvailable override is honored", () => {
  const descriptor = { formatVersion: 1, system: "test", sections: [] };
  const adapter = createDescriptorAdapter(descriptor, { isAvailable: () => false });
  assert.equal(adapter.isAvailable(), false);
  assert.equal(adapter.id, "test");
});

test("descriptor-engine: the raw descriptor is exposed on the adapter (e.g. for reading fastForward config)", () => {
  const descriptor = { formatVersion: 1, system: "test", fastForward: { event: { shiftKey: true } }, sections: [] };
  const adapter = createDescriptorAdapter(descriptor);
  assert.equal(adapter.descriptor, descriptor);
  assert.deepEqual(adapter.descriptor.fastForward, { event: { shiftKey: true } });
});

test("descriptor-engine: resource `options` marks the current choice (falling back to `default`) and writes the picked value", async () => {
  const actor = makeActor();
  const descriptor = {
    formatVersion: 1,
    system: "test",
    sections: [
      { id: "mods", render: "resources", entries: [
        { key: "fh", label: "Favor / Hinder", value: "@system.favorHinder", default: "none", write: "system.favorHinder",
          options: [{ value: "hinder", label: "Hinder" }, { value: "none", label: "None" }, { value: "favor", label: "Favor" }] },
      ] },
    ],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML });
  let fh = (await adapter.buildSheetData({ actor })).sections[0].entries[0];
  assert.deepEqual(fh.options.map((o) => o.selected), [false, true, false]); // unset -> default "none"

  await fh.onOption("favor");
  assert.equal(actor.system.favorHinder, "favor");
  fh = (await adapter.buildSheetData({ actor })).sections[0].entries[0];
  assert.deepEqual(fh.options.map((o) => o.selected), [false, false, true]);
});

test("descriptor-engine: resource `deltaInvoke` replaces the clamp-and-write with an invoke that sees vars.delta", async () => {
  const actor = makeActor({ system: { luck: 2 } });
  const seen = [];
  const custom = { adjust: (ctx) => seen.push(ctx.vars.delta) };
  const descriptor = {
    formatVersion: 1,
    system: "test",
    invokeModule: "x.mjs",
    sections: [
      { id: "v", render: "resources", entries: [
        { key: "luck", label: "Luck", value: "@system.luck", editable: true, deltaInvoke: { kind: "custom", fn: "adjust" } },
      ] },
    ],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML, importModule: async () => custom });
  const luck = (await adapter.buildSheetData({ actor })).sections[0].entries[0];
  assert.equal(luck.editable, true);
  await luck.onDelta(-1);
  await luck.onDelta(1);
  assert.deepEqual(seen, [-1, 1]);
  assert.equal(actor.updateCalls.length, 0); // nothing written by the engine itself
});

test("descriptor-engine: resource `invoke` is pressable only while `pressWhen` holds; `active` passes through", async () => {
  const pressed = [];
  const custom = { rush: () => pressed.push("rush") };
  const build = async (canRush) => {
    const actor = makeActor({ system: { canRush, rushing: canRush } });
    const descriptor = {
      formatVersion: 1,
      system: "test",
      invokeModule: "x.mjs",
      sections: [
        { id: "v", render: "resources", entries: [
          { key: "speed", label: "Speed", value: 30, invoke: { kind: "custom", fn: "rush" },
            pressWhen: "@system.canRush", active: "@system.rushing" },
        ] },
      ],
    };
    const adapter = createDescriptorAdapter(descriptor, { enrichHTML, importModule: async () => custom });
    return (await adapter.buildSheetData({ actor })).sections[0].entries[0];
  };
  const off = await build(false);
  assert.equal(off.pressable, undefined);
  assert.equal(off.onPress, undefined);
  assert.equal(off.active, false);

  const on = await build(true);
  assert.equal(on.pressable, true);
  assert.equal(on.active, true);
  await on.onPress({});
  assert.deepEqual(pressed, ["rush"]);
});

test("descriptor-engine: check-grid `name` labels entries from the entry itself; `active` flags lit entries", async () => {
  const actor = makeActor({ system: { actions: { "a1|x": { label: "Rage", active: true }, "a2|y": { label: "Mark", active: false } } } });
  const descriptor = {
    formatVersion: 1,
    system: "test",
    sections: [{ id: "acts", render: "check-grid", source: "@system.actions", name: "@.label", active: "@.active" }],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML });
  const entries = (await adapter.buildSheetData({ actor })).sections[0].entries;
  assert.deepEqual(entries.map((e) => [e.id, e.label, e.active]), [["a1|x", "Rage", true], ["a2|y", "Mark", false]]);
});

test("descriptor-engine: custom item actions carrying a `stepper` move into qtyTracks; `hidden` actions drop", async () => {
  const actor = makeActor();
  const deltas = [];
  const custom = {
    menu: () => [
      { icon: "fas fa-a", label: "Use", onSelect() {} },
      { label: "Quantity", stepper: { value: 3, onDelta: (d) => deltas.push(d) } },
      { icon: "fas fa-b", label: "Secret", hidden: true, onSelect() {} },
    ],
  };
  const descriptor = {
    formatVersion: 1,
    system: "test",
    invokeModule: "x.mjs",
    sections: [{ id: "inv", render: "item-list", where: { type: "weapon" }, actions: [{ custom: "menu" }] }],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML, importModule: async () => custom });
  const dagger = (await adapter.buildSheetData({ actor })).sections[0].entries.find((e) => e.id === "i2");
  assert.deepEqual(dagger.actions.map((a) => a.label), ["Use"]);
  assert.equal(dagger.qtyTracks.length, 1);
  assert.equal(dagger.qtyTracks[0].label, "Quantity");
  assert.equal(dagger.qtyTracks[0].value, 3);
  dagger.qtyTracks[0].onDelta(-1);
  assert.deepEqual(deltas, [-1]);
});

test("descriptor-engine: revealWith and hideIfEmpty pass through to the built section (the app reads both)", async () => {
  const actor = makeActor();
  const descriptor = {
    formatVersion: 1,
    system: "test",
    sections: [
      { id: "abilities", render: "stat-row", source: "@system.abilities", value: "@.value", revealWith: "header" },
      { id: "empty", render: "check-grid", source: "@system.nothing", hideIfEmpty: false },
    ],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML });
  const [abilities, empty] = (await adapter.buildSheetData({ actor })).sections;
  assert.equal(abilities.revealWith, "header");
  assert.equal(empty.id, "empty");
  assert.equal(empty.hideIfEmpty, false);
  assert.equal(empty.entries.length, 0);
});

test("descriptor-engine: stat-row/check-grid entries with an invoke are flagged pressable; without one they aren't", async () => {
  const actor = makeActor();
  const descriptor = {
    formatVersion: 1,
    system: "test",
    sections: [
      { id: "rollable", render: "stat-row", source: "@system.abilities", value: "@.value", invoke: { kind: "formula", formula: "1d6" } },
      { id: "plain", render: "stat-row", source: "@system.abilities", value: "@.value" },
    ],
  };
  const adapter = createDescriptorAdapter(descriptor, { enrichHTML });
  const [rollable, plain] = (await adapter.buildSheetData({ actor })).sections;
  assert.ok(rollable.entries.every((e) => e.pressable === true && typeof e.onPress === "function"));
  assert.ok(plain.entries.every((e) => e.pressable === undefined && e.onPress === undefined));
});

test("resolveModulePath: root paths go through foundry.utils.getRoute when available; others pass through", () => {
  assert.equal(resolveModulePath("/modules/x/a.mjs"), "/modules/x/a.mjs"); // no foundry global under node
  globalThis.foundry = { utils: { getRoute: (p) => `/prefix/${p.replace(/^\/+/, "")}` } };
  try {
    assert.equal(resolveModulePath("/modules/x/a.mjs"), "/prefix/modules/x/a.mjs");
    assert.equal(resolveModulePath("modules/x/a.mjs"), "modules/x/a.mjs");
    assert.equal(resolveModulePath("https://cdn.example/a.mjs"), "https://cdn.example/a.mjs");
    assert.equal(resolveModulePath("//cdn.example/a.mjs"), "//cdn.example/a.mjs");
  } finally {
    delete globalThis.foundry;
  }
});
