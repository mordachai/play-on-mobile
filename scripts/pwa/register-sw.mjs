import { MODULE_ID } from "../settings.mjs";

/** Injects the manifest link and registers the static-asset service worker.
 * Both are cheap/no-op if unsupported, safe to call unconditionally — except
 * for a GM, who is skipped entirely: this module's installable-app identity
 * is for players, and a GM device that also runs fgm-tools (a GM-only phone
 * remote) needs that module's manifest to be the one a browser picks, not
 * this one. Only one <link rel="manifest"> is ever honored per page. */
export function registerServiceWorker() {
  if (game.user.isGM) return;
  injectManifestLink();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register(foundry.utils.getRoute(`modules/${MODULE_ID}/service-worker.js`), {
        // getRoute strips trailing slashes; a scope must keep its own.
        scope: `${foundry.utils.getRoute(`modules/${MODULE_ID}`)}/`,
      })
      .catch((err) => console.warn("Play on Mobile | service worker registration failed", err));
  }
}

function injectManifestLink() {
  if (document.head.querySelector('link[rel="manifest"][data-play-on-mobile]')) return;
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = foundry.utils.getRoute(`modules/${MODULE_ID}/static/manifest.webmanifest`);
  link.dataset.playOnMobile = "true";
  document.head.appendChild(link);
}
