/**
 * Single-finger tap gestures layered on top of core's native touch handling
 * (which already does tap-to-select and drag-to-move-a-token — see
 * canvas-gestures.mjs's header comment). This file only reacts to taps that
 * core doesn't already give special meaning to:
 *
 * - Tap empty space while a token is controlled → walk it there, distance
 *   capped by the actor's speed (vagabond-specific field, degrades to
 *   unlimited if the system/actor doesn't have a recognizable one).
 * - Tap the same token twice quickly → toggle target, since touch has no
 *   hover/right-click to hang the usual targeting affordance off of.
 * - Tap an already-controlled token once (not a double-tap) → release it.
 *   Core only ever selects on tap, never deselects, so this is layered on
 *   top rather than something core already gives us.
 *
 * Never calls preventDefault — a tap is, from core's perspective, a completed
 * click it already fully handled by the time our touchend fires; we're only
 * adding a side effect, not intercepting the gesture.
 */

const TAP_MAX_MS = 300;
const TAP_MAX_MOVE_PX = 10;
const DOUBLE_TAP_MS = 350;

let tapStart = null;
let lastTap = null; // { tokenId, time }

export function attachTapActions(view) {
  view.addEventListener("touchstart", onTouchStart, { passive: true });
  view.addEventListener("touchend", onTouchEnd, { passive: true });
}

function onTouchStart(event) {
  if (event.touches.length !== 1 || !canvas?.ready) {
    tapStart = null;
    return;
  }
  const t = event.touches[0];
  // Captured before core's own touchend handling runs, so this reflects
  // selection state going into the tap, not whatever the tap just did.
  const world = canvas.canvasCoordinatesFromClient({ x: t.clientX, y: t.clientY });
  const token = tokenAtWorldPoint(world.x, world.y);
  tapStart = {
    x: t.clientX,
    y: t.clientY,
    time: performance.now(),
    tokenWasControlled: token?.controlled ?? false,
  };
}

function onTouchEnd(event) {
  if (!tapStart || event.touches.length !== 0 || !canvas?.ready) return;
  const changed = event.changedTouches[0];
  const start = tapStart;
  tapStart = null;
  if (!changed) return;

  const elapsed = performance.now() - start.time;
  const moved = Math.hypot(changed.clientX - start.x, changed.clientY - start.y);
  if (elapsed > TAP_MAX_MS || moved > TAP_MAX_MOVE_PX) return; // was a drag, not a tap

  const world = canvas.canvasCoordinatesFromClient({ x: changed.clientX, y: changed.clientY });
  const token = tokenAtWorldPoint(world.x, world.y);

  if (token) {
    handlePossibleDoubleTap(token, start.tokenWasControlled);
    return;
  }

  const controlled = canvas.tokens.controlled[0];
  if (controlled?.isOwner) moveTowardSpeedLimited(controlled, world);
}

function tokenAtWorldPoint(x, y) {
  for (const t of canvas.tokens.placeables) {
    const doc = t.document;
    const w = doc.width * canvas.grid.size;
    const h = doc.height * canvas.grid.size;
    if (x >= doc.x && x <= doc.x + w && y >= doc.y && y <= doc.y + h) return t;
  }
  return null;
}

function handlePossibleDoubleTap(token, wasControlled) {
  const now = performance.now();
  if (lastTap && lastTap.tokenId === token.id && now - lastTap.time <= DOUBLE_TAP_MS) {
    token.setTarget(!game.user.targets.has(token), { releaseOthers: false });
    lastTap = null;
    return;
  }

  lastTap = { tokenId: token.id, time: now };
  if (wasControlled && token.controlled) token.release();
}

function moveTowardSpeedLimited(token, worldTarget) {
  const doc = token.document;
  const size = canvas.grid.size;
  const cx = doc.x + (doc.width * size) / 2;
  const cy = doc.y + (doc.height * size) / 2;
  const dx = worldTarget.x - cx;
  const dy = worldTarget.y - cy;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return;

  const maxDistance = getSpeedLimitPixels(token.actor);
  const ratio = maxDistance && dist > maxDistance ? maxDistance / dist : 1;
  const newCx = cx + dx * ratio;
  const newCy = cy + dy * ratio;

  // Raw, collision-less update — documented MVP limitation, see DESIGN.md §7 risk 1.
  return doc.update({ x: newCx - (doc.width * size) / 2, y: newCy - (doc.height * size) / 2 });
}

function getSpeedLimitPixels(actor) {
  const raw = actor?.system?.speed;
  const speedValue = typeof raw === "number" ? raw : raw?.base;
  if (typeof speedValue !== "number" || !canvas.scene) return null;

  const distancePerSquare = canvas.scene.grid.distance || 1;
  const squares = speedValue / distancePerSquare;
  return squares * canvas.grid.size;
}
