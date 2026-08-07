/**
 * Legacy-scope migration.
 *
 * This build ships as a SEPARATE system id (`starwarsffg`) so it can be
 * installed alongside the stable `starwarsffg` system and tested in its own
 * worlds. Foundry namespaces both flags and settings by system id, so a world
 * duplicated from the V13 system keeps all of its data under the OLD id and
 * this system reads none of it:
 *
 *   - `flags.starwarsffg.*` on actors, items, effects, users, combatants and
 *     unlinked token actor deltas (XP logs, crew assignments, languages, sheet
 *     options / edit mode, talent-tree and gear/weapon/ability tab layouts,
 *     importer ids, dice-status durations, ...)
 *   - world and client settings (`starwarsffg.<key>`): custom skill lists, crew
 *     roles, the currency and language master lists, dice/UI theme, compendium
 *     mappings, destiny pool, and so on.
 *
 * This helper copies that data forward, non-destructively: the legacy values are
 * left untouched, so the same world still opens correctly under the original
 * system. Existing values in this system's scope are never overwritten, which
 * also makes the migration safe to re-run.
 *
 * GM only (it writes world-scoped data). Run from the console with:
 *   await game.ffg.migrateLegacyScope();            // apply
 *   await game.ffg.migrateLegacyScope({dryRun: true}); // report only
 */

import { GuardedDialogV2 as DialogV2 } from "./dialog-helpers.js";

const LEGACY_SCOPE = "starwarsffg";

/** Document classes whose flags we migrate, in the order they are reported. */
function collectionsToScan() {
  return [
    { label: "Actors", cls: Actor, docs: game.actors },
    { label: "Items", cls: Item, docs: game.items },
    { label: "Journal", cls: JournalEntry, docs: game.journal },
    { label: "Macros", cls: Macro, docs: game.macros },
    { label: "Roll Tables", cls: RollTable, docs: game.tables },
    { label: "Scenes", cls: Scene, docs: game.scenes },
  ];
}

/**
 * Build the flag update for a single document, or null when nothing to do.
 * Existing values under the current scope win; only missing keys are filled.
 */
function buildFlagUpdate(doc, scope) {
  const legacy = doc?.flags?.[LEGACY_SCOPE];
  if (!legacy || foundry.utils.isEmpty(legacy)) return null;
  const current = doc?.flags?.[scope] ?? {};
  const merged = foundry.utils.mergeObject(
    foundry.utils.deepClone(legacy),
    foundry.utils.deepClone(current),
    { inplace: false }
  );
  if (foundry.utils.objectsEqual(merged, current)) return null;
  return { _id: doc.id, flags: { [scope]: merged } };
}

/**
 * Migrate one document plus its embedded items and effects.
 * @returns {{doc: object|null, items: object[], effects: object[]}}
 */
function planForDocument(doc, scope) {
  const plan = { doc: buildFlagUpdate(doc, scope), items: [], effects: [] };
  for (const item of doc.items ?? []) {
    const u = buildFlagUpdate(item, scope);
    if (u) plan.items.push(u);
  }
  for (const effect of doc.effects ?? []) {
    const u = buildFlagUpdate(effect, scope);
    if (u) plan.effects.push(u);
  }
  return plan;
}

/**
 * Copy legacy-scope settings whose values are still stored under the old id.
 * Only settings this system actually registers are considered, and only when
 * the current scope has no stored value (a default-valued setting counts as
 * unset, which is what makes a duplicated world pick up its old configuration).
 */
async function migrateSettings(scope, { dryRun }) {
  const migrated = [];
  const skipped = [];

  const worldStorage = game.settings.storage.get("world");
  const clientStorage = game.settings.storage.get("client");

  for (const [fullKey, config] of game.settings.settings.entries()) {
    if (!fullKey.startsWith(`${scope}.`)) continue;
    const key = fullKey.slice(scope.length + 1);
    const legacyKey = `${LEGACY_SCOPE}.${key}`;

    // Never carry the migration bookkeeping or the version stamp across - the
    // stamp would suppress this system's own data migrations.
    if (key === "systemMigrationVersion" || key === "legacyScopeMigrated") continue;

    let raw;
    if (config.scope === "world") {
      raw = worldStorage?.find?.((s) => s.key === legacyKey)?.value;
      const already = worldStorage?.find?.((s) => s.key === fullKey);
      if (raw === undefined) continue;
      if (already !== undefined) { skipped.push(key); continue; }
    } else {
      raw = clientStorage?.getItem?.(legacyKey);
      if (raw === null || raw === undefined) continue;
      if (clientStorage?.getItem?.(fullKey) !== null) { skipped.push(key); continue; }
    }

    let value = raw;
    if (typeof raw === "string") {
      // Settings are stored JSON-encoded; fall back to the raw string for
      // plain String settings written before encoding was uniform.
      try { value = JSON.parse(raw); } catch (_e) { value = raw; }
    }

    if (!dryRun) {
      try {
        await game.settings.set(scope, key, value);
      } catch (err) {
        CONFIG.logger?.warn?.(`legacy-scope migration: could not set ${key}`, err);
        continue;
      }
    }
    migrated.push(key);
  }
  return { migrated, skipped };
}

/**
 * Run the migration.
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] Report what would change, write nothing.
 * @param {boolean} [options.notify=true]  Show a completion notification.
 * @returns {Promise<object>} a summary of what was (or would be) migrated
 */
export async function migrateLegacyScope({ dryRun = false, notify = true } = {}) {
  const scope = game.system.id;
  if (scope === LEGACY_SCOPE) {
    ui.notifications.warn("This world is already running the legacy system id; nothing to migrate.");
    return null;
  }
  if (!game.user.isGM) {
    ui.notifications.warn("Only a GM can run the legacy-scope migration.");
    return null;
  }

  const summary = { dryRun, documents: {}, embeddedItems: 0, embeddedEffects: 0, users: 0, combatants: 0, tokenDeltas: 0, settings: null };

  // --- world documents (+ their embedded items and effects) ---
  for (const { label, cls, docs } of collectionsToScan()) {
    if (!docs) continue;
    const updates = [];
    const itemUpdates = new Map();
    const effectUpdates = new Map();
    for (const doc of docs) {
      const plan = planForDocument(doc, scope);
      if (plan.doc) updates.push(plan.doc);
      if (plan.items.length) itemUpdates.set(doc, plan.items);
      if (plan.effects.length) effectUpdates.set(doc, plan.effects);
    }
    if (updates.length && !dryRun) await cls.updateDocuments(updates);
    for (const [parent, ups] of itemUpdates) {
      if (!dryRun) await parent.updateEmbeddedDocuments("Item", ups);
      summary.embeddedItems += ups.length;
    }
    for (const [parent, ups] of effectUpdates) {
      if (!dryRun) await parent.updateEmbeddedDocuments("ActiveEffect", ups);
      summary.embeddedEffects += ups.length;
    }
    if (updates.length) summary.documents[label] = updates.length;
  }

  // --- users (per-user preferences such as the critical-roller type) ---
  const userUpdates = [];
  for (const user of game.users ?? []) {
    const u = buildFlagUpdate(user, scope);
    if (u) userUpdates.push(u);
  }
  if (userUpdates.length && !dryRun) await User.updateDocuments(userUpdates);
  summary.users = userUpdates.length;

  // --- combatants (initiative slot markers: fake / disposition) ---
  for (const combat of game.combats ?? []) {
    const ups = [];
    for (const combatant of combat.combatants ?? []) {
      const u = buildFlagUpdate(combatant, scope);
      if (u) ups.push(u);
    }
    if (ups.length && !dryRun) await combat.updateEmbeddedDocuments("Combatant", ups);
    summary.combatants += ups.length;
  }

  // --- unlinked token actors (their own flags live on the token's actor delta) ---
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens ?? []) {
      const actor = token.actor;
      if (!actor || token.actorLink) continue;
      const plan = planForDocument(actor, scope);
      if (plan.doc && !dryRun) await actor.update({ flags: plan.doc.flags });
      if (plan.items.length && !dryRun) await actor.updateEmbeddedDocuments("Item", plan.items);
      if (plan.doc || plan.items.length) summary.tokenDeltas += 1;
    }
  }

  // --- settings ---
  summary.settings = await migrateSettings(scope, { dryRun });

  CONFIG.logger?.log?.("Legacy-scope migration summary", summary);
  if (notify) {
    const docCount = Object.values(summary.documents).reduce((a, b) => a + b, 0);
    const parts = [
      `${docCount} document(s)`,
      `${summary.embeddedItems} owned item(s)`,
      `${summary.users} user(s)`,
      `${summary.settings.migrated.length} setting(s)`,
    ];
    ui.notifications.info(
      `${dryRun ? "[Dry run] Would migrate" : "Migrated"} legacy Star Wars FFG data: ${parts.join(", ")}. See the console for details.`
    );
  }
  return summary;
}

/**
 * True when the world still holds legacy-scope data that this system cannot see.
 * Deliberately cheap: checks documents and stops at the first hit.
 */
export function hasLegacyScopeData() {
  const scope = game.system.id;
  if (scope === LEGACY_SCOPE) return false;
  const hasLegacy = (doc) => {
    const legacy = doc?.flags?.[LEGACY_SCOPE];
    return legacy && !foundry.utils.isEmpty(legacy) && foundry.utils.isEmpty(doc?.flags?.[scope] ?? {});
  };
  for (const actor of game.actors ?? []) if (hasLegacy(actor)) return true;
  for (const item of game.items ?? []) if (hasLegacy(item)) return true;
  const worldStorage = game.settings.storage.get("world");
  if (worldStorage?.some?.((s) => s.key.startsWith(`${LEGACY_SCOPE}.`))) return true;
  return false;
}

/**
 * Offer the migration once per world when legacy data is detected. Runs for the
 * GM only; the answer (either way) is remembered so this never nags.
 */
export async function promptLegacyScopeMigration() {
  const scope = game.system.id;
  if (!game.user.isGM || scope === LEGACY_SCOPE) return;
  if (game.settings.get(scope, "legacyScopeMigrated")) return;
  if (!hasLegacyScopeData()) return;

  const run = await DialogV2.confirm({
    window: { title: "Star Wars FFG (V14): Import Legacy World Data" },
    content: `
      <p>This world contains Star Wars FFG data saved under the original system id
      (<code>${LEGACY_SCOPE}</code>), which this parallel V14 build cannot read.</p>
      <p>Copy it across now? This includes XP logs, crew assignments, languages,
      sheet options, tab layouts, and system settings such as custom skill lists,
      crew roles, and the currency/language lists.</p>
      <p><em>The original data is left untouched, so the world still works under the
      original system. Nothing already set here is overwritten.</em></p>`,
    rejectClose: false,
  });

  if (run) await migrateLegacyScope();
  // Remember the answer either way so the prompt does not reappear every load.
  await game.settings.set(scope, "legacyScopeMigrated", true);
}
