/**
 * Fallback adapter for any system other than vagabond. Stub only — read-only
 * flattened data plus a raw-formula roll box, just enough that companion mode
 * doesn't hard-fail on an unsupported system. Not polished this round (see
 * DESIGN.md §6 Phase 4, explicitly out of scope for now).
 */
export const GenericAdapter = {
  id: "generic",

  isAvailable() {
    return true;
  },

  async initHandlers() {
    // No system handlers to wire up — rolls are built directly in buildSheetData.
  },

  async buildSheetData(phoneApp) {
    const actor = phoneApp.actor;
    const fields = Object.entries(actor.system ?? {})
      .filter(([, v]) => typeof v !== "object" || v === null)
      .map(([key, value]) => ({ key, value: String(value) }));

    return {
      name: actor.name,
      img: actor.img,
      resources: [],
      stats: [],
      saves: [],
      skills: [],
      attackSkills: [],
      equipped: [],
      spells: [],
      inventory: [],
      magic: [],
      traits: [],
      features: [],
      perks: [],
      genericFields: fields,
      onRawRoll: async (formula) => {
        const roll = new Roll(formula, actor.getRollData());
        await roll.evaluate();
        return roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }) });
      },
    };
  },
};
