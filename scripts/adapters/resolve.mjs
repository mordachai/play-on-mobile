/**
 * Pure expression/filter/label resolution for system descriptors (see
 * docs/system-adapters-plan.md §5). CONFIG and i18n are passed in explicitly
 * via `ctx` rather than read off the global — keeps this file unit-testable
 * with plain `node --test` outside a running Foundry instance, and the exact
 * same code path runs in production once ctx.CONFIG is the real global.
 */

const COMPARATORS = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
  nin: (a, b) => Array.isArray(b) && !b.includes(a),
};

export function getProperty(obj, path) {
  if (obj == null || !path) return undefined;
  let cur = obj;
  for (const part of String(path).split(".")) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function setProperty(obj, path, value) {
  const parts = String(path).split(".");
  const last = parts.pop();
  let cur = obj;
  for (const part of parts) {
    if (cur[part] == null || typeof cur[part] !== "object") cur[part] = {};
    cur = cur[part];
  }
  cur[last] = value;
  return obj;
}

function actorItemsList(ctx) {
  const items = ctx.actor?.items ?? [];
  return Array.isArray(items) ? items : Array.from(items);
}

/**
 * Resolves one descriptor expression against a context ({ actor, item, entry, snapshot }):
 *   "@system.foo.bar"        -> path on ctx.actor
 *   "@snap.foo.bar"          -> path on ctx.snapshot (see descriptor `snapshot` field —
 *                                a system's own derived-data read, e.g. vagabond's
 *                                VagabondActor.read(), used instead of reimplementing
 *                                that unwrapping/renaming logic as JSON)
 *   "@items.<type>"          -> first embedded item of that type
 *   "@items.<type>.<path>"   -> a path read off that item (e.g. its own .system)
 *   "@itemsOfType.<type>"    -> EVERY embedded item of that type, as an array —
 *                                for entry-list sections sourced straight from
 *                                actor.items rather than an embedded array on
 *                                one particular item (e.g. vagabond's perks)
 *   "@item.foo"              -> path on ctx.item (item-list rows)
 *   "@.foo"                  -> path on ctx.entry (relative — inside a `source` iteration)
 *   "@"                      -> ctx.entry itself
 *   anything without a leading "@" -> literal, returned unchanged
 * Non-string values pass through unchanged (already-resolved data).
 */
export function resolveExpr(expr, ctx = {}) {
  if (typeof expr !== "string" || !expr.startsWith("@")) return expr;

  if (expr.startsWith("@itemsOfType.")) {
    const type = expr.slice("@itemsOfType.".length);
    return actorItemsList(ctx).filter((i) => i.type === type);
  }
  if (expr.startsWith("@items.")) {
    const [type, ...rest] = expr.slice("@items.".length).split(".");
    const item = actorItemsList(ctx).find((i) => i.type === type);
    return rest.length ? getProperty(item, rest.join(".")) : item;
  }
  if (expr.startsWith("@item.")) return getProperty(ctx.item, expr.slice("@item.".length));
  if (expr.startsWith("@snap.")) return getProperty(ctx.snapshot, expr.slice("@snap.".length));
  if (expr.startsWith("@.")) return getProperty(ctx.entry, expr.slice(2));
  if (expr === "@") return ctx.entry;
  return getProperty(ctx.actor, expr.slice(1));
}

/** Recursively templates "{key}" tokens inside strings — turns an invoke's
 * `args`/`formula`/`set` templates into real values from the current
 * iteration (skills.{key} -> skills.strength). Tokens with no matching var
 * are left untouched rather than replaced with "undefined". */
export function templateValue(value, vars = {}) {
  if (typeof value === "string") {
    return value.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
  }
  if (Array.isArray(value)) return value.map((v) => templateValue(v, vars));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = templateValue(v, vars);
    return out;
  }
  return value;
}

/** AND of every key in `where` against `subject` (an item, or an entry from
 * a `source` iteration). A bare scalar means eq; a bare array means "in".
 * Comparator values that are themselves descriptor expressions
 * ("@system.details.level") are resolved against `ctx` first, so filters can
 * compare against live actor state. `where.custom` names a predicate
 * exported from the descriptor's invokeModule, looked up in
 * `customPredicates`. */
export function matchWhere(where, subject, ctx = {}, customPredicates = {}) {
  if (!where) return true;
  for (const [key, test] of Object.entries(where)) {
    if (key === "custom") {
      const fn = customPredicates[test];
      if (typeof fn !== "function" || !fn(subject, ctx)) return false;
      continue;
    }
    const actual = getProperty(subject, key);
    if (Array.isArray(test)) {
      if (!test.includes(actual)) return false;
    } else if (test && typeof test === "object") {
      for (const [op, raw] of Object.entries(test)) {
        const cmp = COMPARATORS[op];
        if (!cmp) throw new Error(`Unknown where comparator "${op}"`);
        const expected = typeof raw === "string" && raw.startsWith("@") ? resolveExpr(raw, ctx) : raw;
        if (!cmp(actual, expected)) return false;
      }
    } else if (actual !== test) {
      return false;
    }
  }
  return true;
}

/** Systems store labels three different ways — a plain string in CONFIG, an
 * object with a label/name field, or something that still needs localizing.
 * One resolver handles all three so descriptors don't need to know which
 * shape a given system chose. */
export function resolveLabelFrom(labelFrom, key, ctx = {}) {
  if (!labelFrom) return key;
  const table = getProperty(ctx.CONFIG, labelFrom.config);
  const raw = table?.[key];
  let label = key;
  if (typeof raw === "string") label = raw;
  else if (raw && typeof raw === "object") label = raw[labelFrom.field ?? "label"] ?? raw.name ?? key;
  if (labelFrom.localize && ctx.i18n?.localize) label = ctx.i18n.localize(label);
  return label;
}
