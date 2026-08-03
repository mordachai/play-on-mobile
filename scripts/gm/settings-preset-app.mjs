import { MODULE_ID } from "../settings.mjs";
import { buildPresetableGroups } from "./settings-preset.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function coerceValue(kind, raw) {
  if (kind === "boolean") return raw === "true";
  if (kind === "number") return Number(raw);
  return raw;
}

/** GM-only panel (opened via the module's Settings menu entry) to build the
 * preset of client-scope settings forced onto every player's device the
 * moment companion mode activates there — see gm/settings-preset.mjs. A row
 * left unchecked stays out of the saved preset entirely, so that player's
 * own value is never touched. */
export class SettingsPresetApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "play-on-mobile-settings-preset",
    classes: ["pom-settings-preset-app"],
    tag: "div",
    window: { title: "Play on Mobile — Companion Settings Preset", resizable: true },
    position: { width: 560, height: 700 },
    actions: {
      save: SettingsPresetApp._onSave,
      clear: SettingsPresetApp._onClear,
    },
  };

  static PARTS = {
    app: {
      template: "modules/play-on-mobile/templates/settings-preset.hbs",
      scrollable: [".pom-preset-scroll"],
    },
  };

  constructor(options = {}) {
    super(options);
    this._message = null;
  }

  async _prepareContext(_options) {
    const preset = game.settings.get(MODULE_ID, "companionSettingsPreset");
    return { groups: buildPresetableGroups(preset), message: this._message };
  }

  _readPreset() {
    const preset = {};
    for (const checkbox of this.element.querySelectorAll("[data-preset-id]")) {
      if (!checkbox.checked) continue;
      const id = checkbox.dataset.presetId;
      const valueEl = this.element.querySelector(`[data-preset-value="${CSS.escape(id)}"]`);
      if (!valueEl) continue;
      preset[id] = coerceValue(valueEl.dataset.kind, valueEl.value);
    }
    return preset;
  }

  static async _onSave(_event, _target) {
    const preset = this._readPreset();
    await game.settings.set(MODULE_ID, "companionSettingsPreset", preset);
    const count = Object.keys(preset).length;
    this._message = {
      type: "ok",
      text: `Saved — ${count} setting${count === 1 ? "" : "s"} will be forced on companion activation.`,
    };
    this.render();
  }

  static async _onClear(_event, _target) {
    await game.settings.set(MODULE_ID, "companionSettingsPreset", {});
    this._message = { type: "ok", text: "Cleared — every row unchecked." };
    this.render();
  }
}
