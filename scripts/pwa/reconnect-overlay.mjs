import { MODULE_ID } from "../settings.mjs";

/** Shows a full-screen "reconnecting…" overlay on the companion phone while
 * the socket is down, so the player isn't left staring at a frozen sheet with
 * no feedback. Uses game.socket's underlying socket.io connect/disconnect
 * events — stable across Foundry versions since game.socket is a plain
 * socket.io client. */
export function initReconnectOverlay() {
  if (!game.settings.get(MODULE_ID, "companionMode")) return;
  if (!game.socket) return;

  const overlay = buildOverlay();
  document.body.appendChild(overlay);

  game.socket.on("disconnect", () => {
    overlay.classList.add("pom-visible");
  });
  game.socket.on("connect", () => {
    overlay.classList.remove("pom-visible");
    Hooks.callAll("play-on-mobile.reconnected");
  });
}

function buildOverlay() {
  const el = document.createElement("div");
  el.id = "pom-reconnect-overlay";
  el.textContent = game.i18n.localize("PLAYONMOBILE.Companion.Reconnecting");
  Object.assign(el.style, {
    position: "fixed",
    inset: "0",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.85)",
    color: "#fff",
    fontSize: "1.2rem",
    zIndex: "10000",
  });
  const style = document.createElement("style");
  style.textContent = "#pom-reconnect-overlay.pom-visible { display: flex !important; }";
  document.head.appendChild(style);
  return el;
}
