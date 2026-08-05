/**
 * Foundry's own Application/DialogV2 windows (JournalSheet's `.scrollable`
 * pages region, SpellCastDialog content, etc. — see the companion.css
 * comment on `.application:not(.pom-companion-app)`) rely on native
 * overflow-y scrolling, but one-finger touch drag inside them doesn't
 * reliably move the content on the phone (confirmed by the user testing the
 * journal sheet). This adds an explicit touch-drag-to-scroll fallback scoped
 * to core dialogs only — canvas-gestures.mjs/tap-actions.mjs (which handle
 * the canvas itself) are untouched.
 *
 * Same tap-vs-drag threshold approach as tap-actions.mjs: below the
 * threshold nothing happens and the touch resolves as a normal tap/click
 * (buttons inside dialogs must keep working); only past it do we take over
 * and drive scrollTop/scrollLeft manually.
 */

const DRAG_THRESHOLD_PX = 10;

let tracking = null; // { scrollEl, startX, startY, scrollTop, scrollLeft, dragging }

export function initDialogScrollGesture() {
  document.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("touchend", onTouchEnd, { passive: true });
  document.addEventListener("touchcancel", onTouchEnd, { passive: true });
}

// Prefer core's own `.scrollable` convention (ApplicationV2 parts config
// tags its designated scroll region with this class — see JournalSheet's
// `pages: { scrollable: [".journal-entry-pages"] }`); fall back to any
// ancestor that's actually overflowing, for plain Dialogs that don't use it.
function findScrollable(el) {
  let node = el;
  while (node && node !== document.body) {
    if (node.classList?.contains("scrollable")) return node;
    const style = getComputedStyle(node);
    const scrollableY = /auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
    const scrollableX = /auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
    if (scrollableY || scrollableX) return node;
    // Not `.application` — dialog-fit.mjs deliberately never tags V1 sheets
    // (Shadowdark, OSE, ...) with that class (see its wireV1Window comment).
    if (node.classList?.contains("pom-dialog-fit") || node.classList?.contains("pom-dialog-native")) break;
    node = node.parentElement;
  }
  return null;
}

function onTouchStart(event) {
  tracking = null;
  if (!document.body.classList.contains("pom-companion-mode") || event.touches.length !== 1) return;
  const dialog = event.target.closest(".pom-dialog-fit, .pom-dialog-native");
  if (!dialog) return;
  const scrollEl = findScrollable(event.target);
  if (!scrollEl) return;
  const t = event.touches[0];
  tracking = {
    scrollEl,
    startX: t.clientX,
    startY: t.clientY,
    scrollTop: scrollEl.scrollTop,
    scrollLeft: scrollEl.scrollLeft,
    dragging: false,
  };
}

function onTouchMove(event) {
  if (!tracking || event.touches.length !== 1) return;
  const t = event.touches[0];
  const dx = t.clientX - tracking.startX;
  const dy = t.clientY - tracking.startY;
  if (!tracking.dragging) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    tracking.dragging = true;
  }
  tracking.scrollEl.scrollTop = tracking.scrollTop - dy;
  tracking.scrollEl.scrollLeft = tracking.scrollLeft - dx;
  event.preventDefault();
}

function onTouchEnd() {
  tracking = null;
}
