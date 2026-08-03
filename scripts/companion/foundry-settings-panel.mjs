/** Companion mode hides Foundry's whole sidebar (see companion.css), which
 * is the only way a player normally reaches Settings > Configure Settings —
 * so on the phone there is no way to reach, say, a system's own "Combat
 * Carousel: Auto-Hide" toggle at all. This rebuilds that screen generically
 * from the live settings/menus registries (not hardcoded to any one system)
 * so it works for vagabond today and for anything else registered later
 * without touching this file again.
 *
 * Mirrors Foundry's own SettingsConfig filtering: client-scope settings are
 * always visible (each user has their own copy); world-scope settings and
 * restricted menus are GM-only, matching core's behavior. */

import { resolveNamespaceTitle, classifyField } from "../settings-field-utils.mjs";

export function buildForeignSettingsGroups(expandedAccordions) {
  const groups = new Map();

  const groupFor = (namespace) => {
    let group = groups.get(namespace);
    if (!group) {
      group = {
        id: namespace,
        title: resolveNamespaceTitle(namespace),
        open: expandedAccordions.has(`settings-group-${namespace}`),
        fields: [],
      };
      groups.set(namespace, group);
    }
    return group;
  };

  for (const [id, menu] of game.settings.menus.entries()) {
    if (menu.restricted && !game.user.isGM) continue;
    const dot = id.indexOf(".");
    const namespace = id.slice(0, dot);
    const key = id.slice(dot + 1);
    groupFor(namespace).fields.push({
      kind: "menu",
      isMenu: true,
      namespace,
      key,
      label: game.i18n.localize(menu.name ?? key),
      hint: menu.hint ? game.i18n.localize(menu.hint) : "",
      buttonLabel: game.i18n.localize(menu.label || "PLAYONMOBILE.Companion.Settings.Configure"),
    });
  }

  for (const [id, entry] of game.settings.settings.entries()) {
    if (!entry.config) continue;
    if (entry.scope === "world" && !game.user.isGM) continue;

    const dot = id.indexOf(".");
    const namespace = id.slice(0, dot);
    const key = id.slice(dot + 1);
    const value = game.settings.get(namespace, key);
    const kind = classifyField(entry);

    const field = {
      kind,
      namespace,
      key,
      label: game.i18n.localize(entry.name ?? key),
      hint: entry.hint ? game.i18n.localize(entry.hint) : "",
      value,
      isBoolean: kind === "boolean",
      isSelect: kind === "select",
      isRange: kind === "range",
      isNumber: kind === "number",
      isText: kind === "text",
      isReadonly: kind === "readonly",
    };

    if (kind === "select") {
      field.choices = Object.entries(entry.choices).map(([choiceValue, label]) => ({
        value: choiceValue,
        label: game.i18n.localize(label),
        selected: choiceValue === String(value),
      }));
    } else if (kind === "range") {
      field.min = entry.range.min;
      field.max = entry.range.max;
      field.step = entry.range.step ?? 1;
    } else if (kind === "readonly" && value && typeof value === "object") {
      field.value = JSON.stringify(value);
    }

    groupFor(namespace).fields.push(field);
  }

  const result = [...groups.values()].filter((g) => g.fields.length);
  result.sort((a, b) => {
    if (a.id === "core") return -1;
    if (b.id === "core") return 1;
    if (a.id === game.system.id) return -1;
    if (b.id === game.system.id) return 1;
    return a.title.localeCompare(b.title);
  });
  return result;
}
