/**
 * Floating one-finger pan control. The two-finger pan/pinch in
 * canvas-gestures.mjs needs a free hand; this is for panning the map with
 * just a thumb while the other hand is doing something else (or there isn't
 * one free). Classic virtual-joystick behavior: drag the knob off-center and
 * hold it there to keep panning in that direction for as long as it's held,
 * released snaps back to center and panning stops. Fixed at the vertical
 * center of the left edge — clear of the bottom-dock panel (portrait) and
 * the right-dock panel (landscape) either way.
 *
 * Double-tapping the nib (without dragging) recenters the canvas on the
 * user's own token, same speed-dial gesture as tap-actions.mjs uses for
 * targeting, since a virtual joystick has no room for a separate button.
 */

const BASE_RADIUS = 34; // px
const MAX_PAN_SPEED = 1400; // world units/sec at full deflection, before /scale
const TAP_MAX_MS = 300; // touch duration under which a touch counts as a tap, not a drag
const TAP_MAX_MOVE_PX = 10;
const DOUBLE_TAP_MS = 350; // max gap between two taps to count as a double-tap

// Multiplies MAX_PAN_SPEED — adjustable live from the companion Settings tab
// (see companion-app.mjs _onToggleNib / the nib-sensitivity range input)
// without tearing down and rebuilding the nib element.
let sensitivity = 1;

export function setPanNibSensitivity(value) {
  sensitivity = value;
}

// Screen edge the nib sits on — always opposite the dock (companionHandedness
// setting), so the dock's dominant-hand edge and the nib's other-hand edge
// never overlap. "right" handedness (dock on screen-right) puts the nib
// left, and vice versa. Live-updates the element if already built.
let nibSide = "left";

export function setPanNibSide(handedness) {
  nibSide = handedness === "left" ? "right" : "left";
  const base = document.getElementById("pom-pan-nib");
  if (base) applyNibSide(base);
}

function applyNibSide(base) {
  base.style.left = nibSide === "left" ? "calc(env(safe-area-inset-left, 0px) + 10px)" : "";
  base.style.right = nibSide === "right" ? "calc(env(safe-area-inset-right, 0px) + 10px)" : "";
}

/** Toggle from the Settings tab: builds/tears down the nib element on the
 * fly so the change is visible immediately, no reload required. */
export function setPanNibEnabled(enabled) {
  if (enabled) initPanNib();
  else document.getElementById("pom-pan-nib")?.remove();
}

export function initPanNib() {
  if (document.getElementById("pom-pan-nib")) return;

  const base = document.createElement("div");
  base.id = "pom-pan-nib";
  Object.assign(base.style, {
    position: "fixed",
    top: "50%",
    transform: "translateY(-50%)",
    width: `${BASE_RADIUS * 2}px`,
    height: `${BASE_RADIUS * 2}px`,
    borderRadius: "50%",
    background: "rgba(0,0,0,0.35)",
    border: "1px solid rgba(255,255,255,0.4)",
    // Below .pom-companion-app (z-index: 10 in companion.css) so an open
    // sheet/dock physically covers it and blocks its touches instead of the
    // nib silently eating taps meant for the sheet underneath (it used to
    // sit at 9000, above everything, including the companion panel).
    zIndex: "5",
    touchAction: "none",
  });
  applyNibSide(base);

  const knob = document.createElement("div");
  Object.assign(knob.style, {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: "26px",
    height: "26px",
    marginLeft: "-13px",
    marginTop: "-13px",
    borderRadius: "50%",
    background: "rgba(255,255,255,0.75)",
    transition: "transform 0.1s ease-out",
  });
  base.appendChild(knob);
  document.body.appendChild(base);

  let active = false;
  let originX = 0;
  let originY = 0;
  let dx = 0;
  let dy = 0;
  let rafId = null;
  let lastTime = 0;
  let touchStartTime = 0;
  let lastTapTime = 0;

  function onStart(event) {
    active = true;
    const t = event.touches[0];
    originX = t.clientX;
    originY = t.clientY;
    dx = 0;
    dy = 0;
    lastTime = performance.now();
    touchStartTime = lastTime;
    if (!rafId) rafId = requestAnimationFrame(loop);
    event.preventDefault();
  }

  function onMove(event) {
    if (!active) return;
    const t = event.touches[0];
    let mx = t.clientX - originX;
    let my = t.clientY - originY;
    const dist = Math.hypot(mx, my);
    if (dist > BASE_RADIUS) {
      mx = (mx / dist) * BASE_RADIUS;
      my = (my / dist) * BASE_RADIUS;
    }
    dx = mx;
    dy = my;
    knob.style.transition = "none";
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    event.preventDefault();
  }

  function onEnd(event) {
    active = false;
    const changed = event.changedTouches[0];
    const elapsed = performance.now() - touchStartTime;
    const moved = changed ? Math.hypot(changed.clientX - originX, changed.clientY - originY) : Infinity;
    dx = 0;
    dy = 0;
    knob.style.transition = "transform 0.1s ease-out";
    knob.style.transform = "translate(0, 0)";
    event.preventDefault();

    if (elapsed <= TAP_MAX_MS && moved <= TAP_MAX_MOVE_PX) {
      const now = performance.now();
      if (now - lastTapTime <= DOUBLE_TAP_MS) {
        lastTapTime = 0;
        panToOwnerToken();
      } else {
        lastTapTime = now;
      }
    }
  }

  function loop(now) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    if (active && (dx || dy) && canvas?.ready) {
      const scale = canvas.stage.scale.x || 1;
      const speed = (MAX_PAN_SPEED * sensitivity) / scale;
      const fracX = dx / BASE_RADIUS;
      const fracY = dy / BASE_RADIUS;
      const pivot = canvas.stage.pivot;
      canvas.pan({ x: pivot.x + fracX * speed * dt, y: pivot.y + fracY * speed * dt });
    }
    if (active) rafId = requestAnimationFrame(loop);
    else rafId = null;
  }

  function panToOwnerToken() {
    if (!canvas?.ready) return;
    const token = getOwnerToken();
    if (!token) return;
    if (!token.controlled) token.control({ releaseOthers: true });
    const doc = token.document;
    const size = canvas.grid.size;
    canvas.animatePan({
      x: doc.x + (doc.width * size) / 2,
      y: doc.y + (doc.height * size) / 2,
      duration: 400,
    });
  }

  function getOwnerToken() {
    const controlled = canvas.tokens.controlled[0];
    if (controlled?.isOwner) return controlled;
    const character = game.user.character;
    const characterToken = character?.getActiveTokens(true)[0];
    if (characterToken) return characterToken;
    return canvas.tokens.placeables.find((t) => t.isOwner) ?? null;
  }

  base.addEventListener("touchstart", onStart, { passive: false });
  base.addEventListener("touchmove", onMove, { passive: false });
  base.addEventListener("touchend", onEnd, { passive: false });
  base.addEventListener("touchcancel", onEnd, { passive: false });
}
