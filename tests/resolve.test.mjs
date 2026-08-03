import { test } from "node:test";
import assert from "node:assert/strict";
import { getProperty, setProperty, resolveExpr, templateValue, matchWhere, resolveLabelFrom } from "../scripts/adapters/resolve.mjs";

test("getProperty walks dotted paths and is undefined-safe", () => {
  assert.equal(getProperty({ a: { b: { c: 5 } } }, "a.b.c"), 5);
  assert.equal(getProperty({ a: {} }, "a.b.c"), undefined);
  assert.equal(getProperty(null, "a.b"), undefined);
  assert.equal(getProperty({ a: 1 }, ""), undefined);
});

test("setProperty creates intermediate objects", () => {
  const obj = {};
  setProperty(obj, "a.b.c", 5);
  assert.deepEqual(obj, { a: { b: { c: 5 } } });
});

test("resolveExpr: literal strings pass through unchanged", () => {
  assert.equal(resolveExpr("HP", {}), "HP");
  assert.equal(resolveExpr(42, {}), 42);
  assert.equal(resolveExpr(true, {}), true);
});

test("resolveExpr: @system.* resolves against actor", () => {
  const ctx = { actor: { system: { attributes: { hp: { value: 12 } } } } };
  assert.equal(resolveExpr("@system.attributes.hp.value", ctx), 12);
});

test("resolveExpr: @items.<type> finds first embedded item of that type", () => {
  const ctx = { actor: { items: [{ type: "class", name: "Fighter" }, { type: "class", name: "Second" }, { type: "race", name: "Human" }] } };
  assert.equal(resolveExpr("@items.class", ctx).name, "Fighter");
  assert.equal(resolveExpr("@items.race", ctx).name, "Human");
  assert.equal(resolveExpr("@items.missing", ctx), undefined);
});

test("resolveExpr: @itemsOfType.<type> returns EVERY embedded item of that type, not just the first", () => {
  const ctx = { actor: { items: [{ type: "perk", name: "A" }, { type: "trait", name: "X" }, { type: "perk", name: "B" }] } };
  assert.deepEqual(resolveExpr("@itemsOfType.perk", ctx).map((i) => i.name), ["A", "B"]);
  assert.deepEqual(resolveExpr("@itemsOfType.missing", ctx), []);
});

test("resolveExpr: @item.* resolves against ctx.item", () => {
  const ctx = { item: { system: { quantity: 3 } } };
  assert.equal(resolveExpr("@item.system.quantity", ctx), 3);
});

test("resolveExpr: @snap.* resolves against ctx.snapshot, not ctx.actor", () => {
  const ctx = { actor: { system: { fatigue: 2 } }, snapshot: { fatigue: { value: 2, max: 5 } } };
  assert.equal(resolveExpr("@snap.fatigue.max", ctx), 5);
  assert.equal(resolveExpr("@system.fatigue", ctx), 2);
});

test("resolveExpr: @.* resolves relative to ctx.entry, @ alone returns the entry", () => {
  const ctx = { entry: { value: 7, label: "Str" } };
  assert.equal(resolveExpr("@.value", ctx), 7);
  assert.equal(resolveExpr("@", ctx), ctx.entry);
});

test("templateValue: replaces {key} tokens in strings, recurses into objects/arrays", () => {
  assert.equal(templateValue("system.skills.{key}.total", { key: "athletics" }), "system.skills.athletics.total");
  assert.deepEqual(templateValue([{ skill: "{key}" }, "flat"], { key: "athletics" }), [{ skill: "athletics" }, "flat"]);
  // unmatched token left alone, not replaced with "undefined"
  assert.equal(templateValue("{missing}", {}), "{missing}");
});

test("matchWhere: bare scalar means eq", () => {
  assert.equal(matchWhere({ type: "weapon" }, { type: "weapon" }), true);
  assert.equal(matchWhere({ type: "weapon" }, { type: "armor" }), false);
});

test("matchWhere: bare array means in", () => {
  const where = { type: ["weapon", "armor"] };
  assert.equal(matchWhere(where, { type: "weapon" }), true);
  assert.equal(matchWhere(where, { type: "gear" }), false);
});

test("matchWhere: nested path keys and multiple ANDed keys", () => {
  const where = { type: "equipment", "system.equipped": false };
  assert.equal(matchWhere(where, { type: "equipment", system: { equipped: false } }), true);
  assert.equal(matchWhere(where, { type: "equipment", system: { equipped: true } }), false);
});

test("matchWhere: comparator object, including an @expr compared against live ctx", () => {
  const ctx = { actor: { system: { details: { level: 5 } } } };
  const where = { level: { lte: "@system.details.level" } };
  assert.equal(matchWhere(where, { level: 3 }, ctx), true);
  assert.equal(matchWhere(where, { level: 5 }, ctx), true);
  assert.equal(matchWhere(where, { level: 6 }, ctx), false);
});

test("matchWhere: unknown comparator throws (fail loud, not silently pass)", () => {
  assert.throws(() => matchWhere({ level: { between: [1, 2] } }, { level: 1 }));
});

test("matchWhere: custom predicate delegates to invokeModule fn", () => {
  const customPredicates = { isWeaponSkill: (subject) => subject.tag === "weapon" };
  assert.equal(matchWhere({ custom: "isWeaponSkill" }, { tag: "weapon" }, {}, customPredicates), true);
  assert.equal(matchWhere({ custom: "isWeaponSkill" }, { tag: "other" }, {}, customPredicates), false);
  assert.equal(matchWhere({ custom: "missingFn" }, {}, {}, customPredicates), false);
});

test("resolveLabelFrom: CONFIG entry as plain string", () => {
  const ctx = { CONFIG: { DND5E: { abilities: { str: "Strength" } } } };
  assert.equal(resolveLabelFrom({ config: "DND5E.abilities" }, "str", ctx), "Strength");
});

test("resolveLabelFrom: CONFIG entry as object with field, default field is 'label'", () => {
  const ctx = { CONFIG: { DND5E: { skills: { ath: { label: "Athletics" } } } } };
  assert.equal(resolveLabelFrom({ config: "DND5E.skills" }, "ath", ctx), "Athletics");
});

test("resolveLabelFrom: object field falls back to .name, then to the raw key", () => {
  const ctx = { CONFIG: { X: { a: { name: "Alpha" }, b: {} } } };
  assert.equal(resolveLabelFrom({ config: "X" }, "a", ctx), "Alpha");
  assert.equal(resolveLabelFrom({ config: "X" }, "b", ctx), "b");
  assert.equal(resolveLabelFrom({ config: "X" }, "missing", ctx), "missing");
});

test("resolveLabelFrom: localize runs the resolved string through ctx.i18n", () => {
  const ctx = {
    CONFIG: { X: { a: "RAW.KEY" } },
    i18n: { localize: (k) => (k === "RAW.KEY" ? "Localized Label" : k) },
  };
  assert.equal(resolveLabelFrom({ config: "X", localize: true }, "a", ctx), "Localized Label");
});

test("resolveLabelFrom: no labelFrom returns the raw key", () => {
  assert.equal(resolveLabelFrom(undefined, "str", {}), "str");
});
