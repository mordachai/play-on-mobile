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
  Hooks.on("renderApplicationV2", (app, el) => {
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

    tagAndWire(app, el);

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

  // Many systems (confirmed: Shadowdark, OSE — see the live-testing memory)
  // still ship V1 Application actor/item sheets, not ApplicationV2, and V1
  // never fires renderApplicationV2 at all — every rule above silently never
  // applied to them. V1's own hook dispatch (Application#_callHooks) only
  // calls hooks named after classes up to whichever ancestor set
  // `baseApplication` on itself; ActorSheet/ItemSheet both do (to their own
  // name), so "renderActorSheet"/"renderItemSheet" are the two hook names
  // guaranteed to fire for *every* system's actor/item sheets regardless of
  // subclass — see foundry.mjs ActorSheet/ItemSheet defaultOptions and
  // Application#_getInheritanceChain. Plain "renderApplication" is kept as a
  // fallback for V1 windows that don't set baseApplication at all.
  for (const hook of ["renderApplication", "renderActorSheet", "renderItemSheet"]) {
    Hooks.on(hook, (app, _html) => wireV1Window(app));
  }
}

function wireV1Window(app) {
  if (!document.body.classList.contains("pom-companion-mode")) return;
  // `app.element` (not the hook's own `html` arg) is always the current
  // outer `.app.window-app` frame for a V1 Application, on first render and
  // every re-render alike — the hook's `html` is only the outer frame on the
  // very first render (see application-v1.mjs#_render: `html = inner`
  // unless this is a fresh popOut).
  const el = app.element?.[0];
  if (!el || !app.popOut) return;
  // Deliberately NOT tagged with core's own "application" class — V1's
  // window-app template never carries it, and blindly adding it would pull
  // in ~165 V2-specific core rules (positioning, min-width, header-control
  // sizing, ...) built for V2's slightly different internal DOM, likely
  // breaking layout rather than fixing it. tagAndWire's own
  // pom-dialog-fit/pom-dialog-native classes are self-contained (no
  // `.application` dependency) and are what companion.css's touch-action
  // and touch-target-sizing rules key off of instead — see the comments
  // there.
  tagAndWire(app, el);
}

function tagAndWire(app, el) {
  const descriptor = getActiveDescriptor();
  const native = descriptor?.dialogs?.selfPositioned ?? [];
  const isNative = native.some((sel) => matchesSafely(el, sel));
  el.classList.add(isNative ? "pom-dialog-native" : "pom-dialog-fit");

  if (descriptor?.dialogs?.collapsePanel !== false) collapseCompanionPanel();

  preventTouchMinimize(app);

  const header = el.querySelector(".window-header");
  if (!header) {
    wireFramelessDrag(el, descriptor);
  } else if (!isNative) {
    // pom-dialog-native dialogs position themselves already (own JS) —
    // leave them alone. Everything else gets our own free-form drag instead
    // of core's clamped Draggable — see wireHeaderDrag for why.
    wireHeaderDrag(app, el, header);
  }
}

// Core's window-header has a "dblclick" -> minimize handler (V1's
// _onToggleMinimize / V2's #onWindowDoubleClick) built for a desktop mouse.
// On touch, two quick taps on the header — a natural retry when a drag
// attempt didn't seem to register — get synthesized by the browser into a
// real "dblclick" event and silently collapse the sheet to a title-only
// strip sitting over whatever's beneath it (confirmed live: reported as "a
// thin strip of a sheet covers some values"). Companion mode has no touch
// equivalent for "restore from minimized" surfaced anywhere, so once
// minimized this way a sheet is effectively stuck.
//
// No-op the instance's own minimize/maximize rather than trying to intercept
// the dblclick event itself: both handlers call `this.minimize(ev)`/
// `this.maximize(ev)` dynamically (not a pre-bound reference), so overriding
// the instance methods works regardless of listener registration order —
// an event-interception approach would depend on our listener running before
// core's own (already-registered-at-render-time) one, which isn't guaranteed.
function preventTouchMinimize(app) {
  if (app.__pomNoMinimize) return;
  app.__pomNoMinimize = true;
  app.minimize = async () => {};
  app.maximize = async () => {};
}

// Core's own Draggable (application.mjs's #onWindowDragStart / the V1
// Draggable class) drives dragging through `app.setPosition()`, which clamps
// left/top to keep the window fully on-screen — reasonable on desktop, but
// on a phone it means (a) a sheet can never be dragged partway off-screen to
// reach fields hidden behind the companion panel or the URL bar, and (b) any
// system sheet with a desktop-oriented min-width wider than the viewport
// (confirmed live: Shadowdark's item sheet, 550px on a 384px phone) gets
// wedged against the left edge and can't move at all, since the clamp range
// collapses once width exceeds innerWidth.
//
// So instead of letting core drive position, we take the header over
// entirely — same free-form, unclamped pointer-drag already used for
// frameless dialogs (wireFramelessDrag), just with an extra step up front to
// stop core's own handler from also reacting to the same touch and fighting
// us for position. That also means dropping the old shrink-to-65%-of-
// viewport-on-first-touch move: it existed only to leave room inside core's
// clamp, and shrinking a system's sheet below its designed width is exactly
// what was squeezing field rows down to unreadable slivers (confirmed live:
// "a thin strip of a sheet... fields are almost covered by their divs").
// Unpinning now only frees *position*, not size — the sheet keeps its
// natural/system width and can hang off either edge once dragged.
function wireHeaderDrag(app, el, header) {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const onDown = (event) => {
    // Capture phase + stopImmediatePropagation so core's own bubble-phase
    // pointerdown handler on this same header never runs — otherwise it'd
    // start its own clamped drag in parallel with ours. Reliable whenever
    // the touch lands on a header child (title text, icons — the common
    // case): ancestor capture-listeners fire before a descendant target's
    // own bubble listeners. Only misses the edge case of a touch landing on
    // bare header background with no child element under it.
    event.stopImmediatePropagation();
    if (!el.classList.contains("pom-dialog-fit-unpinned")) {
      // First touch: freeze the current on-screen position into inline
      // left/top so removing the pinned-CSS class (companion.css's
      // `:not(.pom-dialog-fit-unpinned)` rule) doesn't jump the window —
      // deliberately NOT freezing width/height too, so the sheet reverts to
      // its natural system-CSS size once unpinned instead of staying
      // shrunk-to-fit.
      const rect = el.getBoundingClientRect();
      el.style.position = "fixed";
      el.style.left = `${rect.left}px`;
      el.style.top = `${rect.top}px`;
      el.classList.add("pom-dialog-fit-unpinned");
    }
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    const rect = el.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    header.setPointerCapture(event.pointerId);
  };
  const onMove = (event) => {
    if (!dragging) return;
    el.style.left = `${startLeft + (event.clientX - startX)}px`;
    el.style.top = `${startTop + (event.clientY - startY)}px`;
    event.preventDefault();
  };
  const onUp = () => {
    dragging = false;
  };

  header.addEventListener("pointerdown", onDown, { capture: true });
  header.addEventListener("pointermove", onMove);
  header.addEventListener("pointerup", onUp);
  header.addEventListener("pointercancel", onUp);
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
