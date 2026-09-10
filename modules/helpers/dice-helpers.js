import PopoutEditor from "../popout-editor.js";
import RollBuilderFFG from "../dice/roll-builder.js";
import ModifierHelpers from "../helpers/modifiers.js";
import ImportHelpers from "../importer/import-helpers.js";
import RollProfiles from "../helpers/roll-profiles.js";

export default class DiceHelpers {
  /**
   * The dice a (skill, characteristic) pair contributes, merged with any pool the caller already
   * holds.
   *
   * This is the single implementation of the FFG pool formula - `max(rank, characteristic)` ability
   * dice, of which `min(rank, characteristic)` are upgraded to proficiency - plus the skill-scoped
   * modifier fields Active Effects write onto `system.skills.<skill>.*`. Every roll entry point used
   * to carry its own copy of it, and they had drifted.
   *
   * @param {object}  opts
   * @param {object}  opts.skill              the actor's skill entry (rank + skill-scoped modifiers)
   * @param {object}  opts.characteristic     the governing characteristic entry (`{value}`)
   * @param {?object} [opts.incoming]         a pool to merge into (the vehicle/crew path)
   * @param {number}  [opts.baseDifficulty]   difficulty before any skill modifiers
   * @param {number}  [opts.extraSetback]     setback from sources outside the skill (item status, defence)
   * @param {number}  [opts.extraDifficulty]  difficulty from sources outside the skill (item status)
   * @param {boolean} [opts.consumeUpgrades]  spend the pool's `upgrades` as ability upgrades
   * @param {boolean} [opts.applyDifficulty]  compute a difficulty side at all
   * @param {?object} [opts.source]           modifier provenance, for the dice-pool tooltip
   * @returns {DicePoolFFG}
   */
  static buildSkillPool({
    skill,
    characteristic,
    incoming = null,
    baseDifficulty = 0,
    extraSetback = 0,
    extraDifficulty = 0,
    consumeUpgrades = true,
    applyDifficulty = true,
    source = null,
  }) {
    const n = (value) => Number(value) || 0;
    const inc = incoming ?? {};
    const rank = n(skill?.rank);
    const charValue = n(characteristic?.value);

    const poolData = {
      ability: Math.max(charValue, rank) + n(inc.ability),
      boost: n(skill?.boost) + n(inc.boost),
      setback: n(skill?.setback) + n(inc.setback) + n(extraSetback),
      remsetback: n(skill?.remsetback) + n(inc.remsetback),
      force: n(skill?.force) + n(inc.force),
      advantage: n(skill?.advantage) + n(inc.advantage),
      dark: n(skill?.dark) + n(inc.dark),
      light: n(skill?.light) + n(inc.light),
      failure: n(skill?.failure) + n(inc.failure),
      threat: n(skill?.threat) + n(inc.threat),
      success: n(skill?.success) + n(inc.success),
      triumph: n(skill?.triumph) + n(inc.triumph),
      despair: n(skill?.despair) + n(inc.despair),
      upgrades: n(skill?.upgrades) - n(skill?.downgradeAbility) + n(inc.upgrades),
      challenge: n(inc.challenge),
    };
    if (applyDifficulty) {
      poolData.difficulty = Math.max(
        0,
        n(baseDifficulty) + n(inc.difficulty) + n(extraDifficulty) + n(skill?.difficulty) - n(skill?.decreaseDifficulty)
      );
    }
    if (source) poolData.source = source;

    const dicePool = new DicePoolFFG(poolData);
    dicePool.upgrade(Math.min(charValue, rank) + n(inc.proficiency) + (consumeUpgrades ? dicePool.upgrades : 0));
    if (applyDifficulty) {
      dicePool.upgradeDifficulty(n(skill?.upgradeDifficulty) - n(skill?.downgradeDifficulty));
    }
    return dicePool;
  }

  /**
   * Resolve which skill and characteristic a check actually rolls - honouring a per-roll override
   * from the roll dialog, or one stored on the weapon (see helpers/roll-profiles.js) - and assemble
   * the finished pool.
   *
   * Two things deliberately stay on the weapon's OWN skill rather than following an override:
   *
   *  - Defence dice. `getDefenseDice` decides ranged vs melee defence from the skill name, so
   *    rolling a blaster with Mechanics would otherwise silently drop the target's ranged defence.
   *  - Damage. Not touched here at all; `Actor#_applyCharacteristicDamage` keeps adding the weapon's
   *    own `system.characteristic.value`, whatever the check is rolled with.
   *
   * Skill-scoped Active Effects (`system.skills.<skill>.boost` and friends) DO follow the override,
   * because they are read off whichever skill entry is resolved here - if the character is rolling
   * Mechanics, they get Mechanics' modifiers.
   *
   * @param {object} opts
   * @param {object} opts.actorData        the actor's `system` data (or a sheet getData()'s `data`)
   * @param {Item}   [opts.item]           the item being rolled, if any
   * @param {?string} [opts.baseSkillKey]  the skill the roll started from, for non-item rolls
   * @param {?object} [opts.overrides]     `{skill, characteristic}` chosen for this roll only
   * @returns {Promise<{dicePool: DicePoolFFG, profile: object, skill: object, characteristic: object, label: string}>}
   */
  static async assemblePool({
    actorData,
    item = null,
    baseSkillKey = null,
    overrides = null,
    baseDifficulty = 0,
    extraSetback = 0,
    extraDifficulty = 0,
    upgradeType = null,
    incoming = null,
    consumeUpgrades = true,
  }) {
    const profile = RollProfiles.resolve(actorData, item, overrides, baseSkillKey);
    const skill = actorData?.skills?.[profile.skill] ?? (await this.buildFallbackSkill(actorData, profile.skill));
    const characteristic = actorData?.characteristics?.[profile.characteristic] ?? { value: 0 };
    // getWeaponStatus/getDefenseDice/getModifiers all key off `type`; a plain skill row has no item.
    const itemData = item ?? { type: "skill" };

    // Defence is a property of how the weapon is USED, not of the skill it is rolled with: keep it
    // on the weapon's own skill so an override cannot silently discard the target's defence.
    const defenseDice = this.getDefenseDice({ value: profile.baseSkill ?? profile.skill }, itemData);

    let dicePool = this.buildSkillPool({
      skill,
      characteristic,
      incoming,
      baseDifficulty,
      extraSetback: extraSetback + defenseDice,
      extraDifficulty,
      consumeUpgrades,
    });

    if (upgradeType === "ability") {
      dicePool.upgrade();
    } else if (upgradeType === "difficulty") {
      dicePool.upgradeDifficulty();
    }

    dicePool = new DicePoolFFG(await this.getModifiers(dicePool, itemData));

    return { dicePool, profile, skill, characteristic, label: skill.label };
  }

  /**
   * A zeroed skill entry for a skill the actor does not carry (an adversary rolling a skill outside
   * its list, a renamed skill theme). Labelled from the active skill theme where possible.
   * @param {object} actorData
   * @param {string} skillName
   */
  static async buildFallbackSkill(actorData, skillName) {
    let skills;
    const theme = await game.settings.get("starwarsffg", "skilltheme");
    try {
      skills = JSON.parse(JSON.stringify(CONFIG.FFG.alternateskilllists.find((list) => list.id === theme).skills));
    } catch (err) {
      // if we run into an error use the default starwars skill set
      skills = JSON.parse(JSON.stringify(CONFIG.FFG.alternateskilllists.find((list) => list.id === "starwars").skills));
      CONFIG.logger.warn(`Unable to load skill theme ${theme}, defaulting to starwars skill theme`, err);
    }

    const skillData = skills?.[skillName] ?? actorData?.[skillName];

    return {
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
  }

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

    const status = this.getWeaponStatus(item ?? { type: "skill" });
    // getWeaponStatus returns null when the item is too damaged to use (Major); abort the
    // roll (the notification was already shown) rather than dereferencing undefined.
    if (!status) return;

    // TODO: Get weapon specific modifiers from itemmodifiers and itemattachments

    // Re-assembled from scratch whenever the roll dialog's skill/characteristic dropdowns change, so
    // the dice shown are always the dice that pair would really roll rather than a patched-up delta.
    const assemble = async (overrides) =>
      this.assemblePool({
        actorData: data.data,
        item,
        baseSkillKey: skillName,
        overrides,
        baseDifficulty: 2, // default average
        extraDifficulty: status.difficulty,
        extraSetback: status.setback,
        upgradeType: type,
      });

    const rolled = await assemble(null);
    const itemData = item || { name: game.i18n.localize(rolled.label), type: "skill" };

    await this.displayRollDialog(
      data,
      rolled.dicePool,
      `${game.i18n.localize("SWFFG.Rolling")} ${game.i18n.localize(rolled.label)}`,
      rolled.label,
      itemData,
      flavorText,
      sound,
      { profile: this.buildProfileOptions(data.data, item, rolled, assemble) }
    );
  }

  /**
   * The context the roll dialog needs to offer (and re-apply) a skill/characteristic swap.
   * Returns null when there is nothing to swap between.
   *
   * @param {object} actorData
   * @param {?Item} item
   * @param {object} rolled    the result of the initial {@link assemblePool}
   * @param {Function} rebuild `async (overrides) => assemblePool(...)`
   */
  static buildProfileOptions(actorData, item, rolled, rebuild) {
    if (!actorData?.skills || !Object.keys(actorData.skills).length) return null;
    const stored = RollProfiles.getOverride(item) ?? {};
    return {
      rebuild,
      item: item ?? null,
      // Storing a per-weapon override only makes sense for a real, owned weapon: those are the
      // rows that carry a roll button, and the only ones the stored override is ever read back for.
      canStore: Boolean(item?.setFlag) && ["weapon", "shipweapon"].includes(item.type),
      baseSkillKey: rolled.profile.baseSkill,
      selectedSkill: stored.skill ?? "",
      selectedCharacteristic: stored.characteristic ?? "",
      // Open the control by default when a substitution is already in force, so it is never in
      // effect while hidden behind a collapsed summary.
      expanded: Boolean(stored.skill || stored.characteristic),
      skills: RollProfiles.skillChoices(actorData, stored.skill ?? null),
      characteristics: RollProfiles.characteristicChoices(stored.characteristic ?? null),
      // Saved profiles are offered here as well as in the editor, so a lightsaber form (or any other
      // pair used often enough to be worth naming) is one click away at roll time.
      profiles: RollProfiles.getProfiles(item).map((profile) => ({
        id: profile.id,
        label: profile.label,
        skill: profile.skill ?? "",
        characteristic: profile.characteristic ?? "",
        summary: RollProfiles.profileSummary(actorData, profile),
      })),
      defaultSkillLabel: game.i18n.format("SWFFG.RollProfile.DefaultSkill", {
        skill: RollProfiles.skillLabel(actorData, rolled.profile.baseSkill),
      }),
      defaultCharacteristicLabel: game.i18n.format("SWFFG.RollProfile.DefaultCharacteristic", {
        characteristic: RollProfiles.characteristicLabel(rolled.profile.characteristic),
      }),
      actorData,
    };
  }

  static getDefenseDice(skill, itemData){
    let defenseDice = 0;
    if (game.settings.get("starwarsffg", "useDefense")) {
      // Normalise the skill identifier so both skillsets resolve the same way regardless of
      // how the ranged skills are spelled: Star Wars uses "Ranged: Light" / "Ranged: Heavy"
      // while GOCK uses "Ranged-Light" / "Ranged-Heavy". Stripping all non-alphanumerics and
      // lowercasing collapses those (and any spacing variant) to a single canonical key.
      const normalize = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const key = normalize(skill?.value);
      let isRanged = ["rangedlight", "rangedheavy", "gunnery"].includes(key);
      let isMelee = ["melee", "brawl", "lightsaber"].includes(key);
      // `shipweapon` counts as a weapon here: a vehicle weapon fired at a personal-scale target
      // still faces that target's ranged defence. Omitting it meant gunnery attacks silently
      // ignored defence while the equivalent personal attack applied it.
      if (itemData?.type === "weapon" || itemData?.type === "shipweapon" || itemData?.metaData?.tags?.includes("weapon")) {
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

  static async displayRollDialog(data, dicePool, description, skillName, item, flavorText, sound, options = {}) {
    return new RollBuilderFFG(data, dicePool, description, skillName, item, flavorText, sound, options).render(true);
  }

  static async addSkillDicePool(data, elem) {
    const skillName = elem.dataset["ability"];
    if (data.data.skills[skillName]) {
      const skill = data.data.skills[skillName];
      const characteristic = data.data.characteristics[skill.characteristic];

      // The hover preview shows the ability side only - no difficulty is involved - so the shared
      // builder is asked to skip the difficulty side entirely rather than inventing one.
      const dicePool = this.buildSkillPool({
        skill,
        characteristic,
        applyDifficulty: false,
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

      const rollButton = elem.querySelector(".roll-button");
      dicePool.renderPreview(rollButton);
    }
  }

  static async rollItem(itemId, actorId, flavorText, sound) {
    const actor = game.actors.get(actorId);
    const actorSheet = await actor.sheet.getData();

    const item = actor.items.get(itemId);
    await item.setFlag("starwarsffg", "uuid", item.uuid);

    const status = this.getWeaponStatus(item);
    // getWeaponStatus returns null when the item is too damaged to use (Major); abort the
    // roll (the notification was already shown) rather than dereferencing undefined.
    if (!status) return;

    const assemble = async (overrides) =>
      this.assemblePool({
        actorData: actor.system,
        item,
        overrides,
        baseDifficulty: 2, // default average
        extraDifficulty: status.difficulty,
        extraSetback: status.setback,
      });

    const rolled = await assemble(null);

    this.displayRollDialog(
      actorSheet,
      rolled.dicePool,
      `${game.i18n.localize("SWFFG.Rolling")} ${game.i18n.localize(rolled.label)}`,
      rolled.label,
      item,
      flavorText,
      sound,
      { profile: this.buildProfileOptions(actor.system, item, rolled, assemble) }
    );
  }

  // Takes a skill object, characteristic object, difficulty number and ActorSheetFFG.getData() object and creates the appropriate roll dialog.
  static async rollSkillDirect(skill, characteristic, difficulty, sheet, flavorText, sound) {
    const dicePool = this.buildSkillPool({
      skill,
      characteristic,
      baseDifficulty: difficulty,
    });

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
        // Signal "too damaged to use" to callers, which must abort the roll. Returning
        // null (rather than a status object) is what blocks the roll; callers guard on it.
        return null;
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
        } else if (attr.modtype === "Skill Decrease Difficulty") {
          dicePool.difficulty = Math.max(0, dicePool.difficulty - value);
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
 * @param item optional weapon being rolled; a skill/characteristic override stored on it is honoured
 * @returns {DicePoolFFG}
 */
export function get_dice_pool(actor_id, skill_name, incoming_roll, item = null) {
  const actor = game.actors.get(actor_id);
  const parsed_skill_name = convert_skill_name(skill_name);
  // A stored override names its skill by key already, so it is used as-is; otherwise fall back to
  // the caller's (localized or raw) skill name, resolved through convert_skill_name as before.
  const override = RollProfiles.getOverride(item);
  const resolved_skill_name = override?.skill ?? parsed_skill_name;
  const skill = actor?.system?.skills?.[resolved_skill_name];
  const characteristic = skill
    ? actor?.system?.characteristics?.[override?.characteristic ?? skill.characteristic]
    : undefined;

  // If the skill or its characteristic can't be resolved (e.g. a vehicle weapon with no
  // skill set, or an unknown skill name), degrade gracefully to the incoming pool instead
  // of throwing, so the roll dialog still opens and the user can adjust dice manually.
  if (!skill || !characteristic) {
    CONFIG.logger?.warn?.(`get_dice_pool: unresolved skill '${skill_name}' (parsed '${resolved_skill_name}') or its characteristic for '${actor?.name}'; using unmodified pool.`);
    return new DicePoolFFG(incoming_roll);
  }

  // consumeUpgrades is off here alone: this path has never spent the skill's own "Skill Add
  // Upgrade" total as ability upgrades (the crew/vehicle callers apply weapon-borne upgrades
  // themselves via applySkillModifiers), and turning it on would silently change every vehicle
  // roll. The field is still carried on the pool, exactly as before.
  return DiceHelpers.buildSkillPool({
    skill,
    characteristic,
    incoming: incoming_roll,
    consumeUpgrades: false,
  });
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
