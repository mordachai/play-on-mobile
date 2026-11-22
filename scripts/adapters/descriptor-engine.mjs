/**
 * Turns a system descriptor (docs/system-adapters-plan.md §5) into an
 * adapter matching the exact same interface as vagabond-adapter.mjs /
 * generic-adapter.mjs — { id, isAvailable, initHandlers, buildSheetData } —
 * so adapter-registry.mjs never needs a special case for descriptor-driven
 * systems, and companion-app.mjs / companion-sheet.hbs never need to know
 * whether a section's onPress/onDelta/actions[].onSelect closures were
 * hand-written or generated from JSON.
 *
 * Dormant in Phase A: nothing imports this module yet.
 */
import { resolveExpr, matchWhere, resolveLabelFrom, getProperty } from "./resolve.mjs";
import { runInvoke } from "./invokes.mjs";

async function defaultEnrichHTML(html, actor) {
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

/** `section.qtyLabel` may be a single expression or an ordered list of
 * fallback candidates (a per-item override, then a static default) — first
 * non-empty wins. Mirrors the fallback a system's own sheet already does in
 * Handlebars (e.g. XDZ's weapon-card falling back from a per-weapon
 * `ammoLabel` to a localized default when the item leaves it blank), so a
 * descriptor can express the same thing without an invokeModule fn. */
function resolveFirst(exprOrList, ctx) {
  const candidates = Array.isArray(exprOrList) ? exprOrList : [exprOrList];
  for (const expr of candidates) {
    const value = resolveExpr(expr, ctx);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function actorItems(actor) {
  const items = actor?.items ?? [];
  return Array.isArray(items) ? items : Array.from(items);
}

/** Subtitle items are either a bare expression ("@items.class.name") shown
 * as-is, or `{label, value}` for the rare case a system needs a literal
 * prefix on a derived value (vagabond's "Level 3" — the label is static
 * text, only the number comes off the actor). */
function buildHeader(header, ctx) {
  if (!header) return { subtitle: [] };
  const subtitle = (header.subtitle ?? [])
    .map((item) => {
      if (item && typeof item === "object") {
        const value = resolveExpr(item.value, ctx);
        return value === undefined || value === null || value === "" ? undefined : `${item.label} ${value}`;
      }
      return resolveExpr(item, ctx);
    })
    .filter((v) => v !== undefined && v !== null && v !== "");
  return { subtitle };
}

/** `when` lets a resource entry disappear entirely when a system doesn't
 * have that pool at all (vagabond: not every actor has mana/luck) — distinct
 * from a value of 0, which still renders normally. Returns null (filtered by
 * the caller) rather than an entry when `when` resolves falsy. */
function buildResourceEntry(e, ctx) {
  if (e.when && !resolveExpr(e.when, ctx)) return null;

  const entry = {
    id: e.key,
    key: e.key,
    label: e.label,
    value: resolveExpr(e.value, ctx),
    max: e.max != null ? resolveExpr(e.max, ctx) : undefined,
  };
  if (e.active) entry.active = !!resolveExpr(e.active, ctx);
  // `options`: a small fixed choice written straight to one actor field,
  // rendered as a segmented control instead of a value + steppers (a
  // system's persistent roll-mode toggle, e.g. vagabond's Favor / Hinder).
  if (Array.isArray(e.options) && e.write) {
    const current = String(entry.value ?? e.default ?? "");
    entry.options = e.options.map((o) => ({
      value: String(o.value),
      label: o.label ?? String(o.value),
      selected: String(o.value) === current,
    }));
    entry.onOption = (value) => ctx.actor.update({ [e.write]: value });
  }
  // `deltaInvoke` routes the +/- buttons through the system's own logic
  // instead of a plain clamp-and-write — for pools whose change has side
  // effects on desktop (a chat card on spending Luck, a d6 rolled on
  // spending a Studied Die). The invoke sees the step as `ctx.vars.delta`.
  if (e.editable && e.deltaInvoke) {
    entry.editable = true;
    entry.onDelta = (delta) => runInvoke(e.deltaInvoke, { ...ctx, vars: { delta } });
  } else if (e.editable && e.write) {
    entry.editable = true;
    entry.onDelta = (delta) => {
      const current = Number(getProperty(ctx.actor, e.write) ?? 0);
      const maxVal = e.max != null ? Number(resolveExpr(e.max, ctx) ?? Infinity) : Infinity;
      const min = e.min ?? 0;
      const next = Math.min(maxVal, Math.max(min, current + delta));
      return ctx.actor.update({ [e.write]: next });
    };
  }
  // `invoke` makes the cell's label tappable (vagabond: Speed label takes /
  // ends the Rush Action, XP label opens Level Up). `pressWhen` keeps it
  // inert until it means something, so the label doesn't look tappable
  // when a tap would do nothing.
  if (e.invoke && (!e.pressWhen || resolveExpr(e.pressWhen, ctx))) {
    entry.pressable = true;
    entry.onPress = (mods) => runInvoke(e.invoke, { ...ctx, event: mods });
  }
  return entry;
}

/** Resolves `section.source` and returns [{key, entry}] pairs, filtered by
 * `section.where`. Objects (system.abilities, system.skills) iterate their
 * own keys; arrays (levelFeatures, traits) iterate by index/id. The
 * iteration key is threaded into the ctx used for filtering, not just value
 * resolution, so a `where.custom` predicate can key off it (e.g. vagabond's
 * isWeaponSkill, which classifies by skill key, not by the skill's value
 * shape). */
function buildFromSource(section, ctx) {
  const source = resolveExpr(section.source, ctx);
  const list = [];
  if (Array.isArray(source)) {
    source.forEach((entry, i) => list.push({ key: entry?.key ?? entry?.id ?? String(i), entry }));
  } else if (source && typeof source === "object") {
    for (const [key, entry] of Object.entries(source)) list.push({ key, entry });
  }
  return list.filter(({ key, entry }) => matchWhere(section.where, entry, { ...ctx, key }, ctx.custom));
}

function buildKeyValueEntry(section, key, entry, ctx) {
  const entryCtx = { ...ctx, entry, key };
  const out = {
    id: key,
    key,
    value: section.value ? resolveExpr(section.value, entryCtx) : entry,
  };
  if (section.abbr) out.abbr = resolveLabelFrom(section.abbr, key, ctx);
  if (section.labelFrom) out.label = resolveLabelFrom(section.labelFrom, key, ctx);
  // `name`: per-entry label read off the entry itself, for sources whose
  // keys are opaque ids rather than config-table keys (vagabond's feature
  // actions are keyed "<itemId>|<path>", statuses by effect id).
  else if (section.name) out.label = resolveExpr(section.name, entryCtx);
  else if (section.label !== undefined) out.label = section.label;
  if (section.active) out.active = !!resolveExpr(section.active, entryCtx);
  if (section.invoke) {
    // Boolean flag for the template (never test the closure itself there:
    // Handlebars calls function-valued properties). stat-row renders a
    // tappable chip only when this is set; check-grid is always a button.
    out.pressable = true;
    out.onPress = (mods) =>
      runInvoke(section.invoke, { ...entryCtx, event: mods, custom: ctx.custom, runtime: ctx.runtime });
  }
  return out;
}

/** Icon-row actions on an item's expanded accordion — builtin vocabulary
 * (§5.7) plus a `custom` escape hatch for systems whose action set has real
 * branching (vagabond's armor/gear/consumable Use-visibility rule). */
function buildItemActions(section, item, itemCtx, ctx) {
  const defs = section.actions ?? [];
  return defs.flatMap((def) => {
    // "use"/"toChat"/"edit"/"delete" take either bare-string or object form;
    // the object form's only extra field is `icon`, letting a descriptor
    // override the builtin default to match its own system's real glyph
    // for that action (e.g. OSE's "Show" button is fa-eye, not fa-comment).
    const action = typeof def === "string" ? def : def?.action;
    const iconOverride = typeof def === "object" ? def.icon : undefined;
    if (action === "use") {
      if (!section.invoke) return [];
      return [
        { icon: iconOverride ?? "fas fa-hand-sparkles", label: "Use", onSelect: () => runInvoke(section.invoke, itemCtx) },
      ];
    }
    if (action === "toChat") {
      return [
        {
          icon: iconOverride ?? "fas fa-comment",
          label: "Send to Chat",
          onSelect: () =>
            ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor: ctx.actor }),
              content: `<strong>${item.name}</strong>`,
            }),
        },
      ];
    }
    if (action === "edit") {
      return [{ icon: iconOverride ?? "fas fa-edit", label: "Edit", onSelect: () => item.sheet.render(true) }];
    }
    if (action === "delete") {
      return [
        {
          icon: iconOverride ?? "fas fa-trash",
          label: "Delete",
          onSelect: async () => {
            const confirmed = await foundry.applications.api.DialogV2.confirm({
              window: { title: `Delete ${item.name}` },
              content: `Delete "${item.name}"?`,
              rejectClose: false,
              modal: true,
            });
            if (confirmed) await item.delete();
          },
        },
      ];
    }
    if (def && typeof def === "object" && def.action === "toggle") {
      const current = !!getProperty(item, def.path);
      return [
        {
          icon: def.icon ?? (current ? "fas fa-times" : "fas fa-check"),
          label: current ? (def.offLabel ?? def.label ?? "Unset") : (def.label ?? "Set"),
          onSelect: () => item.update({ [def.path]: !current }),
        },
      ];
    }
    if (def && typeof def === "object" && def.action === "cycle") {
      const states = def.states ?? [];
      const current = String(getProperty(item, def.path) ?? "");
      const idx = states.findIndex((s) => String(s.value) === current);
      const next = states[(idx + 1 + states.length) % states.length] ?? states[0];
      if (!next) return [];
      return [
        {
          icon: next.icon ?? "fas fa-arrows-rotate",
          label: next.label ? `Move to ${next.label}` : "Cycle",
          onSelect: () => item.update({ [def.path]: next.value }),
        },
      ];
    }
    if (def && typeof def === "object" && def.action === "invoke") {
      return [
        {
          icon: def.icon ?? "fas fa-bolt",
          label: def.label ?? "Action",
          onSelect: () => runInvoke(def.invoke, itemCtx),
        },
      ];
    }
    if (def && typeof def === "object" && def.custom) {
      const fn = ctx.custom?.[def.custom];
      return typeof fn === "function" ? (fn(item, itemCtx) ?? []) : [];
    }
    return [];
  });
}

async function buildItemEntry(section, item, ctx) {
  // sectionId lets a custom action/invoke fn behave differently depending on
  // which section it fired from (vagabond: the "Use" action on an equipped
  // weapon attacks; the identical action on the same item type in Inventory
  // would not, since equipped weapons never appear in Inventory) — without
  // it, a custom fn only sees the item, not which list it's rendered in.
  const itemCtx = { ...ctx, item, sectionId: section.id };
  const entry = { id: item.id, label: item.name, img: item.img };
  if (section.qty) entry.qty = resolveExpr(section.qty, itemCtx);
  if (section.qtyLabel) entry.qtyLabel = resolveFirst(section.qtyLabel, itemCtx);
  // `tracks` gives an item-list row one +/- stepper per resource the item
  // itself carries (a weapon's ammo, secondary/grenade charges, damage taken
  // — any of them independently) in its expanded accordion body, not the
  // collapsed row itself, since that row's tap is already spoken for by
  // `section.invoke` (the attack/use roll). Each track's own `when` lets it
  // appear only under some item state (XDZ: secondary/damaged only while the
  // weapon is equipped); a track with no room to move (max === min, e.g. a
  // melee weapon's ammo track sitting at 0/0) is dropped even without an
  // explicit `when`, matching the real sheet's own pip row rendering
  // empty/inert for the same case.
  if (section.tracks) {
    entry.qtyTracks = section.tracks
      .filter((t) => !t.when || resolveExpr(t.when, itemCtx))
      .map((t) => {
        const maxVal = t.max != null ? Number(resolveExpr(t.max, itemCtx) ?? Infinity) : Infinity;
        const min = t.min != null ? Number(resolveExpr(t.min, itemCtx) ?? 0) : 0;
        if (maxVal <= min) return null;
        return {
          label: t.label ? resolveFirst(t.label, itemCtx) : undefined,
          value: resolveExpr(t.value, itemCtx),
          onDelta: (delta) => {
            const current = Number(getProperty(item, t.write) ?? 0);
            const next = Math.min(maxVal, Math.max(min, current + delta));
            return item.update({ [t.write]: next });
          },
        };
      })
      .filter(Boolean);
  }
  if (section.status) {
    const key = resolveExpr(section.status.source, itemCtx);
    entry.status = resolveLabelFrom(section.status, key, ctx);
  }
  if (section.description) {
    const raw = resolveExpr(section.description, itemCtx);
    entry.description = await ctx.enrichHTML(raw, ctx.actor);
  }
  if (section.invoke) {
    entry.onPress = (mods) =>
      runInvoke(section.invoke, { ...itemCtx, event: mods, custom: ctx.custom, runtime: ctx.runtime });
  }
  const actions = buildItemActions(section, item, itemCtx, ctx).filter((a) => a && a.hidden !== true);
  // A custom action may be a stepper (`{label, stepper: {value, onDelta}}`)
  // rather than a button — vagabond's Quantity entry in its own item menu.
  // Those join the row's `tracks` steppers instead of the icon row, so a
  // system that builds its whole menu in code gets the same +/- control a
  // JSON `tracks` entry would.
  const steppers = actions.filter((a) => a.stepper);
  entry.actions = actions.filter((a) => !a.stepper);
  if (steppers.length) {
    entry.qtyTracks = [
      ...(entry.qtyTracks ?? []),
      ...steppers.map((a) => ({ label: a.label, value: a.stepper.value, onDelta: a.stepper.onDelta })),
    ];
  }
  return entry;
}

async function buildItemListEntries(section, ctx) {
  const matched = actorItems(ctx.actor).filter((item) => matchWhere(section.where, item, ctx, ctx.custom));
  return Promise.all(matched.map((item) => buildItemEntry(section, item, ctx)));
}

async function buildEntryListEntries(section, ctx) {
  const rows = buildFromSource(section, ctx);
  return Promise.all(
    rows.map(async ({ entry }, i) => {
      const entryCtx = { ...ctx, entry };
      const raw = section.description ? resolveExpr(section.description, entryCtx) : undefined;
      return {
        id: entry?.id ?? `${section.id}-${i}`,
        name: section.name ? resolveExpr(section.name, entryCtx) : entry?.name,
        level: entry?.level,
        description: raw != null ? await ctx.enrichHTML(raw, ctx.actor) : "",
      };
    })
  );
}

function buildFieldsEntries(section, ctx) {
  const source = resolveExpr(section.source ?? "@system", ctx);
  return Object.entries(source ?? {})
    .filter(([, v]) => typeof v !== "object" || v === null)
    .map(([key, value]) => ({ key, value: String(value) }));
}

const RENDERERS = {
  resources: (section, ctx) => section.entries.map((e) => buildResourceEntry(e, ctx)).filter(Boolean),
  "stat-row": (section, ctx) =>
    buildFromSource(section, ctx).map(({ key, entry }) => buildKeyValueEntry(section, key, entry, ctx)),
  "check-grid": (section, ctx) =>
    buildFromSource(section, ctx).map(({ key, entry }) => buildKeyValueEntry(section, key, entry, ctx)),
  "item-list": buildItemListEntries,
  "entry-list": buildEntryListEntries,
  fields: (section, ctx) => buildFieldsEntries(section, ctx),
};

async function buildSection(section, ctx) {
  const build = RENDERERS[section.render];
  if (!build) throw new Error(`Unknown section render "${section.render}"`);

  const out = {
    id: section.id,
    render: section.render,
    label: section.label,
    collapsible: !!section.collapsible,
    cssClass: section.cssClass,
    // Both read by companion-app.mjs: `revealWith: "header"` keeps a section
    // hidden until the name header is expanded (vagabond's ability scores);
    // `hideIfEmpty: false` keeps an empty section on screen.
    revealWith: section.revealWith,
    hideIfEmpty: section.hideIfEmpty,
    entries: await build(section, ctx),
  };
  if (section.icon) out.icon = resolveExpr(section.icon, ctx);
  // `when` lets a badge disappear entirely for actors that don't have the
  // underlying pool at all (vagabond: Focus, shown on Spells only for
  // classes that have one) — distinct from a badge value of 0.
  if (section.badge && (!section.badge.when || resolveExpr(section.badge.when, ctx))) {
    out.badge = {
      label: section.badge.label,
      value: resolveExpr(section.badge.value, ctx),
      max: section.badge.max != null ? resolveExpr(section.badge.max, ctx) : undefined,
    };
  }

  if (section.hideIfEmpty !== false && !out.entries?.length) return null;
  return out;
}

/** Descriptors name their invokeModule as a server-root path
 * ("/modules/<id>/..."). A Foundry server mounted under a route prefix
 * (e.g. /foundry) serves it at "/foundry/modules/..." instead, so root
 * paths go through Foundry's own route helper. Relative paths and
 * full URLs pass through; so does everything outside a running Foundry
 * (unit tests). */
export function resolveModulePath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return path;
  const getRoute = typeof foundry !== "undefined" ? foundry.utils?.getRoute : undefined;
  return typeof getRoute === "function" ? getRoute(path) : path;
}

/** Loads a descriptor's `invokeModule` (custom invoke fns / predicates /
 * action builders) once and caches it on the phoneApp instance. */
async function loadCustom(descriptor, phoneApp, opts) {
  if (phoneApp._descriptorCustom) return phoneApp._descriptorCustom;
  if (!descriptor.invokeModule) return (phoneApp._descriptorCustom = {});
  const importModule = opts.importModule ?? ((path) => import(path));
  phoneApp._descriptorCustom = await importModule(resolveModulePath(descriptor.invokeModule));
  return phoneApp._descriptorCustom;
}

/**
 * Builds an adapter from a descriptor. `opts` exists for testing/DI:
 *   - isAvailable(): override the default `game.system.id === descriptor.system` check
 *   - importModule(path): override the dynamic import used for invokeModule
 *   - CONFIG / i18n / enrichHTML / runtime: override the Foundry globals
 *     buildSheetData would otherwise read, so this file runs under plain
 *     node for unit tests.
 */
export function createDescriptorAdapter(descriptor, opts = {}) {
  return {
    id: descriptor.system,
    // Not part of the adapter interface proper (generic-adapter.mjs has no
    // equivalent) — an escape hatch so companion-app.mjs can read
    // descriptor-level config like `fastForward` without the engine needing
    // its own dedicated accessor for every such field.
    descriptor,
    isAvailable: () =>
      opts.isAvailable ? opts.isAvailable() : typeof game !== "undefined" && game.system.id === descriptor.system,

    async initHandlers(phoneApp) {
      await loadCustom(descriptor, phoneApp, opts);
    },

    async buildSheetData(phoneApp) {
      const actor = phoneApp.actor;
      const custom = await loadCustom(descriptor, phoneApp, opts);

      // A system's own derived-data read (vagabond's VagabondActor.read()) —
      // computed once per render and exposed to every expression as
      // "@snap.*", so the descriptor delegates to the system's real
      // unwrapping/renaming logic instead of reimplementing it as JSON. Only
      // fetched when the descriptor actually declares one.
      let snapshot;
      if (descriptor.snapshot?.custom) {
        const fn = custom[descriptor.snapshot.custom];
        if (typeof fn !== "function") {
          throw new Error(`No custom snapshot fn "${descriptor.snapshot.custom}"`);
        }
        snapshot = fn(actor);
      }

      const ctx = {
        actor,
        snapshot,
        // Lets a system's custom invoke fns reach phoneApp-scoped state
        // (vagabond: lazily-created RollHandler/SpellHandler instances,
        // cached on phoneApp exactly like the hand-written adapter did).
        phoneApp,
        custom,
        CONFIG: opts.CONFIG ?? (typeof CONFIG !== "undefined" ? CONFIG : {}),
        i18n: opts.i18n ?? (typeof game !== "undefined" ? game.i18n : undefined),
        enrichHTML: opts.enrichHTML ?? defaultEnrichHTML,
        runtime: opts.runtime,
      };

      const sections = (await Promise.all(descriptor.sections.map((s) => buildSection(s, ctx)))).filter(
        Boolean
      );

      return {
        name: actor.name,
        img: actor.img,
        header: buildHeader(descriptor.header, ctx),
        sections,
      };
    },
  };
}
