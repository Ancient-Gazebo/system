import ModifierHelpers from "./modifiers.js";
import ItemHelpers from "./item-helpers.js";
import {migrateDataToSystem} from "./migration.js";

export default class ActorHelpers {
  static async updateActor(event, formData) {
    formData = foundry.utils.expandObject(formData);
    const ownedItems = this.actor.items;

    // as of Foundry v10, saving an editor only submits the single entry for that editor
    if (Object.keys(formData).length > 1) {
      if (this.object.type === "minion") {
        Object.keys(formData?.data?.skills).forEach((skill) => {
          if (!formData.data.skills[skill].groupskill && this.object.system.skills[skill].groupskill) {
            // this is a minion group with a group skill being removed - reduce the rank by one (since we added 1 when it was checked)
            formData.data.skills[skill].rank -= this.object.system.quantity.value;
          }
        });
      }
      if (this.object.type !== "homestead") {
        if (this.object.type !== "vehicle") {
          // Handle credits
          if (formData.data.stats?.credits?.value) {
            const rawCredits = formData.data.stats?.credits.value
              ?.toString()
              .match(/^(?!.*\.).*|.*\./)[0]
              .replace(/[^0-9]+/g, "");
            formData.data.stats.credits.value = parseInt(rawCredits, 10);
          }
          // Handle currency denominations. The sheet renders values with grouping separators (e.g.
          // "1,200"); strip everything but digits and store as an integer so the data model stays
          // numeric and the CurrencyManager can operate on it.
          if (formData.data.currency && typeof formData.data.currency === "object") {
            for (const key of Object.keys(formData.data.currency)) {
              const raw = formData.data.currency[key];
              if (raw === undefined || raw === null || raw === "") continue;
              const digits = raw.toString().replace(/[^0-9]+/g, "");
              formData.data.currency[key] = digits === "" ? 0 : parseInt(digits, 10);
            }
          }
        }
      }
      if (this.object.type === "minion") {
        // include the updated quantity of minions in the group in the update object so automation can access it
        formData.data.quantity.value = Math.min(formData.data.quantity.max, formData.data.quantity.max - Math.floor(formData.data.stats.wounds.value - 1) / formData.data.unit_wounds.value);
      }
    }
    // Handle the free-form attributes list
    const formAttrs = foundry.utils.expandObject(formData)?.data?.attributes || {};
    const attributes = Object.values(formAttrs).reduce((obj, v) => {
      let k = v["key"].trim();
      delete v["key"];
      obj[k] = v;
      return obj;
    }, {});

    // Remove attributes which are no longer used
    if (this.object.system?.attributes) {
      for (let k of Object.keys(this.object.system.attributes)) {
        if (!attributes.hasOwnProperty(k)) attributes[`-=${k}`] = null;
      }
    }

    // recombine attributes to formData
    formData.data.attributes = attributes;

    // Update the Actor
    foundry.utils.setProperty(formData, `flags.starwarsffg.loaded`, false);

    // as of v12, "data" is no longer shimmed into "system" for you, so we must do it ourselves
    formData = migrateDataToSystem(formData);

    const curXP = this.object?.system?.experience?.available ? this.object.system.experience.available : 0;
    const newXP = formData?.system?.experience?.available ? formData.system.experience.available : 0;
    if (curXP !== newXP && curXP !== 0 && newXP !== 0) {
      await xpLogEarn(this.object, newXP - curXP, newXP, this.object?.system?.experience.total, "manual adjustment", "Self");
    }

    return await this.object.update(formData);
  }

  /**
   * Records the state of all active effects on the actor and then suspends them.
   * This is used to enable manual editing without an infinite loop from the two being combined
   * Note that this returns a state, which is REQUIRED to restore the original AE state
   * @param actor
   * @param persistChanges - defaults to False, and generally should be. For GM XP granting, this should be True
   * @returns {Promise<{directEffects: *[], itemEffects: {}}>}
   */
  static async beginEditMode(actor, persistChanges=false) {
    // Store initial state
    CONFIG.logger.debug(`Beginning Edit mode for ${actor.name}`);
    // Track both direct and item-based effects
    const initialState = {
      directEffects: [],
      itemEffects: {},
    };

    // Record direct effects and disable them in a single batched update
    const directEffectUpdates = [];
    for (const effect of actor.effects) {
      initialState.directEffects.push({
        id: effect.id,
        disabled: effect.disabled,
      });
      if (effect.disabled !== true) {
        directEffectUpdates.push({ _id: effect.id, disabled: true });
      }
    }
    if (directEffectUpdates.length > 0) {
      if (!persistChanges) {
        // updateSource is not available as a batch operation; fall back to individual calls (in-memory only, no DB write)
        for (const update of directEffectUpdates) {
          const effect = actor.effects.get(update._id);
          await effect.updateSource({ disabled: true });
        }
      } else {
        await actor.updateEmbeddedDocuments("ActiveEffect", directEffectUpdates);
      }
    }

    // Record item-based effects and disable them in a single batched update per item
    for (const item of actor.items) {
      CONFIG.logger.debug(`> examining ${item.name}`);
      initialState.itemEffects[item.id] = [];
      const itemEffectUpdates = [];
      for (const effect of item.effects) {
        CONFIG.logger.debug(`>> Recording state for ${effect.name}`);
        initialState.itemEffects[item.id].push({
          id: effect.id,
          disabled: effect.disabled,
        });
        if (effect.disabled !== true) {
          CONFIG.logger.debug(`>> Disabling AE for ${effect.name}`);
          itemEffectUpdates.push({ _id: effect.id, disabled: true });
        }
      }
      if (itemEffectUpdates.length > 0) {
        if (!persistChanges) {
          for (const update of itemEffectUpdates) {
            const effect = item.effects.get(update._id);
            await effect.updateSource({ disabled: true });
          }
        } else {
          await item.updateEmbeddedDocuments("ActiveEffect", itemEffectUpdates);
        }
      }
    }

    CONFIG.logger.debug(`Final initial state: ${JSON.stringify(initialState)}`);
    return initialState;
  }

  static async endEditMode(actor, originalState, persistChanges=false) {
    CONFIG.logger.debug(`Ending Edit mode for ${actor.name} - original state: ${JSON.stringify(originalState)}`);

    // Revert direct effects in a single batched update
    const directEffectUpdates = [];
    for (const effect of actor.effects) {
      const locatedEffect = originalState.directEffects.find((s) => s.id === effect.id);
      if (locatedEffect && effect.disabled !== locatedEffect.disabled) {
        directEffectUpdates.push({ _id: effect.id, disabled: locatedEffect.disabled });
      }
    }
    if (directEffectUpdates.length > 0) {
      if (!persistChanges) {
        for (const update of directEffectUpdates) {
          const effect = actor.effects.get(update._id);
          await effect.updateSource({ disabled: update.disabled });
        }
      } else {
        await actor.updateEmbeddedDocuments("ActiveEffect", directEffectUpdates);
      }
    }

    // Revert item-based effects in a single batched update per item
    for (const item of actor.items) {
      CONFIG.logger.debug(`> examining ${item.name}`);
      if (!(item.id in originalState.itemEffects)) {
        CONFIG.logger.debug("> no item AEs in stored state, skipping further processing");
        continue;
      }
      const storedItemState = originalState.itemEffects[item.id];
      CONFIG.logger.debug(`> found item AEs in stored state: ${JSON.stringify(storedItemState)}`);
      const itemEffectUpdates = [];
      for (const effect of item.effects) {
        CONFIG.logger.debug(`>> examining ${effect.name}`);
        const storedEffectState = storedItemState.find((s) => s.id === effect.id);
        if (storedEffectState && effect.disabled !== storedEffectState.disabled) {
          CONFIG.logger.debug(">>> found a stored state for this effect, making adjustments");
          itemEffectUpdates.push({ _id: effect.id, disabled: storedEffectState.disabled });
        } else {
          CONFIG.logger.debug(">>> no stored state for this effect or the state is the same, not making adjustments");
        }
      }
      if (itemEffectUpdates.length > 0) {
        if (!persistChanges) {
          for (const update of itemEffectUpdates) {
            const effect = item.effects.get(update._id);
            await effect.updateSource({ disabled: update.disabled });
          }
        } else {
          await item.updateEmbeddedDocuments("ActiveEffect", itemEffectUpdates);
        }
      }
    }
  }

  /**
   * Automatically learn ("auto-purchase") unranked talents that the character has already
   * acquired in another specialization tree, per the FFG rule: when advancing through a
   * specialization tree and you reach an unranked talent you already own from a different
   * tree, you gain it on the new tree for free (no XP).
   *
   * The behaviour is connection-aware. An unranked talent only auto-completes once it is
   * "reached" in its tree, meaning it is in the top (entry) tier, or it is connected via an
   * active grid link to a talent already learned in that same tree. Because a freshly
   * auto-learned talent then becomes a valid connection point itself, the resolution
   * cascades until no further talents can be auto-learned.
   *
   * Talent grids are a fixed 4-wide layout (talent0..talent19). For a talent at index x:
   *   - the talent directly above is x-4, linked when this talent has `links-top-1`
   *   - the talent directly to the right is x+1, linked when this talent has `links-right`
   * Links are treated as undirected for reachability.
   *
   * @param {Actor} actor                  The owning character actor.
   * @returns {Promise<boolean>}           Whether any talent was auto-learned.
   */
  static async autoPurchaseConnectedTalents(actor) {
    if (!actor || actor.type !== "character") return false;

    const specializations = actor.items.filter((i) => i.type === "specialization");
    // Sharing an unranked talent requires at least two trees.
    if (specializations.length < 2) return false;

    const GRID_WIDTH = 4;
    const GRID_SIZE = 20;

    // Work against an in-memory copy of every tree so the cascade can resolve without a
    // database round-trip per change; only changed trees are written back at the end.
    const working = {};
    for (const spec of specializations) {
      working[spec.id] = {
        spec,
        talents: foundry.utils.deepClone(spec.system.talents || {}),
        dirty: false,
      };
    }

    // Is the talent at index x reachable within its own tree given the current learned state?
    const isReachable = (talents, x) => {
      // Top (entry) tier is always reachable once the tree is owned.
      if (x < GRID_WIDTH) return true;
      const self = talents[`talent${x}`];
      // Connected upward to a learned talent (our top link -> the talent above).
      const above = talents[`talent${x - GRID_WIDTH}`];
      if (self?.["links-top-1"] && above?.islearned) return true;
      // Connected downward to a learned talent (their top link -> us).
      const below = talents[`talent${x + GRID_WIDTH}`];
      if (below?.["links-top-1"] && below?.islearned) return true;
      // Connected to the right (our right link -> the talent to our right).
      if ((x + 1) % GRID_WIDTH !== 0) {
        const right = talents[`talent${x + 1}`];
        if (self?.["links-right"] && right?.islearned) return true;
      }
      // Connected from the left (their right link -> us).
      if (x % GRID_WIDTH !== 0) {
        const left = talents[`talent${x - 1}`];
        if (left?.["links-right"] && left?.islearned) return true;
      }
      return false;
    };

    // The set of unranked talent names the character currently owns in ANY tree.
    const ownedUnrankedNames = () => {
      const names = new Set();
      for (const id of Object.keys(working)) {
        const talents = working[id].talents;
        for (let x = 0; x < GRID_SIZE; x++) {
          const t = talents[`talent${x}`];
          if (t && t.islearned && !t.isRanked && t.name) names.add(t.name);
        }
      }
      return names;
    };

    // Cascade: repeatedly auto-learn reachable, owned-elsewhere, unranked talents until stable.
    let changed = true;
    let safety = 0;
    const maxPasses = GRID_SIZE * specializations.length + 5;
    while (changed && safety < maxPasses) {
      changed = false;
      safety += 1;
      const owned = ownedUnrankedNames();
      for (const id of Object.keys(working)) {
        const talents = working[id].talents;
        for (let x = 0; x < GRID_SIZE; x++) {
          const t = talents[`talent${x}`];
          if (!t || t.islearned || t.isRanked || !t.name) continue;
          // Only auto-complete talents we already own from a different tree.
          if (!owned.has(t.name)) continue;
          // ...and only once they are actually reached in this tree.
          if (!isReachable(talents, x)) continue;
          t.islearned = true;
          working[id].dirty = true;
          changed = true;
          // Newly owned name becomes available to subsequent trees on the next pass.
          owned.add(t.name);
        }
      }
    }

    // Persist only the trees that actually changed.
    let anyChange = false;
    for (const id of Object.keys(working)) {
      if (!working[id].dirty) continue;
      anyChange = true;
      await working[id].spec.update({ system: { talents: working[id].talents } });
    }
    if (anyChange) {
      // Resolve the Active Effect state of every tree now that the learned map changed. This
      // both activates the modifiers of any newly auto-learned canonical talent and - critically -
      // keeps duplicate copies of an unranked talent suspended, so a talent like Armor Master
      // does not apply its soak bonus once per tree it appears in.
      try {
        await ItemHelpers.syncActorTreeAEs(actor);
      } catch (e) {
        CONFIG.logger.warn("Failed to sync specialization Active Effects after cross-tree auto-purchase", e);
      }
    }
    return anyChange;
  }
}

/**
 * Adds a SPEND log entry to the actor's XP log (accessed via the notebook under specializations)
 * @param actor - ffgActor object
 * @param action - action taken (e.g. "skill rank Astrogation 1 --> 2")
 * @param cost - XP spent
 * @param available - XP available
 * @param total - XP total
 * @param statusId - ID of the associated active effect (if in use)
 * @param refund - optional metadata describing how to refund this purchase from the XP log
 *                 (e.g. {kind:"tree", type:"specialization", itemId, nodeId} or
 *                 {kind:"forcepower-base", name}). Skills use `statusId` instead.
 * @returns {Promise<void>}
 */
export async function xpLogSpend(actor, action, cost, available, total, statusId=undefined, refund=undefined) {
  const xpLog = actor.getFlag("starwarsffg", "xpLog") || [];
  const date = new Date().toISOString().slice(0, 10);
  const newEntry = {
    action: 'purchased',
    id: statusId,
    xp: {
      cost: cost,
      available: available,
      total: total,
    },
    date: date,
    description: action,
  };
  if (refund) newEntry.refund = refund;
  await actor.setFlag("starwarsffg", "xpLog", [newEntry, ...xpLog]);
  await notifyXpSpend(actor, action);
}

/**
 * Whisper the GM notifying them of spending XP
 * @param actor
 * @param action
 * @returns {Promise<void>}
 */
async function notifyXpSpend(actor, action) {
  if (game.settings.get("starwarsffg", "notifyOnXpSpend")) {
    const chatData = {
      speaker: {
        actor: actor,
      },
      content: `bought ${action}`,
      whisper: ChatMessage.getWhisperRecipients("GM"),
    };
    await ChatMessage.create(chatData);
  }
}

/**
 * Adds a GRANT log entry to the actor's XP log (accessed via the notebook under specializations)
 * @param actor - ffgActor object
 * @param grant - XP granted
 * @param available - XP available
 * @param total - XP total
 * @param note - note about the grant
 * @param granter - string for who did the granting
 * @returns {Promise<void>}
 */
export async function xpLogEarn(actor, grant, available, total, note, granter="GM", statusId=undefined) {
  const xpLog = actor.getFlag("starwarsffg", "xpLog") || [];
  const date = new Date().toISOString().slice(0, 10);
  let action;
  if (granter === "GM") {
    action = "granted";
  } else {
    action = "adjusted";
  }
  const newEntry = {
    action: action,
    id: statusId, // XP grants are not done by Active Effects
    xp: {
      cost: grant,
      available: available,
      total: total,
    },
    date: date,
    description: note,
  };
  await actor.setFlag("starwarsffg", "xpLog", [newEntry, ...xpLog]);
}

/**
 * Undoes an XP grant, e.g., from removing a species
 * @param actor - ffgActor object
 * @param undone - XP undone
 * @param available - (new) XP available
 * @param total - (new) XP total
 * @returns {Promise<void>}
 */
export async function xpLogUndo(actor, undone, available, total) {
  const xpLog = actor.getFlag("starwarsffg", "xpLog") || [];
  const date = new Date().toISOString().slice(0, 10);
  const newEntry = {
    action: "undid",
    id: undefined,
    xp: {
      cost: undone,
      available: available,
      total: total,
    },
    date: date,
    description: "Species XP",
  };
  await actor.setFlag("starwarsffg", "xpLog", [newEntry, ...xpLog]);
}
