import { MODULE_ID, registerSettings } from "./settings.mjs";
import { CompanionController } from "./companion/companion-controller.mjs";
import { initSheetOpenGuard } from "./gestures/sheet-open-guard.mjs";
import { maybePromptMobileActivation } from "./companion/mobile-detect.mjs";
import { registerServiceWorker } from "./pwa/register-sw.mjs";
import { initReconnectOverlay } from "./pwa/reconnect-overlay.mjs";
import { initWakeLock } from "./pwa/wake-lock.mjs";
import { checkUrlReset } from "./url-reset.mjs";
import { DeviceControlApp } from "./gm/device-control-app.mjs";
import { initDeviceControlSocket } from "./gm/socket.mjs";
import { DescriptorOverrideApp } from "./gm/descriptor-override-app.mjs";
import { SettingsPresetApp } from "./gm/settings-preset-app.mjs";
import { RefreshApp } from "./refresh-app.mjs";
import { initRefreshButton } from "./refresh-button.mjs";
import { registerSystem, getActiveDescriptor } from "./adapters/adapter-registry.mjs";

Hooks.once("init", async () => {
  registerSettings();
  // Must run before any token draws — see sheet-open-guard.mjs header.
  initSheetOpenGuard();

  // A system/module wanting first-class companion support without shipping
  // it as part of this module (or waiting on a release of this module) calls
  // this from ITS OWN init/setup hook — see docs/system-adapters-plan.md §7.
  // getAdapter() isn't consulted until "ready" (CompanionController), but
  // exposing the api any later risks losing the race against another
  // module's own init-time registration call.
  game.modules.get(MODULE_ID).api = { registerSystem, getDescriptor: getActiveDescriptor };

  game.settings.registerMenu(MODULE_ID, "deviceControlMenu", {
    name: "Player Device Control",
    label: "Open Panel",
    hint: "GM only: force companion mode on or off for a specific connected player's device, remotely — works even if that player's own screen is stuck.",
    icon: "fa-solid fa-tv",
    type: DeviceControlApp,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, "descriptorOverrideMenu", {
    name: "System Descriptor Override",
    label: "Open Editor",
    hint: "GM only: override the system descriptor driving the companion sheet for this world, without a module update. Leave empty to use the shipped/registered default.",
    icon: "fa-solid fa-code",
    type: DescriptorOverrideApp,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, "settingsPresetMenu", {
    name: "Companion Settings Preset",
    label: "Open Editor",
    hint: "GM only: pick client-scope settings (this module's or any other module's/system's) to force onto a player's device the moment companion mode activates there. Unchecked settings are left exactly as that player has them.",
    icon: "fa-solid fa-sliders",
    type: SettingsPresetApp,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, "refreshMenu", {
    name: "Refresh",
    label: "Refresh Now",
    hint: "Reloads the page to pick up the latest Play on Mobile version.",
    icon: "fa-solid fa-rotate",
    type: RefreshApp,
    restricted: false,
  });

  // If ?pom-reset is on the URL, bail out now — the page is about to
  // navigate away with both settings forced off. See url-reset.mjs.
  if (await checkUrlReset()) return;

  foundry.applications.handlebars.loadTemplates([
    "modules/play-on-mobile/templates/companion-sheet.hbs",
    "modules/play-on-mobile/templates/device-control.hbs",
    "modules/play-on-mobile/templates/descriptor-override.hbs",
    "modules/play-on-mobile/templates/settings-preset.hbs",
  ]);
});

Hooks.on("ready", () => {
  // Companion needs game.system.id / globalThis.vagabond (set by the vagabond
  // system's own init/ready) to be available — hence "ready", not "init".
  initDeviceControlSocket();
  CompanionController.maybeActivate();
  maybePromptMobileActivation();
  registerServiceWorker();
  initReconnectOverlay();
  initWakeLock();
  initRefreshButton();
});
