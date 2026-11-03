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
 *
 * Species list their talents the same way, and dropping a species on a character fetches each one
 * through its link, so a species whose talents were imported again without it silently granted
 * nothing. Species only ever get the repair: a dead link is repointed at the talent of the same name.
 */

import ModifierHelpers from "./modifiers.js";
import { careerSkillSlots, systemSkillKey } from "./skill-keys.js";
import { markDeleted } from "./update-operators.js";

const CAREER_PACK = "world.oggdudecareers";
const SPECIES_PACK = "world.oggdudespecies";

const LISTS = {
  specializations: { type: "specialization", pack: "world.oggdudespecializations", setting: "specializationCompendiums" },
  signatureabilities: { type: "signatureability", pack: "world.oggdudesignatureabilities", setting: "signatureAbilityCompendiums" },
};
const SPECIES_TALENTS = { type: "talent", pack: "world.oggdudetalents", setting: "talentCompendiums" };

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
 * @param {object} [options]
 * @param {boolean} [options.keepNames] - keep the names stored with links that still resolve
 * @returns {{update: object, fixed: string[], removed: string[], broken: string[]}}
 */
function relinkList(current, reference, { type, pack }, names, { keepNames = false } = {}) {
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
    result.set(found.id, keepNames && link?.name ? { ...found, name: link.name } : found);
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

/**
 * Repair the career skills of every career and specialization in the world. Before 4.0.21 the
 * importer stored each skill's OggDude name ("Athletics ", "Knowledge: Science") where the skill
 * list's key belongs, so with a list keyed otherwise those slots matched no skill and granted
 * nothing, and every copy made from them carried the same names.
 *
 * Each stored name becomes its skill's key; a skill the list does not have drops out. A copy (on a
 * character or in the Items directory) then takes the career skills of the imported career or
 * specialization with the same OggDude key (or name) when everything it has is on that list, which
 * fills in skills it lost or never got; a copy holding a skill the imported one lacks was set by
 * hand and keeps its own list. GM only; safe to run again.
 * @param {object} [options]
 * @param {function(string): void} [options.log] - receives one line per changed item
 * @returns {Promise<{checked: number, updated: number}|null>}
 */
export async function repairCareerSkills({ log = () => {} } = {}) {
  if (!game.user.isGM) return null;
  const summary = { checked: 0, updated: 0 };
  const known = new Set(Object.keys(CONFIG.FFG.skills ?? {}));
  const filled = (item) => careerSkillSlots(item.type)
    .map((slot) => item.system?.careerSkills?.[slot])
    .filter((skill) => skill && skill !== "(none)");

  const repair = async (item, reference) => {
    summary.checked += 1;
    const slots = careerSkillSlots(item.type);
    const current = filled(item);
    const resolved = [];
    for (const skill of current) {
      const key = known.has(skill) ? skill : systemSkillKey(skill);
      if (key && !resolved.includes(key)) resolved.push(key);
    }
    let wanted = resolved;
    if (reference) {
      const imported = filled(reference).filter((skill) => known.has(skill));
      const covered = resolved.every((skill) => imported.includes(skill));
      // the same skills in another order are left as they are
      if (covered && imported.length > resolved.length) wanted = imported;
    }
    if (wanted.length > slots.length) {
      log(`${item.name}: ${wanted.slice(slots.length).join(", ")} does not fit in ${slots.length} slots`);
    }
    const next = Object.fromEntries(slots.map((slot, i) => [slot, wanted[i] ?? "(none)"]));
    if (slots.every((slot) => (item.system?.careerSkills?.[slot] ?? "(none)") === next[slot])) return;
    try {
      await item.update({ system: { careerSkills: next } });
      summary.updated += 1;
      log(`${item.parent ? `${item.parent.name}: ` : ""}${item.name}: ${wanted.slice(0, slots.length).join(", ") || "(none)"}`);
    } catch (err) {
      CONFIG.logger.error(`Could not repair the career skills of ${item.uuid}`, err);
    }
  };

  for (const [type, packId] of [["career", CAREER_PACK], ["specialization", "world.oggdudespecializations"]]) {
    // The imported entries first (their names only): the copies below take their lists from them.
    const pack = game.packs.get(packId);
    const references = pack ? (await pack.getDocuments()).filter((item) => item.type === type) : [];
    if (pack && !pack.locked) {
      for (const item of references) await repair(item, null);
    }
    const byKey = new Map();
    const byName = new Map();
    for (const item of references) {
      const key = item.flags?.starwarsffg?.ffgimportid;
      if (key && !byKey.has(key)) byKey.set(key, item);
      if (!byName.has(item.name)) byName.set(item.name, item);
    }
    const copies = game.items.filter((item) => item.type === type);
    for (const actor of game.actors) copies.push(...actor.items.filter((item) => item.type === type));
    for (const item of copies) {
      await repair(item, byKey.get(item.flags?.starwarsffg?.ffgimportid) ?? byName.get(item.name) ?? null);
    }
  }
  return summary;
}

/**
 * Repair every species in the world (the imported ones, the Items directory's and each actor's):
 * dead talent links are repointed at the talent of the same name, and modifiers whose effects an
 * import left empty or missing get them rebuilt. GM only.
 * @param {object} [options]
 * @param {function(string): void} [options.log] - receives one line per changed species
 * @returns {Promise<{checked: number, updated: number, fixed: number, broken: number, effects: number}|null>}
 */
export async function relinkSpecies({ log = () => {} } = {}) {
  if (!game.user.isGM) return null;
  const summary = { checked: 0, updated: 0, fixed: 0, broken: 0, effects: 0 };
  const names = await nameIndex(SPECIES_TALENTS);

  const pack = game.packs.get(SPECIES_PACK);
  const species = pack && !pack.locked ? (await pack.getDocuments()).filter((s) => s.type === "species") : [];
  species.push(...game.items.filter((i) => i.type === "species"));
  for (const actor of game.actors) species.push(...actor.items.filter((i) => i.type === "species"));

  for (const item of species) {
    summary.checked += 1;
    // A character's copy keeps the names it was given: removing the species deletes the talents it
    // granted by name, and those copies still carry the old names.
    const result = relinkList(item.system?.talents, null, SPECIES_TALENTS, names, { keepNames: !!item.parent });
    summary.fixed += result.fixed.length;
    summary.broken += result.broken.length;
    const notes = [];
    if (result.fixed.length) notes.push(`linked ${result.fixed.join(", ")}`);
    if (result.broken.length) notes.push(`still broken ${result.broken.join(", ")}`);
    let changed = false;
    try {
      if (Object.keys(result.update).length) {
        await item.update({ system: { talents: result.update } });
        changed = true;
      }
      const effects = await ModifierHelpers.reconcileAttributeEffects(item);
      const repaired = effects.created + effects.rebuilt + effects.deleted;
      if (repaired) {
        summary.effects += repaired;
        notes.push(`${repaired} modifier effects repaired`);
        changed = true;
      }
    } catch (err) {
      CONFIG.logger.error(`Could not relink species ${item.uuid}`, err);
    }
    if (changed) summary.updated += 1;
    if (notes.length) log(`${item.parent ? `${item.parent.name}: ` : ""}${item.name}: ${notes.join("; ")}`);
  }
  return summary;
}
