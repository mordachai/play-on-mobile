import { GenericAdapter } from "./generic-adapter.mjs";
import { createDescriptorAdapter } from "./descriptor-engine.mjs";
import { validateDescriptor } from "./validate-descriptor.mjs";
import { MODULE_ID } from "../settings.mjs";
import vagabondDescriptor from "../../systems/vagabond.json" with { type: "json" };
import oseDescriptor from "../../systems/ose.json" with { type: "json" };

// Shipped, built-in descriptors — precedence tier 3. See
// docs/system-adapters-plan.md §7 for the full precedence order.
const SHIPPED = {
  vagabond: vagabondDescriptor,
  ose: oseDescriptor,
};

// isAvailable overrides for shipped descriptors — game.system.id alone isn't
// always enough; the system's own API namespace (set on its own "ready"
// hook) has to actually exist too.
const AVAILABILITY = {
  vagabond: () => typeof globalThis.vagabond !== "undefined",
};

// Precedence tier 2 — game.modules.get("play-on-mobile").api.registerSystem().
// Populated at runtime by other modules/systems; see registerSystem() below
// and the api export in play-on-mobile.mjs. Must be called on init/setup —
// getAdapter() isn't consulted until CompanionController.maybeActivate()
// on "ready".
const REGISTERED = new Map();

/** Validates eagerly at registration time (not at first use) so a bad
 * descriptor fails loudly for the module author registering it, not
 * silently later for whichever player happens to open the companion panel
 * first. */
export function registerSystem(descriptor) {
  if (!descriptor?.system) throw new Error(`${MODULE_ID} | registerSystem: descriptor missing "system"`);
  const { errors } = validateDescriptor(descriptor);
  if (errors.length) {
    throw new Error(`${MODULE_ID} | registerSystem: invalid descriptor for "${descriptor.system}":\n${errors.join("\n")}`);
  }
  REGISTERED.set(descriptor.system, descriptor);
}

function worldOverrideDescriptor() {
  const raw = game.settings.get(MODULE_ID, "systemDescriptorOverride");
  if (!raw) return null;
  let descriptor;
  try {
    descriptor = JSON.parse(raw);
  } catch (err) {
    console.error(`${MODULE_ID} | World descriptor override failed to parse, ignoring it:`, err);
    return null;
  }
  const { errors } = validateDescriptor(descriptor);
  if (errors.length) {
    console.error(`${MODULE_ID} | World descriptor override is invalid, ignoring it:`, errors);
    return null;
  }
  return descriptor;
}

/** Precedence: world setting override > api.registerSystem() > shipped
 * systems/*.json > generic fallback. The world override is scoped to
 * whichever system it declares, so a stale override left over from a
 * different world's system doesn't silently apply here — it just falls
 * through to the next tier instead. */
function activeDescriptor() {
  const worldDescriptor = worldOverrideDescriptor();
  if (worldDescriptor && worldDescriptor.system === game.system.id) return worldDescriptor;

  const registered = REGISTERED.get(game.system.id);
  if (registered) return registered;

  const shipped = SHIPPED[game.system.id];
  if (shipped && (AVAILABILITY[shipped.system]?.() ?? true)) return shipped;

  return null;
}

/** Exposed via the module api for support/debugging — "what descriptor is
 * actually driving the companion sheet right now, and where did it come
 * from". */
export function getActiveDescriptor() {
  return activeDescriptor();
}

export function getAdapter() {
  const descriptor = activeDescriptor();
  if (descriptor) return createDescriptorAdapter(descriptor);
  return GenericAdapter;
}
