import { sendDeviceCommand } from "./socket.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** GM-only panel (opened via the module's Settings menu entry) to force
 * companion mode on or off for a specific connected player's device. */
export class DeviceControlApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "play-on-mobile-device-control",
    classes: ["pom-device-control"],
    tag: "div",
    window: { title: "Play on Mobile — Player Devices", resizable: true },
    position: { width: 480 },
    actions: {
      forceNormal: DeviceControlApp._onForceNormal,
      forceCompanion: DeviceControlApp._onForceCompanion,
    },
  };

  static PARTS = {
    app: { template: "modules/play-on-mobile/templates/device-control.hbs" },
  };

  async _prepareContext(_options) {
    return { users: game.users.filter((u) => u.active && !u.isGM) };
  }

  static _onForceNormal(_event, target) {
    sendDeviceCommand(target.dataset.userId, { companionMode: false });
    ui.notifications.info(`Play on Mobile: sent "force normal view" to ${target.dataset.userName}`);
  }

  static _onForceCompanion(_event, target) {
    sendDeviceCommand(target.dataset.userId, { companionMode: true });
    ui.notifications.info(`Play on Mobile: sent "force companion mode" to ${target.dataset.userName}`);
  }
}
