/**
 * Framework-free sanity check for a system descriptor (see
 * docs/system-adapters-plan.md §5 and docs/descriptor.schema.json). No
 * imports at all — deliberately safe to load both under plain `node` (see
 * tools/validate-descriptor.mjs, the CLI wrapper) and in the browser (the
 * world-setting descriptor override's Validate button, see
 * foundry-settings-panel.mjs / play-on-mobile.mjs).
 */

const RENDERERS = new Set(["resources", "stat-row", "check-grid", "item-list", "entry-list", "fields"]);
const INVOKE_KINDS = new Set(["actorMethod", "itemMethod", "propMethod", "formula", "update", "sheetClick", "custom"]);
const BUILTIN_ACTIONS = new Set(["use", "toChat", "edit", "delete"]);

function validateInvoke(invoke, path, errors) {
  if (invoke == null) return;
  if (typeof invoke !== "object") {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!INVOKE_KINDS.has(invoke.kind)) {
    errors.push(`${path}.kind "${invoke.kind}" is not one of: ${[...INVOKE_KINDS].join(", ")}`);
    return;
  }
  if (invoke.kind === "custom" && !invoke.fn) errors.push(`${path}: kind "custom" requires "fn"`);
  if (invoke.kind === "formula" && !invoke.formula) errors.push(`${path}: kind "formula" requires "formula"`);
  if (invoke.kind === "sheetClick" && !invoke.selector) errors.push(`${path}: kind "sheetClick" requires "selector"`);
  if (invoke.kind === "update" && !invoke.set) errors.push(`${path}: kind "update" requires "set"`);
  if ((invoke.kind === "actorMethod" || invoke.kind === "itemMethod" || invoke.kind === "propMethod") && !invoke.path) {
    errors.push(`${path}: kind "${invoke.kind}" requires "path"`);
  }
  if (invoke.kind === "propMethod" && !invoke.call) errors.push(`${path}: kind "propMethod" requires "call"`);
}

function validateAction(def, path, errors) {
  if (typeof def === "string") {
    if (!BUILTIN_ACTIONS.has(def)) errors.push(`${path}: unknown builtin action "${def}"`);
    return;
  }
  if (!def || typeof def !== "object") {
    errors.push(`${path} must be a string or an object`);
    return;
  }
  if (def.custom) return; // opaque — lives in invokeModule
  if (def.action === "toggle") {
    if (!def.path) errors.push(`${path}: action "toggle" requires "path"`);
  } else if (def.action === "invoke") {
    validateInvoke(def.invoke, `${path}.invoke`, errors);
  } else {
    errors.push(`${path}: unknown action.action "${def.action}"`);
  }
}

function validateSection(section, index, errors, seenIds) {
  const path = `sections[${index}]`;
  if (!section.id) {
    errors.push(`${path} missing required "id"`);
  } else if (seenIds.has(section.id)) {
    errors.push(`${path}: duplicate section id "${section.id}" — accordion state will collide`);
  } else {
    seenIds.add(section.id);
  }

  if (!RENDERERS.has(section.render)) {
    errors.push(`${path}.render "${section.render}" is not one of: ${[...RENDERERS].join(", ")}`);
    return;
  }

  if (section.render === "resources") {
    if (!Array.isArray(section.entries) || !section.entries.length) {
      errors.push(`${path}: render "resources" requires a non-empty "entries" array`);
    } else {
      section.entries.forEach((e, i) => {
        if (!e.key) errors.push(`${path}.entries[${i}] missing "key"`);
        if (e.value === undefined) errors.push(`${path}.entries[${i}] missing "value"`);
        if (e.editable && !e.write) errors.push(`${path}.entries[${i}]: editable requires "write"`);
      });
    }
  }

  if (["stat-row", "check-grid", "entry-list"].includes(section.render) && !section.source) {
    errors.push(`${path}: render "${section.render}" requires "source"`);
  }

  if (section.render === "item-list" && !section.where) {
    errors.push(`${path}: render "item-list" typically requires "where" to avoid listing every item`);
  }

  if (section.invoke) validateInvoke(section.invoke, `${path}.invoke`, errors);
  if (Array.isArray(section.actions)) {
    section.actions.forEach((def, i) => validateAction(def, `${path}.actions[${i}]`, errors));
  }
}

/** Returns { errors: string[] }. Empty errors means the descriptor is valid. */
export function validateDescriptor(descriptor) {
  const errors = [];

  if (descriptor.formatVersion !== 1) errors.push(`formatVersion must be 1, got ${descriptor.formatVersion}`);
  if (!descriptor.system) errors.push('missing required field "system"');
  if (!Array.isArray(descriptor.sections) || !descriptor.sections.length) {
    errors.push('missing required non-empty "sections" array');
    return { errors };
  }

  const seenIds = new Set();
  descriptor.sections.forEach((s, i) => validateSection(s, i, errors, seenIds));

  return { errors };
}
