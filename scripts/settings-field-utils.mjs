/** Shared by foundry-settings-panel.mjs (player-facing settings tab) and
 * gm/settings-preset-app.mjs (GM preset editor) — both need to classify an
 * arbitrary game.settings.settings entry into a renderable field type and
 * resolve a namespace id to a display title. */

export function resolveNamespaceTitle(namespace) {
  if (namespace === "core") return "Core";
  if (namespace === game.system.id) return game.system.title;
  return game.modules.get(namespace)?.title ?? namespace;
}

export function classifyField(entry) {
  if (entry.type === Boolean) return "boolean";
  if (entry.choices) return "select";
  if (entry.range) return "range";
  if (entry.type === Number) return "number";
  if (entry.type === String) return "text";
  return "readonly";
}
