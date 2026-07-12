import {DicePoolFFG, RollFFG} from "./dice-pool-ffg.js";
import PopoutEditor from "./popout-editor.js";

/**
 * Extend the base Combat entity.
 * @extends {Combat}
 * Note: slot claiming is in the following format:
 * {
 *   <round>: {
 *     <turnCombatantId>:<claimantCombatantId>,
 *   }
 * }
 *
 * for example, if we had two combatants:
 * combatant "hello" - ID 111
 * combatant "world" - ID 222
 * and "hello" claimed "world's" slot for round one, the structure would look like this:
 * {
 *   1: {
 *     222: 111,
 *   }
 * }
 * and the UI would show "hello" as the sole claimant for this round (the other slot would say "claim this slot")
 */
export class CombatFFG extends Combat {
  /**
   * Adds a generic slot to the combat (via a flag)
   * @param round - INT - the round to add the slot to
   * @param disposition - INT - the disposition of the slot
   * @param initiative - FLOAT - the initiative value of the slot
   * @returns {Promise<void>}
   */
  async addExtraSlot(round, disposition, initiative) {
    const data = {
      name: "__GENERIC_SLOT__",
      disposition: disposition,
      combatantId: foundry.utils.randomID(),
      hidden: false,
      visible: true,
      initiative: initiative,
      flags: {
        fake: true,
        disposition: disposition,
      },
    };

    const createdSlotId = (await this.createEmbeddedDocuments("Combatant", [data]))[0].id;
    const createdSlot = this.combatants.get(createdSlotId);
    await createdSlot.setFlag("starwarsffg", "fake", true);
    await createdSlot.setFlag("starwarsffg", "disposition", disposition);
    return createdSlotId;
  }

  /**
   * Adds a slot to the combat with a specific combatant ID
   * @param disposition - disposition to create the combatant with
   * @param initiative - initiative to create the combatant with
   * @param actorId - the ID of the existing actor to assign to the combatant
   * @param tokenId - the ID of the existing token to assign to the combatant
   * @param sceneId - the ID of the existing scene to assign to the combatant
   * @param claimantName - the name of the claimant to assign to the combatant
   * @returns {Promise<void>}
   */
  async addIDedExtraSlot(disposition, initiative, actorId, tokenId, sceneId, claimantName) {
    const data = {
      name: claimantName,
      disposition: disposition,
      actorId: actorId,
      tokenId: tokenId,
      sceneId: sceneId,
      hidden: false,
      visible: true,
      initiative: initiative,
    };

    const createdSlotId = (await this.createEmbeddedDocuments("Combatant", [data]))[0].id;
    return createdSlotId;
  }

  /**
   * Handler for clicking the "add extra slot" button. Creates a dialog to get the slot details,
   * then calls the function to create the slot
   * @returns {Promise<void>}
   */
  async addInitiativeSlot() {
    // ask the user which disposition and initiative they would like, so we can add a generic slot

    let slotDialog = new Dialog({
      title: game.i18n.localize("SWFFG.Combats.Slots.Dialog.Title"),
      content: `
        <p>${game.i18n.localize("SWFFG.Combats.Slots.Dialog.Labels.Initiative")} :</p>
        <input type="number" id="initiative" name="initiative" value="0">
        <p>${game.i18n.localize("SWFFG.Combats.Slots.Dialog.Labels.Disposition")}:</p>
        <label><input type="radio" id="friendly" name="disposition" value="friendly">${game.i18n.localize("SWFFG.Combats.Slots.Dialog.Labels.Friendly")}</label>
        <label><input type="radio" id="neutral" name="disposition" value="neutral">${game.i18n.localize("SWFFG.Combats.Slots.Dialog.Labels.Neutral")}</label>
        <label><input type="radio" id="enemy" name="disposition" value="enemy">${game.i18n.localize("SWFFG.Combats.Slots.Dialog.Labels.Enemy")}</label>
      `,
      buttons: {
        submit: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("SWFFG.Combats.Slots.Dialog.Labels.Submit"),
          callback: async (obj, event) => {
            const jObj = $(obj);
            let disposition = undefined;
            if (jObj.find("#friendly")[0].checked) {
              disposition = CONST.TOKEN_DISPOSITIONS["FRIENDLY"];
            } else if (jObj.find("#neutral")[0].checked) {
              disposition = CONST.TOKEN_DISPOSITIONS["NEUTRAL"];
            } else if (jObj.find("#enemy")[0].checked) {
              disposition = CONST.TOKEN_DISPOSITIONS["HOSTILE"];
            }
            if (disposition === undefined) {
              ui.notifications.warn("You must select a disposition");
              return;
            }
            const initiative = jObj.find("#initiative")[0].value;
            if (initiative === "") {
              ui.notifications.warn("You must provide an initiative value");
              return;
            }
            this.debounceRender();
            await this.addExtraSlot(this.round, disposition, parseInt(initiative));
            this.setupTurns();
            game.socket.emit("system.starwarsffg", {event: "trackerRender", combatId: this.id});
          }
        }
      },
      default: "submit",
    });
    slotDialog.render(true);
  }

  debounceRender = foundry.utils.debounce(() => {
    if (ui.combat.viewed === this) {
      ui.combat.render();
    }
  }, 200);

  /**
   * Capture the turn pointer state prior to "slot surgery" (deleting and/or re-creating combatant
   * documents). Foundry core adjusts `turn` whenever combatants are deleted - advancing to the next
   * survivor when the currently-active document is removed - which is wrong for the generic-slot
   * tracker: the acting position in the initiative order should not move just because a slot was
   * removed or backfilled. Pair with _restoreTurnPosition().
   * @returns {{turn: number|null, combatantId: string|null}}
   */
  _captureTurnPosition() {
    return {
      turn: this.turn,
      combatantId: this.combatant?.id ?? null,
      // snapshot of the pre-surgery turn order (combatant ids). Used by _restoreTurnPosition to snap
      // to the nearest surviving neighbor when the acting slot itself is deleted, instead of reusing
      // a now-meaningless numeric index.
      order: this.turns?.map((t) => t.id) ?? [],
    };
  }

  /**
   * Restore the turn pointer after slot surgery. Resolution priority:
   *   1 - the previously-current combatant document, if it survived
   *   2 - an explicitly provided replacement slot (the slot re-created in place of a deleted
   *       current slot, carrying the same initiative)
   *   3 - the same numeric index, clamped to the new turn count
   * @param {{turn: number|null, combatantId: string|null}} prior - from _captureTurnPosition()
   * @param {string|null} replacementId - slot created to replace the deleted current slot, if any
   * @returns {Promise<void>}
   */
  async _restoreTurnPosition(prior, replacementId = null) {
    if (!this.started || prior?.turn === null || prior?.turn === undefined) return;
    let newTurn;
    if (prior.combatantId && this.turns.some((t) => t.id === prior.combatantId)) {
      // the acting combatant survived the surgery - follow it to its new index
      newTurn = this.turns.findIndex((t) => t.id === prior.combatantId);
    } else if (replacementId && this.turns.some((t) => t.id === replacementId)) {
      // an explicit replacement slot was created in place of the deleted acting slot
      newTurn = this.turns.findIndex((t) => t.id === replacementId);
    } else {
      // The acting combatant was deleted with no replacement. Snap to the nearest surviving
      // combatant from the pre-surgery order - walking forward from the old position first (the
      // "next" combatant, matching how core advances a turn when the current one is removed), then
      // backward. Reusing the raw numeric index here was the bug: after a slot is deleted and the
      // remaining combatants are re-sorted by initiative, prior.turn can land on an unrelated slot
      // on the other side of the tracker (e.g. a friendly claim slot), making the active turn
      // appear to jump far down the list.
      newTurn = -1;
      const order = prior.order ?? [];
      for (let i = prior.turn + 1; i < order.length; i++) {
        const idx = this.turns.findIndex((t) => t.id === order[i]);
        if (idx >= 0) { newTurn = idx; break; }
      }
      if (newTurn < 0) {
        for (let i = prior.turn - 1; i >= 0; i--) {
          const idx = this.turns.findIndex((t) => t.id === order[i]);
          if (idx >= 0) { newTurn = idx; break; }
        }
      }
      // nothing from the old order survived (should not happen) - clamp as a last resort
      if (newTurn < 0) newTurn = Math.min(prior.turn, Math.max(this.turns.length - 1, 0));
    }
    if (newTurn >= 0 && newTurn !== this.turn) {
      // turnEvents: false prevents this pointer correction from firing start/end-of-turn logic
      await this.update({ turn: newTurn }, { turnEvents: false });
    }
  }

  /** @override */
  async _getInitiativeRoll(combatant, formula) {
    const cData = foundry.utils.duplicate(combatant.actor.system);

    if (combatant.actor.type === "vehicle") {
      return new RollFFG("0");
    }

    if (formula === "Vigilance") {
      formula = _getInitiativeFormula(cData.skills.Vigilance, parseInt(cData.characteristics.Willpower.value));
    } else if (formula === "Cool") {
      formula = _getInitiativeFormula(cData.skills.Cool, parseInt(cData.characteristics.Presence.value));
    }

    const rollData = combatant.actor ? combatant.actor.getRollData() : {};

    let roll = await new RollFFG(formula, rollData).roll();

    const total = roll.ffg.success + roll.ffg.advantage * 0.01;
    roll._result = total;
    roll._total = total;

    return roll;
  }

  /** @override */
  _getInitiativeFormula(combatant) {
    return CONFIG.Combat.initiative.formula || game.system.initiative;
  }

  /** @override */
  async rollInitiative(ids, { formula = null, updateTurn = true, messageOptions = {} } = {}) {
    let initiative = this;

    // Normalize `ids` to an array and bail out early if there is nothing to roll.
    // Core Foundry's rollNPC()/rollAll() pass an empty array once every eligible
    // combatant already has an initiative value (e.g. when the button is clicked a
    // second time). Without this guard, the lookup below dereferences `.tokenId`
    // on `undefined` and throws an uncaught TypeError, which also breaks the
    // combat-tracker control until a new combat is started.
    ids = typeof ids === "string" ? [ids] : (Array.isArray(ids) ? ids : []);
    if (!ids.length) {
      CONFIG.logger.debug("rollInitiative called with no combatants to roll; nothing to do.");
      ui.notifications?.info("No combatants remaining to roll initiative for.");
      return this;
    }

    let promise = new Promise(async function (resolve, reject) {
      const id = foundry.utils.randomID();

      let whosInitiative = initiative.combatant?.name;
      let dicePools = [];
      let vigilanceDicePool = new DicePoolFFG({});
      let coolDicePool = new DicePoolFFG({});
      let addDicePool = new DicePoolFFG({});

      const defaultInitiativeFormula = formula || initiative._getInitiativeFormula();
      if (Array.isArray(ids) && ids.length > 1) {
        whosInitiative = "Multiple Combatants";
      } else {
        // Make sure we are dealing with an array of ids
        ids = typeof ids === "string" ? [ids] : ids;
        const c = initiative.getCombatantByToken(
            initiative.combatants.map(combatant => combatant)
            .filter(combatantData => combatantData._id == ids[0])[0]
            .tokenId);
        //const data = c.actor.system;
        const data = _findActorForInitiative(c);
        whosInitiative = c.actor.name;

        vigilanceDicePool = _buildInitiativePool(data, "Vigilance");
        coolDicePool = _buildInitiativePool(data, "Cool");

        const initSkills = Object.keys(data.skills).filter((skill) => data.skills[skill].useForInitiative);

        initSkills.forEach((skill) => {
          if (dicePools.find((p) => p.name === skill)) return;

          const skillPool = _buildInitiativePool(data, skill);
          skillPool.label = data.skills[skill].label;
          skillPool.name = skill;
          dicePools.push(skillPool);
        });
      }

      if (dicePools.findIndex((p) => p.name === "Vigilance") < 0) {
        vigilanceDicePool.label = "SWFFG.SkillsNameVigilance";
        vigilanceDicePool.name = "Vigilance";
        dicePools.push(vigilanceDicePool);
      }
      if (dicePools.findIndex((p) => p.name === "Cool") < 0) {
        coolDicePool.label = "SWFFG.SkillsNameCool";
        coolDicePool.name = "Cool";
        dicePools.push(coolDicePool);
      }

      const diceSymbols = {
        advantage: await foundry.applications.ux.TextEditor.enrichHTML("[AD]"),
        success: await foundry.applications.ux.TextEditor.enrichHTML("[SU]"),
        threat: await foundry.applications.ux.TextEditor.enrichHTML("[TH]"),
        failure: await foundry.applications.ux.TextEditor.enrichHTML("[FA]"),
        upgrade: await foundry.applications.ux.TextEditor.enrichHTML("[PR]"),
        force: await foundry.applications.ux.TextEditor.enrichHTML("[FO]"),
      };

      const title = game.i18n.localize("SWFFG.InitiativeRoll") + ` ${whosInitiative}...`;
      const content = await foundry.applications.handlebars.renderTemplate("systems/starwarsffg/templates/dialogs/ffg-initiative.html", {
        id,
        dicePools,
        addDicePool,
        defaultInitiativeFormula,
        diceSymbols,
      });

      new Dialog({
        title,
        content,
        buttons: {
          one: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("SWFFG.InitiativeRoll"),
            callback: async () => {
              const container = document.getElementById(id);
              const currentId = initiative.combatant?.id;

              const baseFormulaType = container.querySelector('input[name="skill"]:checked').value;

              // Iterate over Combatants, performing an initiative roll for each
              const [updates, messages] = await ids.reduce(
                async (results, id, i) => {
                  let [updates, messages] = await results;
                  // Get Combatant data
                  const c = initiative.getCombatantByToken(
                    initiative.combatants.map(combatant => combatant)
                    .filter(combatantData => combatantData._id == id)[0]
                    .tokenId);
                  // Skip combatants the current user can't roll for, but keep processing the rest
                  // of the batch. Returning the accumulator unchanged (as the success path does) is
                  // required: returning resolve()'s value here would feed `undefined` into the next
                  // iteration and throw a TypeError, aborting initiative for every later combatant.
                  if (!c || !c.isOwner) return results;

                  // Detemine Formula
                  const data = _findActorForInitiative(c);
                  let pool = _buildInitiativePool(data, baseFormulaType);

                  const addPool = DicePoolFFG.fromContainer(container.querySelector(`.addDicePool`));
                  pool.success += +addPool.success;
                  pool.advantage += +addPool.advantage;
                  pool.failure += +addPool.failure;
                  pool.threat += +addPool.threat;
                  pool.boost += +addPool.boost;
                  pool.setback += +addPool.setback;
                  pool.force = +addPool.force;
                  pool.upgrade(addPool.upgrades)

                  const rollData = c.actor ? c.actor.getRollData() : {};
                  let roll = await new RollFFG(pool.renderDiceExpression(), rollData, { success: pool.success, advantage: pool.advantage, failure: pool.failure, threat: pool.threat }).roll();
                  const total = roll.ffg.success + roll.ffg.advantage * 0.01;
                  roll._result = total;
                  roll._total = total;

                  // Roll initiative
                  updates.push({ _id: id, initiative: roll.total });

                  // Determine the roll mode
                  let rollMode = messageOptions.rollMode || game.settings.get("core", "rollMode");
                  if ((c.token.hidden || c.hidden) && rollMode === "roll") rollMode = "gmroll";

                  // Construct chat message data
                  let messageData = foundry.utils.mergeObject(
                    {
                      speaker: {
                        scene: canvas.scene.id,
                        actor: c.actor ? c.actor.id : null,
                        token: c.token.id,
                        alias: c.token.name,
                      },
                      flavor: `${c.token.name} ${game.i18n.localize("SWFFG.InitiativeRoll")} (${game.i18n.localize(`SWFFG.SkillsName${baseFormulaType.replace(/[: ]/g, "")}`)})`,
                      flags: { "core.initiativeRoll": true },
                    },
                    messageOptions
                  );
                  const chatData = await roll.toMessage(messageData, { create: false, rollMode });

                  // Play 1 sound for the whole rolled set
                  if (i > 0) chatData.sound = null;
                  messages.push(chatData);

                  // Return the Roll and the chat data
                  return results;
                },
                [[], []]
              );
              if (!updates.length) {
                // Nothing was rolled (e.g. the user owned none of the selected combatants).
                // Resolve the outer promise so the caller's await doesn't hang.
                resolve(initiative);
                return;
              }

              // Update multiple combatants
              await initiative.updateEmbeddedDocuments("Combatant", updates);

              // Ensure the turn order remains with the same combatant if there was one active
              if (updateTurn && !!currentId) {
                await initiative.update({ turn: initiative.turns.findIndex((t) => t.id === currentId) });
              }

              // Refresh the custom tracker so freshly-rolled initiative values appear right away.
              // The slot-based tracker derives its displayed values in prepareDerivedData()/setupTurns(),
              // and unlike every other mutating method this one never re-rendered it. The only render
              // trigger above is the turn update, which is skipped before combat starts (no active
              // combatant -> currentId is undefined), so rolled initiative used to stay invisible until
              // "Begin Combat" forced a re-render. Rebuild turns, re-render locally (debounced), and tell
              // other clients to do the same.
              initiative.setupTurns();
              initiative.debounceRender();
              game.socket.emit("system.starwarsffg", { event: "trackerRender", combatId: initiative.id });

              // Create multiple chat messages
              await CONFIG.ChatMessage.documentClass.create(messages);

              resolve(initiative);
            },
          },
          two: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("SWFFG.Cancel"),
          },
        },
      }).render(true);
    });

    return await promise;
  }

  /**
   * Given an original combatant's ID, look up claims for that slot
   * Note: this is a key lookup
   * @param round - INT - the round
   * @param slot_id - STRING - the ID of the native combatant for this turn
   * @returns {undefined|*}
   */
  getSlotClaims(round, slot_id) {
    const claims = this.getFlag('starwarsffg', 'combatClaims') || undefined;
    if (!claims) {
      return undefined;
    }
    return claims[round]?.[slot_id];
  }

  /**
   * Given a claimant's ID, look up the slot they've claimed
   * Note: This is a search-by-value
   * @param round - INT - the round
   * @param combatantId - STRING - the ID of the native combatant for this turn
   * @returns {string|undefined} - an array of
   */
  findSlotClaims(round, combatantId) {
    const claims = this.getFlag('starwarsffg', 'combatClaims') || undefined;
    if (!claims) {
      return undefined;
    }
    const roundClaims = claims[round];
    try {
      return Object.keys(roundClaims).find(key => roundClaims[key] === combatantId) || undefined;
    } catch (error) {
      // we get an exception if there have been no claims in the round yet
      return undefined;
    }
  }

  /**
   * gets any existing initiative claims for this round of a given combat
   * @param round - INT - the round
   * @returns {*|*[]} - a list of combatant IDs (NOT token IDs, NOT actor IDs)
   */
  getClaims(round) {
    const combatClaims = this.getFlag('starwarsffg', 'combatClaims');
    if (combatClaims) {
      return combatClaims[round] || [];
    }
    return [];
  }

  /**
   * Check if a given combatant has any claims in the current combat round
   * @param combatantId - STRING - the combatant ID (NOT token ID, NOT actor ID)
   * @returns {boolean|string} - false if no claims, otherwise the round of the claimant
   */
  hasClaims(combatantId) {
    const claims = this.getClaims(this.round);
    if (!claims) {
      return false;
    }
    if (Object.values(claims).includes(combatantId)) {
      return Object.keys(claims).find(key => claims[key] === combatantId);
    } else {
      return false;
    }
  }

  async handleCombatantRemoval(combatant, options, userId) {
    const claimedSlot = this.findSlotClaims(this.round, combatant.id);
    if (!combatant.combat.started) {
      // the combat hasn't started, remove the actual initiative slot. return here - falling
      // through would run doRemoval() on the already-deleted combatant and throw
      return await this.removeCombatantOnly(combatant.id);
    }

    let action = game.settings.get("starwarsffg", "removeCombatantAction")
    if (action === "prompt") {
      new Dialog({
        title: game.i18n.localize("SWFFG.CombatantRemoval.Title"),
        content: game.i18n.localize("SWFFG.CombatantRemoval.Body"),
        buttons: {
          one: {
            label: game.i18n.localize("SWFFG.CombatantRemoval.CombatantOnly"),
            callback: async () => {
              await this.doRemoval(combatant, "combatant_only");
            },
          },
          two: {
            label: game.i18n.localize("SWFFG.CombatantRemoval.LastSlot"),
            callback: async () => {
              await this.doRemoval(combatant, "last_slot");
            },
          },
          three: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("SWFFG.Cancel"),
          },
        },
      }).render(true);
    } else {
      await this.doRemoval(combatant, action);
    }
  }

  async doRemoval(combatant, action) {
    switch (action) {
      case "combatant_only": {
        await this.removeCombatantOnly(combatant.id);
        break;
      }
      case "last_slot": {
        await this.removeLastSlot(combatant.id);
        break;
      }
    }
  }

  async handleCombatantAddition(combatant, context, options, combatantI) {
    // there may be cases when this is needed, but for now, we don't need to do anything
    // (leaving as a placeholder until we know for sure)
  }

  async removeCombatantOnly(combatantId) {
    CONFIG.logger.debug("Removing combatant from combat");
    const round = this.round;
    const combatant = this.combatants.get(combatantId);
    const disposition = combatant.disposition;
    const initiative = combatant.initiative;
    CONFIG.logger.debug(`Initial information: combatantId - ${combatantId}, combatantName - ${combatant.name}`);

    const originalCombatantId = $('.combatant.actor[data-combatant-id="' + combatant.id + '"]').data('alt-id');

    // record where the turn pointer is before core's delete handling moves it
    const priorTurn = this._captureTurnPosition();
    // find if the combatant has any slots claimed
    const claimedSlot = this.getSlotClaims(round, originalCombatantId);
    // prevent constant re-rendering of the tracker
    this.debounceRender();
    if (claimedSlot) {
      // un-claim the slot
      CONFIG.logger.debug("Someone claimed the actors slot, un-claiming it");
      await this.unclaimSlot(round, originalCombatantId);
    }
    await this.unclaimSlot(round, combatantId);
    // now delete the toRemoveCombatantId slot
    Hooks.off("preDeleteCombatant", CONFIG.FFG.preCombatDelete);
    CONFIG.FFG.preCombatDelete = undefined;
    await this.combatants.get(combatantId).delete();
    if (CONFIG.FFG.preCombatDelete === undefined) {
      CONFIG.FFG.preCombatDelete = Hooks.on("preDeleteCombatant", registerHandleCombatantRemoval);
    }
    // now create a new slot to replace it
    // NOTE: declared outside the block - it was previously `const` inside the `if`, which made the
    // re-claim below throw a ReferenceError whenever the replaced slot had a claim on it
    let replacementTurnId;
    if (combatant.combat.started) {
      CONFIG.logger.debug("Re-creating the slot with the same disposition and initiative");
      replacementTurnId = await this.addExtraSlot(round, disposition, initiative);
    }

    // if there was a claim on the slot replaced, add it back
    if (claimedSlot && claimedSlot !== combatantId && replacementTurnId) {
      CONFIG.logger.debug(`Since this slot was originally claimed by ${claimedSlot}, we are re-claiming it for them`);
      await this.claimSlot(round, replacementTurnId, claimedSlot);
    }
    // re-render the tracker / re-order the turns
    CONFIG.logger.debug("Re-rendering the tracker and emitting a socket event for other clients");
    // force re-checking slots before reordering
    this.prepareDerivedData();
    this.setupTurns();
    // core advances the turn pointer when the current document is deleted; since the slot was
    // re-created in place, put the pointer back where it was (bug: removal skipped a slot)
    await this._restoreTurnPosition(priorTurn, replacementTurnId);
    // emit a socket event
    game.socket.emit("system.starwarsffg", {event: "trackerRender", combatId: this.id});
  }

  async removeLastSlot(combatantId) {
    CONFIG.logger.debug("Removing last slot of combat...");
    const round = this.round;

    /*
      Steps
        1 - Gather information about the actor being removed
        2 - Gather information about the last slot (of the same disposition)
        3 - Check if the results of steps 1 and 2 are the same or not. if they are different, proceed to step 4a. otherwise, go to 4b
        4a - Locate, record, and remove any claims on the slot of the actor being removed
        5 - Locate, record, and remove any claims on the last slot
        6 - Delete the actor being removed from the combat
        7 - Add a new slot with the last slot data (except Initiative, which is copied from the slot being removed)
        8 - Delete the last slot
        9 - Re-claim slots as needed
        4b - Delete the actor being removed; no further steps are needed
    */

    // Step 1 - Gather information about the actor being removed
    const removedCombatant = this.combatants.get(combatantId);
    let removedCombatantId = removedCombatant.id;
    const removedDisposition = removedCombatant.disposition;
    const removedInitiative = removedCombatant.initiative;

    // Step 2 - Gather information about the last slot (of the same disposition)
    let lowestInitiativeValue;
    let lastSlotId;
    for (const combatant of this.combatants) {
      if (combatant.disposition === removedDisposition) {
        if (!lowestInitiativeValue || combatant.initiative < lowestInitiativeValue) {
          lowestInitiativeValue = combatant.initiative;
          lastSlotId = combatant.id;
        }
      }
    }
    const lastSlotCombatant = this.combatants.get(lastSlotId);
    const lastSlotCombatantId = lastSlotId;
    const lastSlotActorId = lastSlotCombatant.actorId;
    const lastSlotSceneId = lastSlotCombatant.sceneId;
    const lastSlotTokenId = lastSlotCombatant.tokenId;
    const lastSlotName = lastSlotCombatant.name;
    let lastSlotActorClaimedRemovedCombatant;

    // record where the turn pointer is before core's delete handling moves it
    const priorTurn = this._captureTurnPosition();
    // prevent constant re-rendering of the tracker
    this.debounceRender();
    // prevent an infinite loop as we delete actors
    Hooks.off("preDeleteCombatant", CONFIG.FFG.preCombatDelete);

    // Step 3 - Check if the results of steps 1 and 2 are the same or not. if they are different, proceed to step 4a. otherwise, go to 4b
    let removedCombatantReplacementId;
    if (removedCombatantId !== lastSlotCombatantId) {
      // Step 4a - Locate, record, and remove any claims on the slot of the actor being removed
      let removedClaimantId = this.getSlotClaims(round, removedCombatantId);
      // we should only reclaim the slot if the claimant is not the one being removed
      const removedClaimantIsRemovedCombatant = removedClaimantId === removedCombatantId;
      if (removedClaimantId) {
        lastSlotActorClaimedRemovedCombatant = lastSlotCombatantId === removedClaimantId;
        // revoke the claim on the removedCombatant slot
        await this.unclaimSlot(round, removedCombatantId);
      }

      // Step 5 - Locate, record, and remove any claims on the last slot
      const lastClaimantId = this.getSlotClaims(round, lastSlotCombatantId);
      const lastClaimantIsRemovedCombatant = lastClaimantId === removedCombatantId;
      if (lastClaimantId) {
        // revoke the claim on the removedCombatant slot
        await this.unclaimSlot(round, lastSlotCombatantId);
      }

      // Step 6 - Delete the actor being removed from the combat
      await this.combatants.get(removedCombatantId).delete();

      // Step 7 - Add a new slot with the last slot data (except Initiative, which is copied from the slot being removed)
      removedCombatantReplacementId = await this.addIDedExtraSlot(
          removedDisposition,
          removedInitiative,
          lastSlotActorId,
          lastSlotTokenId,
          lastSlotSceneId,
          lastSlotName,
      );

      // Step 8 - Delete the last slot
      await this.combatants.get(lastSlotCombatantId).delete();

      // Step 9 - Re-claim slots as needed
      if (removedClaimantId && !removedClaimantIsRemovedCombatant) {
        if (lastSlotActorClaimedRemovedCombatant) {
          // the last actor had the removed slot claimed
          await this.claimSlot(round, removedCombatantReplacementId, removedCombatantReplacementId);
        } else {
          // a different actor had the removed slot claimed
          await this.claimSlot(round, removedCombatantReplacementId, removedClaimantId);
        }
      } else if (lastClaimantId && !lastClaimantIsRemovedCombatant) {
        await this.claimSlot(round, removedCombatantReplacementId, removedCombatantReplacementId);
      }
    } else {
      // Step 4b - Delete the actor being removed; no further steps are needed
      await this.combatants.get(removedCombatantId).delete();
    }
    // re-enable the hooks we disabled
    CONFIG.FFG.preCombatDelete = Hooks.on("preDeleteCombatant", registerHandleCombatantRemoval);
    this.setupTurns();
    // core advances the turn pointer when the current document is deleted. If the pointer was on
    // the removed actor, follow it to the replacement slot (same initiative, same position); if it
    // was on the deleted last slot, the clamp inside _restoreTurnPosition keeps it at the end of
    // the (now shorter) order instead of jumping.
    const replacementFor = priorTurn.combatantId === removedCombatantId ? removedCombatantReplacementId : null;
    await this._restoreTurnPosition(priorTurn, replacementFor);
  }

  /**
   * Claim a slot for a given combatant
   * @param round - INT - the round
   * @param slot_id - STRING - the ID of the native combatant for this turn
   * @param combatantId - STRING - the combatant ID (NOT token ID, NOT actor ID)
   * @returns {Promise<void>}
   */
  async claimSlot(round, slot_id, combatantId) {
    if (!game.user.isGM) {
      const data = {
        combatId: this.id,
        round: round,
        slot: slot_id,
        combatantId: combatantId,
      }
      game.socket.emit("system.starwarsffg", {event: "combat", data: data});
      return;
    }
    const claims = {
      ...this.getFlag('starwarsffg', 'combatClaims')
    };
    if (!claims[round]) {
      claims[round] = {};
    }
    claims[round][slot_id] = combatantId;
    await this.setFlag('starwarsffg', 'combatClaims', claims);
  }

  /**
   * Un-claim a slot for a given combatant
   * @param round - INT - the round
   * @param slot_id - STRING - the ID of the native combatant for this turn
   * @returns {Promise<void>}
   */
  async unclaimSlot(round, slot_id) {
    if (!game.user.isGM) {
      // only the GM can un-claim a slot
      return;
    }
    await this.unsetFlag('starwarsffg', `combatClaims.${round}.${slot_id}`);
  }

  /**
   * Used by the Combat Tracker to update the initiative of a single slot
   * @param el
   * @returns {Promise<void>}
   */
  async updateCombatant(el) {
    const slotId = el.getAttribute("data-alt-id");
    const combatant = this.combatants.get(slotId);
    const currentInitiative = combatant.initiative;
    const updateDialog = new Dialog({
      title: game.i18n.localize("SWFFG.Combats.Slots.Dialog.Title"),
      content: `
        <p>${game.i18n.localize("SWFFG.Combats.Slots.Dialog.Labels.Initiative")} :</p>
        <input type="number" id="initiative" name="initiative" value="${currentInitiative}">
      `,
      buttons: {
        submit: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("SWFFG.Combats.Slots.Dialog.Labels.Submit"),
          callback: async (obj, event) => {
            const jObj = $(obj);
            const initiative = +jObj.find("#initiative")[0].value;
            if (initiative === "") {
              ui.notifications.warn("You must provide an initiative value");
              return;
            }
            await combatant.update({initiative: initiative});
            game.socket.emit("system.starwarsffg", {event: "trackerRender", combatId: this.id});
          }
        }
      },
      default: "submit",
    });
    updateDialog.render(true);
  }

  async removeCombatant(el) {
    const round = this.round;
    // find the combatant being right-clicked
    const clickedCombatantId = el.getAttribute("data-alt-id");
    const clickedCombatantName = this.combatants.get(clickedCombatantId)?.name;
    CONFIG.logger.debug("Detected combatant removal on custom combat tracker, working...");
    CONFIG.logger.debug(`Right clicked original actor was ${clickedCombatantName} (${clickedCombatantId})`);
    // find the claimant on the slot being right-clicked
    const toRemoveCombatantId = this.getSlotClaims(round, clickedCombatantId);
    if (!toRemoveCombatantId) {
      return ui.notifications.warn(game.i18n.localize("SWFFG.Notifications.Combat.Remove.Slot"));
    }
    const toRemoveCombatantName = this.combatants.get(toRemoveCombatantId)?.name;
    CONFIG.logger.debug(`Actor actually being removed is ${toRemoveCombatantName} (${toRemoveCombatantId})`);
    // pull disposition and initiative from the actor being removed (so we can re-create the slot with those values)
    const disposition = CONST.TOKEN_DISPOSITIONS[el.getAttribute("data-disposition").replace('Enemy', 'Hostile').toUpperCase()];
    const initiative = this.combatants.get(toRemoveCombatantId).initiative;

    // see if there is a claim on the slot for the actor being removed (which may not have been the one right-clicked)
    const toRemoveClaimantId = this.getSlotClaims(round, toRemoveCombatantId);
    const toRemoveClaimantName = this.combatants.get(toRemoveClaimantId)?.name;
    // record where the turn pointer is before core's delete handling moves it
    const priorTurn = this._captureTurnPosition();
    // prevent constant re-rendering of the tracker
    this.debounceRender();
    if (toRemoveClaimantId) {
      CONFIG.logger.debug(`Located claim on actor's slot by ${toRemoveClaimantName} (${toRemoveClaimantId}), un-claiming it`);
      // if there is a claim on the slot being removed, un-claim it
      await this.unclaimSlot(round, toRemoveCombatantId);
    }

    // un-claim the slot we're removing the actor from
    CONFIG.logger.debug("Releasing the claim of the actor being removed");
    await this.unclaimSlot(round, clickedCombatantId);
    // now delete the toRemoveCombatantId slot
    CONFIG.logger.debug("Ok, actually removing the actor");
    Hooks.off("preDeleteCombatant", CONFIG.FFG.preCombatDelete);
    await this.combatants.get(toRemoveCombatantId).delete();
    CONFIG.FFG.preCombatDelete = Hooks.on("preDeleteCombatant", registerHandleCombatantRemoval);
    // now create a new slot to replace it
    CONFIG.logger.debug("Re-creating the slot with the same disposition and initiative");
    const replacementTurnId = await this.addExtraSlot(round, disposition, initiative);

    // if there was a claim on the slot replaced, add it back
    if (toRemoveClaimantId && toRemoveClaimantId !== toRemoveCombatantId) {
      CONFIG.logger.debug(`Since this slot was originally claimed by ${toRemoveClaimantName}, we are re-claiming it for them`);
      await this.claimSlot(round, replacementTurnId, toRemoveClaimantId);
    }
    // re-render the tracker / re-order the turns
    CONFIG.logger.debug("Re-rendering the tracker and emitting a socket event for other clients");
    this.setupTurns();
    // core advances the turn pointer when the current document is deleted; since the slot was
    // re-created in place, put the pointer back where it was (bug: removal skipped a slot)
    await this._restoreTurnPosition(priorTurn, replacementTurnId);
    // emit a socket event
    game.socket.emit("system.starwarsffg", {event: "trackerRender", combatId: this.id});
  }

  /** @override */
  async delete() {
    for (const combatant of this.combatants.contents) {
      await combatant.removeCombatEffects();
    }
    await super.delete();
  }

  /** @override */
  async prepareDerivedData() {
    super.prepareDerivedData();
    CONFIG.logger.debug("Preparing combat data for custom tracker!");

    const newInitiatives = {
      [CONST.TOKEN_DISPOSITIONS.FRIENDLY]: this.combatants.filter(i => i.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY).map(i => i.initiative),
      [CONST.TOKEN_DISPOSITIONS.NEUTRAL]: this.combatants.filter(i => i.disposition === CONST.TOKEN_DISPOSITIONS.NEUTRAL).map(i => i.initiative),
      [CONST.TOKEN_DISPOSITIONS.SECRET]: this.combatants.filter(i => i.disposition === CONST.TOKEN_DISPOSITIONS.SECRET).map(i => i.initiative),
      [CONST.TOKEN_DISPOSITIONS.HOSTILE]: this.combatants.filter(i => i.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE).map(i => i.initiative),
    }

    // sort the initiatives
    newInitiatives[CONST.TOKEN_DISPOSITIONS.FRIENDLY].sort(sortInit);
    newInitiatives[CONST.TOKEN_DISPOSITIONS.NEUTRAL].sort(sortInit);
    newInitiatives[CONST.TOKEN_DISPOSITIONS.SECRET].sort(sortInit);
    newInitiatives[CONST.TOKEN_DISPOSITIONS.HOSTILE].sort(sortInit);

    // used to track how many slots have occurred per side - we care to mark slots as "unused" if they're past the number of alive combatants
    let turnTracker = {
      [CONST.TOKEN_DISPOSITIONS.FRIENDLY]: 0,
      [CONST.TOKEN_DISPOSITIONS.NEUTRAL]: 0,
      [CONST.TOKEN_DISPOSITIONS.SECRET]: 0,
      [CONST.TOKEN_DISPOSITIONS.HOSTILE]: 0,
    };

    if (!this.turns) {
      CONFIG.logger.debug("skipping due to lack of turns");
      return;
    }

    const turns = await Promise.all(this.turns.map(async (turn, index) => {
      CONFIG.logger.debug(`Processing turn for ${turn?.name}`);
      turn.owner = turn?.isOwner || false;
      // combatant ID of the claimant of this slot, if it exists
      const claimantId = this.getSlotClaims(this.round, turn.id);
      // actor data of the claimant
      const claimant = claimantId ? (this.combatants.get(claimantId)) : undefined;
      // true if if there's a claim on the slot and combat has started
      const claimed = this.started ? claimantId !== undefined : true;
      // the normal actor for this slot. may or may not match the claimant
      const combatant = foundry.utils.deepClone(this.combatants.get(turn.id));
      if (!combatant) {
        CONFIG.logger.debug("No combatant found, skipping");
        return turn;
      }
      // track the disposition: the token, if it exists, then the actor, if it exists, then turn.defeated (which is where we stash extra slot initiative)
      const disposition = combatant.disposition;
      // can the user claim this slot?
      const canClaim = (disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY && !claimed) || game.user.isGM;

      // the highest possible initiative for this combatant
      let slotInitiative;
      try {
        slotInitiative = newInitiatives[disposition].pop();
      } catch (e) {
        CONFIG.logger.warn(`caught disposition issue: ${e}, skipping processing turn (this is normal when removing combatants)`);
        return turn;
      }

      let claim = {};
      let hasRolled = true;

      if (this.started && claimant) {
        // the slot is claimed
        CONFIG.logger.debug(`slot ${index} has been claimed by ${claimant.name}`);
        const hidden = this._getTokenHidden(claimant.tokenId);
        let defeated = claimant.isDefeated;

        const effects = new Set();
        if (claimant.token) {
          claimant.token.effects.forEach((e) => effects.add(e))
          if (claimant.token.overlayEffect) {
            effects.add(claimant.token.overlayEffect);
          }
        }

        if (claimant.actor) {
          if (claimant.isDefeated) {
            defeated = true;
          }
          for (const effect of claimant.actor.temporaryEffects) {
            if (effect?.icon) {
              effects.add(effect.icon);
            }
          }
        }

        if (!hidden && turn.css) {
          turn.css = turn?.css?.replace('hidden', '');
        }

        if (claimant.initiative === null || claimant.initiative === undefined) {
          CONFIG.logger.debug("setting hasRolled to false (no initiative for claimant)");
          hasRolled = false;
        }

        claim = {
          id: claimant.id,
          combatantId: combatant.id,
          name: claimant.name,
          img: claimant.img ?? CONST.DEFAULT_TOKEN,
          owner: claimant.isOwner,
          defeated,
          hidden: hidden,
          canPing: claimant.sceneId === canvas.scene?.id && game.user.hasPermission("PING_CANVAS"),
          effects,
          initiative: claimant.initiative,
          claimantToken: claimant.token,
        };

        turn.hidden = hidden;
        // record the claimant on the (in-place mutated) turn object so the post-loop marker sweep
        // below lights the claimant's token for this slot
        turn.claimed = claimantId;
      } else {
        CONFIG.logger.debug(`slot ${index} is unclaimed`);
        // Clear any claim recorded on a previous pass. `turn` is the live this.turns[index] object,
        // so a stale `.claimed` left here would make _refreshTurnMarker() light the old claimant's
        // token (a second, lingering turn marker) once this slot is unclaimed or backfilled.
        turn.claimed = undefined;
        if (combatant) {
          turn.combatantId = combatant.id;

          if (combatant && Object.keys(combatant).includes("tokenId")) {
            combatant.hidden = this._getTokenHidden(combatant.tokenId);
          } else {
            combatant.hidden = false;
          }

          // sync the turn state to the token state
          turn.hidden = combatant.hidden;
          if (combatant.initiative === null || combatant.initiative === undefined) {
            hasRolled = false;
          }
        }
      }

      if (combatant.css === undefined || combatant.css === null) {
        combatant.css = "";
      }
      if (this.turn === index) {
        combatant.active = true;
        combatant.css += " active";
      } else {
        combatant.active = false;
        combatant.css = "";
      }

      let slotType;
      if (disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY) {
        slotType = 'Friendly';
      } else if (disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE) {
        slotType = 'Enemy';
      } else if (disposition === CONST.TOKEN_DISPOSITIONS.SECRET) {
        slotType = 'Secret';
      } else {
        slotType = 'Neutral';
      }

      // determine if we should mark the slot as unneeded
      const aliveCount = this._getCombatantStateCount(disposition);
      let unused = false;
      turnTracker[disposition]++;

      // we do not care about the defeated status since defeated units get their slot marked unused
      if (turn.css) {
        turn.css = turn.css.replace('defeated', '');
      }

      // extract the initiative information into icons for rendering on the combat tracker
      const initiativeImage = {
        "successes": "",
        "advantages": "",
        "triumphs": "",
      }
      if (slotInitiative) {
        const initiativeParts = slotInitiative.toFixed(2);
        const decimalPosition = initiativeParts.indexOf(".");
        const successes = initiativeParts.substring(0, decimalPosition);
        const triumphs = initiativeParts.substring(decimalPosition + 1, decimalPosition + 2);
        const advantages = initiativeParts.substring(decimalPosition + 2, decimalPosition + 3);

        for (let x = 0; x < successes; x++) {
          initiativeImage['successes'] += await foundry.applications.ux.TextEditor.enrichHTML("[su]");
        }
        for (let x = 0; x < advantages; x++) {
          initiativeImage['advantages'] += await foundry.applications.ux.TextEditor.enrichHTML("[ad]");
        }
        for (let x = 0; x < triumphs; x++) {
          initiativeImage['triumphs'] += await foundry.applications.ux.TextEditor.enrichHTML("[tr]");
        }
      }

      return {
        ...turn,
        ...claim,
        slotType: slotType,
        initiative: slotInitiative,
        hasRolled: hasRolled,
        claimed,
        canClaim,
        activationId: slotInitiative ? slotInitiative.activationId : undefined,
        unused: unused,
        initiativeImage,
      }
    }));

    // write to customTurns to avoid permanent changes
    this.customTurns = turns;

    // Refresh the turn marker on EVERY token on the canvas, not just the ones referenced by the
    // current turns list. Each token's _refreshTurnMarker() self-determines whether it should be
    // lit from game.combat's active combatant, so sweeping all tokens guarantees a marker left on a
    // token that has since dropped out of the acting position gets cleared. Previously the refresh
    // only touched the current slot's own token (or its claimant); when a slot was removed and
    // replaced by a generic slot - which carries no token - the previously-marked token was never
    // revisited, so its marker lingered while the new one lit up, producing two turn markers that
    // persisted for the rest of combat. Running this once after the loop (rather than mid-loop) also
    // ensures the active combatant's `.claimed` value is finalized before any marker is computed.
    if (canvas?.ready) {
      for (const token of canvas.tokens?.placeables ?? []) {
        token._refreshTurnMarker?.();
      }
    }
  }

  /**
   * Determine the hidden status of a token, since the state in the combat tracker seems to lag
   * @param tokenId
   * @returns {boolean}
   * @private
   */
  _getTokenHidden(tokenId) {
    let hidden = true;
    const scene = game.scenes.find(i => i.isView);
    if (!scene) {
      return false;
    }
    const token = scene.tokens.get(tokenId);
    if (token) {
      hidden = token.hidden;
    }
    CONFIG.logger.debug(`looked up hidden state for ${token?.name}/${tokenId} on scene ${scene.id}: ${hidden}`);
    return hidden;
  }

    /**
   * get the number of alive combatants on a given side, including any who have claimed a slot and died
   * essentially, the claimed and dead ones need to be included to get an accurate count to determine unused slots
   * @param disposition
   * @returns {number}
   * @private
   */
  _getCombatantStateCount(disposition) {
    const total =  this.combatants.filter(i => i.disposition === disposition);
    const defeated = this.combatants.filter(i => i.disposition === disposition && i.isDefeated);
    CONFIG.logger.debug(`getting combatant state count for ${disposition}`)
    CONFIG.logger.debug(`detected ${total.length} real slots, and ${defeated.length} defeated slots`);
    return total.length - defeated.length;
  }
}

function _getInitiativeFormula(skill, ability) {
  const dicePool = new DicePoolFFG({
    ability: ability,
    boost: parseInt(skill.boost),
    setback: parseInt(skill.setback),
    force: parseInt(skill.force),
  });
  dicePool.upgrade(parseInt(skill.rank));
  return dicePool.renderDiceExpression();
}

function _findActorForInitiative(c) {
  let data = c.actor.system;
  const initiativeRole = game.settings.get('starwarsffg', 'initiativeCrewRole');
  CONFIG.logger.debug("Attempting to find initiative data for actor in combat");
  if (c.actor.type === "vehicle") {
    CONFIG.logger.debug("Actor is a vehicle, looking for initiative crew role.");
    const crew = c.actor.getFlag("starwarsffg", "crew");
    if (crew !== undefined && crew !== []) {
      const initiativeCrew = crew.find((c) => c.role === "Pilot");
      if (initiativeCrew) {
        CONFIG.logger.debug("Found initiative crew role, swapping data to crew member");
        const realActor = game.actors.get(initiativeCrew.actor_id);
        if (realActor?.system) {
          data = realActor.system;
        }
      }
    } else {
      CONFIG.logger.warn("You must set a crew member with the pilot role to roll initiative for a vehicle");
    }
  }
  CONFIG.logger.debug("Finished checking");
  return data;
}

function _buildInitiativePool(data, skill) {
  const pool = new DicePoolFFG({
    ability: Math.max(data.characteristics[data.skills[skill].characteristic].value, data.skills[skill].rank),
    boost: data.skills[skill].boost,
    advantage: data.skills[skill].advantage,
    success: data.skills[skill].success,
  });
  pool.upgrade(Math.min(data.characteristics[data.skills[skill].characteristic].value, data.skills[skill].rank));

  return pool;
}

export class CombatTrackerFFG extends foundry.applications.sidebar.tabs.CombatTracker {

  /** @inheritdoc */
  static PARTS = {
    header: {
      template: "systems/starwarsffg/templates/combat/ffg-combat-tracker-header.html",
    },
    tracker: {
      template: "systems/starwarsffg/templates/combat/ffg-combat-tracker-body.html",
    },
    footer: {
      template: "systems/starwarsffg/templates/combat/ffg-combat-tracker-footer.html",
    },
  };

  /** @override */
  async _onRender(context, options) {
    try {
      await super._onRender(context, options);
    } catch (error) {
      CONFIG.logger.debug(`Custom combat tracker caught semi-expected render error: ${error}`)
    }
    const claimElement = this.element.querySelector('a[data-claim-slot]');
    if (claimElement) {
      claimElement.addEventListener("click", this._claimInitiativeSlot.bind(this));
    }
  }

  /**
   * Initial JS handler for the "claim slot" button on the combat tracker
   * @param event
   * @returns {Promise<void>}
   * @private
   */
  async _claimInitiativeSlot(event) {
    const slot = $(event.currentTarget).data('claim-slot');
    const slotId = this.viewed.turns[slot].id;
    const tokenCount = canvas.tokens.controlled.length;
    const ownedTokenCount = canvas.tokens.ownedTokens.length;
    // you must have a single token selected to claim a slot
    if (tokenCount !== 1 && ownedTokenCount !== 1) {
      ui.notifications.warn(game.i18n.localize("SWFFG.Notifications.Combat.Claim.OneToken"));
      return;
    }
    const token = ownedTokenCount === 1 ? canvas.tokens.ownedTokens[0] : canvas.tokens.controlled[0];
    const combatant = this.viewed.combatants.find(i => i.actorId === token.actor.id);
    if (!combatant) {
      ui.notifications.warn(game.i18n.localize("SWFFG.Notifications.Combat.Claim.Combatant"));
      return;
    }
    // ensure combatant is permitted in this type of slot
    const combatantDisposition = combatant?.token?.disposition ?? combatant?.actor?.token?.disposition ?? token?.document?.disposition ?? 0;
    const slotDisposition = this.viewed.turns[slot]?.token?.disposition ?? this.viewed.turns[slot]?.actor?.token?.disposition ?? this.viewed.turns[slot]?.disposition ?? 0;
    if (slotDisposition !== combatantDisposition) {
      ui.notifications.warn(game.i18n.localize("SWFFG.Notifications.Combat.Claim.SlotType"));
      return;
    }
    await this.viewed.claimSlot(this.viewed.round, slotId, combatant.id);
  }

  /** @override */
  async _prepareContext(options) {
    const combat = this.viewed;
    if (!combat) {
      return await super._prepareContext(options);
    }

    // create a copy of the turn data, then set hidden to false so non-GMs can view all turns, then set the data back
    const tempData = foundry.utils.deepClone(this.viewed.turns);
    for (const turn of this.viewed.turns) {
      turn.hidden = false;
    }
    const data = await super._prepareContext(options);
    const turnData = {
      Friendly: this.viewed.turns.filter(i => combat.combatants.get(i.id)?.token?.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY),
      Enemy: this.viewed.turns.filter(i => combat.combatants.get(i.id)?.token?.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE),
      Neutral: this.viewed.turns.filter(i => combat.combatants.get(i.id)?.token?.disposition === CONST.TOKEN_DISPOSITIONS.NEUTRAL),
      Secret: this.viewed.turns.filter(i => combat.combatants.get(i.id)?.token?.disposition === CONST.TOKEN_DISPOSITIONS.SECRET),
    };

    // update visibility state for each token
    for (const turn of turnData['Friendly']) {
      const combatant = combat.combatants.get(turn.id);
      turn.hidden = this._getTokenHidden(combatant.tokenId);
      turn.slotClaimed = combat.hasClaims(combatant.id);
    }

    for (const turn of turnData['Enemy']) {
      const combatant = combat.combatants.get(turn.id);
      turn.hidden = this._getTokenHidden(combatant.tokenId);
      turn.slotClaimed = combat.hasClaims(combatant.id);
    }

    for (const turn of turnData['Neutral']) {
      const combatant = combat.combatants.get(turn.id);
      turn.hidden = this._getTokenHidden(combatant.tokenId);
      turn.slotClaimed = combat.hasClaims(combatant.id);
    }

    for (const turn of turnData['Secret']) {
      const combatant = combat.combatants.get(turn.id);
      turn.hidden = this._getTokenHidden(combatant.tokenId);
      turn.slotClaimed = combat.hasClaims(combatant.id);
    }

    // the current custom turn
    await this.viewed.prepareDerivedData();
    const currentTurn = this.viewed.customTurns[this.viewed.turn];
    // if the current user is an owner of the current turn (true is claimed, or they're a GM)
    const customControl = currentTurn ? currentTurn.owner : false;

    return {
      ...data,
      hasCombat: this.viewed?.started,
      round: this.viewed?.round,
      custom_turns: this.viewed.customTurns,
      customControl: customControl,
      turnData,
    };
  }

  /**
   * get the total number of slots for a given disposition, including any extra slots
   * @param combat
   * @param disposition
   * @returns {number}
   * @private
   */
  _getDispositionSlotCount(combat, disposition) {
    return combat.combatants.filter(i => i.disposition === disposition).length;
  }

  /** @override */
  _getEntryContextOptions() {
    const baseEntries = super._getEntryContextOptions();
    // replace the default remove combatant entry with our custom one, which allows us to detect and remove extra slots
    const updateCombatantEntry = baseEntries.find(i => i.name === "COMBAT.CombatantUpdate");
    if (updateCombatantEntry) {
      updateCombatantEntry.name = "SWFFG.Notifications.Combat.Initiative.Update";
      updateCombatantEntry.callback = async el => {
        await this.viewed.updateCombatant(el);
      };
      baseEntries[0] = updateCombatantEntry;
    }

    const removeCombatantEntry = baseEntries.find(i => i.name === "COMBAT.CombatantRemove");
    if (removeCombatantEntry) {
      removeCombatantEntry.callback = async el => {
        await this.viewed.removeCombatant(el);
      };
      baseEntries[4] = removeCombatantEntry;
    }

    const removeSlot = {
      name: 'SWFFG.Notifications.Combat.Claim.RemoveSlot',
      icon: '<i class="fa-regular fa-trash-alt"></i>',
      callback: async (el) => {
        const index = +el.getAttribute("data-slot-index");
        if (!isNaN(index)) {
          await this._removeSlot(this.viewed.round, el);
        }
      },
    };

    // Allow GMs to revoke an initiative slot claim.
    const unClaimSlot = {
      name: 'SWFFG.Notifications.Combat.Claim.UnClaim',
      icon: '<i class="fa-regular fa-xmark"></i>',
      callback: async (el) => {
        const li = $(el);
        const index = +li.data('slot-index');
        if (!isNaN(index)) {
          await this.viewed.unclaimSlot(this.viewed.round, this.viewed.turns[index].id);
        }
      },
    };

    // remove reroll initiative
    baseEntries.splice(2, 1);

    return [...baseEntries, removeSlot, unClaimSlot];
  }

  async _removeSlot(tracker, el) {
    CONFIG.logger.debug("Removing slot from combat");
    const combat = this.viewed;
    if (!combat) {
      ui.notifications.error("Error detecting combat, try starting/ending combat?");
      return;
    }
    const round = combat.round;
    const turn = el.getAttribute("data-slot-index");
    const combatant = combat.turns[turn];
    const claim = combat.getSlotClaims(round, combatant.id);
    const claimed = claim !== undefined;
    const disposition = CONST.TOKEN_DISPOSITIONS[el.getAttribute("data-disposition").replace('Enemy', 'Hostile').toUpperCase()];

    if (claimed) {
      ui.notifications.warn("You must un-claim the slot before removing it");
      return;
    }
    const slotCount = this._getDispositionSlotCount(combat, disposition)
    const presentCount = combat.combatants.filter(i => i?.token?.disposition === disposition).length;

    CONFIG.logger.debug(`detected ${presentCount} total combatants for disposition ${disposition}, along with ${slotCount} total slots`);

    const fakeTurn = combatant?.flags?.fake || false;
    // True when there are no spare (extra) slots left for this side, so removing one would leave
    // fewer slots than actors. In that case the only way to honor the request is to remove the
    // underlying combatant from the encounter entirely.
    const wouldDropBelowActors = slotCount - 1 < presentCount;
    const combatantName = combatant?.name || combatant?.token?.name || "this combatant";

    // Confirm before deleting. Previously a slot at the actor floor was hard-refused; now we allow
    // it but make the consequence explicit so it can't happen by accident.
    let confirmContent;
    if (fakeTurn) {
      confirmContent = `<p>Remove this extra initiative slot?</p>`;
    } else if (wouldDropBelowActors) {
      confirmContent = `<p>There are no spare slots for this side, so removing this slot will remove <strong>${combatantName}</strong> from the encounter entirely.</p><p>Continue?</p>`;
    } else {
      confirmContent = `<p>Remove an initiative slot for this side? ${combatantName}'s slot will be backfilled by a spare slot.</p>`;
    }

    const confirmed = await Dialog.confirm({
      title: "Remove Initiative Slot",
      content: confirmContent,
      defaultYes: false,
    });
    if (!confirmed) {
      return;
    }

    // record where the turn pointer is before core's delete handling moves it (the
    // removeLastSlot() branch handles this internally)
    const priorTurn = combat._captureTurnPosition();
    if (fakeTurn) {
      // if it's a fake slot, delete it
      CONFIG.logger.debug("This is a non-actor turn, deleting");
      Hooks.off("preDeleteCombatant", registerHandleCombatantRemoval);
      await combatant.delete();
      CONFIG.FFG.preCombatDelete = Hooks.on("preDeleteCombatant", registerHandleCombatantRemoval);
      await combat._restoreTurnPosition(priorTurn);
    } else if (wouldDropBelowActors) {
      // No spare slot to backfill with, so remove the actor (and its slot) from the encounter.
      // removeLastSlot() drops the lowest-initiative slot for this side and keeps claims/order intact.
      CONFIG.logger.debug("No spare slot available; removing the combatant from the encounter");
      await combat.removeLastSlot(combatant.id);
    } else {
      // this is a real slot, we need to find a replacement
      // the approach is to pick another slot, copy data from that slot to our slot, copy claims to our slot (as needed)
      //   and then delete that fake slot
      // locate a fake turn
      CONFIG.logger.debug("This slot is owned by a real actor, doing some magic");
      // Pick a spare (fake) slot on the same side to consume as the backfill. Prefer one that is NOT
      // the slot currently taking its turn: deleting the acting slot would strand the turn pointer
      // (there is no surviving combatant to follow), which previously caused the active turn to jump.
      const currentTurnId = combat.combatant?.id;
      const replacementTurn = combat.turns.find(i => i.flags?.fake && i.disposition === combatant.disposition && i.id !== currentTurnId)
        ?? combat.turns.find(i => i.flags?.fake && i.disposition === combatant.disposition);
      if (!replacementTurn) {
        CONFIG.logger.warn("Unable to find a replacement turn, likely concurrency issues");
        return;
      }
      CONFIG.logger.debug(`Replacement turn is ${replacementTurn.name} / ${replacementTurn.id}`);
      await combatant.update({initiative: replacementTurn.initiative});
      const replacementClaimed = combat.getSlotClaims(round, replacementTurn.id);
      CONFIG.logger.debug(`Claims on replacement slot: ${replacementClaimed}`);
      if (replacementClaimed) {
        await combat.unclaimSlot(round, replacementTurn.id);
        await combat.claimSlot(round, combatant.id, replacementClaimed);
      }
      Hooks.off("preDeleteCombatant", registerHandleCombatantRemoval);
      await replacementTurn.delete();
      CONFIG.FFG.preCombatDelete = Hooks.on("preDeleteCombatant", registerHandleCombatantRemoval);
      await combat._restoreTurnPosition(priorTurn);
    }

    // refresh the tracker (locally + on other clients) so the slot change shows immediately
    combat.setupTurns();
    combat.debounceRender();
    game.socket.emit("system.starwarsffg", { event: "trackerRender", combatId: combat.id });
  }

  /** @override */
  _attachFrameListeners() {
    super._attachFrameListeners();
    // allow clicking the custom combat stuff and zooming to the combatant
    this.element.addEventListener("click", this._onCombatantMouseDown.bind(this));
  }

  /** @override */
  async _onCombatantMouseDown(event) {
    CONFIG.logger.debug("Caught click on custom combat tracker");
    if ( (event.target instanceof HTMLInputElement) || (event.target instanceof HTMLButtonElement) ) {
      CONFIG.logger.debug("Rejected click due to wrong place");
      return;
    }
    if (event.target.classList.contains("roll")) {
      CONFIG.logger.debug("rejecting click as this is an initiative roll");
      return;
    }

    const { combatantId } = event.target?.dataset ?? {};
    const combatant = this.viewed?.combatants?.get(combatantId);
    if ( !combatant ) {
      CONFIG.logger.debug("Unable to find combatant");
      return;
    }
    if ( event.type === "dblclick" ) {
      if ( combatant.actor?.testUserPermission(game.user, "OBSERVER") ) combatant.actor?.sheet.render(true);
      return;
    }
    const token = combatant.token?.object;
    if ( !token ) {
      CONFIG.logger.debug("Unable to find token");
      return;
    }
    CONFIG.logger.debug("Accepted, should be animating");
    canvas.animatePan(token.center);
  }

  /**
   * Determine the hidden status of a token, since the state in the combat tracker seems to lag
   * @param tokenId
   * @returns {boolean}
   * @private
   */
  _getTokenHidden(tokenId) {
    let hidden = true;
    const scene = game.scenes.find(i => i.isView);
    if (!scene) {
      return false;
    }
    const token = scene.tokens.get(tokenId);
    if (token) {
      hidden = token.hidden;
    }
    CONFIG.logger.debug(`looked up hidden state for ${token?.name}/${tokenId} on scene ${scene.id}: ${hidden}`);
    return hidden;
  }
}

export default class CombatantFFG extends Combatant {
  /**
   * @override
   * In the FFG system, "NPC" is determined by actor *type*, not by player
   * ownership. Core Foundry treats any combatant without an assigned player
   * owner as an NPC, which causes "Roll NPCs" to sweep up PC `character`
   * actors that have no player assigned (the common case when the GM is
   * testing or running a one-shot). Here, only `character` actors are PCs;
   * everything else (minion / rival / nemesis / vehicle / homestead) is an NPC.
   * @returns {boolean}
   */
  get isNPC() {
    if (!this.actor) return true;
    return this.actor.type !== "character";
  }

  get disposition() {
    if (this.getFlag("starwarsffg", "fake")) {
      return this.getFlag("starwarsffg", "disposition");
    } else {
      return this?.token ? this.token?.disposition : this?.actor?.prototypeToken?.disposition;
    }
  }

  /** @override  */
  async delete() {
    await this.removeCombatEffects();
    await super.delete();
  }

  /**
   * Delete any status effects which have a duration of a "combat" when the actor is removed from combat
   * @returns {Promise<void>}
   */
  async removeCombatEffects() {
    if (!this.actor) {
      // no actor exists for this slot
      return;
    }
    CONFIG.logger.debug(`Removing combat-length status effects from ${this.actor.name} on combatant removal`);
    const effects = this.actor.getEmbeddedCollection("ActiveEffect");
    const toDelete = effects.filter(e => e?.system?.duration === "combat");
    if (toDelete) {
      await this.actor.deleteEmbeddedDocuments("ActiveEffect", toDelete.map(i => i.id));
    }
  }
}

/**
 * Force the combat tracker to re-render, which picks up "hidden" state changes of tokens
 */
export function updateCombatTracker() {
  // Used to force the tracker to re-render based on updated visibility state
  if (game.combat && game.settings.get("starwarsffg", "useGenericSlots")) {
    ui.combat.render(true);
  }
}

/**
 * Sort function for initiatives. Puts NULL to the end.
 * @param a
 * @param b
 * @returns {number|number}
 */
function sortInit(a, b) {
  // equal items sort equally
  if (a === b) {
      return 0;
  }
  // nulls sort before anything else
  if (a === null) {
      return -1;
  }
  if (b === null) {
      return 1;
  }
  return a < b ? -1 : 1;
}

export function registerHandleCombatantRemoval(combatant, options, userId) {
  game.combat.handleCombatantRemoval(combatant, options, userId);
  return false;
}
