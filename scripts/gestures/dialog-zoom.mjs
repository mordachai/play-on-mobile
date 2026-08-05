/**
 * Two-finger pinch-to-zoom for the content of any core dialog/sheet open on
 * the phone (item sheets, actor sheets, DialogV2s, ...) — the dialog
 * equivalent of canvas-gestures.mjs's pinch-zoom. Foundry v14 core has no
 * pinch-zoom of its own, and no system sheet is designed for phone-scale
 * text, so field labels/values are often too small to read at touch scale.
 *
 * Uses the CSS `zoom` property on the dialog's `.window-content` region,
 * not `transform: scale`, specifically because `zoom` triggers a real
 * layout reflow — the element's effective content box grows, so the
 * existing native `overflow-y: auto` scrolling (and dialog-scroll.mjs's
 * touch-drag-to-scroll fallback) can reach the zoomed-in content for free,
 * with no separate pan/translate math needed. `transform: scale` wouldn't:
 * it repaints visually larger without changing layout, so scroll bounds
 * would stay computed against the pre-zoom size and the zoomed-in edges
 * would be unreachable.
 *
 * Deliberately two-finger only (see canvas-gestures.mjs's same rationale) —
 * one-finger touch is left alone for taps and dialog-scroll.mjs's drag.
 */

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

let gesture = null; // { target, startDistance, startZoom }

export function initDialogZoomGesture() {
  document.addEventListener("touchstart", onTouchStart, { passive: false });
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("touchend", onTouchEnd, { passive: true });
  document.addEventListener("touchcancel", onTouchEnd, { passive: true });
}

// Same walk-up-to-`.window-content` convention as dialog-scroll.mjs's
// findScrollable, kept separate since this one doesn't need the "is it
// actually overflowing" fallback — pinch should zoom the content area
// whether or not it currently overflows.
function findZoomTarget(el) {
  let node = el;
  while (node && node !== document.body) {
    if (node.classList?.contains("window-content")) return node;
    if (node.classList?.contains("pom-dialog-fit") || node.classList?.contains("pom-dialog-native")) break; // don't escape the dialog
    node = node.parentElement;
  }
  return null;
}

function distance(touches) {
  const [a, b] = touches;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function onTouchStart(event) {
  gesture = null;
  if (!document.body.classList.contains("pom-companion-mode") || event.touches.length !== 2) return;
  // Not `.application` — dialog-fit.mjs deliberately never tags V1 sheets
  // (Shadowdark, OSE, ...) with that class (see its wireV1Window comment),
  // so it can't be used to find "any companion-mode dialog" generically.
  // `.pom-dialog-fit`/`.pom-dialog-native` are what it tags every companion
  // dialog with instead, V1 and V2 alike.
  const dialog = event.target.closest(".pom-dialog-fit, .pom-dialog-native");
  if (!dialog) return;
  const target = findZoomTarget(event.target) ?? dialog.querySelector(".window-content");
  if (!target) return;
  gesture = {
    target,
    startDistance: distance(Array.from(event.touches)),
    startZoom: parseFloat(target.style.zoom) || 1,
  };
}

function onTouchMove(event) {
  if (!gesture || event.touches.length !== 2) return;
  event.preventDefault();
  const dist = distance(Array.from(event.touches));
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, gesture.startZoom * (dist / gesture.startDistance)));
  gesture.target.style.zoom = zoom;
}

function onTouchEnd(event) {
  if (event.touches.length < 2) gesture = null;
}
