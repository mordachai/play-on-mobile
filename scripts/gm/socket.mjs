import { MODULE_ID } from "../settings.mjs";

const CHANNEL = `module.${MODULE_ID}`;

/** Every client listens — each message carries a target userId and only that
 * user's client acts on it. Lets a GM force companion mode on/off for a
 * specific player's device with zero interaction required on their end (the
 * escape button and ?pom-reset URL trick both still need the player to act on
 * their own stuck screen; this doesn't). */
export function initDeviceControlSocket() {
  game.socket.on(CHANNEL, handleMessage);
}

async function handleMessage(data) {
  if (!data || data.userId !== game.user.id) return;
  if (typeof data.companionMode === "boolean") {
    await game.settings.set(MODULE_ID, "companionMode", data.companionMode);
  }
  window.location.reload();
}

export function sendDeviceCommand(userId, patch) {
  game.socket.emit(CHANNEL, { userId, ...patch });
}
