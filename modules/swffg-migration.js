import ModifierHelpers from "./helpers/modifiers.js";

/**
 * Handles all logic related to migrating the system to a new version, including sending notifications
 * @returns {Promise<void>}
 */
export async function handleUpdate() {
  const registeredVersion = game.settings.get("starwarsffg", "systemMigrationVersion");
  const runningVersion = game.system.version;
  if (registeredVersion !== runningVersion) {
    await handleMigration(registeredVersion, runningVersion);
    await sendChanges(runningVersion);
    if (parseFloat(registeredVersion) >= 2.0 || !registeredVersion) {
      await game.settings.set("starwarsffg", "systemMigrationVersion", runningVersion);
    } else {
      // do not register the updated warning and instead throw an error every time that the world is unsupported
      await warnUnsupportedWorld();
    }
  }
}

/**
 * Handles migration logic for the system
 * @param oldVersion - version previously run (from the settings)
 * @param newVersion - version currently running (from game.system.version)
 * @returns {Promise<void>}
 */
async function handleMigration(oldVersion, newVersion) {
  // migration handlers should be added here going forward
  if (parseFloat(oldVersion) < 1.901) {
    await migrateTo1_901();
  }
  if (parseFloat(oldVersion) < 1.906) {
    await migrateTo1_906();
  }
  if (parseFloat(oldVersion) < 1.907) {
    await migrateTo1907();
  }
  if (parseFloat(oldVersion) < 2.1) {
    await migrateCreditsToGlass();
  }
  if (parseFloat(oldVersion) < 2.1) {
    await migrateSpeciesInherentEffects();
  }
  if (parseFloat(oldVersion) < 2.1) {
    await cleanupSpeciesTalentEffects();
  }
  await warnTheme();
}

/**
 * Sends a notification to all users in the game that the system has been updated
 * @param newVersion - version currently running (from game.system.version)
 * @returns {Promise<void>}
 */
async function sendChanges(newVersion) {
  const template = "systems/starwarsffg/templates/notifications/new_version.html";
  const html = await foundry.applications.handlebars.renderTemplate(template, { version: newVersion });
  const messageData = {
    user: game.user.id,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    content: html,
  };
  ChatMessage.create(messageData);
}

/**
 * Notify users if they are using the now-retired theme
 * @returns {Promise<void>}
 */
async function warnTheme() {
  if (game.settings.get("starwarsffg", "ui-uitheme") === "default") {
    const messageData = {
      user: game.user.id,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER,
      content: "You are using an unsupported theme. Expected issues, or swap to the Mandar theme.<br>(This message will only show once.)",
    };
    ChatMessage.create(messageData);
  }
}

/**
 * Handles updating talents from species on actors to be a "species" talent rather than the default type
 * @returns {Promise<void>}
 */
async function migrateTo1_901() {
  for (const actor of game.actors) {
    for (const species of actor.items.filter(a => a.type === "species")) {
      for (const talent of Object.values(species.system.talents)) {
        await actor.items.find(i => i.name === talent.name)?.update({flags: {starwarsffg: {fromSpecies: true}}});
      }
    }
  }
}

/**
 * Updates settings pointing to system compendiums to instead point to world-level compendiums
 * @returns {Promise<void>}
 */
async function migrateTo1_906() {
  // specializations
  let compendiums = [];
  for (const compendium of game.settings.get("starwarsffg", "specializationCompendiums").split(",")) {
    if (compendium.includes("starwarsffg.")) {
      compendiums.push(compendium.replace("starwarsffg.", "world."));
    } else {
      compendiums.push(compendium);
    }
  }
  game.settings.set("starwarsffg", "specializationCompendiums", compendiums.join(","));
  // signature abilities
  compendiums = [];
  for (const compendium of game.settings.get("starwarsffg", "signatureAbilityCompendiums").split(",")) {
    if (compendium.includes("starwarsffg.")) {
      compendiums.push(compendium.replace("starwarsffg.", "world."));
    } else {
      compendiums.push(compendium);
    }
  }
  game.settings.set("starwarsffg", "signatureAbilityCompendiums", compendiums.join(","));
  // force powers
  compendiums = [];
  for (const compendium of game.settings.get("starwarsffg", "forcePowerCompendiums").split(",")) {
    if (compendium.includes("starwarsffg.")) {
      compendiums.push(compendium.replace("starwarsffg.", "world."));
    } else {
      compendiums.push(compendium);
    }
  }
  game.settings.set("starwarsffg", "forcePowerCompendiums", compendiums.join(","));
  // talents
  compendiums = [];
  for (const compendium of game.settings.get("starwarsffg", "talentCompendiums").split(",")) {
    if (compendium.includes("starwarsffg.")) {
      compendiums.push(compendium.replace("starwarsffg.", "world."));
    } else {
      compendiums.push(compendium);
    }
  }
  game.settings.set("starwarsffg", "talentCompendiums", compendiums.join(","));
}

/**
 * Creates Active Effects on all relevant items and reduces actor stats to account for this
 * @returns {Promise<void>}
 */
async function migrateTo1907() {
  try {
    for (const actor of game.actors) {
      const xpLog = actor.getFlag("starwarsffg", "xpLog") || [];
      const updatedLog = [];
      const purchaseRegex = new RegExp("<b>(.*?)</b>: (.*?) <b>(.*?)</b>.*<b>(.*?)</b> \\((.*?) available, (.*?) total");
      const grantRegex = new RegExp("<b>(.*?)</b>: (\\w*) granted <b>(.*?)</b>.*: (.*?) \\((.*?) available, (.*?) total");

      for (const entry of xpLog) {
        if (typeof entry === 'string') {
          const parsedEntry = entry.match(purchaseRegex);
          if (parsedEntry && parsedEntry.length === 7) {
            // normal spend
            updatedLog.push({
              action: parsedEntry[2].replace('spent', 'purchased'),
              id: undefined,
              xp: {
                cost: parsedEntry[3],
                available: parsedEntry[5],
                total: parsedEntry[6],
              },
              date: parsedEntry[1],
              description: parsedEntry[4],
            });
          } else {
            // "<font color=\"green\"><b>2024-08-08</b>: Self granted <b>50</b> XP, reason: manual grant (50 available, 0 total)</font>"
            // "<font color=\"green\"><b>2025-07-09</b>: GM granted <b>5</b> XP, reason: feel like it, bubs (175 available, 110 total)</font>"
            const parsedEntry = entry.match(grantRegex);
            if (parsedEntry && parsedEntry.length === 7) {
              updatedLog.push({
                action: parsedEntry[2].replace('GM', 'granted').replace('Self', 'adjusted'),
                id: undefined,
                xp: {
                  cost: parsedEntry[3],
                  available: parsedEntry[5],
                  total: parsedEntry[6],
                },
                date: parsedEntry[1],
                description: parsedEntry[4],
              });
            }
          }
        }
      }
      actor.setFlag("starwarsffg", "xpLog", updatedLog);
    }
    // iterate over actors to update their stats
    for (const actor of game.actors) {
      // record the initial stats so we can subtract them out later
      let inputStats = {
        system: {},
      };

      // collect the initial stats
      if (["character", "nemesis", "rival"].includes(actor.type)) {
        // characteristics
        inputStats.system.characteristics = {};
        for (const characteristic in actor.system.characteristics) {
          inputStats.system.characteristics[characteristic] = {
            value: actor.system.characteristics[characteristic].value,
          }
        }
        // wounds, soak, strain, defense, encumbrance
        inputStats.system.stats = {
          wounds: foundry.utils.deepClone(actor.system.stats.wounds),
          soak: foundry.utils.deepClone(actor.system.stats.soak),
          defence: foundry.utils.deepClone(actor.system.stats.defence),
          encumbrance: foundry.utils.deepClone(actor.system.stats.encumbrance),
        };
        if (actor.type !== "rival") {
          inputStats.system.stats.strain = foundry.utils.deepClone(actor.system.stats.strain);
        }
        // skills
        inputStats.system.skills = foundry.utils.deepClone(actor.system.skills);
      }

      for (const item of actor.items) {
        // trigger modifier AEs to be created
        const itemData = actor.items.get(item.id).toJSON();
        itemData.data = itemData.system;
        delete itemData.flags;

        // trigger inherent AEs to be created
        await item._onCreateAEs({parent: true}, true);
        await ModifierHelpers.applyActiveEffectOnUpdate(item, itemData);
      }

      const updatedStats = game.actors.get(actor.id);
      const finalStats = foundry.utils.deepClone(inputStats);

      if (["character", "nemesis", "rival"].includes(actor.type)) {
        // characteristics
        for (const characteristic in actor.system.characteristics) {
          finalStats.system.characteristics[characteristic].value = updatedStats.system.characteristics[characteristic].value - ((updatedStats.system.characteristics[characteristic].value - foundry.utils.deepClone(inputStats.system.characteristics[characteristic].value)) * 2);
        }
        // wounds
        finalStats.system.stats.wounds.max = updatedStats.system.stats.wounds.max - ((updatedStats.system.stats.wounds.max - inputStats.system.stats.wounds.max) * 2);
        // strain
        if (actor.type !== "rival") {
          finalStats.system.stats.strain.max = updatedStats.system.stats.strain.max - ((updatedStats.system.stats.strain.max - inputStats.system.stats.strain.max) * 2);
        }
        // soak
        finalStats.system.stats.soak.value = Math.max(updatedStats.system.stats.soak.value - ((updatedStats.system.stats.soak.value - inputStats.system.stats.soak.value) * 2), 0);
        // defense
        finalStats.system.stats.defence.melee = updatedStats.system.stats.defence.melee - ((updatedStats.system.stats.defence.melee - inputStats.system.stats.defence.melee) * 2);
        finalStats.system.stats.defence.ranged = updatedStats.system.stats.defence.ranged - ((updatedStats.system.stats.defence.ranged - inputStats.system.stats.defence.ranged) * 2);
        // encumbrance
        finalStats.system.stats.encumbrance.max = updatedStats.system.stats.encumbrance.max - ((updatedStats.system.stats.encumbrance.max - inputStats.system.stats.encumbrance.max) * 2);

        // skills
        for (const skill in actor.system.skills) {
          finalStats.system.skills[skill].rank = updatedStats.system.skills[skill].rank - ((updatedStats.system.skills[skill].rank - foundry.utils.deepClone(inputStats.system.skills[skill].rank)) * 2);
        }

        await updatedStats.update({system: finalStats.system});
        // certain changes get clobbered if done in this single update, so split them out
        await updatedStats.update({"system.stats.soak.value": finalStats.system.stats.soak.value});
        await updatedStats.update({"system.stats.wounds.max": finalStats.system.stats.wounds.max});
        if (actor.type !== "rival") {
          await updatedStats.update({"system.stats.strain.max": finalStats.system.stats.strain.max});
        }
      }
    }

    // now that the stats have been updated, create AEs for remaining speciality items
    // I'm not sure why, but making changes in the same loop results in duplication bugs
    for (const actor of game.actors) {
      for (const item of actor.items) {
        // rename any mods using the old naming scheme and create active effects for them
        if (item.type === "specialization") {
          const toCreate = [];
          for (let i = 0; i < 20; i++) {
            const attributes = item.system.talents[`talent${i}`].attributes;
            if (attributes && Object.keys(attributes).length > 0) {
              for (const attribute in attributes) {
                if (!attribute.startsWith("attr")) {
                  // the attribute is using an older form, update it to the new naming scheme
                  const nk = `attr${new Date().getTime()}`;
                  item.system.talents[`talent${i}`].attributes[nk] = attributes[attribute];
                  item.system.talents[`talent${i}`].attributes[`-=${attribute}`] = null;
                  delete item.system.talents[`talent${i}`].attributes[attribute];
                  // ensure further keys have a new entry
                  await new Promise(r => setTimeout(r, 1));

                  const explodedMods = ModifierHelpers.explodeMod(
                    item.system.talents[`talent${i}`].attributes[nk].modtype,
                    item.system.talents[`talent${i}`].attributes[nk].mod
                  );
                  const changes = [];
                  for (const curMod of explodedMods) {
                    changes.push({
                      key: ModifierHelpers.getModKeyPath(curMod['modType'], curMod['mod']),
                      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
                      value: item.system.talents[`talent${i}`].attributes[nk].value,
                    });
                  }
                  // add an active effect with the changes we've just built, synced to the learned state
                  toCreate.push({
                    name: nk,
                    changes: changes,
                    disabled: !item.system.talents[`talent${i}`].islearned,
                  });
                }
              }
            }
          }
          await item.update({"system.talents": item.system.talents});
          if (toCreate.length > 0) {
            await item.createEmbeddedDocuments("ActiveEffect", toCreate);
          }
        } else if (item.type === "forcepower") {
          const toCreate = [];
          for (let i = 0; i < 16; i++) {
            const attributes = item.system.upgrades[`upgrade${i}`].attributes;
            if (attributes && Object.keys(attributes).length > 0) {
              for (const attribute in attributes) {
                if (!attribute.startsWith("attr")) {
                  // the attribute is using an older form, update it to the new naming scheme
                  const nk = `attr${new Date().getTime()}`;
                  item.system.upgrades[`upgrade${i}`].attributes[nk] = attributes[attribute];
                  item.system.upgrades[`upgrade${i}`].attributes[`-=${attribute}`] = null;
                  delete item.system.upgrades[`upgrade${i}`].attributes[attribute];
                  // ensure further keys have a new entry
                  await new Promise(r => setTimeout(r, 1));

                  const explodedMods = ModifierHelpers.explodeMod(
                    item.system.upgrades[`upgrade${i}`].attributes[nk].modtype,
                    item.system.upgrades[`upgrade${i}`].attributes[nk].mod
                  );
                  const changes = [];
                  for (const curMod of explodedMods) {
                    changes.push({
                      key: ModifierHelpers.getModKeyPath(curMod['modType'], curMod['mod']),
                      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
                      value: item.system.upgrades[`upgrade${i}`].attributes[nk].value,
                    });
                  }
                  // add an active effect with the changes we've just built, synced to the learned state
                  toCreate.push({
                    name: nk,
                    changes: changes,
                    disabled: !item.system.upgrades[`upgrade${i}`].islearned,
                  });
                }
              }
            }
          }
          await item.update({"system.upgrades": item.system.upgrades});

          if (toCreate.length > 0) {
            await item.createEmbeddedDocuments("ActiveEffect", toCreate);
          }
        } else if (item.type === "signatureability") {
          const toCreate = [];

          for (let i = 0; i < 8; i++) {
            const attributes = item.system.upgrades[`upgrade${i}`].attributes;
            if (attributes && Object.keys(attributes).length > 0) {
              for (const attribute in attributes) {
                if (!attribute.startsWith("attr")) {
                  // the attribute is using an older form, update it to the new naming scheme
                  const nk = `attr${new Date().getTime()}`;
                  item.system.upgrades[`upgrade${i}`].attributes[nk] = attributes[attribute];
                  item.system.upgrades[`upgrade${i}`].attributes[`-=${attribute}`] = null;
                  delete item.system.upgrades[`upgrade${i}`].attributes[attribute];
                  // ensure further keys have a new entry
                  await new Promise(r => setTimeout(r, 1));

                  const explodedMods = ModifierHelpers.explodeMod(
                    item.system.upgrades[`upgrade${i}`].attributes[nk].modtype,
                    item.system.upgrades[`upgrade${i}`].attributes[nk].mod
                  );
                  const changes = [];
                  for (const curMod of explodedMods) {
                    changes.push({
                      key: ModifierHelpers.getModKeyPath(curMod['modType'], curMod['mod']),
                      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
                      value: item.system.upgrades[`upgrade${i}`].attributes[nk].value,
                    });
                  }
                  // add an active effect with the changes we've just built, synced to the learned state
                  toCreate.push({
                    name: nk,
                    changes: changes,
                    disabled: !item.system.upgrades[`upgrade${i}`].islearned,
                  });
                }
              }
            }
          }
          await item.update({"system.upgrades": item.system.upgrades});

          if (toCreate.length > 0) {
            await item.createEmbeddedDocuments("ActiveEffect", toCreate);
          }
        }
      }
    }

    // handle items
    for (const item of game.items) {
      // trigger inherent AEs to be created
      await item._onCreateAEs({parent: false});
      // trigger modifier AEs to be created
      const itemData = item.toJSON();
      itemData.data = itemData.system;
      try {
        await ModifierHelpers.applyActiveEffectOnUpdate(item, itemData);
      } catch (e) {
        ui.notifications.warn(`Failed to migrate item ${item.name}, it may need to be recreated by hand`);
      }
    }
  } catch (e) {
    ui.notifications.error("The migration to 1.907 has failed for an unknown world. You may need to replace items on actors with items to fully experience 1.907.");
    CONFIG.logger.debug(e);
  }
}

/**
 * Migrate legacy single-value credits (system.stats.credits.value) into the new currency system
 * (system.currency.<defaultCurrency>). Only seeds the default currency when it is still empty, so
 * re-running the migration is safe and never clobbers a balance a user has already set.
 * @returns {Promise<void>}
 */
async function migrateCreditsToGlass() {
  try {
    const defaultKey =
      CONFIG.FFG?.defaultCurrency && CONFIG.FFG?.currencies?.[CONFIG.FFG.defaultCurrency]
        ? CONFIG.FFG.defaultCurrency
        : "glass";
    for (const actor of game.actors) {
      if (!["character", "minion", "rival", "nemesis"].includes(actor.type)) continue;
      const legacy = Number(actor.system?.stats?.credits?.value) || 0;
      const current = Number(actor.system?.currency?.[defaultKey]) || 0;
      if (legacy > 0 && current === 0) {
        await actor.update({ [`system.currency.${defaultKey}`]: legacy });
        CONFIG.logger.debug(`Migrated ${legacy} credits to currency.${defaultKey} for ${actor.name}`);
      }
    }
  } catch (e) {
    ui.notifications.error("The currency migration (credits -> Glass) failed for an unknown world. You may need to set actor currency by hand.");
    CONFIG.logger.debug(e);
  }
}

/**
 * Backfill / repair the (inherent) Active Effect on species items.
 *
 * A species built from scratch is created with an empty inherent effect, and under the old
 * applyActiveEffectOnUpdate logic its characteristics were never written into it (the update loop
 * only touched changes that already existed). Such species carry their characteristics in
 * system.attributes but have an empty or partial inherent effect, so nothing applies to actors -
 * and the stale state used to throw when the species was next edited.
 *
 * This rebuilds each species' inherent changes from its stored attributes using the same derivation
 * as the create path (characteristics, base Soak, and the derived Wound/Strain/Encumbrance
 * thresholds: WT = Wounds + Brawn, ST = Strain + Willpower, Enc = Brawn + 5). It is idempotent: a
 * species whose inherent effect already matches is left untouched, and one with no characteristics
 * stored is skipped. User modifiers live in their own separate Active Effects and are never touched.
 *
 * Runs automatically on version bump, and can be run by hand at any time (as a GM) via:
 *   game.ffg.migrateSpeciesInherentEffects()
 * @returns {Promise<{scanned: number, repaired: number}>}
 */
export async function migrateSpeciesInherentEffects() {
  if (!game.user?.isGM) {
    ui.notifications.warn("The species inherent-effect repair must be run by a GM.");
    return { scanned: 0, repaired: 0 };
  }

  // Build the desired inherent change list from a species' stored attributes. Mirrors the create
  // path in item-ffg.js#_onCreateAEs, but de-duplicated (findIndex-then-push) so shared keys such as
  // system.stats.wounds.max produced by both the Brawn and Wounds attributes collapse to one change.
  const buildInherentChanges = (attributes) => {
    const changes = [];
    for (const attribute of Object.keys(attributes ?? {})) {
      if (attribute.startsWith("attr")) continue; // user modifiers live in their own AEs
      const attr = attributes[attribute];
      if (!attr || typeof attr !== "object") continue;
      const explodedMods = ModifierHelpers.explodeMod(attr.modtype, attribute);
      for (const curMod of explodedMods) {
        const key = ModifierHelpers.getModKeyPath(curMod.modType, curMod.mod);
        if (!key) continue;
        const idx = changes.findIndex(c => c.key === key);
        if (idx >= 0) {
          changes[idx].value = attr.value;
        } else {
          changes.push({ key, mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: attr.value });
        }
      }
    }
    // fold in the derived thresholds from the raw characteristics
    const brawn = parseInt(attributes?.Brawn?.value, 10) || 0;
    const willpower = parseInt(attributes?.Willpower?.value, 10) || 0;
    const wounds = parseInt(attributes?.Wounds?.value, 10) || 0;
    const strain = parseInt(attributes?.Strain?.value, 10) || 0;
    for (const change of changes) {
      if (change.key === "system.stats.wounds.max") change.value = wounds + brawn;
      else if (change.key === "system.stats.strain.max") change.value = strain + willpower;
      else if (change.key === "system.stats.encumbrance.max") change.value = brawn + 5;
    }
    return changes;
  };

  // Compare two change lists ignoring order; treats values as strings so 3 and "3" match (Active
  // Effect changes are stored as strings), avoiding needless updates that would re-render sheets.
  const changesEqual = (a, b) => {
    if (a.length !== b.length) return false;
    const norm = (list) => [...list]
      .map(c => `${c.key}\u0000${c.mode}\u0000${c.value}`)
      .sort();
    const na = norm(a);
    const nb = norm(b);
    return na.every((v, i) => v === nb[i]);
  };

  const repairItem = async (item) => {
    // skip anything without characteristics to rebuild from (e.g. a species that never got saved)
    const attributes = item.system?.attributes ?? {};
    const hasInherentAttrs = Object.keys(attributes).some(k => !k.startsWith("attr"));
    if (!hasInherentAttrs) return false;

    const desired = buildInherentChanges(attributes);
    if (!desired.length) return false;

    const inherent = item.effects.find(e => e.name === "(inherent)");
    if (!inherent) {
      await item.createEmbeddedDocuments("ActiveEffect", [{
        name: "(inherent)",
        img: item.img,
        changes: desired,
      }]);
      return true;
    }
    if (changesEqual(inherent.changes, desired)) return false;
    await inherent.update({ changes: desired });
    return true;
  };

  let scanned = 0;
  let repaired = 0;
  const collections = [game.items, ...game.actors.map(a => a.items)];
  for (const collection of collections) {
    for (const item of collection) {
      if (item.type !== "species") continue;
      // never touch items sourced from a (locked) compendium
      if (item.pack) continue;
      scanned += 1;
      try {
        if (await repairItem(item)) {
          repaired += 1;
          CONFIG.logger.debug(`Repaired inherent effect on species "${item.name}" (${item.uuid})`);
        }
      } catch (e) {
        CONFIG.logger.error(`Failed to repair inherent effect on species "${item?.name}"`, e);
      }
    }
  }

  ui.notifications.info(`Species inherent-effect repair complete: ${repaired} of ${scanned} species updated.`);
  CONFIG.logger.debug(`migrateSpeciesInherentEffects: scanned ${scanned}, repaired ${repaired}`);
  return { scanned, repaired };
}

/**
 * Remove duplicate talent Active Effects that were copied onto species items.
 *
 * Older versions transferred a dropped talent's Active Effect onto the species itself, in addition to
 * granting the talent as its own item (which already carries that effect) when the species was added
 * to a character. The result was the talent's modifier applying twice (e.g. Gearhead). New drops no
 * longer copy the effect; this removes the stale copies from existing species.
 *
 * A transferred copy keeps the source talent's effect name - a unique attr<timestamp> - so it never
 * collides with the species' own modifier effects or its (inherent) effect. We therefore fetch each
 * granting talent, collect its effect names, and delete only species effects whose names match. If a
 * talent's source can't be resolved it is skipped (safe: we simply don't remove that copy rather than
 * risk deleting the wrong effect).
 *
 * Runs automatically on version bump, and can be run by hand at any time (as a GM) via:
 *   game.ffg.cleanupSpeciesTalentEffects()
 * @returns {Promise<{scanned: number, removed: number}>}
 */
export async function cleanupSpeciesTalentEffects() {
  if (!game.user?.isGM) {
    ui.notifications.warn("The species talent-effect cleanup must be run by a GM.");
    return { scanned: 0, removed: 0 };
  }

  const cleanItem = async (item) => {
    const talents = item.system?.talents ?? {};
    const talentIds = Object.keys(talents);
    if (!talentIds.length) return 0;

    const talentEffectNames = new Set();
    for (const talentId of talentIds) {
      const source = talents[talentId]?.source;
      if (!source) continue;
      let talentItem = null;
      try {
        talentItem = await fromUuid(source);
      } catch {
        talentItem = null;
      }
      if (!talentItem) continue;
      for (const effect of talentItem.effects) {
        if (effect.name && effect.name !== "(inherent)") talentEffectNames.add(effect.name);
      }
    }
    if (!talentEffectNames.size) return 0;

    const toDelete = item.effects
      .filter(e => e.name !== "(inherent)" && talentEffectNames.has(e.name))
      .map(e => e.id);
    if (!toDelete.length) return 0;

    await item.deleteEmbeddedDocuments("ActiveEffect", toDelete);
    return toDelete.length;
  };

  let scanned = 0;
  let removed = 0;
  const collections = [game.items, ...game.actors.map(a => a.items)];
  for (const collection of collections) {
    for (const item of collection) {
      if (item.type !== "species") continue;
      if (item.pack) continue;
      scanned += 1;
      try {
        const n = await cleanItem(item);
        if (n) {
          removed += n;
          CONFIG.logger.debug(`Removed ${n} duplicate talent effect(s) from species "${item.name}" (${item.uuid})`);
        }
      } catch (e) {
        CONFIG.logger.error(`Failed to clean transferred talent effects on species "${item?.name}"`, e);
      }
    }
  }

  ui.notifications.info(`Species talent-effect cleanup complete: removed ${removed} duplicate effect(s) across ${scanned} species.`);
  CONFIG.logger.debug(`cleanupSpeciesTalentEffects: scanned ${scanned}, removed ${removed}`);
  return { scanned, removed };
}

async function warnUnsupportedWorld() {
  const content = game.i18n.localize("SWFFG.Migrate.Unsupported.Text");
  new Dialog(
    {
      title: game.i18n.localize("SWFFG.Migrate.Unsupported.Title"),
      content: content,
      buttons: {
        ok: {
          icon: '<i class="fas fa-exclamation"></i>',
          label: game.i18n.localize("SWFFG.Migrate.Unsupported.Button"),
        },
      },
    },
    {
      classes: ["dialog", "starwarsffg"],
    }
  ).render(true);
}
