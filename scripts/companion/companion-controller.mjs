import { MODULE_ID } from "../settings.mjs";
import { PhoneCompanionApp } from "./companion-app.mjs";
import { initCanvasGestures } from "../gestures/canvas-gestures.mjs";
import { initPanNib, setPanNibSensitivity, setPanNibSide } from "../gestures/pan-nib.mjs";
import { initDialogScrollGesture } from "../gestures/dialog-scroll.mjs";
import { initDialogFit } from "../gestures/dialog-fit.mjs";
import { applyCompanionSettingsPreset } from "../gm/settings-preset.mjs";

const BODY_CLASS = "pom-companion-mode";

export const CompanionController = {
  async maybeActivate() {
    if (!game.settings.get(MODULE_ID, "companionMode")) return;

    // Apply the GM's forced-settings preset first — everything below reads
    // module settings (panNibEnabled, companionHandedness, ...) that a
    // preset entry may have just overridden, and this same activation
    // should see the forced value, not wait for a reload.
    await applyCompanionSettingsPreset();

    document.body.classList.add(BODY_CLASS);
    // Canvas stays live: it's the map view now, mirrored to the TV via the
    // phone's own screen-mirroring, not a separate hidden-away thing.
    initCanvasGestures();
    initDialogScrollGesture();
    initDialogFit();
    setPanNibSensitivity(game.settings.get(MODULE_ID, "panNibSensitivity"));
    setPanNibSide(game.settings.get(MODULE_ID, "companionHandedness"));
    if (game.settings.get(MODULE_ID, "panNibEnabled")) initPanNib();

    const actor = resolveBoundActor();
    const app = new PhoneCompanionApp({ actor });
    app.render({ force: true });
  },
};

function resolveBoundActor() {
  const boundId = game.settings.get(MODULE_ID, "companionActorId");
  if (boundId) {
    const actor = game.actors.get(boundId);
    if (actor?.isOwner) return actor;
  }
  return game.user.character ?? null;
}
