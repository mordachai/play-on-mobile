/**
 * Invoke-kind dispatch (see docs/system-adapters-plan.md §5.8). The actual
 * side effects — calling actor.rollSkill(), evaluating a Roll, clicking into
 * a live sheet, ... — live behind an injectable `runtime` so a single
 * dispatch table works for every descriptor with no per-system code, and so
 * this file is unit-testable with a fake runtime outside a running Foundry
 * instance.
 */
import { templateValue, getProperty } from "./resolve.mjs";

function mergeEvent(mods = {}) {
  return {
    preventDefault() {},
    shiftKey: !!mods.shiftKey,
    ctrlKey: !!mods.ctrlKey,
    altKey: !!mods.altKey,
  };
}

/** Real side effects, used whenever the caller doesn't inject a runtime
 * override (tests do). Every method receives the already `{key}`-templated
 * invoke descriptor plus the resolved ctx (actor/item/entry/event). */
export const defaultRuntime = {
  async actorMethod(ctx, { path, args = [], options }) {
    const fn = getProperty(ctx.actor, path);
    if (typeof fn !== "function") throw new Error(`Actor has no method "${path}"`);
    return fn.apply(ctx.actor, options !== undefined ? [...args, options] : args);
  },
  async itemMethod(ctx, { path, args = [], options }) {
    const fn = getProperty(ctx.item, path);
    if (typeof fn !== "function") throw new Error(`Item has no method "${path}"`);
    return fn.apply(ctx.item, options !== undefined ? [...args, options] : args);
  },
  async propMethod(ctx, { path, call, args = [], options }) {
    const owner = getProperty(ctx.actor, path) ?? ctx.actor;
    const fn = owner?.[call];
    if (typeof fn !== "function") throw new Error(`No method "${call}" at "${path}"`);
    return fn.apply(owner, options !== undefined ? [...args, options] : args);
  },
  async formula(ctx, { formula, flavor }) {
    const roll = new Roll(formula, ctx.actor.getRollData());
    await roll.evaluate();
    return roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: ctx.actor }), flavor });
  },
  async update(ctx, { target, set }) {
    const doc = target === "item" ? ctx.item : ctx.actor;
    return doc.update(set);
  },
  async sheetClick(ctx, { selector }) {
    const sheet = ctx.item?.sheet ?? ctx.actor.sheet;
    await sheet.render(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const root = sheet.element?.querySelector ? sheet.element : sheet.element?.[0];
    const el = root?.querySelector?.(selector);
    el?.click();
    return sheet.close();
  },
};

/** Runs one invoke descriptor. `ctx` = { actor, item, entry, key, vars,
 * event, custom, runtime }. `ctx.event` mods win over the descriptor's own
 * `event` default (e.g. a long-press wanting the roll dialog even though the
 * descriptor default fast-forwards it). */
export async function runInvoke(invoke, ctx = {}) {
  if (!invoke) return undefined;
  const vars = { key: ctx.key, ...(ctx.vars ?? {}) };
  const templated = templateValue(invoke, vars);

  if (templated.kind === "custom") {
    const fn = ctx.custom?.[templated.fn];
    if (typeof fn !== "function") throw new Error(`No custom invoke "${templated.fn}"`);
    return fn({ ...ctx, event: mergeEvent({ ...invoke.event, ...ctx.event }) });
  }

  const runtime = ctx.runtime ?? defaultRuntime;
  const handler = runtime[templated.kind];
  if (typeof handler !== "function") throw new Error(`Unknown invoke kind "${templated.kind}"`);
  return handler({ ...ctx, event: mergeEvent({ ...invoke.event, ...ctx.event }) }, templated);
}
