/**
 * Adapter for the "vagabond" system. Never reimplements rules/dice — every roll
 * or item use calls straight into vagabond's own RollHandler/SpellHandler/Item
 * methods, the same ones the system's own sheet and character-hud.mjs use, so
 * results/chat cards are identical to using the real sheet. See DESIGN.md §5a/§6.
 *
 * Sheet layout (stats/skills/saves/equipped/inventory/magic/traits/features/
 * perks split) mirrors what was actually asked for, grounded against the real
 * data model rather than guessed:
 * - equipmentType taxonomy (weapon/armor/gear/alchemical/relic) confirmed in
 *   helpers/equipment-helper.mjs.
 * - "weapon skill" is a real, named concept (CONFIG.VAGABOND.homebrew.skills[].
 *   isWeaponSkill, used elsewhere for crit-threshold calc) — Attack Skills is
 *   that subset of the Skills list, not a duplicate of the weapon-attack list.
 * - Equipped state is `system.equipmentState !== 'unequipped'` per
 *   EquipmentHelper.isEquipped(), not the `system.equipped` boolean used
 *   internally by the actor's own armor-total calc (an inconsistency in
 *   vagabond itself — isEquipped() is the maintained public helper, used here).
 * - Ancestry traits / class level-gated features / perk items confirmed in
 *   data/item-ancestry.mjs, data/item-class.mjs, data/item-perk.mjs.
 */

const clamp = (val, min, max) => Math.min(max, Math.max(min, val));

// Cached after first dynamic import — avoids re-fetching the module on every tap.
let _handlerClasses = null;
async function loadHandlerClasses() {
  if (_handlerClasses) return _handlerClasses;
  const [{ RollHandler }, { SpellHandler }] = await Promise.all([
    import("/systems/vagabond/module/sheets/handlers/roll-handler.mjs"),
    import("/systems/vagabond/module/sheets/handlers/spell-handler.mjs"),
  ]);
  _handlerClasses = { RollHandler, SpellHandler };
  return _handlerClasses;
}

function syntheticEvent(mods = {}) {
  return {
    preventDefault() {},
    shiftKey: !!mods.shiftKey,
    ctrlKey: !!mods.ctrlKey,
  };
}

async function enrich(html, actor) {
  if (!html) return "";
  try {
    return await foundry.applications.ux.TextEditor.enrichHTML(html, {
      rollData: actor.getRollData(),
      secrets: actor.isOwner,
      async: true,
    });
  } catch (_err) {
    return html;
  }
}

export const VagabondAdapter = {
  id: "vagabond",

  isAvailable() {
    return game.system.id === "vagabond" && typeof globalThis.vagabond !== "undefined";
  },

  async initHandlers(phoneApp) {
    const { RollHandler, SpellHandler } = await loadHandlerClasses();
    phoneApp._rollHandler = new RollHandler(phoneApp, { npcMode: false });
    phoneApp._spellHandler = new SpellHandler(phoneApp);
  },

  async buildSheetData(phoneApp) {
    const actor = phoneApp.actor;
    const snap = globalThis.vagabond.documents.VagabondActor.read(actor) ?? {};
    const rollHandler = phoneApp._rollHandler;
    const spellHandler = phoneApp._spellHandler;
    const { EquipmentHelper } = globalThis.vagabond.utils;

    const ancestryItem = actor.items.find((i) => i.type === "ancestry");
    const classItem = actor.items.find((i) => i.type === "class");

    const [traits, features, perks] = await Promise.all([
      buildTraits(ancestryItem, actor),
      buildFeatures(classItem, snap.level, actor),
      buildPerks(actor),
    ]);

    return {
      name: actor.name,
      img: actor.img,
      level: snap.level,
      ancestryName: ancestryItem?.name ?? "",
      ancestryImg: ancestryItem?.img ?? "",
      className: classItem?.name ?? "",
      classImg: classItem?.img ?? "",
      resources: buildResources(actor, snap),
      focus: snap.focus ?? null,
      stats: buildStats(snap),
      saves: buildSaves(snap, rollHandler),
      speed: snap.speed?.base ?? null,
      luck: buildLuck(actor, snap),
      xp: actor.system.attributes?.xp ?? 0,
      xpRequired: actor.system.attributes?.xpRequired ?? null,
      onXpDelta: (delta) => {
        const val = Math.max(0, (actor.system.attributes?.xp ?? 0) + delta);
        return actor.update({ "system.attributes.xp": val });
      },
      skills: buildSkills(snap, rollHandler, false),
      attackSkills: buildSkills(snap, rollHandler, true),
      equipped: await buildEquipped(actor, rollHandler, EquipmentHelper),
      inventory: await buildStash(actor, rollHandler, EquipmentHelper, ["weapon", "armor", "gear", "alchemical"]),
      inventorySlots: buildInventorySlots(actor),
      magic: await buildStash(actor, rollHandler, EquipmentHelper, ["relic"]),
      spells: await buildSpells(actor, spellHandler),
      traits,
      features,
      perks,
    };
  },
};

function buildResources(actor, snap) {
  const resources = [];

  if (snap.health) {
    resources.push({
      key: "health",
      label: "HP",
      value: snap.health.value,
      max: snap.health.max,
      editable: true,
      onDelta: (delta) => {
        const max = actor.system.health?.max ?? 0;
        const val = clamp((actor.system.health?.value ?? 0) + delta, 0, max);
        return actor.update({ "system.health.value": val });
      },
    });
  }

  if (snap.fatigue) {
    resources.push({
      key: "fatigue",
      label: "Fatigue",
      value: snap.fatigue.value,
      max: snap.fatigue.max,
      editable: true,
      onDelta: (delta) => {
        const max = actor.system.fatigueMax ?? 5;
        const val = clamp((actor.system.fatigue ?? 0) + delta, 0, max);
        return actor.update({ "system.fatigue": val });
      },
    });
  }

  if (snap.mana) {
    resources.push({
      key: "mana",
      label: "Mana",
      value: snap.mana.current,
      max: snap.mana.max,
      editable: true,
      onDelta: (delta) => {
        const max = actor.system.mana?.max ?? 0;
        const val = clamp((actor.system.mana?.current ?? 0) + delta, 0, max);
        return actor.update({ "system.mana.current": val });
      },
    });
  }

  return resources;
}

function buildLuck(actor, snap) {
  if (!snap.luck) return null;
  return {
    value: snap.luck.current,
    max: snap.luck.max,
    onDelta: (delta) => {
      const max = actor.system.maxLuck ?? 0;
      const val = clamp((actor.system.currentLuck ?? 0) + delta, 0, max);
      return actor.update({ "system.currentLuck": val });
    },
  };
}

function buildStats(snap) {
  const VAG = CONFIG.VAGABOND ?? {};
  return Object.entries(snap.stats ?? {}).map(([key, value]) => ({
    key,
    abbr: VAG.statAbbreviations?.[key] ?? key.slice(0, 3).toUpperCase(),
    value,
  }));
}

function buildSaves(snap, rollHandler) {
  const VAG = CONFIG.VAGABOND ?? {};
  return Object.entries(snap.saves ?? {}).map(([key, value]) => {
    const label = game.i18n.localize(VAG.saves?.[key] ?? key);
    return {
      key,
      label,
      value,
      onPress: () =>
        rollHandler.roll(syntheticEvent(), { dataset: { roll: true, type: "save", key, label } }),
    };
  });
}

function buildSkills(snap, rollHandler, weaponSkillsOnly) {
  const VAG = CONFIG.VAGABOND ?? {};
  const weaponSkillKeys = new Set(
    (VAG.homebrew?.skills ?? []).filter((s) => s.isWeaponSkill).map((s) => s.key)
  );
  return Object.entries(snap.skills ?? {})
    .filter(([key]) => weaponSkillKeys.has(key) === weaponSkillsOnly)
    .map(([key, value]) => {
      const label = game.i18n.localize(VAG.skills?.[key] ?? key);
      return {
        key,
        label,
        value,
        onPress: () =>
          rollHandler.roll(syntheticEvent(), { dataset: { roll: true, type: "skill", key, label } }),
      };
    });
}

/** Mirrors vagabond's own inventory-handler.mjs showInventoryContextMenu —
 * same Use-visibility rule, same Equip/Unequip toggle, same Bind/Unbind for
 * bound-requiring relics, same Edit/Delete (with its own confirm dialog) —
 * just rendered as an icon row inside the companion's long-press accordion
 * instead of a floating desktop-style ContextMenu. `useAction` is supplied by
 * the caller since equipped weapons attack while everything else "uses". */
function buildItemActions(actor, item, useAction, EquipmentHelper) {
  const { VagabondChatCard } = globalThis.vagabond.utils;
  const isEquipped = EquipmentHelper.isEquipped(item);
  const isArmor = EquipmentHelper.isArmor(item);
  const isGear = EquipmentHelper.isGear(item);

  let showUse = true;
  if (isArmor) showUse = false;
  else if (isGear) showUse = item.system.isConsumable === true || (item.system.handsRequired ?? 0) > 0;

  const actions = [];
  if (showUse) {
    actions.push({ icon: "fas fa-hand-sparkles", label: "Use", onSelect: useAction });
  }
  actions.push({
    icon: "fas fa-comment",
    label: "Send to Chat",
    onSelect: () => VagabondChatCard.gearUse(actor, item),
  });
  if (item.type === "equipment") {
    actions.push({
      icon: `fas fa-${isEquipped ? "times" : "check"}`,
      label: isEquipped ? "Unequip" : "Equip",
      onSelect: () => {
        const newState = isEquipped ? "unequipped" : EquipmentHelper.defaultEquipState(item);
        return EquipmentHelper.equipWithHandLimit(actor, item.id, newState);
      },
    });
  }
  if (item.system?.requiresBound) {
    const isBound = item.system.bound === true;
    actions.push({
      icon: "fa-solid fa-diamond",
      label: isBound ? "Unbind" : "Bind",
      onSelect: () => item.update({ "system.bound": !isBound }),
    });
  }
  actions.push({ icon: "fas fa-edit", label: "Edit", onSelect: () => item.sheet.render(true) });
  actions.push({
    icon: "fas fa-trash",
    label: "Delete",
    onSelect: async () => {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.format("VAGABOND.ContextMenu.DeleteItemTitle", { name: item.name }) },
        content: game.i18n.format("VAGABOND.ContextMenu.DeleteItemContent", { name: item.name }),
        rejectClose: false,
        modal: true,
      });
      if (confirmed) await item.delete();
    },
  });
  return actions;
}

/** Everything currently worn/held, any equipmentType. Weapons/alchemicals
 * attack when tapped (you use what you're holding); armor/gear/relic unequip
 * (nothing else to "do" with worn armor from a quick-access row). Long-press
 * (wired in companion-app.mjs) expands the row as an accordion: the same
 * icon-row context menu vagabond's own sheet shows on right-click, plus the
 * item's own description below it. */
function buildEquipped(actor, rollHandler, EquipmentHelper) {
  return Promise.all(
    actor.items
      .filter((item) => item.type === "equipment" && EquipmentHelper.isEquipped(item))
      .map(async (item) => {
        const isAttack = EquipmentHelper.isWeapon(item) || EquipmentHelper.isAlchemical(item);
        const useAction = () =>
          isAttack
            ? rollHandler.rollWeapon(syntheticEvent(), { dataset: { itemId: item.id } })
            : rollHandler.useItem(syntheticEvent(), { dataset: { itemId: item.id } });
        return {
          id: item.id,
          label: item.name,
          img: item.img,
          description: await enrich(item.system?.description, actor),
          onPress: (mods) =>
            isAttack
              ? rollHandler.rollWeapon(syntheticEvent(mods), { dataset: { itemId: item.id } })
              : EquipmentHelper.equipWithHandLimit(actor, item.id, "unequipped"),
          actions: buildItemActions(actor, item, useAction, EquipmentHelper),
        };
      })
  );
}

/** Unequipped weapons/armor/gear/alchemicals (+ containers) for Inventory,
 * unequipped relics for Magic. Tap uses the item directly; long-press (wired
 * in companion-app.mjs) expands the row as an accordion: same icon-row
 * context menu as buildEquipped above, plus the item's own description. */
function buildStash(actor, rollHandler, EquipmentHelper, equipmentTypes) {
  return Promise.all(
    actor.items
      .filter((item) => {
        if (EquipmentHelper.isEquipped(item)) return false;
        if (item.type === "container") return equipmentTypes.includes("gear");
        return item.type === "equipment" && equipmentTypes.includes(item.system.equipmentType);
      })
      .map(async (item) => {
        const useAction = () => rollHandler.useItem(syntheticEvent(), { dataset: { itemId: item.id } });
        return {
          id: item.id,
          label: item.name,
          img: item.img,
          qty: item.system?.quantity ?? null,
          description: await enrich(item.system?.description, actor),
          onPress: useAction,
          actions: buildItemActions(actor, item, useAction, EquipmentHelper),
        };
      })
  );
}

/** Inventory accordion title shows "available/max" slots (character actors
 * only — NPCs carry no slot economy in vagabond's data model). */
function buildInventorySlots(actor) {
  const inv = actor.system?.inventory;
  if (!inv || inv.maxSlots == null) return null;
  return { available: Math.max(0, inv.availableSlots ?? inv.maxSlots), max: inv.maxSlots };
}

function buildSpells(actor, spellHandler) {
  return Promise.all(
    actor.items
      .filter((item) => item.type === "spell")
      .map(async (item) => ({
        id: item.id,
        label: item.name,
        img: item.img,
        description: await enrich(item.system?.description, actor),
        onPress: () => spellHandler.castSpell(syntheticEvent(), { dataset: { spellId: item.id } }),
      }))
  );
}

async function buildTraits(ancestryItem, actor) {
  const traits = ancestryItem?.system?.traits ?? [];
  return Promise.all(
    traits.map(async (t, i) => ({
      id: `trait-${i}`,
      name: t.name,
      description: await enrich(t.description, actor),
    }))
  );
}

async function buildFeatures(classItem, level, actor) {
  const features = (classItem?.system?.levelFeatures ?? []).filter((f) => f.level <= (level ?? 0));
  return Promise.all(
    features.map(async (f, i) => ({
      id: `feature-${i}`,
      name: f.name,
      level: f.level,
      description: await enrich(f.description, actor),
    }))
  );
}

async function buildPerks(actor) {
  const perks = actor.items.filter((i) => i.type === "perk");
  return Promise.all(
    perks.map(async (item) => ({
      id: item.id,
      name: item.name,
      description: await enrich(item.system?.description, actor),
    }))
  );
}
