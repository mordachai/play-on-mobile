import { MODULE_ID } from "../settings.mjs";
import { validateDescriptor } from "../adapters/validate-descriptor.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** GM-only panel (opened via the module's Settings menu entry) for the
 * world-scoped descriptor override — see docs/system-adapters-plan.md §7
 * Phase D. Exists so a broken mapping is fixable without a module release:
 * paste JSON, Validate to check it before committing, Save to persist it as
 * the world's systemDescriptorOverride setting (highest precedence tier —
 * see adapter-registry.mjs), or Clear to fall through to the next source. */
export class DescriptorOverrideApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "play-on-mobile-descriptor-override",
    classes: ["pom-descriptor-override"],
    tag: "div",
    window: { title: "Play on Mobile — System Descriptor Override", resizable: true },
    position: { width: 640, height: 640 },
    actions: {
      validate: DescriptorOverrideApp._onValidate,
      save: DescriptorOverrideApp._onSave,
      clear: DescriptorOverrideApp._onClear,
    },
  };

  static PARTS = {
    app: { template: "modules/play-on-mobile/templates/descriptor-override.hbs" },
  };

  constructor(options = {}) {
    super(options);
    this._message = null;
    // Unsaved textarea content survives a Validate re-render — _prepareContext
    // must not clobber it with the last-saved setting value mid-edit.
    this._pendingRaw = null;
  }

  async _prepareContext(_options) {
    return {
      raw: this._pendingRaw ?? game.settings.get(MODULE_ID, "systemDescriptorOverride"),
      systemId: game.system.id,
      message: this._message,
    };
  }

  _readTextarea() {
    return this.element.querySelector("textarea[name=descriptor]")?.value ?? "";
  }

  _parseAndValidate(raw) {
    if (!raw.trim()) return { descriptor: null, errors: [] };
    let descriptor;
    try {
      descriptor = JSON.parse(raw);
    } catch (err) {
      return { descriptor: null, errors: [`Invalid JSON: ${err.message}`] };
    }
    const { errors } = validateDescriptor(descriptor);
    if (!errors.length && descriptor.system !== game.system.id) {
      errors.push(
        `descriptor.system is "${descriptor.system}", but this world is running "${game.system.id}" — it would never be picked up here.`
      );
    }
    return { descriptor, errors };
  }

  static _onValidate(_event, _target) {
    this._pendingRaw = this._readTextarea();
    const { errors } = this._parseAndValidate(this._pendingRaw);
    this._message = errors.length
      ? { type: "error", text: errors.join("\n") }
      : { type: "ok", text: this._pendingRaw.trim() ? "Valid." : "Empty — falls through to the next source." };
    this.render();
  }

  static async _onSave(_event, _target) {
    const raw = this._readTextarea();
    const { errors } = this._parseAndValidate(raw);
    if (errors.length) {
      this._pendingRaw = raw;
      this._message = { type: "error", text: errors.join("\n") };
      this.render();
      return;
    }
    await game.settings.set(MODULE_ID, "systemDescriptorOverride", raw.trim());
    this._pendingRaw = null;
    this._message = { type: "ok", text: "Saved. Each client picks it up on its next reload." };
    this.render();
  }

  static async _onClear(_event, _target) {
    await game.settings.set(MODULE_ID, "systemDescriptorOverride", "");
    this._pendingRaw = "";
    this._message = { type: "ok", text: "Cleared." };
    this.render();
  }
}
