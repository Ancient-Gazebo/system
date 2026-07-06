/**
 * Sheet data helper for the DataModel migration.
 *
 * Once a DataModel is registered, `document.toObject(false)` serializes only the
 * schema-defined fields and silently drops the derived data that prepareData /
 * prepareDerivedData attach to the live `system` object — e.g. `skilltypes`,
 * `stats.*OverThreshold`, `renderedDesc`, and the CONFIG-merged + localized
 * `skills`. The sheets read those fields, and also need a mutable copy they can
 * freely delete from / modify for display.
 *
 * `preparedSystemCopy` returns a plain, mutable copy of the document's LIVE
 * prepared system: plain data is deep-cloned, while class instances (such as the
 * embedded ActiveEffect documents stored under `system.effects`) are left by
 * reference. This matches the previous `toObject(false)` behavior for non-plain
 * values and works whether or not a DataModel is registered.
 */
export function preparedSystemCopy(doc) {
  const system = doc?.system;
  if (!system || typeof system !== "object") return system;
  const out = {};
  for (const key of Object.keys(system)) {
    out[key] = foundry.utils.deepClone(system[key]);
  }
  return out;
}
