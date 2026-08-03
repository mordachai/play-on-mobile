/**
 * Foundry v14 core has no pinch-zoom and no single-finger-pan for touch —
 * verified against client/canvas/interaction/mouse-handler.mjs: touch only
 * gets special-cased out of hover-state handling, everything else (including
 * token drag-to-move) shares the same pipeline as mouse and already works by
 * touch with no changes needed. What's missing is camera pan/zoom.
 *
 * Deliberately two-finger only, leaving one-finger touch completely alone:
 * one finger keeps doing whatever core already does with it (select a token,
 * drag a controlled token to move it, rubber-band select on empty space).
 * Two fingers are unambiguously ours — no hit-testing needed to tell "empty
 * space" from "token", which would otherwise be the hard part.
 *
 * Technique: canvas.canvasCoordinatesFromClient() converts a screen point to
 * a world point using the live stage transform, so pan is just "keep the
 * world point grabbed at gesture start under the same screen point every
 * frame", and zoom reuses the same conversion before/after changing scale to
 * correct the pivot so the pinch centroid doesn't drift.
 */

import { attachTapActions } from "./tap-actions.mjs";

let attached = false;
let gesture = null;

export function initCanvasGestures() {
  attachToCurrentCanvas();
  Hooks.on("canvasReady", attachToCurrentCanvas);
}

function attachToCurrentCanvas() {
  const view = canvas?.app?.view;
  if (!view || view.dataset.potGesturesAttached) return;
  view.dataset.potGesturesAttached = "true";

  view.addEventListener("touchstart", onTouchStart, { passive: false });
  view.addEventListener("touchmove", onTouchMove, { passive: false });
  view.addEventListener("touchend", onTouchEnd, { passive: false });
  view.addEventListener("touchcancel", onTouchEnd, { passive: false });
  attachTapActions(view); // single-finger tap-to-move / double-tap-to-target
  attached = true;
}

function centroid(touches) {
  let x = 0;
  let y = 0;
  for (const t of touches) {
    x += t.clientX;
    y += t.clientY;
  }
  return { x: x / touches.length, y: y / touches.length };
}

function distance(touches) {
  const [a, b] = touches;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function onTouchStart(event) {
  if (event.touches.length < 2 || !canvas?.ready) {
    gesture = null;
    return;
  }
  event.preventDefault();
  const touches = Array.from(event.touches);
  gesture = {
    startDistance: distance(touches),
    startScale: canvas.stage.scale.x,
    grabbedWorld: canvas.canvasCoordinatesFromClient(centroid(touches)),
  };
}

function onTouchMove(event) {
  if (!gesture || event.touches.length < 2) return;
  event.preventDefault();

  const touches = Array.from(event.touches);
  const c = centroid(touches);
  const dist = distance(touches);

  // Zoom first (canvas.pan() internally clamps to the valid scale range).
  const scale = gesture.startScale * (dist / gesture.startDistance);
  canvas.pan({ scale });

  // Then correct the pivot so the originally-grabbed world point is still
  // under the fingers' current centroid, whether they moved or not — this
  // gives pan and pinch-zoom-toward-fingers for free from the same code path.
  const worldNow = canvas.canvasCoordinatesFromClient(c);
  const pivot = canvas.stage.pivot;
  canvas.pan({
    x: pivot.x + (gesture.grabbedWorld.x - worldNow.x),
    y: pivot.y + (gesture.grabbedWorld.y - worldNow.y),
  });
}

function onTouchEnd(event) {
  if (event.touches.length < 2) gesture = null;
}

export function canvasGesturesAttached() {
  return attached;
}
