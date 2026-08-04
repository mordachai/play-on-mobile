/**
 * Core opens a token's actor sheet on double-click (Token#_onClickLeft2),
 * fed by PIXI's own click-count tracking on the canvas view — a path
 * separate from tap-actions.mjs's touchstart/touchend listeners, so nothing
 * there can intercept it. Wrapping the method itself is the only point that
 * sees "this resolved to a double-click" before the sheet renders.
 *
 * Must be installed at "init", before canvas/tokens exist. Each Token's
 * PlaceableObject#_createInteractionManager() (called from draw(), which
 * runs at canvasReady) captures `this._onClickLeft2` BY VALUE into its
 * MouseInteractionManager callbacks — not a live property lookup. Patching
 * the prototype later (e.g. from CompanionController on "ready") is too
 * late: already-drawn tokens keep calling the pre-patch original forever,
 * which is why gating install on companionMode at "ready" silently didn't
 * work. Instead the wrap is always installed, and gates its behavior
 * per-call on both companionMode and the setting, so a non-companion client
 * is unaffected.
 */

import { MODULE_ID } from "../settings.mjs";

let wrapped = false;

export function initSheetOpenGuard() {
  if (wrapped) return;
  wrapped = true;

  const TokenClass = foundry.canvas.placeables.Token;
  const original = TokenClass.prototype._onClickLeft2;
  TokenClass.prototype._onClickLeft2 = function (event) {
    if (
      game.settings.get(MODULE_ID, "companionMode") &&
      game.settings.get(MODULE_ID, "blockDoubleTapSheetOpen")
    ) {
      return;
    }
    return original.call(this, event);
  };
}
