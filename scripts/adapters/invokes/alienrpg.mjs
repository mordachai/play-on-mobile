/**
 * Custom invokes/snapshot for systems/alienrpg.json (Alien RPG — Evolved
 * ruleset). Covers both "character" and "synthetic" actor types: alienrpg's
 * own data models and Actor#abilityRoll/rollStress/rollResolve are shared
 * verbatim between the two (a synthetic without system.header.synthstress
 * simply no-ops rollStress/rollResolve internally — nothing special to do
 * here).
 *
 * Every alienrpg roll method takes `(actor, dataset)` — the actor passed to
 * itself — which the generic actorMethod invoke kind can't express (its
 * `args` are static JSON, not resolved expressions), so every actor-level
 * roll here goes through `custom` instead.
 *
 * `dataset.roll` must be built as a non-empty STRING: the system's own sheet
 * reads it off a real DOM dataset, where even "0" is a truthy string — a JS
 * number 0 would silently no-op the whole roll (`if (dataset.roll)`).
 */

// alienrpg's own CONFIG.ALIENRPG.attributes maps each key to a full
// localized name ("Strength"), not a short code — but the stat-row renderer
// only ever displays `entry.abbr` (companion-sheet.hbs), never a full label.
// Namespaced under our own key so it can't collide with anything the system
// itself defines; the descriptor's stat-row `abbr` field points at this.
CONFIG.ALIENRPG.mobileAttrAbbr ??= { str: "STR", wit: "WIT", agl: "AGL", emp: "EMP" };

// system.header.active is a tri-state string ("true" carried/equipped,
// "false" carried but inactive, "fLocker" stowed in the Foot Locker — see
// character-sheet.mjs's addToFLocker/moveFromFlocker). Namespaced the same
// way as mobileAttrAbbr above so the descriptor's item-list `status` field
// can turn it into a pill without a where-filter hiding inactive/locker
// items from the companion sheet entirely.
CONFIG.ALIENRPG.mobileActiveLabel ??= { true: "Active", false: "Inactive", fLocker: "Foot Locker" };

export function readSnapshot(actor) {
  return {
    checks: {
      panic: { panic: { value: actor.system.header.stress.value } },
      resolve: { resolve: { value: actor.system.header.resolve.calculatedMax } },
    },
  };
}

export function rollAttribute(ctx) {
  const { actor, entry, key } = ctx;
  const label = game.i18n.localize(CONFIG.ALIENRPG.attributes[key] ?? key);
  return actor.abilityRoll(actor, { attr: "attribute", roll: String(entry?.mod ?? 0), label });
}

export function rollSkill(ctx) {
  const { actor, entry, key } = ctx;
  const label = game.i18n.localize(CONFIG.ALIENRPG.skills[key]?.name ?? key);
  return actor.abilityRoll(actor, { roll: String(entry?.mod ?? 0), label });
}

/** Armor is rolled off the actor's total armor rating (summed from active
 * armor items by the system's own prepareDerivedData), not per-item — so
 * every row in the Armor list rolls the same actor-level check, matching
 * what tapping the header "Armor" button does on the desktop sheet. */
export function rollArmor(ctx) {
  const { actor } = ctx;
  const value = actor.system.general.armor.value ?? 0;
  return actor.abilityRoll(actor, { roll: String(value), spbutt: "armor", label: game.i18n.localize("ALIENRPG.Armor") });
}

export function rollPanicCheck(ctx) {
  return ctx.actor.rollStress(ctx.actor, {});
}

export function rollResolveCheck(ctx) {
  return ctx.actor.rollResolve(ctx.actor, {});
}
