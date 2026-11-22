import { MODULE_ID } from "../settings.mjs";

const FLAG = "deviceCommand";

/** Lets a GM force companion mode on/off for a specific player's device with
 * zero interaction on their end (the escape button and ?pom-reset URL trick
 * both still need the player to act on their own stuck screen; this doesn't).
 *
 * Delivered as a flag on the target's own User document rather than a raw
 * module socket message: module socket messages carry no trustworthy sender,
 * so any player could have flipped (and reloaded) anyone else's device. Only
 * a GM may update another user's User document — the server enforces that —
 * and the receiver additionally only honors an update authored by a GM, so a
 * player writing the flag on their own User does nothing either. A fresh
 * nonce on every command makes repeating the same command still fire. */
export function initDeviceControlSocket() {
  Hooks.on("updateUser", handleUserUpdate);
}

async function handleUserUpdate(user, changes, _options, authorId) {
  if (user.id !== game.user.id) return;
  // The diff only holds changed keys (a repeated command may differ only in
  // its nonce) — use it to detect the command, then read the whole value.
  if (!changes?.flags?.[MODULE_ID]?.[FLAG]) return;
  const command = user.getFlag(MODULE_ID, FLAG);
  if (!command || typeof command !== "object") return;
  if (!game.users.get(authorId)?.isGM) return;
  if (typeof command.companionMode !== "boolean") return;
  if (command.companionMode === game.settings.get(MODULE_ID, "companionMode")) return;

  await game.settings.set(MODULE_ID, "companionMode", command.companionMode);
  window.location.reload();
}

export function sendDeviceCommand(userId, patch) {
  const user = game.users.get(userId);
  if (!user || !game.user.isGM) return undefined;
  return user.setFlag(MODULE_ID, FLAG, { ...patch, nonce: foundry.utils.randomID() });
}
