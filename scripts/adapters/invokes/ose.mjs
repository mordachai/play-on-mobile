/**
 * Custom invokes for systems/ose.json — OSE's actor/item methods (rollCheck,
 * rollSave, rollExploration, item.roll()) are called directly via plain
 * "actorMethod"/"itemMethod" invokes in the descriptor, so the only code
 * needed here is a load-time label fixup and one snapshot read.
 *
 * OSE's own CONFIG.OSE.exploration_skills / exploration_skills_short tables
 * key the fourth exploration skill "fs", while the actual actor data field
 * (system.exploration.ft) and Actor#rollExploration()'s expected argument
 * are both "ft" — a mismatch inside OSE's own config.ts, not something a
 * plain @-expression can route around. Alias the missing "ft" key once at
 * import time so the descriptor's plain `labelFrom` lookups resolve for all
 * four exploration skills.
 */
const skills = CONFIG.OSE?.exploration_skills;
const skillsShort = CONFIG.OSE?.exploration_skills_short;
if (skills && !("ft" in skills)) skills.ft = skills.fs;
if (skillsShort && !("ft" in skillsShort)) skillsShort.ft = skillsShort.fs;

const SCORE_KEYS = ["str", "int", "wis", "dex", "con", "cha"];

/** OSE's Actor#system.scores is an OseDataModelCharacterScores instance —
 * str/int/wis/dex/con/cha are getters on its prototype, not the instance's
 * own enumerable properties, so a plain `@system.scores` check-grid source
 * (which iterates via Object.entries) always sees an empty object even
 * though `actor.system.scores.str` itself resolves fine. Confirmed live:
 * Object.keys(actor.system.scores) === [] while actor.system.scores.str ===
 * {value, bonus, mod, od}. Flattening it into a plain object here — exactly
 * the kind of system-owns-its-own-derived-data-shape case the descriptor's
 * `snapshot` field exists for — is the fix; iterating @system.scores
 * directly cannot work. */
export function readSnapshot(actor) {
  const scores = {};
  for (const key of SCORE_KEYS) scores[key] = actor.system.scores[key];
  return { scores };
}
