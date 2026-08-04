import { getActiveDescriptor } from "../adapters/adapter-registry.mjs";

/**
 * Tags every non-companion ApplicationV2 window as either .pom-dialog-fit
 * (touch-scaled full-screen-ish — companion.css handles it generically) or
 * .pom-dialog-native (left alone — the dialog positions/sizes itself, e.g.
 * vagabond's SpellCastDialog), based on the active descriptor's
 * `dialogs.selfPositioned` selector list. Replaces a hardcoded
 * `:not(.spell-cast-dialog)` CSS selector that couldn't extend to other
 * systems' self-positioning dialogs — see docs/system-adapters-plan.md §6.1.
 *
 * Also collapses the companion panel so it doesn't sit on top of whatever
 * just opened (§6.4), and wires a generic pointer-based drag for frameless
 * dialogs that have no `.window-header` for core's own drag to hang off of
 * (§6.2) — using `dialogs.dragHandle`, or the dialog's first child element
 * as a fallback heuristic if undeclared.
 */
export function initDialogFit() {
  Hooks.on("renderApplicationV2", (_app, el) => {
    if (!el || el.classList.contains("pom-companion-app")) return;
    if (!document.body.classList.contains("pom-companion-mode")) return;
    // renderApplicationV2 also fires for core's persistent UI chrome (sidebar,
    // scene-navigation, hotbar, players, scene-controls, sidebar sub-tabs like
    // Placeables' "tokens-tab", ...) — those are ApplicationV2 instances too,
    // but not floating dialogs/sheets, and any system could add its own such
    // chrome. They all live inside #interface; real windows (dialogs,
    // actor/item sheets, from any system) render directly under <body>.
    // Confirmed live: alienrpg's weapon roll DialogV2 parents to body, while
    // #sidebar/#scene-navigation/tokens-tab/etc. parent to #interface — skip
    // the latter so they don't get pom-dialog-fit's position:fixed/inset
    // treatment.
    if (el.closest("#interface")) return;

    tagAndWire(el);

    // Some core UI chrome (confirmed: the Placeables sidebar tab's
    // "tokens-tab" sub-app) fires this hook BEFORE Foundry has actually
    // inserted it into #interface — closest("#interface") reads false at
    // hook time here but true one frame later. Recheck next frame and undo
    // the fit/native tagging if it turns out to be chrome after all, so the
    // timing gap above doesn't leave a stray class on core UI permanently.
    requestAnimationFrame(() => {
      if (el.closest("#interface")) el.classList.remove("pom-dialog-fit", "pom-dialog-native");
    });
  });
}

function tagAndWire(el) {
  const descriptor = getActiveDescriptor();
  const native = descriptor?.dialogs?.selfPositioned ?? [];
  const isNative = native.some((sel) => matchesSafely(el, sel));
  el.classList.add(isNative ? "pom-dialog-native" : "pom-dialog-fit");

  if (descriptor?.dialogs?.collapsePanel !== false) collapseCompanionPanel();

  if (!el.querySelector(".window-header")) wireFramelessDrag(el, descriptor);
}

function matchesSafely(el, selector) {
  try {
    return el.matches(selector);
  } catch (_err) {
    return false; // a malformed selector in a descriptor shouldn't break every dialog
  }
}

function collapseCompanionPanel() {
  const companionEl = document.querySelector(".pom-companion-app");
  if (!companionEl) return;
  companionEl.classList.remove("pom-expanded");
  companionEl.style.removeProperty("--pom-panel-offset");
}

function wireFramelessDrag(el, descriptor) {
  const handleMap = descriptor?.dialogs?.dragHandle ?? {};
  let handleSelector = null;
  for (const [dialogSelector, dragHandleSelector] of Object.entries(handleMap)) {
    if (matchesSafely(el, dialogSelector)) {
      handleSelector = dragHandleSelector;
      break;
    }
  }
  const handle = handleSelector ? el.querySelector(handleSelector) : el.firstElementChild;
  if (!handle) return;
  handle.style.touchAction = "none";

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const onDown = (event) => {
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    const rect = el.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    handle.setPointerCapture(event.pointerId);
  };
  const onMove = (event) => {
    if (!dragging) return;
    el.style.position = "fixed";
    el.style.left = `${startLeft + (event.clientX - startX)}px`;
    el.style.top = `${startTop + (event.clientY - startY)}px`;
    event.preventDefault();
  };
  const onUp = () => {
    dragging = false;
  };

  handle.addEventListener("pointerdown", onDown);
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onUp);
}
