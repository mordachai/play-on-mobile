/**
 * Custom invokes/predicates/actions for systems/vagabond.json — the code
 * side of the vagabond descriptor. Everything the JSON layout genuinely
 * cannot express safely lives here, and every piece of it DELEGATES to
 * vagabond's own code rather than re-implementing it:
 *  - rolls: RollHandler / SpellHandler (same classes the desktop sheet uses);
 *  - item taps: activateHandItem() — the desktop sheet's own rollWeapon /
 *    useItem path (auto-equip a hand item, light-source toggle, attack, use);
 *  - item / spell long-press menus: buildItemMenuItems() /
 *    buildSpellMenuItems() — the exact entry set the desktop sheet, HUD and
 *    inventory grid show on right-click (Attack with <skill>, Throw,
 *    Quantity, Stack, grip, Equip in Hands / Belt, Bind, Focus, Favorite…),
 *    so the phone tracks vagabond as it changes instead of drifting;
 *  - pools with side effects (Luck, Studied Die, Check Mod, Rush, Feature
 *    Actions, status cards): ActorActions' own static sheet handlers,
 *    called against the actor's real (unrendered) sheet instance.
 *
 * Loaded once per companion session via descriptor.invokeModule and cached
 * on the phoneApp instance (see descriptor-engine.mjs loadCustom()).
 */

const SYS = "/systems/vagabond/module";

/** Every vagabond module this file needs, imported once up front (top-level
 * await) so the synchronous snapshot read below can use them. Same URLs
 * vagabond itself resolves, so these are the very same module instances —
 * static registries like FeatureAction's live-state map are shared. Each
 * import is settled independently: a file vagabond moves or renames later
 * drops only the features built on it, not the whole sheet. */
const V = await (async () => {
  const specs = {
    handlers: `${SYS}/sheets/handlers/_module.mjs`,
    itemMenu: `${SYS}/helpers/item-menu.mjs`,
    handItem: `${SYS}/helpers/hand-item-activation.mjs`,
    actorActions: `${SYS}/sheets/actor-actions.mjs`,
    featureAction: `${SYS}/helpers/feature-action.mjs`,
    rush: `${SYS}/helpers/rush-helper.mjs`,
  };
  const entries = await Promise.all(
    Object.entries(specs).map(async ([name, url]) => {
      try {
        return [name, await import(url)];
      } catch (err) {
        console.warn(`play-on-mobile | vagabond: could not load ${url} — dependent features disabled`, err);
        return [name, null];
      }
    })
  );
  return Object.fromEntries(entries);
})();

const { RollHandler, SpellHandler, EquipmentHandler } = V.handlers ?? {};
const { buildItemMenuItems, buildSpellMenuItems, itemHasUse } = V.itemMenu ?? {};
const { activateHandItem } = V.handItem ?? {};
const { ActorActions } = V.actorActions ?? {};
const { FeatureAction } = V.featureAction ?? {};
const { RushHelper } = V.rush ?? {};

/** RollHandler / SpellHandler / EquipmentHandler, created lazily and cached
 * on phoneApp — re-created when the bound actor changes (the handlers
 * capture `sheet.actor` at construction, so a cached set would otherwise
 * keep rolling for the previously picked actor).
 *
 * EquipmentHandler gets a minimal sheet shim rather than phoneApp: its
 * methods call `this.sheet.submit()` when `hasFrame` is set, and the
 * companion app has no form to submit. */
function getHandlers(phoneApp) {
  const actor = phoneApp.actor;
  if (phoneApp._vagabondHandlersFor !== actor) {
    phoneApp._rollHandler = new RollHandler(phoneApp, { npcMode: false });
    phoneApp._spellHandler = new SpellHandler(phoneApp);
    phoneApp._equipmentHandler = EquipmentHandler ? new EquipmentHandler({ actor, hasFrame: false }) : null;
    phoneApp._vagabondHandlersFor = actor;
  }
  return {
    rollHandler: phoneApp._rollHandler,
    spellHandler: phoneApp._spellHandler,
    equipmentHandler: phoneApp._equipmentHandler,
  };
}

/** Stand-in for the DOM event a desktop sheet handler receives. `mods`
 * carries the tap's shift/ctrl (a held modifier on a tablet keyboard) and,
 * for ActorActions handlers that branch on it, the mouse button. */
function fakeEvent(mods = {}) {
  return {
    preventDefault() {},
    stopPropagation() {},
    shiftKey: !!mods.shiftKey,
    ctrlKey: !!mods.ctrlKey,
    altKey: !!mods.altKey,
    button: mods.button ?? 0,
    type: mods.type ?? "click",
    clientX: 0,
    clientY: 0,
  };
}

/** Calls one of ActorActions' static desktop-sheet handlers with the real
 * sheet instance as `this` (it reads `this.actor`), exactly as the sheet's
 * own action dispatch would. `actor.sheet` only constructs the sheet object
 * — nothing renders. */
function sheetAction(actor, name, mods, dataset = {}) {
  const fn = ActorActions?.[name];
  if (typeof fn !== "function") {
    console.warn(`play-on-mobile | vagabond: ActorActions.${name} not found`);
    return undefined;
  }
  return fn.call(actor.sheet, fakeEvent(mods), { dataset });
}

/** The descriptor's `snapshot` field — VagabondActor.read() unwraps/renames
 * fields (stats[key].total -> a bare number, fatigue+fatigueMax -> one
 * {value,max} pair, character-vs-NPC speed shapes -> one {base} shape, ...)
 * in ways plain @system paths can't express; delegating to it here means
 * the descriptor never re-implements that logic. Also folds in the
 * inventory slot calc and the sheet-only reads the phone needs (Rush state,
 * feature actions, active statuses). */
export function readSnapshot(actor) {
  const snap = globalThis.vagabond.documents.VagabondActor.read(actor) ?? {};
  const s = actor.system ?? {};
  const inv = s.inventory;
  snap.slots = inv && inv.maxSlots != null ? { available: Math.max(0, inv.availableSlots ?? inv.maxSlots), max: inv.maxSlots } : null;

  snap.favorHinder = s.favorHinder || "none";
  snap.hasFavorHinder = s.favorHinder !== undefined;
  snap.checkBonus = s.manualCheckBonus ?? 0;
  snap.studiedDice = s.studiedDice ?? 0;
  snap.canLevelUp = !!s.attributes?.canLevelUp;

  // Speed label = Rush toggle on desktop; shows the extra feet while Rushing.
  const rush = actor.type === "character" ? RushHelper?.info(actor) : null;
  snap.rush = rush;
  if (snap.speed) {
    snap.speed.display = rush?.active ? `${snap.speed.base} +${rush.feet}'` : snap.speed.base;
  }

  snap.featureActions = collectFeatureActions(actor, snap.level);
  snap.statusEffects = collectStatusEffects(actor);
  return snap;
}

/** Every enabled Feature Action the desktop Features tab shows a button for
 * (ancestry traits, class features up to the actor's level, perks), keyed
 * by FeatureAction's own "<itemId>|<path>" key. FeatureAction.row() does
 * the enabled/label/live-state read, so nothing here guesses at it. */
function collectFeatureActions(actor, level) {
  if (!FeatureAction) return {};
  const out = {};
  const add = (item, path, fallback) => {
    const row = FeatureAction.row(actor, item, path, fallback);
    if (!row) return;
    out[row.key] = { label: row.label, active: row.active, count: row.count || "" };
  };
  for (const item of actor.items ?? []) {
    if (item.type === "ancestry") {
      (item.system.traits ?? []).forEach((t, i) => add(item, `traits.${i}.action`, t?.name ?? item.name));
    } else if (item.type === "class") {
      (item.system.levelFeatures ?? []).forEach((f, i) => {
        if (level != null && (f?.level ?? 0) > level) return;
        add(item, `levelFeatures.${i}.action`, f?.name ?? item.name);
      });
    } else if (item.type === "perk") {
      add(item, "action", item.name);
    }
  }
  return out;
}

/** Same filter as the desktop sheet's status-icon strip
 * (ActorActions._prepareStatusEffects): enabled effects carrying one of
 * CONFIG.statusEffects' ids. */
function collectStatusEffects(actor) {
  const valid = new Set((CONFIG.statusEffects ?? []).map((s) => s.id));
  const out = {};
  for (const effect of actor.effects ?? []) {
    if (effect.disabled) continue;
    if (!Array.from(effect.statuses ?? []).some((id) => valid.has(id))) continue;
    out[effect.id] = { name: effect.name || "Unknown", value: "" };
  }
  return out;
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

function homebrewSkill(key) {
  return (CONFIG.VAGABOND?.homebrew?.skills ?? []).find((s) => s.key === key);
}

export function isWeaponSkill(_subject, ctx) {
  return !!homebrewSkill(ctx.key)?.isWeaponSkill;
}

/** The desktop Skills column lists every non-weapon skill PLUS the weapon
 * skills flagged `showInSkillsList` (Brawl, Finesse — they double as
 * regular checks), so those show in both mobile grids too. */
export function isNonWeaponSkill(_subject, ctx) {
  const skill = homebrewSkill(ctx.key);
  return !skill?.isWeaponSkill || !!skill.showInSkillsList;
}

// ---- invokes -------------------------------------------------------------

function localizedLabel(table, key) {
  const VAG = CONFIG.VAGABOND ?? {};
  return game.i18n.localize(VAG[table]?.[key] ?? key);
}

/** Saves and skills read the actor's persistent Favor / Hinder
 * (system.favorHinder, set from the sheet's segmented control) and Check
 * Mod inside RollHandler.roll() itself — same as the desktop sheet. */
export async function rollSave(ctx) {
  const { rollHandler } = getHandlers(ctx.phoneApp);
  const label = localizedLabel("saves", ctx.key);
  return rollHandler.roll(fakeEvent(ctx.event), { dataset: { roll: true, type: "save", key: ctx.key, label } });
}

export async function rollSkill(ctx) {
  const { rollHandler } = getHandlers(ctx.phoneApp);
  const label = localizedLabel("skills", ctx.key);
  return rollHandler.roll(fakeEvent(ctx.event), { dataset: { roll: true, type: "skill", key: ctx.key, label } });
}

/** Item row tap (Equipped / Inventory / Magic): the desktop sheet's own
 * rollWeapon/useItem path — activateHandItem() draws a hand item into the
 * hands first if needed, then attacks / toggles a light source / uses it.
 * Items with no "Use" on desktop (armor, plain gear) open their action
 * accordion instead of doing something the desktop sheet wouldn't. */
async function activateItem(ctx) {
  const { item, actor } = ctx;
  if (itemHasUse && !itemHasUse(item)) {
    return ctx.phoneApp._toggleAccordion?.(`${ctx.sectionId}:${item.id}`);
  }
  const { rollHandler } = getHandlers(ctx.phoneApp);
  return activateHandItem({ actor, item, event: fakeEvent(ctx.event), rollHandler });
}

export async function equippedPress(ctx) {
  return activateItem(ctx);
}

export async function useItem(ctx) {
  return activateItem(ctx);
}

export async function castSpell(ctx) {
  const { spellHandler } = getHandlers(ctx.phoneApp);
  return spellHandler.castSpell(fakeEvent(ctx.event), { dataset: { spellId: ctx.item.id } });
}

// ---- resource pools with desktop side effects -------------------------

/** Luck +/-: the sheet's own spendLuck (−1 posts the Luck-spent card,
 * Shift = +1 posts the gain card; RAW the Luck stat is not a cap). */
export async function adjustLuck(ctx) {
  return sheetAction(ctx.actor, "_onSpendLuck", { shiftKey: ctx.vars?.delta > 0 });
}

/** Studied Die +/-: −1 rolls the d6 and posts it, +1 adds a die (Shift). */
export async function adjustStudiedDie(ctx) {
  return sheetAction(ctx.actor, "_onSpendStudiedDie", { shiftKey: ctx.vars?.delta > 0 });
}

/** Check Mod +/-: left click +1, right click −1 on desktop. Reset to 0 by
 * vagabond after the next roll. */
export async function adjustCheckBonus(ctx) {
  const down = ctx.vars?.delta < 0;
  return sheetAction(ctx.actor, "_onModifyCheckBonus", { button: down ? 2 : 0, type: down ? "contextmenu" : "click" });
}

/** Speed label: take / end the Rush Action (RushHelper refuses when the
 * actor can't Rush). */
export async function toggleRush(ctx) {
  return sheetAction(ctx.actor, "_onToggleRush", ctx.event);
}

/** XP label while a level is ready: the sheet's Level Up dialog. */
export async function levelUp(ctx) {
  const LevelUpDialog = globalThis.vagabond.applications?.LevelUpDialog;
  if (LevelUpDialog) return new LevelUpDialog(ctx.actor).render(true);
  return undefined;
}

/** Feature Action button: the sheet's own featureAction handler (runs the
 * macro, ends a pure on/off action that's lit, opens the Alchemy lab for
 * Catalyze / Mix). */
export async function runFeatureAction(ctx) {
  return sheetAction(ctx.actor, "_onFeatureAction", ctx.event, { actionKey: ctx.key });
}

/** Status chip: posts the status card to chat, like clicking its icon. */
export async function statusToChat(ctx) {
  return sheetAction(ctx.actor, "_onStatusClick", ctx.event, { effectId: ctx.key });
}

// ---- item / spell action rows (long-press accordions) ------------------

/** Converts vagabond's ContextMenuHelper entries into the companion's
 * action shape. A `stepper` entry (Quantity) becomes a +/- track in the
 * accordion (see descriptor-engine buildItemEntry); disabled entries drop. */
function fromMenuItems(menuItems) {
  return menuItems
    .filter((m) => m && m.enabled !== false)
    .map((m) => {
      if (m.stepper) {
        return {
          label: m.label,
          stepper: { value: m.stepper.value, onDelta: (delta) => m.stepper.onChange(delta) },
        };
      }
      return { icon: m.icon, label: m.label, onSelect: () => m.action?.() };
    });
}

function deleteAction(item) {
  return {
    icon: "fas fa-trash",
    label: game.i18n.localize("VAGABOND.ContextMenu.Delete"),
    onSelect: async () => {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.format("VAGABOND.ContextMenu.DeleteItemTitle", { name: item.name }) },
        content: game.i18n.format("VAGABOND.ContextMenu.DeleteItemContent", { name: item.name }),
        rejectClose: false,
        modal: true,
      });
      if (confirmed) await item.delete();
    },
  };
}

/** Same entries as vagabond's inventory/Equipped right-click menu
 * (InventoryHandler.showInventoryContextMenu): buildItemMenuItems() plus
 * Delete. */
export function itemActions(item, itemCtx) {
  if (!buildItemMenuItems) return [deleteAction(item)];
  const { rollHandler, equipmentHandler } = getHandlers(itemCtx.phoneApp);
  const menu = buildItemMenuItems({
    actor: itemCtx.actor,
    item,
    event: fakeEvent(),
    rollHandler,
    equipmentHandler,
  });
  return [...fromMenuItems(menu), deleteAction(item)];
}

/** Same entries as the favorited-spell / HUD spell right-click menu: Cast,
 * Focus ⇄ Stop Focusing, Dismiss (while something is on the map), Open,
 * Send to Chat, Favorite ⇄ Unfavorite. */
export function spellActions(spell, itemCtx) {
  if (!buildSpellMenuItems) return [];
  const { spellHandler } = getHandlers(itemCtx.phoneApp);
  return fromMenuItems(buildSpellMenuItems({ actor: itemCtx.actor, spell, event: fakeEvent(), spellHandler }));
}
