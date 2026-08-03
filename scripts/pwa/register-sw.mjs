import { MODULE_ID } from "../settings.mjs";

/** Injects the manifest link and registers the static-asset service worker.
 * Both are cheap/no-op if unsupported, safe to call unconditionally. */
export function registerServiceWorker() {
  injectManifestLink();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register(`/modules/${MODULE_ID}/service-worker.js`, { scope: `/modules/${MODULE_ID}/` })
      .catch((err) => console.warn("Play on Mobile | service worker registration failed", err));
  }
}

function injectManifestLink() {
  if (document.head.querySelector('link[rel="manifest"][data-play-on-mobile]')) return;
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = `/modules/${MODULE_ID}/static/manifest.webmanifest`;
  link.dataset.playOnMobile = "true";
  document.head.appendChild(link);
}
