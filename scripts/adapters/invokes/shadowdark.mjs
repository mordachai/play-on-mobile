/**
 * Custom invokes/predicates/snapshot for systems/shadowdark.json.
 *
 * Shadowdark's own dice logic (ability checks, attacks, spellcasting) lives
 * entirely on the *system data model* (actor.system.rollStatCheck /
 * rollAttack / castSpell / useAbility / usePotion / learnSpell — see
 * src/models/PlayerSD.mjs and _ActorBaseSD.mjs), not on the actor document
 * itself, and several of them need the tapped item's uuid as an argument —
 * something a plain `actorMethod`/`propMethod` invoke can't thread through
 * (its `args` only template a bare "{key}", not an "@item.uuid" expression).
 * Hence everything routes through this module's `custom` fns instead.
 *
 * ancestry/background/class/deity/patron are `DocumentUUIDField`s, not
 * embedded items, so `@items.<type>` (which only looks at actor.items)
 * can't reach them. The `snapshot` fn below resolves them once per render
 * via `fromUuidSync` (mirrors shadowdark.utils.getFromUuidSync's own
 * graceful-fallback pattern) — this only works once Foundry has already
 * cached those compendium documents (typically true once the player's own
 * desktop sheet has been opened this session), which is an accepted
 * limitation of the sync-only snapshot contract (descriptor-engine.mjs
 * calls the snapshot fn without awaiting it).
 */

function resolveLinkedName(uuid) {
  if (!uuid) return "";
  const doc = shadowdark.utils.getFromUuidSync(uuid);
  return doc?.name && doc.name !== "[Invalid ID]" ? doc.name : "";
}

export function readSnapshot(actor) {
  const sys = actor.system;
  const pulpMode = game.settings.get("shadowdark", "usePulpMode");

  const languages = (sys.languages ?? [])
    .map((uuid) => shadowdark.utils.getFromUuidSync(uuid))
    .filter((l) => l?.name && l.name !== "[Invalid ID]")
    .map((l) => ({ name: l.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    className: resolveLinkedName(sys.class),
    ancestryName: resolveLinkedName(sys.ancestry),
    backgroundName: resolveLinkedName(sys.background),
    deityName: resolveLinkedName(sys.deity),
    patronName: resolveLinkedName(sys.patron),
    xpNext: (sys.level?.value ?? 0) * 10,
    pulpMode,
    notPulpMode: !pulpMode,
    // Boolean luck.available rendered as a plain "true/false" string via a
    // resources chip would be ugly (see companion-sheet.hbs's {{value}}/{{max}}
    // display) — expose it pre-cast to 0/1 so it reads like every other pool.
    luckAvailable: sys.luck?.available ? 1 : 0,
    languages,
  };
}

// ---- invokes (item-list row tap) -----------------------------------------

export async function rollAttack(ctx) {
  return ctx.actor.system.rollAttack(
    ctx.item.uuid,
    ctx.actor.buildOptionsForSkipPrompt(ctx.event)
  );
}

/** Embedded Spell items cast themselves (spellUuid === item.uuid); Scroll
 * items cast the spell they're printed with. Wands hold multiple spells and
 * are deliberately not wired here — casting a specific one needs the wand's
 * own sheet (see itemActions below). */
export async function castSpell(ctx) {
  const item = ctx.item;
  const spellUuid = item.type === "Scroll" ? item.system.spellUuid : item.uuid;
  if (!spellUuid) return;
  return ctx.actor.system.castSpell(spellUuid, { itemUuid: item.uuid });
}

export async function usePotion(ctx) {
  return ctx.actor.system.usePotion(ctx.item.id);
}

export async function useAbility(ctx) {
  return ctx.actor.system.useAbility(
    ctx.item.uuid,
    ctx.actor.buildOptionsForSkipPrompt(ctx.event)
  );
}

/** Generic row tap for armor/scrolls/wands/gear/gems: light sources toggle
 * on tap (matches the desktop sheet's quick-access behavior); everything
 * else posts its item card to chat. */
export async function itemPress(ctx) {
  const item = ctx.item;
  if (item.system.light?.isSource) {
    return ctx.actor.toggleLight(!item.system.light.active, item.id);
  }
  return shadowdark.chat.showItemCard(item.uuid);
}

// ---- item action row (long-press accordion) ------------------------------

/* Icons below mirror the exact glyphs the desktop inventory row uses for
 * these actions (templates/actors/player/inventory/item.hbs) — the row
 * doesn't swap glyphs for on/off state, it recolors the same one, so we
 * don't either; the button label carries the state instead. */
function equipToggleAction(item) {
  const equipped = item.system.equipped;
  return {
    icon: "fas fa-user-shield",
    label: equipped ? "Unequip" : "Equip",
    onSelect: () => item.update({ "system.equipped": !equipped, "system.stashed": false }),
  };
}

function stashToggleAction(item) {
  const stashed = item.system.stashed;
  return {
    icon: "fa-solid fa-box",
    label: stashed ? "Unstash" : "Stash",
    onSelect: () => item.update({ "system.stashed": !stashed, "system.equipped": false }),
  };
}

/** Matches the circle-question glyph next to the unidentified checkbox on
 * the item sheet's own identify tab (templates/items/_partials/unidentified.hbs) —
 * there's no dedicated inventory-row button for this on desktop. */
function identifyAction(item) {
  return {
    icon: "fas fa-circle-question",
    label: "Identify",
    onSelect: () => item.system.toggleIdentified(),
  };
}

function editAction(item) {
  return { icon: "fas fa-edit", label: "Edit", onSelect: () => item.sheet.render(true) };
}

function deleteAction(item) {
  return {
    icon: "fas fa-trash",
    label: "Delete",
    onSelect: async () => {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: `Delete ${item.name}` },
        content: `<p>Delete "${item.name}"?</p>`,
        rejectClose: false,
        modal: true,
      });
      if (confirmed) await item.delete();
    },
  };
}

/** Real branching per item type — the exact case invokeModule's `custom`
 * escape hatch exists for (docs/adapting-a-system.md "Item actions"). */
export function itemActions(item, itemCtx) {
  const actions = [];

  switch (item.type) {
    case "Weapon":
      actions.push({ icon: "fa-solid fa-dice-d20", label: "Attack", onSelect: () => rollAttack(itemCtx) });
      actions.push(equipToggleAction(item));
      actions.push(stashToggleAction(item));
      break;
    case "Armor":
      actions.push(equipToggleAction(item));
      actions.push(stashToggleAction(item));
      break;
    case "Basic":
    case "Gem":
      if (item.system.light?.isSource) {
        actions.push({
          icon: "fa-solid fa-fire-flame-curved",
          label: item.system.light.active ? "Turn Off" : "Turn On",
          onSelect: () => itemCtx.actor.toggleLight(!item.system.light.active, item.id),
        });
      }
      actions.push(stashToggleAction(item));
      break;
    case "Potion":
      actions.push({ icon: "fas fa-prescription-bottle", label: "Drink", onSelect: () => usePotion(itemCtx) });
      break;
    case "Scroll":
      actions.push({ icon: "fas fa-scroll", label: "Read", onSelect: () => castSpell(itemCtx) });
      if (itemCtx.actor.system.isSpellCaster) {
        actions.push({
          icon: "fas fa-graduation-cap",
          label: "Learn",
          onSelect: () => itemCtx.actor.system.learnSpell(item.id),
        });
      }
      break;
    case "Class Ability":
      actions.push({ icon: "fa-solid fa-dice-d20", label: "Use", onSelect: () => useAbility(itemCtx) });
      break;
    case "Spell":
      actions.push({ icon: "fas fa-hand-sparkles", label: "Cast", onSelect: () => castSpell(itemCtx) });
      if (item.system.duration?.type === "focus") {
        actions.push({
          icon: "fas fa-brain",
          label: "Focus",
          onSelect: () => itemCtx.actor.system.castSpell(item.uuid, { itemUuid: item.uuid, cast: { focus: true } }),
        });
      }
      break;
  }

  if (item.system.magicItem === true && item.system.isIdentified === false) {
    actions.push(identifyAction(item));
  }

  actions.push(editAction(item));
  actions.push(deleteAction(item));
  return actions;
}
