import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDescriptor } from "../scripts/adapters/validate-descriptor.mjs";

function validDescriptor() {
  return {
    formatVersion: 1,
    system: "test",
    sections: [
      { id: "vitals", render: "resources", entries: [{ key: "hp", value: "@system.hp.value" }] },
      { id: "skills", render: "check-grid", source: "@system.skills" },
      { id: "inventory", render: "item-list", where: { type: "weapon" }, actions: ["use", "edit", "delete"] },
    ],
  };
}

test("validateDescriptor: accepts a well-formed descriptor", () => {
  const { errors } = validateDescriptor(validDescriptor());
  assert.deepEqual(errors, []);
});

test("validateDescriptor: rejects wrong formatVersion", () => {
  const d = validDescriptor();
  d.formatVersion = 2;
  const { errors } = validateDescriptor(d);
  assert.ok(errors.some((e) => e.includes("formatVersion")));
});

test("validateDescriptor: rejects missing system / empty sections", () => {
  const { errors: e1 } = validateDescriptor({ formatVersion: 1, sections: [{ id: "a", render: "fields" }] });
  assert.ok(e1.some((e) => e.includes('"system"')));

  const { errors: e2 } = validateDescriptor({ formatVersion: 1, system: "test", sections: [] });
  assert.ok(e2.some((e) => e.includes("sections")));
});

test("validateDescriptor: rejects unknown renderer", () => {
  const d = { formatVersion: 1, system: "test", sections: [{ id: "a", render: "bogus" }] };
  const { errors } = validateDescriptor(d);
  assert.ok(errors.some((e) => e.includes('render "bogus"')));
});

test("validateDescriptor: flags duplicate section ids (accordion collision risk)", () => {
  const d = {
    formatVersion: 1,
    system: "test",
    sections: [
      { id: "dup", render: "fields" },
      { id: "dup", render: "fields" },
    ],
  };
  const { errors } = validateDescriptor(d);
  assert.ok(errors.some((e) => e.includes('duplicate section id "dup"')));
});

test("validateDescriptor: stat-row / check-grid / entry-list require source", () => {
  for (const render of ["stat-row", "check-grid", "entry-list"]) {
    const d = { formatVersion: 1, system: "test", sections: [{ id: "a", render }] };
    const { errors } = validateDescriptor(d);
    assert.ok(errors.some((e) => e.includes("requires \"source\"")), `expected source error for ${render}`);
  }
});

test("validateDescriptor: resources entries need key/value, editable needs write", () => {
  const d = {
    formatVersion: 1,
    system: "test",
    sections: [{ id: "vitals", render: "resources", entries: [{ label: "HP", editable: true }] }],
  };
  const { errors } = validateDescriptor(d);
  assert.ok(errors.some((e) => e.includes("missing \"key\"")));
  assert.ok(errors.some((e) => e.includes("missing \"value\"")));
  assert.ok(errors.some((e) => e.includes("editable requires \"write\"")));
});

test("validateDescriptor: invoke kind validation catches missing required fields per kind", () => {
  const cases = [
    [{ kind: "custom" }, "requires \"fn\""],
    [{ kind: "formula" }, "requires \"formula\""],
    [{ kind: "sheetClick" }, "requires \"selector\""],
    [{ kind: "update" }, "requires \"set\""],
    [{ kind: "actorMethod" }, "requires \"path\""],
    [{ kind: "propMethod", path: "skills.str" }, "requires \"call\""],
    [{ kind: "bogus" }, "is not one of"],
  ];
  for (const [invoke, expectedSubstring] of cases) {
    const d = { formatVersion: 1, system: "test", sections: [{ id: "a", render: "fields", invoke }] };
    const { errors } = validateDescriptor(d);
    assert.ok(
      errors.some((e) => e.includes(expectedSubstring)),
      `expected error containing "${expectedSubstring}" for kind ${invoke.kind}, got: ${errors.join(" | ")}`
    );
  }
});

test("validateDescriptor: unknown builtin action string is rejected", () => {
  const d = { formatVersion: 1, system: "test", sections: [{ id: "a", render: "fields", actions: ["bogus"] }] };
  const { errors } = validateDescriptor(d);
  assert.ok(errors.some((e) => e.includes('unknown builtin action "bogus"')));
});

test("validateDescriptor: toggle action requires path; custom action is opaque and always passes", () => {
  const d1 = { formatVersion: 1, system: "test", sections: [{ id: "a", render: "fields", actions: [{ action: "toggle" }] }] };
  assert.ok(validateDescriptor(d1).errors.some((e) => e.includes('"toggle" requires "path"')));

  const d2 = { formatVersion: 1, system: "test", sections: [{ id: "a", render: "fields", actions: [{ custom: "itemActions" }] }] };
  assert.deepEqual(validateDescriptor(d2).errors, []);
});
