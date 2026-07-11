import PopoutEditor from "../popout-editor.js";
import RollBuilderFFG from "../dice/roll-builder.js";
import ModifierHelpers from "../helpers/modifiers.js";
import ImportHelpers from "../importer/import-helpers.js";

export default class DiceHelpers {
  static async rollSkill(obj, event, type, flavorText, sound) {
    const data = await obj.getData();
    const row = event.target.parentElement.parentElement;
    let skillName = row.parentElement.dataset["ability"];
    if (skillName === undefined) {
      skillName = row.dataset["ability"];
      if (skillName === undefined) {
        skillName = row.parentElement.parentElement.parentElement.dataset["ability"];
      }
    }

    let skills;
    const theme = await game.settings.get("starwarsffg", "skilltheme");
    try {
      skills = JSON.parse(JSON.stringify(CONFIG.FFG.alternateskilllists.find((list) => list.id === theme).skills));
    } catch (err) {
      // if we run into an error use the default starwars skill set
      skills = JSON.parse(JSON.stringify(CONFIG.FFG.alternateskilllists.find((list) => list.id === "starwars").skills));
      CONFIG.logger.warn(`Unable to load skill theme ${theme}, defaulting to starwars skill theme`, err);
    }

    let skillData = skills?.[skillName];

    if (!skillData) {
      skillData = data.data[skillName];
    }

    let skill = {
      rank: 0,
      characteristic: "",
      boost: 0,
      setback: 0,
      force: 0,
      advantage: 0,
      dark: 0,
      light: 0,
      failure: 0,
      threat: 0,
      success: 0,
      triumph: 0,
      despair: 0,
      remsetback: 0,
      upgrades: 0,
      label: skillData?.label ? game.i18n.localize(skillData.label) : game.i18n.localize(skillName),
      source: {},
    };
    let characteristic = {
      value: 0,
    };

    if (data?.data?.skills?.[skillName]) {
      skill = data.data.skills[skillName];
    }
    if (data?.data?.characteristics?.[skill?.characteristic]) {
      characteristic = data.data.characteristics[skill.characteristic];
    }

    const actor = await game.actors.get(data.actor._id);

    // Determine if this roll is triggered by an item.
    let item;
    if ($(row.parentElement).hasClass("item")) {
      //Check if token is linked to actor
      if (obj.actor.token === null) {
        let itemID = row.parentElement.dataset["itemId"];
        item = actor.items.get(itemID);
      } else {
        //Rolls this if unlinked
        let itemID = row.parentElement.dataset["itemId"];
        item = obj.actor.token.actor.items.get(itemID);
      }
    }

    if (item && item.type === "weapon") {
      const ammoEnabled = item.getFlag("starwarsffg", "config.enableAmmo");
      if (ammoEnabled && item.system.ammo.value <= 0) {
        return ui.notifications.warn("Not enough ammo!");
      }
    }

    const itemData = item || { name: game.i18n.localize(skill.label), type: "skill" };
    const status = this.getWeaponStatus(itemData);
    let defenseDice = this.getDefenseDice(skill, itemData);

    // TODO: Get weapon specific modifiers from itemmodifiers and itemattachments

    let dicePool = new DicePoolFFG({
      ability: Math.max(characteristic.value, skill.rank),
      boost: skill.boost ?? 0,
      setback: (skill.setback ?? 0) + status.setback + defenseDice,
      force: skill.force ?? 0,
      advantage: skill.advantage ?? 0,
      dark: skill.dark ?? 0,
      light: skill.light ?? 0,
      failure: skill.failure ?? 0,
      threat: skill.threat ?? 0,
      success: skill.success ?? 0,
      triumph: skill.triumph ?? 0,
      despair: skill.despair ?? 0,
      upgrades: skill.upgrades ?? 0,
      remsetback: skill.remsetback ?? 0,
      difficulty: 2 + status.difficulty + (skill.difficulty ?? 0), // default average + status-effect difficulty dice
    });

    dicePool.upgrade(Math.min(characteristic.value, skill.rank) + dicePool.upgrades);
    // status-effect difficulty upgrades (mirrors skill.upgrades for ability)
    dicePool.upgradeDifficulty(skill.upgradeDifficulty ?? 0);

    if (type === "ability") {
      dicePool.upgrade();
    } else if (type === "difficulty") {
      dicePool.upgradeDifficulty();
    }

    dicePool = new DicePoolFFG(await this.getModifiers(dicePool, itemData));
    await this.displayRollDialog(data, dicePool, `${game.i18n.localize("SWFFG.Rolling")} ${game.i18n.localize(skill.label)}`, skill.label, itemData, flavorText, sound);
  }

  static getDefenseDice(skill, itemData){
    let defenseDice = 0;
    if (game.settings.get("starwarsffg", "useDefense")) {
      let isRanged = ["Ranged-Light", "Ranged-Heavy", "Gunnery"].includes(skill.value);
      let isMelee = ["Melee", "Brawl", "Lightsaber"].includes(skill.value);
      if (itemData?.type === "weapon" || itemData?.metaData?.tags?.includes("weapon")) {
        if (game.user.targets.size > 0) {
          for (const target of game.user.targets) {
            // Personal ranged/melee defense only exists on actors that carry a stats.defence
            // block (character, nemesis, rival, minion). Vehicles use silhouette/shields and
            // have no stats.defence, so a targeted vehicle contributes no setback here rather
            // than throwing a TypeError.
            const defence = target?.actor?.system?.stats?.defence;
            if (!defence) continue;
            if (isRanged) {
              defenseDice = Math.max(defenseDice, Number(defence.ranged) || 0);
            } else if (isMelee) {
              defenseDice = Math.max(defenseDice, Number(defence.melee) || 0);
            }
          }
        }
      }
    }
    return defenseDice;
  }

  static async displayRollDialog(data, dicePool, description, skillName, item, flavorText, sound) {
    return new RollBuilderFFG(data, dicePool, description, skillName, item, flavorText, sound).render(true);
  }

  static async addSkillDicePool(data, elem) {
    const skillName = elem.dataset["ability"];
    if (data.data.skills[skillName]) {
      const skill = data.data.skills[skillName];
      const characteristic = data.data.characteristics[skill.characteristic];

      const dicePool = new DicePoolFFG({
        ability: Math.max(characteristic?.value ? characteristic.value : 0, skill?.rank ? skill.rank : 0),
        boost: skill.boost,
        setback: skill.setback,
        force: skill.force,
        advantage: skill.advantage,
        dark: skill.dark,
        light: skill.light,
        failure: skill.failure,
        threat: skill.threat,
        success: skill.success,
        triumph: skill?.triumph ? skill.triumph : 0,
        despair: skill?.despair ? skill.despair : 0,
        upgrades: skill?.upgrades ? skill.upgrades : 0,
        remsetback: skill?.remsetback ? skill.remsetback : 0,
        source: {
          skill: skill?.ranksource?.length ? skill.ranksource : [],
          boost: skill?.boostsource?.length ? skill.boostsource : [],
          remsetback: skill?.remsetbacksource?.length ? skill.remsetbacksource : [],
          setback: skill?.setbacksource?.length ? skill.setbacksource : [],
          advantage: skill?.advantagesource?.length ? skill.advantagesource : [],
          dark: skill?.darksource?.length ? skill.darksource : [],
          light: skill?.lightsource?.length ? skill.lightsource : [],
          failure: skill?.failuresource?.length ? skill.failuresource : [],
          threat: skill?.threatsource?.length ? skill.threatsource : [],
          success: skill?.successsource?.length ? skill.successsource : [],
          triumph: skill?.triumphsource?.length ? skill.triumphsource : [],
          despair: skill?.despairsource?.length ? skill.despairsource : [],
          upgrades: skill?.upgradessource?.length ? skill.upgradessource : [],
        },
      });
      dicePool.upgrade(Math.min(characteristic?.value ?? 0, skill?.rank ?? 0) + dicePool.upgrades);

      const rollButton = elem.querySelector(".roll-button");
      dicePool.renderPreview(rollButton);
    }
  }

  static async rollItem(itemId, actorId, flavorText, sound) {
    const actor = game.actors.get(actorId);
    const actorSheet = await actor.sheet.getData();

    const item = actor.items.get(itemId);
    const itemData = item.system;
    await item.setFlag("starwarsffg", "uuid", item.uuid);

    const status = this.getWeaponStatus(item);

    const skill = actor.system.skills[itemData.skill.value];
    const characteristic = actor.system.characteristics[skill.characteristic];
    let defenseDice = this.getDefenseDice(skill, itemData);
    let dicePool = new DicePoolFFG({
      ability: Math.max(characteristic.value, skill.rank),
      boost: skill.boost,
      setback: (skill.setback ?? 0) + status.setback + defenseDice,
      force: skill.force,
      advantage: skill.advantage,
      dark: skill.dark,
      light: skill.light,
      failure: skill.failure,
      threat: skill.threat,
      success: skill.success,
      triumph: skill?.triumph ? skill.triumph : 0,
      despair: skill?.despair ? skill.despair : 0,
      upgrades: skill?.upgrades ? skill.upgrades : 0,
      remsetback: skill?.remsetback ? skill.remsetback : 0,
      difficulty: 2 + status.difficulty + (skill.difficulty ?? 0), // default average + status-effect difficulty dice
    });

    dicePool.upgrade(Math.min(characteristic.value, skill.rank) + dicePool.upgrades);
    dicePool.upgradeDifficulty(skill.upgradeDifficulty ?? 0);

    dicePool = new DicePoolFFG(await this.getModifiers(dicePool, item));

    this.displayRollDialog(actorSheet, dicePool, `${game.i18n.localize("SWFFG.Rolling")} ${skill.label}`, skill.label, item, flavorText, sound);
  }

  // Takes a skill object, characteristic object, difficulty number and ActorSheetFFG.getData() object and creates the appropriate roll dialog.
  static async rollSkillDirect(skill, characteristic, difficulty, sheet, flavorText, sound) {
    const dicePool = new DicePoolFFG({
      ability: Math.max(characteristic.value, skill.rank),
      boost: skill.boost,
      setback: skill.setback,
      force: skill.force,
      difficulty: difficulty + (skill.difficulty ?? 0),
      advantage: skill.advantage,
      dark: skill.dark,
      light: skill.light,
      failure: skill.failure,
      threat: skill.threat,
      success: skill.success,
      triumph: skill?.triumph ? skill.triumph : 0,
      despair: skill?.despair ? skill.despair : 0,
      remsetback: skill?.remsetback ? skill.remsetback : 0,
      upgrades: skill?.upgrades ? skill.upgrades : 0,
    });

    dicePool.upgrade(Math.min(characteristic.value, skill.rank) + dicePool.upgrades);
    dicePool.upgradeDifficulty(skill.upgradeDifficulty ?? 0);

    this.displayRollDialog(sheet, dicePool, `${game.i18n.localize("SWFFG.Rolling")} ${skill.label}`, skill.label, { name: game.i18n.localize(skill.label), type: "skill" }, flavorText, sound);
  }

  static getWeaponStatus(item) {
    let setback = 0;
    let difficulty = 0;

    if ((item.type === "weapon" || item.type === "shipweapon" ) && item?.system?.status && item.system.status !== "None") {
      const status = CONFIG.FFG.itemstatus[item.system.status].attributes.find((i) => i.mod === "Setback");

      if (status.value < 99) {
        if (status.value === 1) {
          setback = status.value;
        } else {
          difficulty = 1;
        }
      } else {
        ui.notifications.error(`${item.name} ${game.i18n.localize("SWFFG.ItemTooDamagedToUse")} (${game.i18n.localize(CONFIG.FFG.itemstatus[item.system.status].label)}).`);
        return;
      }
    }

    return { setback, difficulty };
  }

  static async getModifiers(dicePool, item) {
    if (item.type === "weapon" || item.type === "shipweapon") {
      dicePool = await ModifierHelpers.getDicePoolModifiers(dicePool, item, []);

      if (item?.system?.itemattachment) {
        await ImportHelpers.asyncForEach(item.system.itemattachment, async (attachment) => {
          //get base mods and additional mods totals
          dicePool = await ModifierHelpers.getDicePoolModifiers(dicePool, attachment, []);
          const activeModifiers = (attachment.system?.itemmodifier ?? []).filter((i) => i.system?.active);
          await ImportHelpers.asyncForEach(activeModifiers, async (modifier) => {
            dicePool = await ModifierHelpers.getDicePoolModifiers(dicePool, modifier, []);
          });
        });
      }
      if (item?.system?.itemmodifier) {
        await ImportHelpers.asyncForEach(item.system.itemmodifier, async (modifier) => {
          dicePool = await ModifierHelpers.getDicePoolModifiers(dicePool, modifier, []);
        });
      }
    }

    return dicePool;
  }

  /**
   * Apply skill-targeted modifiers (e.g. "Skill Add Upgrade" -> Gunnery, "Skill Boost" -> Gunnery)
   * carried by a modifier-bearing item (weapon, ship weapon, or ship attachment) and its modifications
   * /attachments to the dice pool, when the modifier's target skill matches the skill being rolled.
   *
   * Characters receive these because the modifier is written onto the actor as an Active Effect on
   * `system.skills.<skill>.*`, which `get_dice_pool` then reads. A vehicle's attachments can't write
   * onto a separate gunner actor, so for vehicle/crew rolls we gather them directly here. Mirrors the
   * traversal (and the active/equipped conventions) used by `getModifiers`.
   *
   * @param {DicePoolFFG} dicePool the pool to mutate
   * @param {string} skillName the skill being rolled (e.g. "Gunnery")
   * @param {object} item a weapon/shipweapon/shipattachment-shaped item carrying modifiers
   * @returns {DicePoolFFG} the same pool, mutated
   */
  static applySkillModifiers(dicePool, skillName, item) {
    if (!item?.system || !skillName) return dicePool;
    const targetKey = convert_skill_name(skillName) || skillName;

    // skill modtype -> dice pool field it adds to (Skill Add Upgrade is handled specially below)
    const SKILL_DELTA = {
      "Skill Boost": "boost",
      "Skill Setback": "setback",
      "Skill Remove Setback": "remsetback",
      "Skill Add Advantage": "advantage",
      "Skill Add Success": "success",
      "Skill Add Threat": "threat",
      "Skill Add Failure": "failure",
      "Skill Add Triumph": "triumph",
      "Skill Add Despair": "despair",
      "Skill Add Dark": "dark",
      "Skill Add Light": "light",
    };

    const applyAttrs = (attributes) => {
      for (const attr of Object.values(attributes ?? {})) {
        if (!attr || attr.modtype === undefined) continue;
        // attr.mod holds the target skill key for skill modtypes; normalise both sides before comparing
        const attrSkill = convert_skill_name(attr.mod) || attr.mod;
        if (attrSkill !== targetKey) continue;
        const value = parseInt(attr.value, 10);
        if (!Number.isFinite(value) || value === 0) continue;
        if (attr.modtype === "Skill Add Upgrade") {
          dicePool.upgrade(value);
        } else if (Object.keys(SKILL_DELTA).includes(attr.modtype)) {
          dicePool[SKILL_DELTA[attr.modtype]] += value;
        }
      }
    };

    // a modification is applied unless it is explicitly flagged inactive (matches getCalculatedValueFromItems)
    const isActive = (m) => !(m?.system && Object.keys(m.system).includes("active") && m.system.active === false);

    // the item's own base modifiers
    applyAttrs(item.system.attributes);
    // optional modifications installed directly on the item
    for (const modifier of item.system.itemmodifier ?? []) {
      if (isActive(modifier)) applyAttrs(modifier?.system?.attributes);
    }
    // attachments and their active optional modifications
    for (const attachment of item.system.itemattachment ?? []) {
      applyAttrs(attachment?.system?.attributes);
      for (const modifier of attachment?.system?.itemmodifier ?? []) {
        if (isActive(modifier)) applyAttrs(modifier?.system?.attributes);
      }
    }
    return dicePool;
  }
}

/**
 * Helper function to build a dice pool
 * @param actor_id ID of the actor making the check
 * @param skill_name name of the string of the skill
 * @param incoming_roll existing dice, e.g. difficulty dice
 * @returns {DicePoolFFG}
 */
export function get_dice_pool(actor_id, skill_name, incoming_roll) {
  const actor = game.actors.get(actor_id);
  const parsed_skill_name = convert_skill_name(skill_name);
  const skill = actor?.system?.skills?.[parsed_skill_name];
  const characteristic = skill ? actor?.system?.characteristics?.[skill.characteristic] : undefined;

  // If the skill or its characteristic can't be resolved (e.g. a vehicle weapon with no
  // skill set, or an unknown skill name), degrade gracefully to the incoming pool instead
  // of throwing, so the roll dialog still opens and the user can adjust dice manually.
  if (!skill || !characteristic) {
    CONFIG.logger?.warn?.(`get_dice_pool: unresolved skill '${skill_name}' (parsed '${parsed_skill_name}') or its characteristic for '${actor?.name}'; using unmodified pool.`);
    return new DicePoolFFG(incoming_roll);
  }

  const dicePool = new DicePoolFFG({
    ability: Math.max(characteristic.value, skill.rank) + incoming_roll.ability - (Math.min(characteristic.value, skill.rank) + incoming_roll.proficiency),
    proficiency: Math.min(characteristic.value, skill.rank) + incoming_roll.proficiency,
    boost: (skill.boost ?? 0) + incoming_roll.boost,
    setback: (skill.setback ?? 0) + incoming_roll.setback,
    force: (skill.force ?? 0) + incoming_roll.force,
    advantage: (skill.advantage ?? 0) + incoming_roll.advantage,
    dark: (skill.dark ?? 0) + incoming_roll.dark,
    light: (skill.light ?? 0) + incoming_roll.light,
    failure: (skill.failure ?? 0) + incoming_roll.failure,
    threat: (skill.threat ?? 0) + incoming_roll.threat,
    success: (skill.success ?? 0) + incoming_roll.success,
    triumph: (skill.triumph ?? 0) + incoming_roll.triumph,
    despair: (skill.despair ?? 0) + incoming_roll.despair,
    upgrades: (skill.upgrades ?? 0) + incoming_roll.upgrades,
    remsetback: skill?.remsetback ? skill.remsetback : 0 + incoming_roll.remsetback,
    difficulty: +incoming_roll.difficulty + (skill.difficulty ?? 0),
    challenge: +incoming_roll.challenge,
  });
  dicePool.upgradeDifficulty(skill.upgradeDifficulty ?? 0);
  return dicePool;
}

/**
 * Convert the skill name to how the game handles it
 * @param pool_skill_name skill name to be converted
 * @returns {null|string}
 */
function convert_skill_name(pool_skill_name) {
  CONFIG.logger.debug(`Converting ${pool_skill_name} to skill name`);
  const skills = CONFIG.FFG.skills;
  for (var skill in skills) {
    if (game.i18n.localize(skills[skill]['label']) === pool_skill_name) {
      CONFIG.logger.debug(`Found mapping to ${skill}`);
      return skill;
    }
  }
  // it would appear that sometimes it's value instead of label
  for (var skill in skills) {
    if (skills[skill]['value'] === pool_skill_name) {
      CONFIG.logger.debug(`Found mapping to ${skill}`);
      return skill;
    }
  }
  CONFIG.logger.debug('WARNING: Found no mapping!');
  return null;
}
