import { test } from "node:test";
import assert from "node:assert/strict";
import { runInvoke } from "../scripts/adapters/invokes.mjs";

test("runInvoke: actorMethod calls the templated path on ctx.actor via runtime", async () => {
  const calls = [];
  const runtime = { actorMethod: async (ctx, invoke) => calls.push({ path: invoke.path, args: invoke.args }) };
  const actor = { name: "Hero" };
  await runInvoke(
    { kind: "actorMethod", path: "rollSkill", args: [{ skill: "{key}" }] },
    { actor, key: "athletics", runtime }
  );
  assert.deepEqual(calls, [{ path: "rollSkill", args: [{ skill: "athletics" }] }]);
});

test("runInvoke: {key} templating reaches into nested args/paths", async () => {
  const calls = [];
  const runtime = { propMethod: async (ctx, invoke) => calls.push(invoke.path) };
  await runInvoke({ kind: "propMethod", path: "skills.{key}", call: "roll" }, { key: "stealth", runtime });
  assert.deepEqual(calls, ["skills.stealth"]);
});

test("runInvoke: kind 'custom' dispatches to ctx.custom[fn] instead of the runtime", async () => {
  let received = null;
  const custom = { rollWeapon: (ctx) => (received = ctx.item?.name) };
  await runInvoke({ kind: "custom", fn: "rollWeapon" }, { item: { name: "Sword" }, custom });
  assert.equal(received, "Sword");
});

test("runInvoke: unknown custom fn throws", async () => {
  await assert.rejects(() => runInvoke({ kind: "custom", fn: "missing" }, { custom: {} }));
});

test("runInvoke: unknown kind throws", async () => {
  await assert.rejects(() => runInvoke({ kind: "bogus" }, {}));
});

test("runInvoke: null invoke is a no-op", async () => {
  assert.equal(await runInvoke(null, {}), undefined);
});

test("runInvoke: event mods passed at call time win over the descriptor's own default", async () => {
  let seenEvent = null;
  const runtime = { actorMethod: async (ctx) => (seenEvent = ctx.event) };
  await runInvoke(
    { kind: "actorMethod", path: "roll", event: { shiftKey: true } },
    { event: { shiftKey: false, ctrlKey: true }, runtime }
  );
  assert.equal(seenEvent.shiftKey, false);
  assert.equal(seenEvent.ctrlKey, true);
});

test("runInvoke: default event mods are false when nothing is supplied", async () => {
  let seenEvent = null;
  const runtime = { actorMethod: async (ctx) => (seenEvent = ctx.event) };
  await runInvoke({ kind: "actorMethod", path: "roll" }, { runtime });
  assert.equal(seenEvent.shiftKey, false);
  assert.equal(seenEvent.ctrlKey, false);
  assert.equal(seenEvent.altKey, false);
  assert.equal(typeof seenEvent.preventDefault, "function");
});

test("runInvoke: itemMethod calls the templated path on ctx.item", async () => {
  const calls = [];
  const runtime = { itemMethod: async (ctx, invoke) => calls.push(invoke.path) };
  await runInvoke({ kind: "itemMethod", path: "use" }, { item: { name: "Potion" }, runtime });
  assert.deepEqual(calls, ["use"]);
});

test("runInvoke: update kind forwards target and templated set", async () => {
  const calls = [];
  const runtime = { update: async (ctx, invoke) => calls.push(invoke) };
  await runInvoke(
    { kind: "update", target: "item", set: { "system.bound": true } },
    { runtime }
  );
  assert.deepEqual(calls, [{ kind: "update", target: "item", set: { "system.bound": true } }]);
});

test("defaultRuntime.actorMethod throws a clear error when the actor has no such method", async () => {
  const { defaultRuntime } = await import("../scripts/adapters/invokes.mjs");
  await assert.rejects(
    () => defaultRuntime.actorMethod({ actor: {} }, { path: "rollSkill", args: [] }),
    /Actor has no method "rollSkill"/
  );
});

test("defaultRuntime.actorMethod calls the real method with templated args", async () => {
  const { defaultRuntime } = await import("../scripts/adapters/invokes.mjs");
  let received = null;
  const actor = { rollSkill: (arg) => (received = arg) };
  await defaultRuntime.actorMethod({ actor }, { path: "rollSkill", args: [{ skill: "athletics" }] });
  assert.deepEqual(received, { skill: "athletics" });
});
