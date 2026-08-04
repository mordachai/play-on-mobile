import { setPanNibSide } from "./gestures/pan-nib.mjs";
import { setRefreshButtonSide } from "./refresh-button.mjs";

export const MODULE_ID = "play-on-mobile";

export function registerSettings() {
  game.settings.register(MODULE_ID, "companionMode", {
    name: "PLAYONMOBILE.Settings.CompanionMode.Name",
    hint: "PLAYONMOBILE.Settings.CompanionMode.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true,
  });

  // Hidden — set via the in-app actor picker, not the settings menu.
  game.settings.register(MODULE_ID, "companionActorId", {
    scope: "client",
    config: false,
    type: String,
    default: "",
  });

  game.settings.register(MODULE_ID, "keepAwake", {
    name: "PLAYONMOBILE.Settings.KeepAwake.Name",
    hint: "PLAYONMOBILE.Settings.KeepAwake.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });

  // Controlled only from the companion panel's own Settings tab, not
  // Foundry's Configure Settings menu — config: false.
  game.settings.register(MODULE_ID, "panNibEnabled", {
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "panNibSensitivity", {
    scope: "client",
    config: false,
    type: Number,
    default: 0.6,
  });

  // Companion visual theme — color palette, light/dark mode, corner style.
  // Controlled only from the companion panel's own Settings tab, not
  // Foundry's Configure Settings menu — config: false, same as the pan nib
  // settings above.
  game.settings.register(MODULE_ID, "companionThemeColor", {
    scope: "client",
    config: false,
    type: String,
    default: "sunset",
  });

  game.settings.register(MODULE_ID, "companionThemeMode", {
    scope: "client",
    config: false,
    type: String,
    default: "dark",
  });

  game.settings.register(MODULE_ID, "companionThemeStyle", {
    scope: "client",
    config: false,
    type: String,
    default: "smooth",
  });

  // Landscape dock side + which edge the pan nib lands on (always the
  // opposite edge of the dock, so the two never compete for the same thumb).
  // Config: true — a module-settings-menu choice, not the companion panel's
  // own Settings tab.
  // World-scoped raw descriptor JSON, edited via the descriptorOverrideMenu
  // ApplicationV2 form (see gm/descriptor-override-app.mjs), not Foundry's
  // Configure Settings list directly — config: false. Highest-precedence
  // source in adapter-registry.mjs's getAdapter(); empty string falls
  // through to the next tier. Exists so a broken mapping is fixable by a GM
  // without a module release — see docs/system-adapters-plan.md §7 Phase D.
  game.settings.register(MODULE_ID, "systemDescriptorOverride", {
    scope: "world",
    config: false,
    type: String,
    default: "",
  });

  // Global on/off for whether invokes fast-forward past a system's own roll
  // dialog (see descriptor `fastForward`) — client-scoped since it's a per-
  // player UX preference, not a world rule. Controlled from the companion
  // panel's own Settings tab — config: false.
  game.settings.register(MODULE_ID, "fastRolls", {
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
  });

  // Touch has no hover, so an accidental double-tap on a token (e.g. two
  // quick taps meant as separate select/move actions) reads to core as a
  // double-click and opens the actor sheet on top of the companion panel.
  // Default on — see gestures/sheet-open-guard.mjs. Controlled only from the
  // companion panel's own Settings tab — config: false.
  game.settings.register(MODULE_ID, "blockDoubleTapSheetOpen", {
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
  });

  // GM-authored preset of client-scope settings (this module's own plus any
  // other module's/system's) forced onto a player's client the moment
  // companion mode activates there — see gm/settings-preset.mjs. Keyed by
  // "namespace.key"; a key's absence means untouched, not reset-to-default.
  // Edited only via the settingsPresetMenu app — config: false.
  game.settings.register(MODULE_ID, "companionSettingsPreset", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  game.settings.register(MODULE_ID, "companionHandedness", {
    name: "PLAYONMOBILE.Settings.Handedness.Name",
    hint: "PLAYONMOBILE.Settings.Handedness.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      right: "PLAYONMOBILE.Settings.Handedness.Right",
      left: "PLAYONMOBILE.Settings.Handedness.Left",
    },
    default: "right",
    onChange: (value) => {
      setPanNibSide(value);
      setRefreshButtonSide(value);
      const app = Object.values(ui.windows).find((w) => w.id === "play-on-mobile-companion");
      app?.render();
    },
  });
}
