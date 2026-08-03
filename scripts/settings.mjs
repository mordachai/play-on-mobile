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
