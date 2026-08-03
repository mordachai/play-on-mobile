import { MODULE_ID } from "./settings.mjs";

const PARAM = "pom-reset";

/**
 * Bulletproof escape hatch: the in-page gear button can be missed on real
 * phones (mobile browser toolbars can overlap fixed-position elements near
 * screen edges). The URL bar is always reachable regardless of what the page
 * renders, so appending `?pom-reset` to the current address and loading it
 * forces companion mode off before it ever applies. Must run at init, right
 * after settings are registered, before "ready" activates it.
 */
export async function checkUrlReset() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has(PARAM)) return false;

  await game.settings.set(MODULE_ID, "companionMode", false);

  params.delete(PARAM);
  const query = params.toString();
  const clean = window.location.pathname + (query ? `?${query}` : "") + window.location.hash;
  window.location.replace(clean);
  return true;
}
