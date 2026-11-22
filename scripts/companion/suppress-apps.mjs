/**
 * Keeps a system's desktop-only floating overlays off the phone screen —
 * the active descriptor's `suppressApps` (CSS selectors matched against
 * each ApplicationV2's root element), e.g. vagabond's Combat Carousel,
 * which auto-opens the moment a combatant joins and would sit on top of
 * the map. The companion sheet already covers what those overlays show.
 *
 * Two layers, both scoped to companion mode only:
 *  - a CSS rule hides any match instantly, so there's no one-frame flash
 *    between the app rendering and the close below landing;
 *  - every match is closed on render (and once on activation for anything
 *    already open, e.g. an overlay restored by the system's own `ready`
 *    hook before this module's ran), so a hidden overlay doesn't keep
 *    re-rendering off its own hooks on a weak phone CPU.
 *
 * Closing goes through the app's own close(), so the system's bookkeeping
 * (vagabond resets its "is open" flag in CombatCarousel#close) stays right.
 */
const STYLE_ID = "pom-suppressed-apps";

export function initAppSuppression(selectors) {
  const list = (Array.isArray(selectors) ? selectors : []).filter((s) => typeof s === "string" && s.trim());
  if (!list.length) return;

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `${list.map((s) => `body.pom-companion-mode ${s}`).join(",\n")} { display: none !important; }`;
    document.head.appendChild(style);
  }

  const isSuppressed = (app) => {
    const el = app?.element;
    if (!(el instanceof HTMLElement)) return false;
    return list.some((selector) => {
      try {
        return el.matches(selector);
      } catch (_err) {
        return false; // malformed selector in a GM override — ignore it, don't break rendering
      }
    });
  };
  const closeIfSuppressed = (app) => {
    if (isSuppressed(app)) app.close({ animate: false });
  };

  for (const app of foundry.applications.instances.values()) {
    if (app.rendered) closeIfSuppressed(app);
  }
  Hooks.on("renderApplicationV2", closeIfSuppressed);
}
