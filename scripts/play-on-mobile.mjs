import { MODULE_ID, registerSettings } from "./settings.mjs";
import { CompanionController } from "./companion/companion-controller.mjs";
import { registerServiceWorker } from "./pwa/register-sw.mjs";
import { initReconnectOverlay } from "./pwa/reconnect-overlay.mjs";
import { initWakeLock } from "./pwa/wake-lock.mjs";
import { checkUrlReset } from "./url-reset.mjs";
import { DeviceControlApp } from "./gm/device-control-app.mjs";
import { initDeviceControlSocket } from "./gm/socket.mjs";
import { RefreshApp } from "./refresh-app.mjs";
import { initRefreshButton } from "./refresh-button.mjs";

Hooks.once("init", async () => {
  registerSettings();

  game.settings.registerMenu(MODULE_ID, "deviceControlMenu", {
    name: "Player Device Control",
    label: "Open Panel",
    hint: "GM only: force companion mode on or off for a specific connected player's device, remotely — works even if that player's own screen is stuck.",
    icon: "fa-solid fa-tv",
    type: DeviceControlApp,
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
  ]);
});

Hooks.on("ready", () => {
  // Companion needs game.system.id / globalThis.vagabond (set by the vagabond
  // system's own init/ready) to be available — hence "ready", not "init".
  initDeviceControlSocket();
  CompanionController.maybeActivate();
  registerServiceWorker();
  initReconnectOverlay();
  initWakeLock();
  initRefreshButton();
});
