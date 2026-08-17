/**
 * Custom invokes/snapshot for systems/xdz.json (Xeno Dead Zone). Covers the
 * two player-facing actor types, "commando" and "character" — they share an
 * identical DataModel and Actor#rollTraining/rollResistance verbatim, so one
 * descriptor/snapshot pair covers both with no per-type branching. Xeno/NPC/
 * Vehicle actors have no player rolls at all; the snapshot returns empty
 * training/resistances objects for them so those check-grid sections resolve
 * to zero entries and hide (`hideIfEmpty` default).
 */

// system.equipped is a plain boolean; namespaced under our own key the same
// way alienrpg's mobileActiveLabel is, so the weapons item-list's `status`
// pill can show it without a `where` filter hiding unequipped weapons.
CONFIG.XDZ.mobileEquipLabel ??= { true: "Equipped", false: "Stowed" };

const PC_TYPES = ["commando", "character"];

/**
 * XDZActor#prepareDerivedData() writes spent/budget/remaining onto
 * system.training and system.resistances alongside the five/three real
 * stat keys — iterating @system.training directly would render three bogus
 * tiles for those aggregates. Flattened down to just the real stat keys here,
 * exactly the case the descriptor's `snapshot` escape hatch is for.
 */
export function readSnapshot(actor) {
  if (!PC_TYPES.includes(actor.type)) return { training: {}, resistances: {} };
  const { pilot, systems, mechanic, weapons, medical } = actor.system.training;
  const { fear, dodge, death } = actor.system.resistances;
  return {
    training: { pilot, systems, mechanic, weapons, medical },
    resistances: { fear, dodge, death },
  };
}

/** Weapons without a secondary track (system.secondary.max === 0, e.g. a
 * plain melee weapon) don't get a Secondary/Grenade action at all — the
 * system's own weapon-card only renders that pip row `{{#if system.secondary.max}}`,
 * and item.rollSecondary() has no guard against being called on a weapon
 * that was never given one. Only surfaced while the weapon is equipped too,
 * matching the ammo/damaged tracks: a stowed weapon's resource counts aren't
 * actionable from the loadout row. Real branching on a per-item field, so
 * this lives in invokeModule rather than a static actions[] entry. */
export function weaponSecondaryAction(item) {
  if (!item.system.equipped || !(item.system.secondary?.max > 0)) return [];
  return [
    {
      icon: item.system.secondary.die ? "fas fa-explosion" : "fas fa-bolt",
      label: `${item.system.secondary.label || "Secondary"} ×${item.system.secondary.value}`,
      onSelect: () => item.rollSecondary(),
    },
  ];
}
