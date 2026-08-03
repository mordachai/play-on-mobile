import { MODULE_ID } from "./settings.mjs";

/** Companion mode hides #sidebar (and with it, Settings), so a menu entry
 * there is unreachable exactly when a manual refresh is most needed.
 * Appended directly to <body> with inline styles instead, same reasoning as
 * the old escape-hatch button. Only shown when companion mode is active. */
export function initRefreshButton() {
  const companion = game.settings.get(MODULE_ID, "companionMode");
  if (!companion) return;

  const btn = document.createElement("button");
  btn.id = "pom-refresh-button";
  btn.type = "button";
  btn.title = "Play on Mobile: refresh";
  btn.textContent = "⟳";

  Object.assign(btn.style, {
    position: "fixed",
    top: "calc(env(safe-area-inset-top, 0px) + 8px)",
    zIndex: "2147483647",
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    border: "2px solid rgba(255,255,255,0.6)",
    background: "rgba(0,0,0,0.7)",
    color: "#fff",
    fontSize: "22px",
    lineHeight: "44px",
    padding: "0",
    opacity: "0.7",
    cursor: "pointer",
    touchAction: "manipulation",
  });
  btn.addEventListener("mouseenter", () => (btn.style.opacity = "1"));
  btn.addEventListener("mouseleave", () => (btn.style.opacity = "0.7"));

  btn.addEventListener("click", () => {
    btn.disabled = true;
    btn.textContent = "…";
    window.location.reload();
  });

  document.body.appendChild(btn);
  // Must run after appendChild — setRefreshButtonSide looks the button up by
  // ID, which only exists in the DOM once appended.
  setRefreshButtonSide(game.settings.get(MODULE_ID, "companionHandedness"));
}

/** Opposite corner from the dock, same reasoning as the pan nib (pan-nib.mjs).
 * Called on init and from the handedness setting's onChange (settings.mjs)
 * so it flips live, without needing a reload. */
export function setRefreshButtonSide(handedness) {
  const btn = document.getElementById("pom-refresh-button");
  if (!btn) return;

  const side = handedness === "left" ? "right" : "left";
  const other = side === "left" ? "right" : "left";
  btn.style[other] = "";
  btn.style[side] = `calc(env(safe-area-inset-${side}, 0px) + 8px)`;
}
