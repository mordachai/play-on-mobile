import { MODULE_ID } from "../settings.mjs";

const ASKED_KEY_PREFIX = "pom-mobile-asked-";

function looksLikeMobile() {
  const uaMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  const narrow = window.matchMedia?.("(max-width: 900px)").matches;
  return uaMobile || (coarse && narrow);
}

/** Runs once per user per browser: if the heuristic says "this looks like a
 * phone" and companion mode isn't already on, offer to flip it on. A "No" or
 * dismissed dialog sets the localStorage flag so it never asks that
 * user/browser combo again — manual re-enable is the existing ?pom-reset URL
 * trick or the GM device-control panel, not this prompt. */
export async function maybePromptMobileActivation() {
  if (game.settings.get(MODULE_ID, "companionMode")) return;

  const key = ASKED_KEY_PREFIX + game.user.id;
  if (localStorage.getItem(key)) return;
  if (!looksLikeMobile()) return;

  const activate = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("PLAYONMOBILE.MobileDetect.Title") },
    content: `<p>${game.i18n.localize("PLAYONMOBILE.MobileDetect.Content")}</p>`,
    rejectClose: false,
    modal: true,
  });

  localStorage.setItem(key, "1");

  if (activate) {
    await game.settings.set(MODULE_ID, "companionMode", true);
    window.location.reload();
  }
}
