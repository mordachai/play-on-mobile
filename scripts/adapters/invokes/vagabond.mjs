/**
 * Custom invokes/predicates/actions for systems/vagabond.json — the code
 * side of the vagabond descriptor. Everything the JSON layout genuinely
 * cannot express safely lives here: calls into vagabond's own
 * RollHandler/SpellHandler (never reimplement dice), EquipmentHelper's
 * isEquipped()/isWeapon() helpers (see the "inconsistency in vagabond
 * itself" note below — the plain JSON `where` vocabulary must not
 * re-guess this), and the Use-visibility/action-set branching that used
 * to live in vagabond-adapter.mjs's buildItemActions().
 *
 * Loaded once per companion session via descriptor.invokeModule and cached
 * on the phoneApp instance (see descriptor-engine.mjs loadCustom()).
 */

// Cached after first dynamic import — avoids re-fetching on every tap.
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

/** Lazily creates and caches RollHandler/SpellHandler on phoneApp — same
 * instances vagabond-adapter.mjs used to create eagerly in initHandlers().
 * Lazy here instead: nothing in the generic engine needs to know these
 * exist until an invoke actually fires. */
async function getHandlers(phoneApp) {
  if (!phoneApp._rollHandler) {
    const { RollHandler, SpellHandler } = await loadHandlerClasses();
    phoneApp._rollHandler = new RollHandler(phoneApp, { npcMode: false });
    phoneApp._spellHandler = new SpellHandler(phoneApp);
  }
  return { rollHandler: phoneApp._rollHandler, spellHandler: phoneApp._spellHandler };
}

function blankEvent() {
  return { preventDefault() {}, shiftKey: false, ctrlKey: false };
}

/** The descriptor's `snapshot` field — VagabondActor.read() unwraps/renames
 * fields (stats[key].total -> a bare number, fatigue+fatigueMax -> one
 * {value,max} pair, character-vs-NPC speed shapes -> one {base} shape, ...)
 * in ways plain @system paths can't express; delegating to it here means
 * the descriptor never re-implements that logic. Also folds in the
 * inventory slot calc (clamped, defaulted) for the same reason. */
export function readSnapshot(actor) {
  const snap = globalThis.vagabond.documents.VagabondActor.read(actor) ?? {};
  const inv = actor.system?.inventory;
  snap.slots = inv && inv.maxSlots != null ? { available: Math.max(0, inv.availableSlots ?? inv.maxSlots), max: inv.maxSlots } : null;
  return snap;
}

// ---- where.custom predicates -------------------------------------------

/** Mirrors EquipmentHelper.isEquipped()'s own definition rather than
 * guessing at it via a `where` field comparator — see the equipmentState-
 * vs-equipped inconsistency noted in the old vagabond-adapter.mjs header. */
export function isEquipped(item) {
  return globalThis.vagabond.utils.EquipmentHelper.isEquipped(item);
}

const STASH_TYPES = ["weapon", "armor", "gear", "alchemical"];

/** Inventory: unequipped weapons/armor/gear/alchemicals, plus containers
 * (containers count as "gear" for this purpose only). */
export function isStashItem(item) {
  const { EquipmentHelper } = globalThis.vagabond.utils;
  if (EquipmentHelper.isEquipped(item)) return false;
  if (item.type === "container") return true;
  return item.type === "equipment" && STASH_TYPES.includes(item.system.equipmentType);
}

/** Magic: unequipped relics. Containers never count here — "relic" isn't
 * in the gear-ish set containers stand in for. */
export function isStashRelic(item) {
  const { EquipmentHelper } = globalThis.vagabond.utils;
  if (EquipmentHelper.isEquipped(item)) return false;
  if (item.type === "container") return false;
  return item.type === "equipment" && item.system.equipmentType === "relic";
}

function weaponSkillKeys() {
  const VAG = CONFIG.VAGABOND ?? {};
  return new Set((VAG.homebrew?.skills ?? []).filter((s) => s.isWeaponSkill).map((s) => s.key));
}

export function isWeaponSkill(_subject, ctx) {
  return weaponSkillKeys().has(ctx.key);
}

export function isNonWeaponSkill(_subject, ctx) {
  return !weaponSkillKeys().has(ctx.key);
}

// ---- invokes -------------------------------------------------------------

function localizedLabel(table, key) {
  const VAG = CONFIG.VAGABOND ?? {};
  return game.i18n.localize(VAG[table]?.[key] ?? key);
}

export async function rollSave(ctx) {
  const { rollHandler } = await getHandlers(ctx.phoneApp);
  const label = localizedLabel("saves", ctx.key);
  return rollHandler.roll(blankEvent(), { dataset: { roll: true, type: "save", key: ctx.key, label } });
}

export async function rollSkill(ctx) {
  const { rollHandler } = await getHandlers(ctx.phoneApp);
  const label = localizedLabel("skills", ctx.key);
  return rollHandler.roll(blankEvent(), { dataset: { roll: true, type: "skill", key: ctx.key, label } });
}

/** Equipped row tap: weapons/alchemicals attack (forwarding shift/ctrl fast-
 * forward mods from the actual tap); everything else worn just unequips —
 * nothing else to "do" with worn armor from a quick-access tap. */
export async function equippedPress(ctx) {
  const { EquipmentHelper } = globalThis.vagabond.utils;
  const isAttack = EquipmentHelper.isWeapon(ctx.item) || EquipmentHelper.isAlchemical(ctx.item);
  if (isAttack) {
    const { rollHandler } = await getHandlers(ctx.phoneApp);
    return rollHandler.rollWeapon(ctx.event, { dataset: { itemId: ctx.item.id } });
  }
  return EquipmentHelper.equipWithHandLimit(ctx.actor, ctx.item.id, "unequipped");
}

export async function castSpell(ctx) {
  const { spellHandler } = await getHandlers(ctx.phoneApp);
  return spellHandler.castSpell(blankEvent(), { dataset: { spellId: ctx.item.id } });
}

/** Shared by the Inventory/Magic row tap AND the "Use" action button inside
 * any item's expanded accordion (equipped, inventory, magic alike) — an
 * equipped attack item's Use action still attacks, matching what tapping
 * the row itself does; everything else "uses". */
async function performUse(item, ctx) {
  const { EquipmentHelper } = globalThis.vagabond.utils;
  const { rollHandler } = await getHandlers(ctx.phoneApp);
  const isAttack = EquipmentHelper.isWeapon(item) || EquipmentHelper.isAlchemical(item);
  if (ctx.sectionId === "equipped" && isAttack) {
    return rollHandler.rollWeapon(blankEvent(), { dataset: { itemId: item.id } });
  }
  return rollHandler.useItem(blankEvent(), { dataset: { itemId: item.id } });
}

export async function useItem(ctx) {
  return performUse(ctx.item, ctx);
}

// ---- item action row (equipped / inventory / magic accordions) ----------

/** Mirrors vagabond's own inventory-handler.mjs showInventoryContextMenu —
 * same Use-visibility rule, same Equip/Unequip toggle, same Bind/Unbind for
 * bound-requiring relics, same Edit/Delete (with its own localized confirm
 * dialog) — rendered as an icon row inside the companion's long-press
 * accordion instead of a floating desktop-style ContextMenu. Real branching
 * (armor never "uses", gear only if consumable/two-handed) is exactly the
 * kind of logic the plan keeps out of the JSON `actions` vocabulary. */
export function itemActions(item, itemCtx) {
  const { actor } = itemCtx;
  const { VagabondChatCard, EquipmentHelper } = globalThis.vagabond.utils;
  const isItemEquipped = EquipmentHelper.isEquipped(item);
  const isArmor = EquipmentHelper.isArmor(item);
  const isGear = EquipmentHelper.isGear(item);

  let showUse = true;
  if (isArmor) showUse = false;
  else if (isGear) showUse = item.system.isConsumable === true || (item.system.handsRequired ?? 0) > 0;

  const actions = [];
  if (showUse) {
    actions.push({ icon: "fas fa-hand-sparkles", label: "Use", onSelect: () => performUse(item, itemCtx) });
  }
  actions.push({
    icon: "fas fa-comment",
    label: "Send to Chat",
    onSelect: () => VagabondChatCard.gearUse(actor, item),
  });
  if (item.type === "equipment") {
    actions.push({
      icon: `fas fa-${isItemEquipped ? "times" : "check"}`,
      label: isItemEquipped ? "Unequip" : "Equip",
      onSelect: () => {
        const newState = isItemEquipped ? "unequipped" : EquipmentHelper.defaultEquipState(item);
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
