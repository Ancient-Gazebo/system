/**
 * Keeps the specialization and signature ability lists on careers pointing at real items.
 *
 * A career lists both as `{name, source, id}` entries, `source` being the UUID of the linked item,
 * usually in the OggDude compendiums. Importing a data set with Delete Existing Compendiums ticked
 * rebuilds those compendiums with new ids, which left every career already on a character pointing
 * at items that no longer existed: the career sheet showed the links as broken, an in-career
 * specialization could not be bought, and an ability the data set renamed dropped out of the
 * purchase dialog, which matches signature abilities by name.
 *
 * A copied career (on a character, or in the Items directory) is relinked against the imported
 * career with the same OggDude key, or failing that the same name, and its lists become that
 * career's lists. A link to anywhere other than the imported compendiums (a homebrew specialization
 * dragged onto the career by hand) is kept; a link into them that the data set no longer gives the
 * career is dropped, so a replaced signature ability stops being offered. A career with no imported
 * counterpart keeps its own lists, with dead links repointed at an item of the same name where one
 * exists. The imported careers themselves only get that repair, which covers importing
 * specializations again without importing careers.
 */

const CAREER_PACK = "world.oggdudecareers";

const LISTS = {
  specializations: { type: "specialization", pack: "world.oggdudespecializations", setting: "specializationCompendiums" },
  signatureabilities: { type: "signatureability", pack: "world.oggdudesignatureabilities", setting: "signatureAbilityCompendiums" },
};

/**
 * Mark one key of an ObjectField for deletion in an update. V14 has an operator for it and
 * deprecates the old `-=key` form, which V13 still needs.
 * @param {object} update - the field's update object, changed in place
 * @param {string} key
 */
export function markDeleted(update, key) {
  const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
  if (game.release.generation >= 14 && ForcedDeletion) update[key] = ForcedDeletion.create();
  else update[`-=${key}`] = null;
}

/**
 * Items of one type by name, for repointing a dead link: the imported compendium first, then the
 * other compendiums the purchase dialog reads, then the Items directory.
 * @returns {Promise<Map<string, {name: string, source: string, id: string}>>}
 */
async function nameIndex({ type, pack, setting }) {
  const names = new Map();
  const packIds = [pack, ...(game.settings.get("starwarsffg", setting) ?? "").split(",").map((p) => p.trim())];
  for (const packId of new Set(packIds)) {
    const collection = game.packs.get(packId);
    if (collection?.documentName !== "Item") continue;
    for (const entry of await collection.getIndex({ fields: ["type"] })) {
      if (entry.type === type && !names.has(entry.name)) {
        names.set(entry.name, { name: entry.name, source: collection.getUuid(entry._id), id: entry._id });
      }
    }
  }
  for (const item of game.items) {
    if (item.type === type && !names.has(item.name)) names.set(item.name, { name: item.name, source: item.uuid, id: item.id });
  }
  return names;
}

/**
 * The item a link points at, as a fresh link: found by its UUID, or else by its name.
 * @returns {{name: string, source: string, id: string}|null} null when neither finds one
 */
function resolveLink(link, type, names) {
  if (!link) return null;
  let doc = null;
  try {
    doc = fromUuidSync(link.source, { strict: false });
  } catch (err) {
    doc = null;
  }
  if (doc && (!doc.type || doc.type === type)) return { name: doc.name, source: link.source, id: doc._id ?? doc.id };
  return names.get(link.name) ?? null;
}

/**
 * Work out one list's new contents and the update that writes them.
 * @param {object} current - the career's list as stored
 * @param {object|null} reference - the imported career's list, which wins, or null to repair only
 * @returns {{update: object, fixed: string[], removed: string[], broken: string[]}}
 */
function relinkList(current, reference, { type, pack }, names) {
  current ??= {};
  const managed = `Compendium.${pack}.`;
  const result = new Map();
  const report = { fixed: [], removed: [], broken: [] };
  for (const link of Object.values(reference ?? {})) {
    const found = resolveLink(link, type, names);
    if (found && !result.has(found.id)) result.set(found.id, found);
  }
  for (const [key, link] of Object.entries(current)) {
    const found = resolveLink(link, type, names);
    if (!found) {
      // Nothing to point it at. With no imported career to supply the list, keep it: its name is
      // still what the purchase dialog matches in-career specializations by.
      if (reference) report.removed.push(link?.name ?? key);
      else {
        result.set(key, link);
        report.broken.push(link?.name ?? key);
      }
      continue;
    }
    if (result.has(found.id)) continue;
    if (reference && found.source.startsWith(managed)) {
      report.removed.push(found.name);
      continue;
    }
    result.set(found.id, found);
  }

  const update = {};
  for (const key of Object.keys(current)) {
    if (!result.has(key)) markDeleted(update, key);
  }
  for (const [id, link] of result) {
    const old = current[id];
    if (old?.name !== link.name || old?.source !== link.source || old?.id !== link.id) {
      update[id] = { name: link.name, source: link.source, id: link.id };
      report.fixed.push(link.name);
    }
  }
  return { update, ...report };
}

/**
 * Relink every career in the world: the imported ones, the Items directory's and each actor's.
 * GM only.
 * @param {object} [options]
 * @param {function(string): void} [options.log] - receives one line per changed career
 * @returns {Promise<{checked: number, updated: number, fixed: number, removed: number, broken: number}|null>}
 */
export async function relinkCareers({ log = () => {} } = {}) {
  if (!game.user.isGM) return null;
  const summary = { checked: 0, updated: 0, fixed: 0, removed: 0, broken: 0 };
  const indexes = {};
  for (const [field, list] of Object.entries(LISTS)) indexes[field] = await nameIndex(list);

  const relink = async (career, reference) => {
    summary.checked += 1;
    const update = {};
    const notes = [];
    for (const [field, list] of Object.entries(LISTS)) {
      const result = relinkList(career.system?.[field], reference?.system?.[field], list, indexes[field]);
      if (Object.keys(result.update).length) update[field] = result.update;
      summary.fixed += result.fixed.length;
      summary.removed += result.removed.length;
      summary.broken += result.broken.length;
      if (result.fixed.length) notes.push(`linked ${result.fixed.join(", ")}`);
      if (result.removed.length) notes.push(`removed ${result.removed.join(", ")}`);
      if (result.broken.length) notes.push(`still broken ${result.broken.join(", ")}`);
    }
    if (notes.length) log(`${career.parent ? `${career.parent.name}: ` : ""}${career.name}: ${notes.join("; ")}`);
    if (!Object.keys(update).length) return;
    try {
      await career.update({ system: update });
      summary.updated += 1;
    } catch (err) {
      CONFIG.logger.error(`Could not relink career ${career.uuid}`, err);
    }
  };

  // The imported careers go first: the copies below are relinked to their repaired lists.
  const pack = game.packs.get(CAREER_PACK);
  const references = pack ? (await pack.getDocuments()).filter((c) => c.type === "career") : [];
  if (pack && !pack.locked) {
    for (const career of references) await relink(career, null);
  }

  const byKey = new Map();
  const byName = new Map();
  for (const career of references) {
    const key = career.flags?.starwarsffg?.ffgimportid;
    if (key && !byKey.has(key)) byKey.set(key, career);
    if (!byName.has(career.name)) byName.set(career.name, career);
  }

  const copies = game.items.filter((i) => i.type === "career");
  for (const actor of game.actors) copies.push(...actor.items.filter((i) => i.type === "career"));
  for (const career of copies) {
    const reference = byKey.get(career.flags?.starwarsffg?.ffgimportid) ?? byName.get(career.name) ?? null;
    await relink(career, reference);
  }
  return summary;
}
