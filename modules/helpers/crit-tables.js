/**
 * One-click setup for the Critical Injury / Critical Damage roll tables that
 * the Apply Crit chat button (helpers/apply-crit.js) draws from.
 *
 * Creates world Items (`criticalinjury` / `criticaldamage`, in their own Item
 * folders) mirroring the FFG d100 critical result tables, then two RollTables
 * ("Critical Injuries" and "Critical Damage") whose document results point at
 * those world items — apply-crit resolves results via `game.items.get()`, so
 * they must be world items, not compendium entries.
 *
 * Descriptions are concise paraphrases of the rules effect; edit the created
 * items if you want the full book text. Severity uses the FFG.difficulty enum
 * (1 Easy … 4 Daunting; 0 = no healing check applies).
 *
 * Idempotent: an existing table of the same name is left untouched, and items
 * are reused by name+type rather than duplicated.
 */

export const CRIT_INJURY_TABLE_NAME = "Critical Injuries";
export const CRIT_DAMAGE_TABLE_NAME = "Critical Damage";

// Personal-scale Critical Injury results (d100 + 10 per existing crit, etc.).
// The final entry's upper bound is padded to 999 so heavily-modified rolls
// always land on a result.
const CRITICAL_INJURIES = [
  { min: 1, max: 5, severity: 1, name: "Minor Nick", description: "<p>The target suffers 1 strain.</p>" },
  { min: 6, max: 10, severity: 1, name: "Slowed Down", description: "<p>The target can only act during the last allied initiative slot on their next turn.</p>" },
  { min: 11, max: 15, severity: 1, name: "Sudden Jolt", description: "<p>The target drops whatever is in hand.</p>" },
  { min: 16, max: 20, severity: 1, name: "Distracted", description: "<p>The target cannot perform a free maneuver during their next turn.</p>" },
  { min: 21, max: 25, severity: 1, name: "Off-Balance", description: "<p>Add 1 Setback die to the target's next skill check.</p>" },
  { min: 26, max: 30, severity: 1, name: "Discouraging Wound", description: "<p>Flip one Light Side Destiny Point to Dark Side (reverse if the target is an NPC).</p>" },
  { min: 31, max: 35, severity: 1, name: "Stunned", description: "<p>The target is staggered until the end of their next turn.</p>" },
  { min: 36, max: 40, severity: 1, name: "Stinger", description: "<p>Increase the difficulty of the target's next check by one.</p>" },
  { min: 41, max: 45, severity: 2, name: "Bowled Over", description: "<p>The target is knocked prone and suffers 1 strain.</p>" },
  { min: 46, max: 50, severity: 2, name: "Head Ringer", description: "<p>Increase the difficulty of the target's Intellect and Cunning checks by one until the end of the encounter.</p>" },
  { min: 51, max: 55, severity: 2, name: "Fearsome Wound", description: "<p>Increase the difficulty of the target's Presence and Willpower checks by one until the end of the encounter.</p>" },
  { min: 56, max: 60, severity: 2, name: "Agonizing Wound", description: "<p>Increase the difficulty of the target's Brawn and Agility checks by one until the end of the encounter.</p>" },
  { min: 61, max: 65, severity: 2, name: "Slightly Dazed", description: "<p>The target is disoriented until the end of the encounter.</p>" },
  { min: 66, max: 70, severity: 2, name: "Scattered Senses", description: "<p>The target removes all Boost dice from their checks until the end of the encounter.</p>" },
  { min: 71, max: 75, severity: 2, name: "Hamstrung", description: "<p>The target loses their free maneuver until the end of the encounter.</p>" },
  { min: 76, max: 80, severity: 2, name: "Overpowered", description: "<p>The attacker may immediately make one additional free attack against the target using the same dice pool as the original attack.</p>" },
  { min: 81, max: 85, severity: 2, name: "Winded", description: "<p>The target cannot voluntarily suffer strain to activate abilities or gain additional maneuvers until the end of the encounter.</p>" },
  { min: 86, max: 90, severity: 3, name: "Compromised", description: "<p>Increase the difficulty of all the target's skill checks by one until the end of the encounter.</p>" },
  { min: 91, max: 95, severity: 3, name: "At the Brink", description: "<p>The target suffers 1 strain each time they perform an action.</p>" },
  { min: 96, max: 100, severity: 3, name: "Crippled", description: "<p>One of the target's limbs is crippled until healed: increase the difficulty of all checks that require that limb by one.</p>" },
  { min: 101, max: 105, severity: 3, name: "Maimed", description: "<p>One of the target's limbs is permanently lost. Unless it is replaced, increase the difficulty of all checks that require that limb by one.</p>" },
  { min: 106, max: 110, severity: 3, name: "Horrific Injury", description: "<p>Randomly determine one characteristic (1d10: 1–3 Brawn, 4–6 Agility, 7 Intellect, 8 Cunning, 9 Presence, 10 Willpower). Reduce it by 1 until this Critical Injury is healed.</p>" },
  { min: 111, max: 115, severity: 3, name: "Temporarily Lame", description: "<p>The target cannot perform more than one maneuver per turn until this Critical Injury is healed.</p>" },
  { min: 116, max: 120, severity: 3, name: "Blinded", description: "<p>The target can no longer see: upgrade the difficulty of all checks twice, and of Perception and Vigilance checks three times.</p>" },
  { min: 121, max: 125, severity: 3, name: "Knocked Senseless", description: "<p>The target is staggered for the remainder of the encounter.</p>" },
  { min: 126, max: 130, severity: 4, name: "Gruesome Injury", description: "<p>Randomly determine one characteristic as per Horrific Injury; the reduction is permanent.</p>" },
  { min: 131, max: 140, severity: 4, name: "Bleeding Out", description: "<p>Until healed, the target suffers 1 wound and 1 strain at the start of each of their turns. For every 5 wounds beyond their threshold, they suffer one additional Critical Injury (roll with +10 per existing Critical Injury).</p>" },
  { min: 141, max: 150, severity: 4, name: "The End is Nigh", description: "<p>The target dies after the last initiative slot of the next round.</p>" },
  { min: 151, max: 999, severity: 0, name: "Dead", description: "<p>The target dies instantly.</p>" },
];

// Vehicle / starship Critical Hit results.
const CRITICAL_HITS = [
  { min: 1, max: 9, severity: 1, name: "Mechanical Stress", description: "<p>The vehicle suffers 1 system strain.</p>" },
  { min: 10, max: 18, severity: 1, name: "Jostled", description: "<p>All crew members suffer 1 strain and are disoriented for one round.</p>" },
  { min: 19, max: 27, severity: 1, name: "Losing Power to Shields", description: "<p>Decrease defense in the affected zone by 1 until repaired. If the vehicle has no defense, it suffers 1 system strain.</p>" },
  { min: 28, max: 36, severity: 1, name: "Knocked Off Course", description: "<p>On their next turn the pilot cannot execute any maneuvers and must make a Piloting check (difficulty based on current speed) to regain control.</p>" },
  { min: 37, max: 45, severity: 1, name: "Tailspin", description: "<p>All attacks made from the vehicle suffer 2 Setback dice until the end of the pilot's next turn; crew members are immobilized until then.</p>" },
  { min: 46, max: 54, severity: 2, name: "Component Hit", description: "<p>One component (attacker's choice, or GM's discretion) is knocked offline until this Critical Hit is repaired.</p>" },
  { min: 55, max: 63, severity: 2, name: "Shields Failing", description: "<p>Decrease defense in all zones by 1 until repaired. If the vehicle has no defense, it suffers 2 system strain.</p>" },
  { min: 64, max: 72, severity: 2, name: "Navicomputer Failure", description: "<p>The navicomputer (or hyperdrive equivalent) goes offline; the vehicle cannot jump to hyperspace until repaired.</p>" },
  { min: 73, max: 81, severity: 2, name: "Power Fluctuations", description: "<p>The vehicle suffers intermittent power surges; the pilot cannot voluntarily inflict system strain (to gain extra maneuvers, for example) until repaired.</p>" },
  { min: 82, max: 90, severity: 3, name: "Shields Down", description: "<p>Decrease defense in the affected zone to 0 and in all other zones by 1 until repaired. If the vehicle has no defense, it suffers 4 system strain.</p>" },
  { min: 91, max: 99, severity: 3, name: "Engines Down", description: "<p>The vehicle's maximum speed is reduced to 0 until repaired, although it retains maneuverability.</p>" },
  { min: 100, max: 108, severity: 3, name: "Shot Up", description: "<p>Small explosions ripple through the vehicle: one random crew member suffers a Critical Injury (roll on the Critical Injury table).</p>" },
  { min: 109, max: 117, severity: 3, name: "Major System Failure", description: "<p>One component (attacker's choice) is heavily damaged and inoperable until repaired at a suitable facility.</p>" },
  { min: 118, max: 126, severity: 4, name: "Major Hull Breach", description: "<p>The hull is torn open and the vehicle depressurizes. Crew in the affected sections are exposed to vacuum; see the core rules for depressurization.</p>" },
  { min: 127, max: 135, severity: 4, name: "Destabilized", description: "<p>The vehicle's structural integrity is seriously compromised: halve its hull trauma and system strain thresholds until repaired.</p>" },
  { min: 136, max: 144, severity: 4, name: "Fire!", description: "<p>Fire rages through the vehicle. Characters in the burning areas suffer the effects of fire each round until it is extinguished.</p>" },
  { min: 145, max: 153, severity: 0, name: "Breaking Up", description: "<p>The vehicle starts to come apart and is completely destroyed at the end of the next round; everyone aboard must evacuate or perish.</p>" },
  { min: 154, max: 999, severity: 0, name: "Vaporized", description: "<p>The vehicle is completely destroyed; nothing survives.</p>" },
];

/** True when at least one RollTable matching apply-crit's lookup exists. */
export function hasCriticalTables() {
  return game.tables.some((t) => (t.name || "").includes("Critical"));
}

async function getOrCreateItemFolder(name) {
  const existing = game.folders.find((f) => f.type === "Item" && f.name === name);
  return existing ?? Folder.create({ name, type: "Item" });
}

/**
 * Create the world Items for one table (reusing same-name items of the right
 * type) and the RollTable pointing at them. No-op if the table already exists.
 * @returns {Promise<RollTable|null>} the created table, or null if skipped.
 */
async function buildCritTable({ tableName, folderName, itemType, entries, tableImg }) {
  if (game.tables.some((t) => t.name === tableName)) return null;

  const folder = await getOrCreateItemFolder(folderName);

  const byName = new Map();
  const toCreate = [];
  for (const e of entries) {
    const existing = game.items.find((i) => i.type === itemType && i.name === e.name);
    if (existing) byName.set(e.name, existing);
    else
      toCreate.push({
        name: e.name,
        type: itemType,
        folder: folder.id,
        system: { description: e.description, min: e.min, max: e.max, severity: e.severity },
      });
  }
  if (toCreate.length) {
    const created = await Item.createDocuments(toCreate);
    for (const item of created) byName.set(item.name, item);
  }

  // V13-native TableResult shape (name + documentUuid; the old text/documentId
  // fields are deprecated shims since V13).
  const results = entries.map((e) => {
    const item = byName.get(e.name);
    return {
      type: CONST.TABLE_RESULT_TYPES.DOCUMENT,
      name: item.name,
      documentUuid: item.uuid,
      img: item.img,
      range: [e.min, e.max],
      weight: 1,
    };
  });

  return RollTable.create({
    name: tableName,
    img: tableImg,
    formula: "1d100",
    replacement: true,
    displayRoll: true,
    description: game.i18n.localize("SWFFG.CritSetup.TableDescription"),
    results,
  });
}

/**
 * Create both critical tables (and their backing world items). GM only.
 * Exposed on `game.ffg.setupCriticalTables` for macro use.
 * @returns {Promise<boolean>} true if at least one table was created.
 */
export async function setupCriticalTables() {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("SWFFG.CritSetup.GMOnly"));
    return false;
  }
  const injuries = await buildCritTable({
    tableName: CRIT_INJURY_TABLE_NAME,
    folderName: CRIT_INJURY_TABLE_NAME,
    itemType: "criticalinjury",
    entries: CRITICAL_INJURIES,
    tableImg: "icons/svg/blood.svg",
  });
  const damage = await buildCritTable({
    tableName: CRIT_DAMAGE_TABLE_NAME,
    folderName: CRIT_DAMAGE_TABLE_NAME,
    itemType: "criticaldamage",
    entries: CRITICAL_HITS,
    tableImg: "icons/svg/explosion.svg",
  });
  const created = Boolean(injuries || damage);
  if (created) {
    ui.notifications.info(game.i18n.localize("SWFFG.CritSetup.Done"));
  } else {
    ui.notifications.info(game.i18n.localize("SWFFG.CritSetup.AlreadyPresent"));
  }
  return created;
}

/**
 * GM confirmation prompt used by Apply Crit when no critical table exists.
 * @returns {Promise<boolean>} true if the tables were created.
 */
export async function promptSetupCriticalTables() {
  const { DialogV2 } = foundry.applications.api;
  const confirmed = await DialogV2.confirm({
    window: { title: game.i18n.localize("SWFFG.CritSetup.PromptTitle") },
    content: `<p>${game.i18n.localize("SWFFG.CritSetup.PromptContent")}</p>`,
    rejectClose: false,
  });
  if (!confirmed) return false;
  return setupCriticalTables();
}
