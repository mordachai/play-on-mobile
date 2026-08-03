import { MODULE_ID } from "../settings.mjs";

/** Opt-in, meant for the TV-casting source device, not the TV or the phone.
 * Browsers release wake locks when a tab is backgrounded, so it's
 * re-acquired on visibilitychange. */
export function initWakeLock() {
  if (!("wakeLock" in navigator)) return;
  if (!game.settings.get(MODULE_ID, "keepAwake")) return;

  let lock = null;
  const acquire = async () => {
    try {
      lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => {
        lock = null;
      });
    } catch (err) {
      console.warn("Play on Mobile | wake lock request failed", err);
    }
  };

  acquire();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !lock) acquire();
  });
}
