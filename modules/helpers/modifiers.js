import PopoutModifiers from "../popout-modifiers.js";

export default class ModifierHelpers {
  /**
   * Calculate total value from embedded items
   * @param  {array} items
   * @param  {string} key
   */
  static getCalculatedValueFromItems(items, key, modtype, includeSource) {
    // NOTE: the non-includeSource path used to return 0, which made this whole function a no-op for
    // stat aggregation (it is never called with includeSource=true in practice). It now returns the
    // accumulated total so installed item modifications actually contribute. See the return below.
    let total = 0;
    let checked = false;
    let sources = [];
    // Tracks unranked specialization talents already counted in this aggregation. The same
    // unranked talent can be learned in multiple specialization trees (the FFG cross-tree rule
    // auto-purchases it for free once reached), but its modifiers must only be applied once.
    // Ranked talents legitimately stack and are never added here.
    const seenUnrankedSpecTalents = new Set();

    try {
      items.forEach((item) => {
        if (!item) {
          // don't process null items
          return;
        }
        if (Object.keys(item.system).includes("active") && item.system.active === false) {
          // there is a mod or something, and it's not active - don't process it
          return;
        }
        if (item.type === "gear" && item.system?.equippable && !item.system.equippable.equipped) {
          // unequipped gear contributes no modifiers (dice pool bonuses, etc.)
          return;
        }
        if (item.system?.attributes) {
          const attrsToApply = Object.keys(item.system.attributes)
            .filter((id) => (item.system.attributes[id].mod === key || item.system.attributes[id].mod === "*") && item.system.attributes[id].modtype === modtype)
            .map((i) => item.system.attributes[i]);
          if (item.type === "armour" || item.type === "weapon" || item.type === "itemattachment") {
            if (item?.system?.equippable?.equipped || item.type === "itemattachment") {
              if (item.system?.itemmodifier) {
                total += this.getCalculatedValueFromItems(item.system.itemmodifier, key, modtype);
              }
              if (item.system?.itemattachment && item?.system?.equippable?.equipped) {
                total += this.getCalculatedValueFromItems(item.system.itemattachment, key, modtype);
              }
              if (key === "Soak" && item.system?.soak) {
                sources.push({ modtype, key, name: item.name, value: item.system.soak.adjusted, type: item.type });
                total += parseInt(item.system.soak.adjusted, 10);
              }
              if ((key === "Defence-Melee" || key === "Defence-Ranged") && item.system?.defence) {
                // get the highest defense item
                const shouldUse = items.filter((i) => item.system.defence >= i.system.defence).length >= 0;
                if (shouldUse) {
                  sources.push({ modtype, key, name: item.name, value: item.system.defence.adjusted, type: item.type });
                  total += parseInt(item.system.defence.adjusted, 10);
                }
              }
              if (attrsToApply.length > 0) {
                attrsToApply.forEach((attr) => {
                  if (modtype === "Career Skill" || modtype === "Force Boost") {
                    if (attr.value) {
                      sources.push({ modtype, key, name: item.name, value: true, type: item.type });
                      checked = true;
                    }
                  } else {
                    sources.push({ modtype, key, name: item.name, value: attr.value, type: item.type });
                    total += parseInt(attr.value, 10);
                  }
                });
              }
            }
          } else if (item.type === "forcepower" || item.type === "specialization" || item.type === "signatureability") {
            // apply basic force power/specialization modifiers
            if (attrsToApply.length > 0) {
              attrsToApply.forEach((attr) => {
                if (modtype === "Career Skill" || modtype === "Force Boost") {
                  if (attr.value) {
                    sources.push({ modtype, key, name: item.name, value: true, type: item.type });
                    checked = true;
                  }
                } else {
                  if ((modtype === "ForcePool" && total === 0) || modtype !== "ForcePool") {
                    sources.push({ modtype, key, name: item.name, value: attr.value, type: item.type });
                    total += parseInt(attr.value, 10);
                  }
                }
              });
            }
            let upgrades;
            if (item.type === "forcepower" || item.type === "signatureability") {
              // apply force power upgrades
              upgrades = Object.keys(item.system.upgrades)
                .filter((k) => item.system.upgrades[k].islearned)
                .map((k) => {
                  return {
                    type: "talent",
                    name: `${item.name}: ${item.system.upgrades[k].name}`,
                    system: {
                      attributes: item.system.upgrades[k]?.attributes ? item.system.upgrades[k]?.attributes : {},
                      ranks: {
                        ranked: false,
                        current: 1,
                      },
                    },
                  };
                });
            } else if (item.type === "specialization") {
              // apply specialization talent modifiers
              upgrades = Object.keys(item.system.talents)
                .filter((k) => item.system.talents[k].islearned)
                .filter((k) => {
                  const talent = item.system.talents[k];
                  // ranked talents stack across trees; unnamed/blank slots are left alone
                  if (talent.isRanked || !talent.name) return true;
                  // an unranked talent learned in more than one tree only contributes once
                  if (seenUnrankedSpecTalents.has(talent.name)) return false;
                  seenUnrankedSpecTalents.add(talent.name);
                  return true;
                })
                .map((k) => {
                  return {
                    type: "talent",
                    name: `${item.name}: ${item.system.talents[k].name}`,
                    system: {
                      attributes: item.system.talents[k].attributes,
                      ranks: {
                        ranked: item.system.talents[k].isRanked,
                        current: 1,
                      },
                    },
                  };
                });
            }
            if (modtype === "Career Skill" || modtype === "Force Boost") {
              if (this.getCalculatedValueFromItems(upgrades, key, modtype)) {
                sources.push({ modtype, key, name: item.name, value: true, type: item.type });
                checked = true;
              }
            } else {
              if (includeSource) {
                const subValues = this.getCalculatedValueFromItems(upgrades, key, modtype, includeSource);
                total += subValues.total;
                sources = sources.concat(subValues.sources);
              } else {
                const subValues = this.getCalculatedValueFromItems(upgrades, key, modtype);
                total += subValues;
              }
            }
          } else {
            if (attrsToApply.length > 0) {
              attrsToApply.forEach((attr) => {
                if (modtype === "Career Skill" || modtype === "Force Boost") {
                  if (attr.value) {
                    sources.push({ modtype, key, name: item.name, value: true, type: item.type });
                    checked = true;
                  }
                } else {
                  if (item.type === "talent") {
                    let multiplier = 1;
                    if (item.system.ranks.ranked) {
                      multiplier = item.system.ranks.current;
                    }
                    sources.push({ modtype, key, name: item.name, value: attr.value * multiplier, type: item.type });
                    total += parseInt(attr.value, 10) * multiplier;
                  } else {
                    const quantity = (isNaN(item.system?.quantity?.value)) ? 1 : item.system.quantity.value;
                    sources.push({ modtype, key, name: item.name, value: attr.value, type: item.type });
                    total += parseInt(attr.value, 10) * quantity;
                  }
                }
              });
            }
          }
        }
      });
    } catch (err) {
      CONFIG.logger.warn(`Error occured while trying to calculate modifiers from item list`, err);
    }

    if (modtype === "Career Skill" || modtype === "Force Boost") {
      if (includeSource) {
        checked = true;
        return { checked, sources };
      }
      return 0;
    }

    if (includeSource) {
      return { total, sources };
    } else {
      // Previously returned 0, which silently dropped every modifier accumulated above. The only
      // callers that pass a non-empty `items` list and rely on the numeric return are the item-stat
      // aggregation in item-ffg.js (the attachment's installed optional modifications); the dice-pool
      // path always passes [] and applies each item individually via the item-own path, so it is
      // unaffected. Returning the real total is what makes installed modifications affect the item.
      return total;
    }
  }

  // TODO: this should probably be either removed or refactored
  static getCalculatedValueFromCurrentAndArray(item, items, key, modtype, includeSource) {
    let total = 0;
    let checked = false;
    let sources = [];

    let rank = item?.system?.rank;
    if(rank === null || rank === undefined) {
      rank = 1;
    }
    if (item?.system) {
      const filteredAttributes = Object.values(item.system.attributes ?? {}).filter(a => a).filter((a) => a.modtype === modtype && a.mod === key);

      filteredAttributes.forEach((attr) => {
        sources.push({ modtype, key, name: item.name, value: attr.value * rank, type: item.type });
        total += parseInt(attr.value * rank, 10);
      });
    }

    const itemsTotal = ModifierHelpers.getCalculatedValueFromItems(items, key, modtype, includeSource);
    if (includeSource) {
      total += itemsTotal.total;
      sources = sources.concat(itemsTotal.sources);

      return { total, sources };
    } else {
      total += itemsTotal;
      return total;
    }
  }

  static getBaseValue(items, key, modtype) {
    let total = 0;

    items.forEach((item) => {
      if (item.type === "species") {
        const attrsToApply = Object.keys(item.system.attributes ?? {})
          .filter((id) => item.system.attributes[id].mod === key && item.system.attributes[id].modtype === modtype)
          .map((i) => item.system.attributes[i]);

        if (attrsToApply.length > 0) {
          attrsToApply.forEach((attr) => {
            total += parseInt(attr.value, 10);
          });
        }
      }
    });

    return total;
  }

  /**
   * DOM event
   * @param  {object} event
   */
  static async onClickAttributeControl(event) {
    if(this.actor && !this.actor.verifyEditModeIsNotEnabled()) return;

    event.preventDefault();
    const a = event.currentTarget;
    const action = a.dataset.action;

    if (["forcepower", "signatureability", "specialization"].includes(this.object.type)) {
      // used in the direct modifiers at the top of certain item types
      const form = this.form;
      if (action === "create") {
        const nk = new Date().getTime();
        let newKey = document.createElement("div");
          newKey.innerHTML = `<input type="text" name="data.attributes.attr${nk}.key" value="attr${nk}" style="display:none;"/><select class="attribute-modtype" name="data.attributes.attr${nk}.modtype"><option value="Characteristic">Characteristic</option></select><select class="attribute-mod" name="data.attributes.attr${nk}.mod"><option value="${Object.keys(CONFIG.FFG.characteristics)[0]}">${Object.keys(CONFIG.FFG.characteristics)[0]}</option></select><input class="attribute-value" type="text" name="data.attributes.attr${nk}.value" value="0" data-dtype="Number" placeholder="0"/>`;
        form.appendChild(newKey);
        await this._onSubmit(event);
      } else if (action === "delete") {
        const li = a.closest(".attribute");
        li.parentElement.removeChild(li);
        await this._onSubmit(event);
      }
    } else {
      // Add new attribute
      if (action === "create") {
        CONFIG.logger.debug("Creating new modifier...");
        const nk = new Date().getTime();
        if (["criticaldamage", "shipattachment", "shipweapon"].includes(this.object.type)) {
          await this.object.update({
            "system.attributes": {
              [`attr${nk}`]: {
                modtype: "Vehicle Stat",
                mod: "Armour",
                value: 0,
              },
            }
          });
        } else if (["itemmodifier", "itemattachment"].includes(this.object.type)) {
          await this.object.update({
            "system.attributes": {
              [`attr${nk}`]: {
                modtype: "Stat",
                mod: "Wounds",
                value: 0,
              },
            }
          });
        } else {
          await this.object.update({
            "system.attributes": {
              [`attr${nk}`]: {
                modtype: "Stat",
                mod: "Wounds",
                value: 0,
              },
            }
          });
        }
      }
      // Remove existing attribute
      else if (action === "delete") {
        const li = a.closest(".attribute");
        li.parentElement.removeChild(li);
        await this._onSubmit(event);
      }
    }
  }

  /**
   * Create popout Modifiers Window
   * @param  {object} event
   */
  static async popoutModiferWindow(event) {
    event.preventDefault();
    const a = event.currentTarget.parentElement;

    const title = `${game.i18n.localize("SWFFG.TabModifiers")}: ${this.object.name}`;

    new PopoutModifiers(this.object, {
      title,
    }).render(true);
  }

  static async popoutModiferWindowUpgrade(event) {
    event.preventDefault();
    const a = event.currentTarget.parentElement;
    const keyname = a.dataset.itemid;

    const title = `${game.i18n.localize("SWFFG.TabModifiers")}: ${this.object.system.upgrades[keyname].name}`;

    const data = {
      parent: this.object,
      keyname,
      data: {
        data: {
          ...this.object.system.upgrades[keyname],
        },
      },
      isUpgrade: true,
    };

    new PopoutModifiers(data, {
      title,
    }).render(true);
  }

  static async getDicePoolModifiers(pool, item, items) {
    let dicePool = new DicePoolFFG(pool);

    dicePool.boost += ModifierHelpers.getCalculatedValueFromCurrentAndArray(item, items, "Add Boost", "Roll Modifiers");
    dicePool.setback += ModifierHelpers.getCalculatedValueFromCurrentAndArray(item, items, "Add Setback", "Roll Modifiers");
    dicePool.remsetback += ModifierHelpers.getCalculatedValueFromCurrentAndArray(item, items, "Remove Setback", "Roll Modifiers");
    dicePool.advantage += ModifierHelpers.getCalculatedValueFromCurrentAndArray(item, items, "Add Advantage", "Result Modifiers");
    dicePool.dark += ModifierHelpers.getCalculatedValueFromCurrentAndArray(item, items, "Add Dark", "Result Modifiers");
    dicePool.failure += ModifierHelpers.getCalculatedValueFromCurrentAndArray(item, items, "Add Failure", "Result Modifiers");
    dicePool.light += ModifierHelpers.getCalculatedValueFromCurrentAndArray(item, items, "Add Light", "Result Modifiers");
    dicePool.success += ModifierHelpers.getCalculatedValueFromCurrentAndArray(item, items, "Add Success", "Result Modifiers");
    dicePool.threat += ModifierHelpers.getCalculatedValueFromCurrentAndArray(item, items, "Add Threat", "Result Modifiers");
    dicePool.triumph += ModifierHelpers.getCalculatedValueFromCurrentAndArray(item, items, "Add Triumph", "Result Modifiers");
    dicePool.despair += ModifierHelpers.getCalculatedValueFromCurrentAndArray(item, items, "Add Despair", "Result Modifiers");

    dicePool.difficulty += ModifierHelpers.getCalculatedValueFromCurrentAndArray(item, items, "Add Difficulty", "Dice Modifiers");
    dicePool.upgradeDifficulty(ModifierHelpers.getCalculatedValueFromCurrentAndArray(item, items, "Upgrade Difficulty", "Dice Modifiers"));
    dicePool.upgradeDifficulty(-1 * ModifierHelpers.getCalculatedValueFromCurrentAndArray(item, items, "Downgrade Difficulty", "Dice Modifiers"));
    dicePool.upgrade(ModifierHelpers.getCalculatedValueFromCurrentAndArray(item, items, "Upgrade Ability", "Dice Modifiers"));
    dicePool.upgrade(-1 * ModifierHelpers.getCalculatedValueFromCurrentAndArray(item, items, "Downgrade Ability", "Dice Modifiers"));

    return dicePool;
  }

  // Returns true if data item has characteristic that impacts its damage, false otherwise
  static shouldApplyCharacteristicToDamage(data) {
    if(data.characteristic?.value !== "" && data.characteristic?.value !== undefined) {
      return true;
    }

    return false;
  }

  /**
   * Given a skill path, determine the modifier type for that skill (the revers eof getModKeyPath)
   * @param skillPath
   * @returns {string}
   */
  static getModTypeByModPath(skillPath) {
    if (skillPath.endsWith("force")) {
      return "Force Boost";
    } else if (skillPath.endsWith("decreaseDifficulty")) {
      return "Skill Decrease Difficulty";
    } else if (skillPath.endsWith("downgradeDifficulty")) {
      return "Skill Downgrade Difficulty";
    } else if (skillPath.endsWith("advantage")) {
      return "Skill Add Advantage";
    } else if (skillPath.endsWith("dark")) {
      return "Skill Add Dark";
    } else if (skillPath.endsWith("despair")) {
      return "Skill Add Despair";
    } else if (skillPath.endsWith("failure")) {
      return "Skill Add Failure";
    } else if (skillPath.endsWith("light")) {
      return "Skill Add Light";
    } else if (skillPath.endsWith("success")) {
      return "Skill Add Success";
    } else if (skillPath.endsWith("threat")) {
      return "Skill Add Threat";
    } else if (skillPath.endsWith("triumph")) {
      return "Skill Add Triumph";
    } else if (skillPath.endsWith("upgrades")) {
      return "Skill Add Upgrade";
    } else if (skillPath.endsWith("boost")) {
      return "Skill Boost";
    } else if (skillPath.endsWith("rank")) {
      return "Skill Rank";
    } else if (skillPath.endsWith("remsetback")) {
      return "Skill Remove Setback";
    } else if (skillPath.endsWith("setback")) {
      return "Skill Setback";
    } else if (skillPath.endsWith("careerskill")) {
      return "Career Skill";
    }
  }


  /**
   * Given a mod and mod type, expand them into a list of mods which should be applied
   * For example, modifying Brawn also modifies Encumbrance
   * @param modType
   * @param mod
   * @returns {[{modType, mod}]|[{modType, mod: string},{modType, mod: string}]}
   */
  static explodeMod(modType, mod) {
    const modLower = mod.toLocaleLowerCase();
    if (["defence-melee", "defense-melee"].includes(modLower)) {
      return [
        {
          modType: "Stat",
          mod: "Defence.Melee",
        },
      ];
    } else if (["defence-ranged", "defense-ranged"].includes(modLower)) {
      return [
        {
          modType: "Stat",
          mod: "Defence.Ranged",
        },
      ];
    } else if (["defence", "defense"].includes(modLower)) {
      return [
        {
          modType: "Stat",
          mod: "Defence.Melee",
        },
        {
          modType: "Stat",
          mod: "Defence.Ranged",
        },
      ];
    } else if (["Shields"].includes(mod)) {
      return [
        {
          modType: modType,
          mod: "Shields.Fore",
        },
        {
          modType: modType,
          mod: "Shields.Aft",
        },
        {
          modType: modType,
          mod: "Shields.Port",
        },
        {
          modType: modType,
          mod: "Shields.Starboard",
        },
      ];
    } else if (["Brawn"].includes(mod)) {
      return [
        {
          modType: modType,
          mod: "Brawn",
        },
        {
          modType: modType,
          mod: "Wounds",
        },
        {
          modType: modType,
          mod: "EncumbranceMax",
        },
        {
          modType: "Stat",
          mod: "Soak",
        },
      ];
    } else if (["Willpower"].includes(mod)) {
      return [
        {
          modType: modType,
          mod: "Willpower",
        },
        {
          modType: modType,
          mod: "Strain",
        },
      ];
    } else {
      return [{
        modType: modType,
        mod: mod,
      }];
    }
  }

  /**
   * Given a modifier type and selection, determine the property path for an active effect to apply changes to
   * @param modType
   * @param mod
   * @returns {string}
   */
  static getModKeyPath(modType, mod) {
    if (["Wounds", "Strain", "EncumbranceMax", "Speed", "Hulltrauma", "Systemstrain"].includes(mod)) {
      modType = "Threshold";
    }
    if (modType === "Characteristic") {
      return `system.characteristics.${mod}.value`;
    } else if (modType === "Stat All" || modType === "Stat") {
      if (mod === "ForcePool") {
        return `system.stats.forcePool.max`;
      } else if (mod === "Defence.Melee") {
        return `system.stats.defence.melee`;
      } else if (mod === "Defence.Ranged") {
        return `system.stats.defence.ranged`;
      } else {
        return `system.stats.${mod.toLocaleLowerCase()}.value`;
      }
    } else if (modType === "Threshold") {
      if (mod === "Hulltrauma") {
        return `system.stats.hullTrauma.max`;
      } else if (mod === "Systemstrain") {
        return `system.stats.systemStrain.max`;
      } else if (mod === "EncumbranceMax") {
        // the mod for this is different, so don't simply return the mod value
        return `system.stats.encumbrance.max`;
      } else {
        return `system.stats.${mod.toLocaleLowerCase()}.max`;
      }
    } else if (modType === "Force Boost") {
      return `system.skills.${mod}.force`;
    } else if (modType === "Skill Add Advantage") {
      return `system.skills.${mod}.advantage`;
    } else if (modType === "Skill Add Dark") {
      return `system.skills.${mod}.dark`;
    } else if (modType === "Skill Add Despair") {
      return `system.skills.${mod}.despair`;
    } else if (modType === "Skill Add Failure") {
      return `system.skills.${mod}.failure`;
    } else if (modType === "Skill Add Light") {
      return `system.skills.${mod}.light`;
    } else if (modType === "Skill Add Success") {
      return `system.skills.${mod}.success`;
    } else if (modType === "Skill Add Threat") {
      return `system.skills.${mod}.threat`;
    } else if (modType === "Skill Add Triumph") {
      return `system.skills.${mod}.triumph`;
    } else if (modType === "Skill Add Upgrade") {
      return `system.skills.${mod}.upgrades`;
    } else if (modType === "Skill Boost") {
      return `system.skills.${mod}.boost`;
    } else if (modType === "Skill Decrease Difficulty") {
      return `system.skills.${mod}.decreaseDifficulty`;
    } else if (modType === "Skill Downgrade Difficulty") {
      return `system.skills.${mod}.downgradeDifficulty`;
    } else if (modType === "Skill Rank") {
      return `system.skills.${mod}.rank`;
    } else if (modType === "Skill Remove Setback") {
      return `system.skills.${mod}.remsetback`;
    } else if (modType === "Skill Setback") {
      return `system.skills.${mod}.setback`;
    } else if (modType === "Career Skill") {
      return `system.skills.${mod}.careerskill`;
    } else if (modType === "Vehicle Stat") {
      if (mod === "Shields.Fore") {
        return `system.stats.shields.fore`;
      } else if (mod === "Shields.Aft") {
        return `system.stats.shields.aft`;
      } else if (mod === "Shields.Port") {
        return `system.stats.shields.port`;
      } else if (mod === "Shields.Starboard") {
        return `system.stats.shields.starboard`;
      } else if (mod === "Vehicle.Hardpoints") {
        return `system.stats.customizationHardPoints.value`;
      } else {
        return `system.stats.${mod.toLocaleLowerCase()}.value`;
      }
    } else if (["Weapon Stat", "Armor Stat"].includes(modType) && mod === "encumbrance") {
        return `system.stats.encumbrance.value`;
    } else if (modType === "Armor Stat" && mod === "soak") {
        return `system.stats.soak.value`;
    } else {
      // TODO: this probably shouldn't be a UI notification in the released version
      CONFIG.logger.debug(`Unknown mod type: ${modType}`);
      //ui.notifications.warn(`Unknown mod type: ${modType}`);
    }
  }

  static async applyActiveEffectOnUpdate(item, formData) {
    /**
     * Given an updateObject event, update active effects on the item being updated
     * @type {*|{}}
     */
    CONFIG.logger.debug("Updating active effects on item update");
    if (!Object.keys(formData).includes("data")) {
      CONFIG.logger.debug("Bailing on update as there was no form data");
      // no changes were made, bail
      return;
    }
    // remove deleted keys
    formData = foundry.utils.deepClone(formData);
    if (Object.keys(formData.data).includes("attributes")) {
      for (const attr of Object.keys(formData.data.attributes)) {
        if (attr.startsWith("-=attr")) {
          delete formData.data.attributes[attr];
        }
      }
    }
    // Handle the free-form attributes list
    const formAttrs = foundry.utils.expandObject(formData)?.data?.attributes || {};
    const attributes = formAttrs
    const existing = item.getEmbeddedCollection("ActiveEffect");
    const toDelete = [];
    const toCreate = [];

    // first update anything inherent to the item type (such as "brawn" on "species")
    const inherentEffectName = `(inherent)`;
    const inherentEffect = existing.find(e => e.name === inherentEffectName);
    if (inherentEffect && Object.keys(formData.data).includes("attributes")) {
      for (let k of Object.keys(formData.data.attributes)) {
        if (k.startsWith("attr")) {
          // inherent effects like "brawn" on "species" only - skip user-created active effects only
          continue;
        }

        const explodedMods = ModifierHelpers.explodeMod(
          formData.data.attributes[k].modtype,
          formData.data.attributes[k].mod
        );

        for (const curMod of explodedMods) {
          const modPath = ModifierHelpers.getModKeyPath(
            curMod['modType'],
            curMod['mod']
          );
          const inherentEffectChangeIndex = inherentEffect.changes.findIndex(c => c.key === modPath);
          if (inherentEffectChangeIndex >= 0) {
            inherentEffect.changes[inherentEffectChangeIndex].value = formData.data.attributes[k].value;
          } else if (item.type === "species") {
            // A species built from scratch is created with an empty inherent effect (its
            // system.attributes are empty at creation), so the characteristic/threshold/soak
            // changes never exist to be updated. Create them here on first save instead of
            // silently dropping the value - otherwise the characteristics never apply and the
            // threshold-sync block below has no Brawn/Willpower change to read (which used to
            // throw and wipe the in-progress edits). Mirrors the create path in item-ffg.js.
            inherentEffect.changes.push({
              key: modPath,
              mode: CONST.ACTIVE_EFFECT_MODES.ADD,
              value: formData.data.attributes[k].value,
            });
          }
        }
      }
      await inherentEffect.update({changes: inherentEffect.changes});
    }
    // some inherent effects are not in the `attribute` keyspace; make sure to get them as well
    if (inherentEffect && ["gear", "weapon", "armour"].includes(item.type)) {
      const explodedMods = ModifierHelpers.explodeMod(
        "Stat",
        "Encumbrance"
      );

      for (const curMod of explodedMods) {
        const modPath = ModifierHelpers.getModKeyPath(
          curMod['modType'],
          curMod['mod']
        );
        const inherentEffectChangeIndex = inherentEffect.changes.findIndex(c => c.key === modPath);
        if (inherentEffectChangeIndex >= 0) {
          inherentEffect.changes[inherentEffectChangeIndex].value = formData.data.encumbrance.value;
        }
      }

      if (item.type === "armour") {
        let explodedMods = ModifierHelpers.explodeMod(
          "Stat",
          "Defence"
        );

        for (const curMod of explodedMods) {
          const modPath = ModifierHelpers.getModKeyPath(
            curMod['modType'],
            curMod['mod']
          );
          const inherentEffectChangeIndex = inherentEffect.changes.findIndex(c => c.key === modPath);
          if (inherentEffectChangeIndex >= 0) {
            inherentEffect.changes[inherentEffectChangeIndex].value = formData.data.defence.value;
          }
        }

        explodedMods = ModifierHelpers.explodeMod(
          "Stat",
          "Soak"
        );

        for (const curMod of explodedMods) {
          const modPath = ModifierHelpers.getModKeyPath(
            curMod['modType'],
            curMod['mod']
          );
          const inherentEffectChangeIndex = inherentEffect.changes.findIndex(c => c.key === modPath);
          if (inherentEffectChangeIndex >= 0) {
            inherentEffect.changes[inherentEffectChangeIndex].value = formData.data.soak.value;
          }
        }
      }
      await inherentEffect.update({changes: inherentEffect.changes});
    } else if (inherentEffect && ["shipattachment"].includes(item.type)) {
      const explodedMods = ModifierHelpers.explodeMod(
        "Vehicle Stat",
        "Vehicle.Hardpoints"
      );

      for (const curMod of explodedMods) {
        const modPath = ModifierHelpers.getModKeyPath(
          curMod['modType'],
          curMod['mod']
        );
        const inherentEffectChangeIndex = inherentEffect.changes.findIndex(c => c.key === modPath);
        if (inherentEffectChangeIndex >= 0) {
          // hardpoints are _spent_, not _gained_
          inherentEffect.changes[inherentEffectChangeIndex].value = formData.data.hardpoints.value * -1;
        }
      }
      await inherentEffect.update({changes: inherentEffect.changes});
    }


    // Remove attributes which are no longer used
    if (item.system?.attributes) {
      // iterate over existing attributes to remove them if they were deleted
      for (let k of Object.keys(item.system.attributes)) {
        const match = existing.find(i => i.name === k);
        if (!attributes.hasOwnProperty(k)) {
          attributes[`-=${k}`] = null;
          // delete the matching active effect
          if (match) {
            toDelete.push(match.id);
          }
        }
      }
    }

    // iterate over formdata attributes to add/update them if they were added
    if (formData.data?.attributes) {
      for (let k of Object.keys(formData.data.attributes)) {
        const match = existing.find(i => i.name === k);
        const explodedMods = ModifierHelpers.explodeMod(
          formData.data.attributes[k].modtype,
          formData.data.attributes[k].mod
        );

        const changes = [];
        for (const curMod of explodedMods) {
          changes.push({
            key: ModifierHelpers.getModKeyPath(curMod['modType'], curMod['mod']),
            mode: CONST.ACTIVE_EFFECT_MODES.ADD,
            value: formData.data.attributes[k].value,
          });
        }

        // check if an active effect exists - create it if not, update it if it does
        if (match) {
          await match.update({
            changes: changes,
          });
        } else if (k.startsWith("attr")) {
          // user-created active effects only - skip inherent effects like "brawn" on "species"
          // new entry
          toCreate.push({
            name: k,
            changes: changes,
          });
        }
      }
    }

    const existingEffects = item.getEmbeddedCollection("ActiveEffect");
    const itemEffect = existingEffects.find(i => i.name === `(inherent)`);
    if (itemEffect && item.type === "species") {
      // update the wound and strain changes to match
      const newChanges = foundry.utils.deepClone(itemEffect.changes);
      // Read Brawn/Willpower/Wounds/Strain defensively. The inherent change may be absent (a
      // species built from scratch whose inherent AE was created before any characteristics
      // existed), so fall back to the submitted form, then the stored attributes, then 0. Using
      // ?? (not ||) keeps a legitimate 0. This previously did `.find(...).value` unguarded, which
      // threw "Cannot read properties of undefined (reading 'value')" and wiped the edit.
      const newBrawn = parseInt(
        newChanges.find(ae => ae.key === "system.characteristics.Brawn.value")?.value
        ?? formData?.data?.attributes?.Brawn?.value
        ?? item.system?.attributes?.Brawn?.value,
        10
      ) || 0;
      const newWillpower = parseInt(
        newChanges.find(ae => ae.key === "system.characteristics.Willpower.value")?.value
        ?? formData?.data?.attributes?.Willpower?.value
        ?? item.system?.attributes?.Willpower?.value,
        10
      ) || 0;
      const wounds = parseInt(
        formData?.data?.attributes?.Wounds?.value ?? item.system?.attributes?.Wounds?.value,
        10
      ) || 0;
      const strain = parseInt(
        formData?.data?.attributes?.Strain?.value ?? item.system?.attributes?.Strain?.value,
        10
      ) || 0;

      for (const change of newChanges) {
        if (change.key === "system.stats.wounds.max") {
          change.value = wounds + newBrawn;
        } else if (change.key === "system.stats.strain.max") {
          change.value = strain + newWillpower;
        } else if (change.key === "system.stats.encumbrance.max") {
          change.value = newBrawn + 5;
        }
      }
      await itemEffect.update({changes: newChanges});
    }

    if (toCreate.length) {
      await item.createEmbeddedDocuments("ActiveEffect", toCreate);
    }

    if (toDelete.length) {
      await item.deleteEmbeddedDocuments("ActiveEffect", toDelete);
    }

    CONFIG.logger.debug("applyActiveEffectOnUpdate", toCreate, toDelete);
  }
}
