import { VagabondAdapter } from "./vagabond-adapter.mjs";
import { GenericAdapter } from "./generic-adapter.mjs";

const REGISTRY = {
  vagabond: VagabondAdapter,
};

export function getAdapter() {
  const adapter = REGISTRY[game.system.id];
  if (adapter && adapter.isAvailable()) return adapter;
  return GenericAdapter;
}
