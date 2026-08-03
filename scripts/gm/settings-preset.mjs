import { MODULE_ID } from "../settings.mjs";
import { resolveNamespaceTitle, classifyField } from "../settings-field-utils.mjs";

/** Builds the GM preset-editor's field list: every client-scope setting,
 * config:true OR config:false. Deliberately NOT filtered to config:true —
 * unlike foundry-settings-panel.mjs (which mirrors Foundry's own Configure
 * Settings sheet), plenty of the most useful per-player toggles here are
 * config:false and only reachable through a system's own custom menu app —
 * e.g. vagabond's hideCastRings, useSpellCastDialog, spellCastDialogDarkness/
 * Blur all live behind its "Spell Settings" menu, config:false. This preset
 * tool exists precisely so a GM can force those without walking every
 * player's phone through that menu by hand.
 *
 * World-scope settings and menus are left out entirely: this preset only
 * ever runs on a player's own client at companion activation, which cannot
 * set a world-scope value or open another module's config app. Readonly-kind
 * entries (array/object types with no simple widget) are skipped too — see
 * classifyField. This module's own activation trigger (companionMode) and
 * per-player actor binding (companionActorId) are excluded by name — forcing
 * either from inside activation is meaningless. */
export function buildPresetableGroups(preset) {
  const groups = new Map();

  const groupFor = (namespace) => {
    let group = groups.get(namespace);
    if (!group) {
      group = { id: namespace, title: resolveNamespaceTitle(namespace), fields: [] };
      groups.set(namespace, group);
    }
    return group;
  };

  const EXCLUDED = new Set([`${MODULE_ID}.companionMode`, `${MODULE_ID}.companionActorId`]);

  for (const [id, entry] of game.settings.settings.entries()) {
    if (entry.scope !== "client") continue;
    if (EXCLUDED.has(id)) continue;

    const kind = classifyField(entry);
    if (kind === "readonly") continue;

    const dot = id.indexOf(".");
    const namespace = id.slice(0, dot);
    const key = id.slice(dot + 1);
    const included = Object.prototype.hasOwnProperty.call(preset, id);
    const value = included ? preset[id] : game.settings.get(namespace, key);

    const field = {
      id,
      namespace,
      key,
      label: game.i18n.localize(entry.name ?? key),
      hint: entry.hint ? game.i18n.localize(entry.hint) : "",
      included,
      value,
      isBoolean: kind === "boolean",
      isSelect: kind === "select",
      isRange: kind === "range",
      isNumber: kind === "number",
      isText: kind === "text",
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

/** Runs from CompanionController.maybeActivate(), before anything else on
 * that client reads a module setting — so a forced value (e.g.
 * panNibEnabled) is live for the rest of that same activation, not just
 * after the next reload. A key absent from the preset is left completely
 * untouched, not reset to its default. */
export async function applyCompanionSettingsPreset() {
  const preset = game.settings.get(MODULE_ID, "companionSettingsPreset");
  for (const [id, value] of Object.entries(preset)) {
    const entry = game.settings.settings.get(id);
    if (!entry || entry.scope !== "client") continue;
    const dot = id.indexOf(".");
    const namespace = id.slice(0, dot);
    const key = id.slice(dot + 1);
    if (game.settings.get(namespace, key) === value) continue;
    await game.settings.set(namespace, key, value);
  }
}
