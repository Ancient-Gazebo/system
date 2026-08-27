import PopoutEditor from "../popout-editor.js";
import ModifierHelpers from "../helpers/modifiers.js";

/**
 * Extend the base Actor entity.
 * @extends {Actor}
 */
export class ActorFFG extends Actor {

  // returns true if EditMode is not enabled, false otherwise. sends warning notification if EditMode is enabled and sendWarn is true
  verifyEditModeIsNotEnabled(sendWarn = true){
    const result = !this.getFlag("starwarsffg", "config.enableEditMode");
    if(sendWarn && !result) {
      ui.notifications.warn("Can't do this while EditMode is enabled");
    }
      return result;
  }

  static async create(data, options) {
    const createData = data;

    // Only apply defaults for newly created actors
    if (!(typeof data.system === "undefined")) {
      return super.create(createData, options);
    }

    switch (createData.type) {
      case "minion":
        createData.prototypeToken = {
          actorLink: false,
          disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE,
          bar1: {
            attribute: "stats.wounds",
          },
        };
        break;
      case "character":
        createData.prototypeToken = {
          actorLink: true,
          disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
          bar1: {
            attribute: "stats.wounds",
          },
          bar2: {
            attribute: "stats.strain",
          },
        };
        break;
      case "rival":
        createData.prototypeToken = {
          actorLink: false,
          disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE,
          bar1: {
            attribute: "stats.wounds",
          },
          bar2: {
            attribute: "stats.strain",
          },
          prependAdjective: game.settings.get("starwarsffg", "RivalTokenPrepend"),
        };
        break;
      case "nemesis":
        createData.prototypeToken = {
          actorLink: true,
          disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE,
          bar1: {
            attribute: "stats.wounds",
          },
          bar2: {
            attribute: "stats.strain",
          },
        };
        break;
      case "vehicle":
        createData.prototypeToken = {
          actorLink: true,
          bar1: {
            attribute: "stats.hullTrauma",
          },
          bar2: {
            attribute: "stats.systemStrain",
          },
        };
        break;
    }
    return super.create(createData, options);
  }

  /** @override **/
  async _preCreate(data, operation, user) {
    const defaultImages = {
      character: "systems/starwarsffg/images/defaults/actors/character.png",
      minion: "systems/starwarsffg/images/defaults/actors/minion.png",
      nemesis: "systems/starwarsffg/images/defaults/actors/nemesis.png",
      rival: "systems/starwarsffg/images/defaults/actors/rival.png",
      vehicle: "systems/starwarsffg/images/defaults/actors/vehicle.png",
    }
    if (game.user.id === user.id && (!data?.img || data?.img === "icons/svg/mystery-man.svg")) {
      if (Object.keys(defaultImages).includes(data.type)) {
        this.updateSource({img: defaultImages[data.type]});
      } else {
        // fall back to the previous default
        this.updateSource({img: "icons/svg/mystery-man.svg"});
      }
    }
    return {data, operation, user};
  }


  /** @override
   * We use this to update wounds, strain, and soak when characteristics are changed
   * It's implemented here since Edit Mode must be enabled to make a change here, which means
   *  any modifications from Active Effects are suspended and we can do simple math
   * It's somewhat assumed that direct characteristic modifications are being done during character creation
   * Anything else should be coming from Active Effects (e.g., on a talent giving +1 Brawn)
   */
  async _preUpdate(changes, options, user) {
    /**
     * Derived attributes:
     *  Wound Threshold - Species WT + Brawn. Further increases to Brawn DO NOT increase the WT.
     *  Strain Threshold - Species ST + Willpower. Further increases to Willpower DO NOT increase the ST.
     *  Soak - Brawn. Further increases to Brawn DO increase Soak.
     *  // this might be able to be done when you submit an update to the species item - we update the values of the existing AEs
     */

    CONFIG.logger.debug(`Performing pre-update on ${this.name}`);
    this._convertEncumbranceEditToOffset(changes);
    if (["character", "rival", "nemesis"].includes(this.type)) {
      const originalBrawn = this.system.characteristics.Brawn.value;
      const updatedBrawn = changes?.system?.characteristics?.Brawn?.value;
      if (originalBrawn !== undefined && updatedBrawn !== undefined && originalBrawn !== updatedBrawn) {
        CONFIG.logger.debug(`Detected modified Brawn (${originalBrawn} -> ${updatedBrawn}, updating derived values`);
        // get the wounds without brawn modifying it, then add the new brawn value in
        // Read the persisted threshold (source), not the derived value, so derived modifiers such
        // as the Mystic Alignment effect are not baked into the new stored threshold and compounded.
        const originalWounds = this._source.system.stats?.wounds.max;
        const originalWoundsWithoutBrawn = originalWounds - originalBrawn;
        const updatedWounds = originalWoundsWithoutBrawn + parseInt(updatedBrawn);
        if (!Object.keys(changes.system).includes("stats")) {
          changes.system.stats = {};
        }
        if (changes.system.characteristics?.Brawn?.value) {
          changes.system.stats.Brawn = changes.system.characteristics.Brawn;
        }
        CONFIG.logger.debug(`The character sheet showed ${originalWounds} wounds, while that value without Brawn was ${originalWoundsWithoutBrawn}. Updating to be ${updatedWounds}`);
        changes.system.stats = foundry.utils.mergeObject(
          changes.system.stats,
          {
            wounds: {
              max: updatedWounds,
            }
          }
        );
        // repeat the above process, but for soak. Read the persisted value (source), not the derived
        // value, so derived modifiers such as Active Effects are not baked into the new stored value
        // and compounded.
        const originalSoak = this._source.system.stats?.soak.value;
        const originalSoakWithoutBrawn = originalSoak - originalBrawn;
        const updatedSoak = originalSoakWithoutBrawn + parseInt(updatedBrawn);
        CONFIG.logger.debug(`The character sheet showed ${originalSoak} soak, while that value without Brawn was ${originalSoakWithoutBrawn}. Updating to be ${updatedSoak}`);
        changes.system.stats = foundry.utils.mergeObject(
          changes.system.stats,
          {
            soak: {
              value: updatedSoak,
            }
          }
        );
        // The encumbrance threshold is NOT adjusted here: it is derived on every prepare pass as
        // 5 + Brawn (see _seedEncumbranceThreshold), so it already follows this edit and writing a
        // stored value would only leave dead data behind.
      }
      const originalWillpower = this.system.characteristics.Willpower.value;
      const updatedWillpower = changes.system?.characteristics?.Willpower?.value;
      if (originalWillpower !== undefined && updatedWillpower !== undefined && originalWillpower !== updatedWillpower) {
        CONFIG.logger.debug(`Detected modified Willpower (${originalWillpower} -> ${updatedWillpower}, updating derived values`);
        if (!Object.keys(changes.system).includes("stats")) {
          changes.system.stats = {};
        }
        if (changes.system.characteristics?.Willpower?.value) {
          changes.system.stats.Willpower = changes.system.characteristics.Willpower;
        }
        if (this.system.stats?.strain) {
          // get the strain without willpower modifying it, then add the new willpower value in.
          // Read the persisted threshold (source), not the derived value, so derived modifiers such
          // as the Mystic Alignment effect are not baked into the new stored threshold and compounded.
          const originalStrain = this._source.system.stats?.strain.max;
          const originalStrainWithoutWillpower = originalStrain - originalWillpower;
          const updatedStrain = originalStrainWithoutWillpower + updatedWillpower;
          CONFIG.logger.debug(`The character sheet showed ${originalStrain} strain, while that value without Willpower was ${originalStrainWithoutWillpower}. Updating to be ${updatedStrain}`);
          changes.system.stats = foundry.utils.mergeObject(
            changes.system.stats,
            {
              strain: {
                max: updatedStrain,
              }
            }
          );
        }
      }
    }
    await super._preUpdate(changes, options, user);
  }

  /**
   * Translate a hand-typed Current encumbrance into the manual offset that produces it.
   *
   * The Current box shows a derived total (owned items + offset), so a typed number is a statement
   * about the TOTAL, not a value to store: writing it to `system.stats.encumbrance.value` would be
   * overwritten by the next derivation pass, which is exactly why the field appeared editable on
   * rivals and nemeses but never actually held anything. Store the difference instead, and the
   * typed number survives while items keep adding and removing on top of it.
   *
   * Done here rather than in the sheet so macros and modules that write the field get the same
   * behaviour as a typed edit.
   *
   * Two guards matter:
   *  - A submit whose value already equals the derived total is a no-op resubmit (this sheet
   *    submits every field on every change), so the offset is left alone rather than recomputed.
   *  - When the derived carried total is unavailable the field is genuinely manual - the world has
   *    the soak/encumbrance calculation switched off - so the write is passed through untouched.
   *
   * @param {object} changes the pending update, mutated in place
   * @private
   */
  _convertEncumbranceEditToOffset(changes) {
    if (!ActorFFG.ENCUMBRANCE_ACTOR_TYPES.includes(this.type)) return;

    // Accept both the expanded shape a sheet submit produces and the dotted path an API caller
    // is just as likely to use.
    const dotted = "system.stats.encumbrance.value";
    let typed;
    let drop;
    if (changes?.system?.stats?.encumbrance?.value !== undefined) {
      typed = changes.system.stats.encumbrance.value;
      drop = () => delete changes.system.stats.encumbrance.value;
    } else if (changes?.[dotted] !== undefined) {
      typed = changes[dotted];
      drop = () => delete changes[dotted];
    } else {
      return;
    }

    const carried = this.system?.stats?.encumbranceCarried;
    if (!Number.isFinite(carried)) return;

    const total = parseInt(typed, 10);
    if (!Number.isFinite(total)) {
      drop();
      return;
    }
    drop();

    if (total === parseInt(this.system?.stats?.encumbrance?.value, 10)) return;

    const offset = total - carried;
    CONFIG.logger.debug(`Encumbrance typed as ${total} against ${carried} carried; storing offset ${offset}`);
    foundry.utils.setProperty(changes, "flags.starwarsffg.config.encumbranceAdjustment", offset);
  }

  /**
   * The additive per-skill dice fields. None of these is stored on a skill - they exist only as
   * Active Effect targets (the dice status effects in swffg-main.js, and the "Skill Add ..." /
   * "Skill Boost" / "Force Boost" modifier types mapped by ModifierHelpers.getModKeyPath).
   * `careerskill` is deliberately absent: it is a boolean, not a die count.
   */
  static SKILL_DICE_FIELDS = [
    "boost", "setback", "remsetback", "force",
    "upgrades", "upgradeDifficulty", "difficulty", "decreaseDifficulty",
    "downgradeAbility", "downgradeDifficulty",
    "success", "failure", "advantage", "threat", "triumph", "despair",
    "light", "dark", "damage",
  ];

  /**
   * Seed the additive per-skill dice fields with a numeric 0 before Active Effects are applied.
   *
   * prepareBaseData() runs ahead of prepareEmbeddedDocuments()/applyActiveEffects(), and because
   * none of these fields is ever stored on a skill, the first effect to touch one used to land on
   * core's `current === null` branch in ActiveEffect._applyChangeAdd, which assigns the change's
   * raw value rather than adding it. The dice statuses carry string values ("1"), so the field
   * became the STRING "1" - and a second effect on the same skill and field then hit the default
   * branch and did "1" + "1" = "11". A "Boost This Combat" status plus a talent's Skill Boost
   * modifier produced eleven boost dice instead of two, and the same held for setback, success,
   * advantage, failure, threat and the rest.
   *
   * Starting from a number makes core cast every subsequent delta to a number too, so multiple
   * sources add. Existing non-numeric values are normalised for the same reason.
   *
   * This is in-memory only: ObjectField#initialize deep-clones, so `system.skills` is detached
   * from `_source` and nothing here is ever persisted onto the actor.
   *
   * @override
   */
  prepareBaseData() {
    super.prepareBaseData();
    this._seedEncumbranceThreshold();
    const skills = this.system?.skills;
    if (!skills || typeof skills !== "object") return;
    for (const skill of Object.values(skills)) {
      if (!skill || typeof skill !== "object") continue;
      for (const field of ActorFFG.SKILL_DICE_FIELDS) {
        const value = Number(skill[field]);
        skill[field] = Number.isFinite(value) ? value : 0;
      }
    }
  }

  /**
   * Personal-scale actor types that carry an encumbrance threshold.
   */
  static ENCUMBRANCE_ACTOR_TYPES = ["character", "minion", "rival", "nemesis"];

  /**
   * The flat portion of the encumbrance threshold. Per the core rules a character can carry
   * 5 + Brawn encumbrance before becoming encumbered.
   */
  static ENCUMBRANCE_THRESHOLD_BASE = 5;

  /**
   * Seed the encumbrance threshold with its rules baseline: 5 + Brawn.
   *
   * This runs in prepareBaseData(), i.e. BEFORE applyActiveEffects(), and deliberately ignores
   * whatever `system.stats.encumbrance.max` was persisted. The threshold is fully derived, which
   * is what makes it reliable: a rival, nemesis or minion built by hand - none of which need a
   * species item - used to sit at whatever the stored value happened to be (0 for a fresh actor),
   * because the flat 5 was only ever contributed by a species' (inherent) Active Effect.
   *
   * Every source that raises Brawn also emits a matching `system.stats.encumbrance.max` change
   * (ModifierHelpers.explodeMod maps Brawn -> EncumbranceMax, and the XP-purchase path in
   * ActorSheetFFG#_spendXp does the same), so those land on top of this seed during
   * applyActiveEffects() and the total stays 5 + the fully-resolved Brawn. Standalone
   * "Threshold: Encumbrance (Max)" modifiers stack on top of that, which is the supported way to
   * hand a character a larger pack.
   *
   * Reading Brawn here gets the stored (pre-effect) value on purpose - the effect-driven portion
   * arrives via its own change - exactly as Soak is built up.
   * @private
   */
  _seedEncumbranceThreshold() {
    if (!ActorFFG.ENCUMBRANCE_ACTOR_TYPES.includes(this.type)) return;
    const encumbrance = this.system?.stats?.encumbrance;
    if (!encumbrance) return;
    const brawn = parseInt(this.system?.characteristics?.Brawn?.value, 10);
    encumbrance.max = ActorFFG.ENCUMBRANCE_THRESHOLD_BASE + (Number.isFinite(brawn) ? brawn : 0);
  }

  /**
   * Augment the basic actor data with additional dynamic data.
   */
  prepareDerivedData() {
    const actor = this;
    const data = actor.system;
    const flags = actor.flags;

    // Ensure every configured currency denomination is present (in-memory) so sheets and the
    // CurrencyManager always see a complete map, even on actors created before a denomination was
    // added or before this field existed. Persistence happens on edit; this is non-destructive.
    const currencyConfig = CONFIG.FFG?.currencies;
    if (currencyConfig && ["character", "minion", "rival", "nemesis"].includes(actor.type)) {
      if (!data.currency || typeof data.currency !== "object") data.currency = {};
      for (const key of Object.keys(currencyConfig)) {
        if (typeof data.currency[key] !== "number") data.currency[key] = Number(data.currency[key]) || 0;
      }
      // Backward compatibility: surface a legacy credits balance under the default currency until
      // the world migration runs (or for actors the migration did not touch, e.g. compendium imports).
      const defaultKey = (CONFIG.FFG.defaultCurrency in currencyConfig)
        ? CONFIG.FFG.defaultCurrency
        : Object.keys(currencyConfig)[0];
      const legacyCredits = Number(data.stats?.credits?.value) || 0;
      if (defaultKey && legacyCredits > 0 && !(data.currency[defaultKey] > 0)) {
        data.currency[defaultKey] = legacyCredits;
      }
    }

    // if the actor has skills, add custom skills
    if (data.skills) {
      let skills = JSON.parse(JSON.stringify(CONFIG.FFG.skills));

      data.skills = foundry.utils.mergeObject(skills, data.skills);

      // Filter out skills that are not custom (manually added) or part of the current system skill list
      Object.keys(data.skills)
      .filter(s => !data.skills[s].custom && !CONFIG.FFG.skills[s])
      .forEach(s => delete data.skills[s]);

      let unique = [...new Set(Object.values(data.skills).map((item) => item.type))];
      if (unique.indexOf("General") > 0) {
        const generalIndex = unique.indexOf("General");
        unique[generalIndex] = unique[0];
        unique[0] = "General";
      }
      data.skilltypes = unique.map((item) => {
        return { type: item, label: game.i18n.localize(`SWFFG.Skills${item}`) === `SWFFG.Skills${item}` ? item : game.i18n.localize(`SWFFG.Skills${item}`) };
      });
    }

    // add values for above threshold
    if (["character", "nemesis"].includes(actor.type)) {
      data.stats.woundsOverThreshold = data.stats.wounds.value - data.stats.wounds.max;
      data.stats.strainOverThreshold = data.stats.strain.value - data.stats.strain.max;
    } else if (["rival", "minion"].includes(actor.type)) {
      data.stats.woundsOverThreshold = data.stats.wounds.value - data.stats.wounds.max;
    } else if (["vehicle"].includes(actor.type)) {
      data.stats.hullOverThreshold = data.stats.hullTrauma.value - data.stats.hullTrauma.max;
      data.stats.systemStrainOverThreshold = data.stats.systemStrain.value - data.stats.systemStrain.max;
    }

    this._prepareSharedData.bind(this);
    this._prepareSharedData(actor);
    if (actor.type === "minion") this._prepareMinionData(actor);
    if (["character", "nemesis", "rival"].includes(actor.type)) {
      this._prepareCharacterData(actor);
      this._prepareSources(actor);
      this._prepareCyberneticsData(actor);
    }

    // Fold each owned weapon's governing characteristic into its derived damage. This must run
    // here, in prepareDerivedData() (after applyActiveEffects()), so it sees the fully resolved
    // characteristic - including boosts from active effects such as a dragged-on species. The
    // weapon's own prepareData() runs earlier (in prepareEmbeddedDocuments, before effects) and
    // deliberately omits the characteristic to avoid using its pre-effect value.
    if (["character", "minion", "rival", "nemesis"].includes(actor.type)) {
      this._applyCharacteristicDamage(actor);
      this._applySkillDamage(actor);
    }

    // Personal-scale defence (melee and ranged) is capped at 4 each. Armor, talents, and other
    // effects can otherwise stack a defence value above this with no upper bound. This runs last,
    // after active effects and all derived data, so it reflects the fully resolved value. Vehicles
    // use a different defence structure and are intentionally excluded.
    if (["character", "minion", "rival", "nemesis"].includes(actor.type)) {
      const defence = data.stats?.defence;
      if (defence) {
        if (parseInt(defence.melee, 10) > 4) defence.melee = 4;
        if (parseInt(defence.ranged, 10) > 4) defence.ranged = 4;
      }
    }

    // Being over the encumbrance threshold adds setback dice. Runs last, after the carried
    // encumbrance has been totalled (_prepareSharedData -> _calculateDerivedValues) and after
    // _prepareSources has built the dice-source lists this appends to.
    this._applyEncumbrancePenalty(actor);

    // Label and hover text for the Current encumbrance box. A manual offset is invisible once typed
    // - the box just shows a total - so name it in the label ("Current (+8)"). Otherwise an offset
    // set during one scene silently follows the character forever. The hint carries the words for
    // the over-threshold state; the colour (encumbranceCssClass) carries the at-a-glance signal.
    if (ActorFFG.ENCUMBRANCE_ACTOR_TYPES.includes(actor.type)) {
      const adjustment = data.stats?.encumbranceAdjustment ?? 0;
      const current = game.i18n.localize("SWFFG.Current");
      data.stats.encumbranceCurrentLabel = adjustment
        ? `${current} (${adjustment > 0 ? "+" : ""}${adjustment})`
        : current;

      const over = data.stats?.encumbranceOverThreshold ?? 0;
      const hint = [game.i18n.localize("SWFFG.EncumbranceCurrentHint")];
      if (over > 0) {
        hint.unshift(game.i18n.format(
          data.stats.encumbranceImmobilised
            ? "SWFFG.EncumbranceImmobilisedHint"
            : "SWFFG.EncumbranceOverThresholdHint",
          { over }
        ));
      }
      data.stats.encumbranceHint = hint.join(" ");
    }
  }

  /**
   * Characteristics whose checks suffer from being over-encumbered. Per the core rules the
   * penalty applies to Brawn- and Agility-based checks only.
   */
  static ENCUMBRANCE_PENALTY_CHARACTERISTICS = ["Brawn", "Agility"];

  /**
   * Carrying MORE than this many points over the encumbrance threshold immobilises a character.
   * Flagged on the sheet only; nothing here restricts movement.
   */
  static ENCUMBRANCE_IMMOBILISED_OVER = 5;

  /**
   * Apply the over-encumbrance penalty: one setback die per point of encumbrance carried above
   * the threshold, on every Brawn- and Agility-based check.
   *
   * The penalty is written straight onto the derived `system.skills.<skill>.setback`, which is the
   * single field every roll path already reads (DiceHelpers.rollSkill / rollItem / rollSkillDirect
   * and the sheet's dice-pool preview), so it needs no per-path plumbing. It is in-memory only -
   * skills live in an ObjectField that initialize() deep-clones away from `_source` - so nothing
   * here is ever persisted, and it is recomputed from scratch on every prepare pass rather than
   * accumulating.
   *
   * A matching entry is pushed onto `setbacksource` so the dice-pool tooltip names the penalty
   * instead of showing unexplained setback dice.
   *
   * This runs in prepareDerivedData(), after applyActiveEffects(), so `setback` already holds the
   * effect-driven dice and the threshold already reflects every Brawn source.
   *
   * @param {Actor} actorData
   * @private
   */
  _applyEncumbrancePenalty(actorData) {
    if (!ActorFFG.ENCUMBRANCE_ACTOR_TYPES.includes(actorData.type)) return;
    const data = actorData.system;
    const encumbrance = data?.stats?.encumbrance;
    const skills = data?.skills;
    if (!encumbrance || !skills || typeof skills !== "object") return;

    const carried = parseInt(encumbrance.value, 10);
    const threshold = parseInt(encumbrance.max, 10);
    const over = (Number.isFinite(carried) ? carried : 0) - (Number.isFinite(threshold) ? threshold : 0);

    // Exposed as derived, display-only stats alongside woundsOverThreshold/strainOverThreshold.
    // Deliberately hung off `stats` rather than the schema-backed `stats.encumbrance`, so a sheet
    // submit can never carry them into an update and have the DataModel prune them back out.
    //
    // `immobilised` is a read-out, not a rule the system enforces: past 5 over the threshold the
    // core rules immobilise a character outright, but movement, conditions and turn order stay the
    // GM's call. The sheet only says so, in the same way the cybernetics tracker reddens when the
    // installed count passes the cap (see _prepareCyberneticsData).
    data.stats.encumbranceOverThreshold = Math.max(0, over);
    data.stats.encumbranceImmobilised = over > ActorFFG.ENCUMBRANCE_IMMOBILISED_OVER;
    data.stats.encumbranceCssClass = over <= 0
      ? ""
      : (data.stats.encumbranceImmobilised ? "over-threshold immobilised" : "over-threshold");
    if (data.stats.encumbranceOverThreshold <= 0) return;

    const penalty = data.stats.encumbranceOverThreshold;
    const label = game.i18n.localize("SWFFG.Encumbrance");
    const type = game.i18n.localize("SWFFG.EncumbranceOverThreshold");
    for (const skill of Object.values(skills)) {
      if (!skill || typeof skill !== "object") continue;
      if (!ActorFFG.ENCUMBRANCE_PENALTY_CHARACTERISTICS.includes(skill.characteristic)) continue;
      const current = Number(skill.setback);
      skill.setback = (Number.isFinite(current) ? current : 0) + penalty;
      if (!Array.isArray(skill.setbacksource)) skill.setbacksource = [];
      skill.setbacksource.push({
        modtype: "Skill Setback",
        key: "encumbrance",
        name: label,
        value: penalty,
        type: type,
      });
    }
  }

  /**
   * Add each owned weapon's governing-characteristic value to its derived damage.
   *
   * Called from prepareDerivedData(), i.e. AFTER applyActiveEffects(), so the characteristic read
   * here reflects every effect-driven boost (species dragged onto the sheet, talents, cybernetics,
   * etc.). The item's prepareData() has already folded base damage, item/attachment modifiers and
   * Weapon Stat attribute mods into damage.adjusted, but leaves the characteristic out because it
   * runs before effects are applied; this pass supplies the missing piece.
   *
   * @param {Actor} actor
   */
  _applyCharacteristicDamage(actor) {
    const data = actor.system;
    for (const item of actor.items) {
      if (!["weapon", "shipweapon"].includes(item.type)) continue;
      const idata = item.system;
      if (!ModifierHelpers.shouldApplyCharacteristicToDamage(idata)) continue;
      const charValue = parseInt(data.characteristics?.[idata.characteristic.value]?.value, 10);
      if (Number.isNaN(charValue)) continue;
      idata.damage.adjusted = parseInt(idata.damage.adjusted, 10) + charValue;
    }
  }

  /**
   * Add the "Skill Damage" modifier for a weapon's governing skill to its derived damage.
   *
   * The modifier is written onto the actor as an Active Effect on `system.skills.<skill>.damage`
   * (see ModifierHelpers.getModKeyPath), so it is only resolved after applyActiveEffects() - hence
   * this runs in prepareDerivedData() alongside _applyCharacteristicDamage. Every weapon whose
   * `skill.value` matches picks the bonus up, so it applies to any weapon rolled with that skill.
   *
   * @param {Actor} actor
   */
  _applySkillDamage(actor) {
    const data = actor.system;
    for (const item of actor.items) {
      if (!["weapon", "shipweapon"].includes(item.type)) continue;
      const idata = item.system;
      const skillKey = idata.skill?.value;
      if (!skillKey) continue;
      const bonus = parseInt(data.skills?.[skillKey]?.damage, 10);
      if (Number.isNaN(bonus) || bonus === 0) continue;
      idata.damage.adjusted = parseInt(idata.damage.adjusted, 10) + bonus;
    }
  }

  _prepareSharedData(actorData) {
    const data = actorData.system;
    //data.biography = PopoutEditor.replaceRollTags(data.biography, actorData);

    // localize characteristic names
    if (actorData.type !== "vehicle" && actorData.type !== "homestead") {
      for (let characteristic of Object.keys(data.characteristics)) {
        const strId = `SWFFG.Characteristic${this._capitalize(characteristic)}`;
        const localizedField = game.i18n.localize(strId);

        data.characteristics[characteristic].label = localizedField;
      }

      //localize skill names
      for (let skill of Object.keys(data.skills)) {
        let skillLabel = CONFIG.FFG.skills?.[skill]?.label;

        if (!skillLabel) {
          // this is a one-off skill added directly to the character
          skillLabel = data.skills[skill].label;
        }

        const localizedField = game.i18n.localize(skillLabel);

        data.skills[skill].label = localizedField;
      }
    }

    // Create list of active effects changing this actor
    data.effects = actorData.effects.contents;
    actorData.items.forEach(item => {
      data.effects.push(...item.effects.contents);
    });

    if (["character", "nemesis", "rival", "minion"].includes(actorData.type)) {
      if (game.settings.get("starwarsffg", "enableSoakCalc")) {
        this._calculateDerivedValues(actorData);
      }
    } else if (["vehicle"].includes(actorData.type)) {
      this._calculateDerivedValues(actorData);
    }
  }

  /**
   * Prepare Minion type specific data
   */
  _prepareMinionData(actorData) {
    const data = actorData.system;

    // Set Wounds threshold to unit_wounds * quantity to account for minion group health.
    data.stats.wounds.max = Math.floor(data.unit_wounds.value * data.quantity.max);
    // Check we don't go below 0.
    if (data.stats.wounds.max < 0) {
      data.stats.wounds.max = 0;
    }

    //Calculate the number of alive minions
    data.quantity.value = Math.max(Math.min(data.quantity.max, data.quantity.max - Math.floor((data.stats.wounds.value - 1) / data.unit_wounds.value)), 0);

    // Loop through Skills, and where groupskill = true, set the rank to 1*(quantity-1).
    for (let [key, skill] of Object.entries(data.skills)) {
      // Check to see if this is a group skill, otherwise do nothing.
      if (skill.groupskill) {
        skill.rank = Math.floor(1 * (data.quantity.value - 1));
        // Check we don't go below 0.
        if (skill.rank < 0) {
          skill.rank = 0;
        } else if (skill.rank > 5) {
          skill.rank = 5;
        }
      } else if (!skill.groupskill) {
        skill.rank = data.skills[key].rank;
      }
    }

    // Loop through owned talent items and create the data.talentList object
    const globalTalentList = [];
    const talents = actorData.items.filter((item) => {
      return item.type === "talent";
    });
    talents.forEach((element) => {
      const item = {
        name: element.name,
        itemId: element.id,
        description: element.system?.description,
        activation: element.system.activation?.value,
        activationLabel: element.system.activation?.label,
        isRanked: element.system.ranks?.ranked,
        source: [{ type: "talent", typeLabel: "SWFFG.Talent", name: element.name, id: element.id }],
      };
      if (item.isRanked) {
        item.rank = element.system.ranks?.current;
      } else {
        item.rank = "N/A";
      }

      if (CONFIG.FFG.theme !== "starwars") {
        item.tier = parseInt(element.system.tier, 10);
      }

      let index = globalTalentList.findIndex((obj) => {
        return obj.name === item.name;
      });

      if (index < 0 || !item.isRanked) {
        globalTalentList.push(item);
      } else {
        globalTalentList[index].source.push({ type: "talent", typeLabel: "SWFFG.Talent", name: element.name, id: element.id });
        globalTalentList[index].rank += element.system.ranks?.current;
        if (CONFIG.FFG.theme !== "starwars") {
          globalTalentList[index].tier = Math.abs(globalTalentList[index].rank + (parseInt(element.system.tier, 10) - 1));
        }
      }
    });
    if (CONFIG.FFG.theme !== "starwars") {
      globalTalentList.sort((a, b) => {
        let comparison = 0;
        if (a.tier > b.tier) {
          comparison = 1;
        } else if (a.tier < b.tier) {
          comparison = -1;
        }
        return comparison;
      });
    } else {
      globalTalentList.sort((a, b) => {
        let comparison = 0;
        if (a.name > b.name) {
          comparison = 1;
        } else if (a.name < b.name) {
          comparison = -1;
        }
        return comparison;
      });
    }
    actorData.talentList = globalTalentList;
  }

  /**
   * Prepare Character type specific data
   */
  _prepareCharacterData(actorData) {
    const data = actorData;

    // Build complete talent list.

    const specializations = actorData.items.filter((item) => {
      return item.type === "specialization";
    });

    const globalTalentList = [];
    specializations.forEach((element) => {
      //go through each list of talent where learned = true

      const learnedTalents = Object.keys(element.system.talents).filter((key) => element.system.talents[key].islearned === true);

      learnedTalents.forEach((talent) => {
        const item = JSON.parse(JSON.stringify(element.system.talents[talent]));
        item.firstSpecialization = element.id;
        item.source = [{ type: "specialization", typeLabel: "SWFFG.Specialization", name: element.name, id: element.id }];
        if (item.isRanked) {
          item.rank = element.system.talents[talent]?.rank ? element.system.talents[talent].rank : 1;
        } else {
          item.rank = "N/A";
        }
        let index = item.name ? globalTalentList.findIndex((obj) => {
          return obj.name === item.name;
        }) : -1;

        if (index < 0) {
          globalTalentList.push(item);
        } else if (item.isRanked) {
          // ranked talents stack: combine their ranks and record the additional source
          globalTalentList[index].source.push({ type: "specialization", typeLabel: "SWFFG.Specialization", name: element.name, id: element.id });
          globalTalentList[index].rank += element.system.talents[talent]?.rank ? element.system.talents[talent].rank : 1;
        } else {
          // unranked talent already learned in another specialization tree (e.g. auto-purchased
          // per the FFG cross-tree rule): show it only once, but record the extra source so the
          // talent's tooltip reflects every tree it belongs to. Do NOT add ranks.
          globalTalentList[index].source.push({ type: "specialization", typeLabel: "SWFFG.Specialization", name: element.name, id: element.id });
        }
      });
    });

    const talents = actorData.items.filter((item) => {
      return item.type === "talent";
    });

    talents.forEach((element) => {
      const item = {
        name: element.name,
        itemId: element.id,
        description: element.system?.description,
        activation: element.system?.activation?.value,
        activationLabel: element.system?.activation?.label,
        isRanked: element.system?.ranks?.ranked,
        source: [{
          type: element?.flags?.starwarsffg?.fromSpecies ? "species" : "talent",
          typeLabel: element?.flags?.starwarsffg?.fromSpecies ? "SWFFG.Species" : "SWFFG.Talent",
          name: element.name,
          id: element.id,
        }],
      };

      if (item.isRanked) {
        item.rank = element.system.ranks.current;
      } else {
        item.rank = "N/A";
      }

      if (CONFIG.FFG.theme !== "starwars") {
        item.tier = parseInt(element.system?.tier, 10);
      }

      let index = globalTalentList.findIndex((obj) => {
        return obj.name === item.name;
      });

      if (index < 0 || !item.isRanked) {
        item.isDirectlyAdded = true;
        globalTalentList.push(item);
      } else {
        globalTalentList[index].isDirectlyAdded = true;
        globalTalentList[index].source.push({
          type: element?.flags?.starwarsffg?.fromSpecies ? "species" : "talent",
          typeLabel: element?.flags?.starwarsffg?.fromSpecies ? "SWFFG.Species" : "SWFFG.Talent",
          name: element.name,
          id: element.id,
        });
        globalTalentList[index].rank += element.system.ranks.current;
        if (CONFIG.FFG.theme !== "starwars") {
          globalTalentList[index].tier = Math.abs(parseInt(globalTalentList[index].rank) + (parseInt(element.system?.tier, 10) - 1));
        }
      }
    });

    if (CONFIG.FFG.theme !== "starwars") {
      globalTalentList.sort((a, b) => {
        let comparison = 0;
        if (a.tier > b.tier) {
          comparison = 1;
        } else if (a.tier < b.tier) {
          comparison = -1;
        }
        return comparison;
      });
    } else {
      globalTalentList.sort((a, b) => {
        let comparison = 0;
        if (a.name > b.name) {
          comparison = 1;
        } else if (a.name < b.name) {
          comparison = -1;
        }
        return comparison;
      });
    }

    // enable talent sorting if global to true and sheet is set to inherit or sheet is set to true.
    if ((game.settings.get("starwarsffg", "talentSorting") && (!actorData.flags?.config?.talentSorting || actorData.flags?.config?.talentSorting === "0")) || actorData.flags?.config?.talentSorting === "1") {
      data.talentList = globalTalentList.slice().reverse().sort(this._sortTalents);
    } else {
      data.talentList = globalTalentList;
    }

    if (data?.obligationlist && Object.keys(data.obligationlist).length > 0) {
      let obligation = 0;
      Object.keys(data.obligationlist).forEach((element) => {
        const item = data.obligationlist[element];

        if (parseInt(item.magnitude, 10)) {
          obligation += parseInt(item.magnitude, 10);
        }
      });
      data.obligations.value = obligation;
    }

    if (data?.dutylist && Object.keys(data.dutylist).length > 0) {
      let duty = 0;
      Object.keys(data.dutylist).forEach((element) => {
        const item = data.dutylist[element];
        if (parseInt(item.magnitude, 10)) {
          duty += parseInt(item.magnitude, 10);
        }
      });
      data.duty.value = duty;
    }
  }

  /**
   * Compute the cybernetics cap and the number of installed cybernetics for display on the
   * inventory tab. This is a derived, display-only value: it is not stored on a persisted stat
   * and is not driven by Active Effects, so it is recomputed on every prepareDerivedData pass and
   * always reflects the final, post-effect Brawn value.
   *
   * cap = Brawn + adjustment, where:
   *   Brawn      - the base cybernetics limit per the core rules (one cybernetic per point of Brawn).
   *   adjustment - a manual, signed offset stored on the actor and changed with the +/- controls on
   *                the inventory tab. This covers every source that alters the cap (species such as
   *                Droids or Ganks, implants, talents, etc.) without needing a separate modifier for
   *                each, per the GM's preference for a simple manual override.
   *
   * installed - the total quantity of EQUIPPED owned items flagged to count as a cybernetic.
   *             Carrying a cybernetic is not the same as having it implanted, so unequipped ones
   *             do not consume a slot.
   * @private
   */
  _prepareCyberneticsData(actorData) {
    const data = actorData.system;
    const items = Array.from(actorData.items);

    const brawn = parseInt(data?.characteristics?.Brawn?.value, 10);
    const base = Number.isFinite(brawn) ? brawn : 0;

    const rawAdjustment = parseInt(actorData.flags?.starwarsffg?.config?.cyberneticsCapAdjustment, 10);
    const adjustment = Number.isFinite(rawAdjustment) ? rawAdjustment : 0;

    const max = Math.max(0, base + adjustment);

    // installed: total quantity of EQUIPPED owned items flagged as cybernetics.
    //
    // An unequipped cybernetic is being carried, not implanted, so it must not consume a slot --
    // otherwise spares or loot in the pack push the character over their cap. The
    // `countsAsCybernetic` option is only offered on gear, weapon and armour (see
    // ItemSheetFFG's sheet options), and all three declare an `equippable` schema, so there is no
    // flaggable type that lacks an equip control and would be silently excluded by this.
    let installed = 0;
    for (const item of items) {
      if (!item?.flags?.starwarsffg?.config?.countsAsCybernetic) continue;
      if (!item.system?.equippable?.equipped) continue;
      const qty = parseInt(item.system?.quantity?.value, 10);
      installed += Number.isFinite(qty) ? Math.max(0, qty) : 1;
    }

    data.stats.cybernetics = {
      value: installed,
      max,
      base,
      adjustment,
      overCap: installed > max,
      // used as the CSS class on the display block so an over-cap state can be highlighted
      cssClass: installed > max ? "cybernetics over-cap" : "cybernetics",
    };
  }

  /**
   * Generate source data for dice pools - show where the dice come from
   * @param actorData - an instance of an actor
   * @private
   */
  _prepareSources(actorData) {
    // handle direct active effects - which only come from statuses
    const actorActiveEffects = actorData.getEmbeddedCollection("ActiveEffect");
    for (const effect of actorActiveEffects) {
      for (const change of effect.changes) {
        if (change.key.includes("system.skills")) {
          const skillName = change.key.split('.')[2].capitalize();
          const skillMod = change.key.split('.')[3];
          const modType = ModifierHelpers.getModTypeByModPath(change.key);
          if (!Object.keys(actorData.system.skills[skillName]).includes(`${skillMod}source`)) {
            actorData.system.skills[skillName][`${skillMod}source`] = [];
          }

          // this is an active effect modifying a skill, add the source. Scale the displayed value by
          // any Status Icon Counters stack count so the dice breakdown matches the pool (the applied
          // dice are scaled in ActiveEffectFFG#apply). XP-purchase effects carry no counter, so this
          // is a no-op for them.
          const sourceValue = effect.scaleChangeValue?.(change) ?? change.value;
          if (effect.name.startsWith("purchased-")) {
            actorData.system.skills[skillName][`${skillMod}source`].push({
              modtype: modType,
              key: "purchased",
              name: "User Action",
              value: sourceValue,
              type: "XP Purchase",
            });
          } else {
            actorData.system.skills[skillName][`${skillMod}source`].push({
              modtype: modType,
              key: "purchased",
              name: "Status Effect",
              value: sourceValue,
              type: effect.name,
            });
          }
        }
      }
    }

    // handle indirect active effects - which come from items
    for (const item of actorData.items) {
      const itemActiveEffects = item.getEmbeddedCollection("ActiveEffect");
      for (const effect of itemActiveEffects) {
        if (!effect.disabled) {
          for (const change of effect.changes) {
            if (change.key.includes("system.skills")) {
              // system.skills.Astrogation.value
              const skillName = change.key.split('.')[2].capitalize();
              const skillMod = change.key.split('.')[3];
              const modType = ModifierHelpers.getModTypeByModPath(change.key);
              if (Object.keys(actorData.system.skills).includes(skillName)) {
                if (!Object.keys(actorData.system.skills[skillName]).includes(`${skillMod}source`)) {
                  actorData.system.skills[skillName][`${skillMod}source`] = [];
                }

                // this is an active effect modifying a skill, add the source. Scale it the same
                // way the applied change is scaled (ranked talent Item rank, learned-box count of
                // a ranked tree talent, status stack count), or the dice breakdown reports one
                // rank's worth while the pool gets all of them.
                actorData.system.skills[skillName][`${skillMod}source`].push({
                  modtype: modType,
                  key: "purchased",
                  name: effect.parent.type,
                  value: effect.scaleChangeValue?.(change) ?? change.value,
                  type: effect.parent.name,
                });
              }
            }
          }
        }
      }
    }
  }

  _calculateDerivedValues(actorData) {
    const data = actorData.system;
    const items = actorData.items;
    var encum = 0;

    // Loop through all items
    items.forEach(function(item) {
      try {
        // Calculate encumbrance, only if encumbrance value exists
        if (item.system?.encumbrance?.adjusted !== undefined || item.system?.encumbrance?.value !== undefined) {
          if (item.type === "armour" && item?.system?.equippable?.equipped) {
            const equippedEncumbrance = +item.system.encumbrance.adjusted - 3;
            encum += equippedEncumbrance > 0 ? equippedEncumbrance : 0;
          } else if (item.type === "armour" || item.type === "weapon" || item.type === "shipweapon") {
            let count = 0;
            if (item.system?.quantity?.value) {
              count = item.system.quantity.value;
            }
            encum += ((item.system?.encumbrance?.adjusted !== undefined) ? item.system?.encumbrance?.adjusted : item.system?.encumbrance?.value) * count;
          } else {
            // Gear contributes to carried encumbrance only while equipped; unequipped
            // gear is treated as set aside (mirrors how its modifiers are suspended).
            // Vehicles have no equip UI on cargo, so their gear is unaffected.
            if (item.type === "gear" && actorData.type !== "vehicle" && !item?.system?.equippable?.equipped) {
              return;
            }
            let count = 0;
            if (item.system?.quantity?.value) {
              count = item.system.quantity.value;
            }
            encum += item.system?.encumbrance?.value * count;
          }
        }
      } catch (err) {
        CONFIG.logger.error(`Error calculating derived Encumbrance`, err);
      }
    });

    // Split the carried total into its two parts and expose both.
    //
    // `encumbranceCarried` is what the owned items add up to. `encumbranceAdjustment` is a signed
    // manual offset: the load a character is carrying that no item on their sheet represents - an
    // unconscious ally over the shoulder, a crate they just grabbed, a mid-scene ruling. Without it
    // the Current box would be unusable at the table, because a fully derived number can only ever
    // describe things that were first entered as items.
    //
    // Both are hung off `stats` rather than the schema-backed `stats.encumbrance`, so a sheet submit
    // can never carry them into an update for the DataModel to prune back out. The offset itself is
    // stored as a flag (like the cybernetics cap adjustment) for the same reason.
    const rawAdjustment = parseInt(actorData.flags?.starwarsffg?.config?.encumbranceAdjustment, 10);
    const adjustment = Number.isFinite(rawAdjustment) ? rawAdjustment : 0;
    data.stats.encumbranceCarried = encum;
    data.stats.encumbranceAdjustment = adjustment;

    // Set Encumbrance value on character.
    data.stats.encumbrance.value = encum + adjustment;
  }

  /**
   * Capitalize string
   * @param  {String} s   String value to capitalize
   */
  _capitalize(s) {
    if (typeof s !== "string") return "";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // group talents
  _sortTalents(a, b) {
    /*
        Active (Out)
        Active (Maneuver)
        Active (Incidental)
        Active
        Passive
    */
    if (a.activation.includes("Active") && a.activation.includes("Out")) {
      return -1;
    } else if (b.activation.includes("Active") && b.activation.includes("Out")) {
      return 1;
    }
    if (a.activation.includes("Active") && a.activation.includes("Maneuver")) {
      return -1;
    } else if (b.activation.includes("Active") && b.activation.includes("Maneuver")) {
      return 1;
    }
    if (a.activation.includes("Active") && a.activation.includes("Incidental")) {
      return -1;
    } else if (b.activation.includes("Active") && b.activation.includes("Incidental")) {
      return 1;
    }
    if (a.activation.includes("Active") && a.activation.includes("Incidental")) {
      return -1;
    } else if (b.activation.includes("Active") && b.activation.includes("Incidental")) {
      return 1;
    }
    if (a.activation.includes("Active")) {
      return -1;
    } else if (b.activation.includes("Active")) {
      return 1;
    }
    if (a.activation.includes("Passive")) {
      return -1;
    } else if (b.activation.includes("Passive")) {
      return 1;
    }
  }

  /** @override **/
  /*
    This function is identical to the overridden function except that it does not enforce a maximum value for the update
  */
  async modifyTokenAttribute(attribute, value, isDelta, isBar) {
    const attr = foundry.utils.getProperty(this.system, attribute);
    const current = isBar ? attr.value : attr;
    const update = isDelta ? current + value : value;
    if ( update === current ) return this;

    // Determine the updates to make to the actor data
    let updates;
    if (isBar && ["stats.wounds", "stats.strain", "stats.hullTrauma", "stats.systemStrain"].includes(attribute)) {
      updates = {[`system.${attribute}.value`]: Math.max(update, 0)};
    } else if (isBar) {
      updates = {[`system.${attribute}.value`]: Math.clamp(update, 0, attr.max)};
    } else {
      updates = {[`system.${attribute}`]: update};
    }

    // Allow a hook to override these changes
    const allowed = Hooks.call("modifyTokenAttribute", {attribute, value, isDelta, isBar}, updates);
    return allowed !== false ? this.update(updates) : this;
  }

  /** @override **/
  applyActiveEffects(...args) {
    // V14 made Actor#applyActiveEffects phase-based: core calls it with a string phase
    // identifier and warns (removal in V16) when super is called without it. Forward
    // whatever core passed (V13 passes nothing, V14 passes the phase). The pre-super
    // mutations below are idempotent - they re-derive from live values each call - so
    // V14 invoking this once per phase is safe.
    // collect force pool modifications since it appears the stat value is without AEs active
    // Only count effects that will actually be applied. allApplicableEffects() also yields
    // inactive (disabled/suppressed) effects, and core applyActiveEffects() skips those. If we
    // counted them here we would inflate maxForceRating relative to the real forcePool.max -
    // e.g. a Force User specialization's not-yet-learned Force Rating talent has a disabled
    // forcePool.max effect, which would grant a phantom Force die to Force Boost skills (visible
    // when rolling and on the skills tab) without ever showing up in the Force Pool Maximum.
    let maxForceRating = parseInt(this.system?.stats?.forcePool?.max);
    for (const effect of this.allApplicableEffects()) {
      if (!effect.active) continue;
      for (const change of effect.changes) {
        if (change.key === "system.stats.forcePool.max") {
          maxForceRating += parseInt(change.value);
        }
      }
    }
    // apply the resulting value (minus any committed dice)
    for (const effect of this.allApplicableEffects()) {
      if (!effect.active) continue;
      for (const change of effect.changes) {
        if (change.key.includes("system.skills") && change.key.includes(".force")) {
          change.value = Math.max(maxForceRating - parseInt(this.system?.stats?.forcePool?.value), 0);
        }
      }
    }
    return super.applyActiveEffects(...args);
  }
}
