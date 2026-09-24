import ModifierHelpers from "./modifiers.js";
import TalentTree from "./talent-tree.js";
import { AE_MODES } from "../config/ffg-active-effect-modes.js";

export default class ItemHelpers {
  static async itemUpdate(event, formData, { render = false } = {}) {
    formData = foundry.utils.expandObject(formData);

    if (this.object.isEmbedded && this.object.actor?.compendium?.metadata) {
      return;
    }
    CONFIG.logger.debug(`Updating ${this.object.type}`);

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

    // apply active effects
    await ModifierHelpers.applyActiveEffectOnUpdate(this.object, formData);

    // recombine attributes to formData
    if (Object.keys(attributes).length > 0) {
      foundry.utils.setProperty(formData, `data.attributes`, attributes);
    }

    // migrate data to v10 structure
    let updated_id = formData._id;
    delete formData._id;

    foundry.utils.setProperty(formData, `flags.starwarsffg.loaded`, false);
    await this.object.update(formData, { render });
    // sync the active effect state (if applicable). needs to be after the update so we have the updated state
    await ItemHelpers.syncAEStatus(this.object, this.object.getEmbeddedCollection("ActiveEffect"));
    // Only re-render if the sheet is still open; async awaits above mean the user may have
    // closed the sheet while the update was in flight, and render(true) would reopen it.
    if (this.rendered) await this.render(true);

    if (this.object.type === "talent") {
      if (this.object.flags?.clickfromparent?.length) {
        let listofparents = JSON.parse(JSON.stringify(this.object.flags.clickfromparent));
        while (listofparents.length > 0) {
          const parent = listofparents.shift();
          const spec = await fromUuid(parent.id);
          if (spec) {
            let updateData = {};
            foundry.utils.setProperty(updateData, `data.talents.${parent.talent}.name`, formData.name);
            foundry.utils.setProperty(updateData, `data.talents.${parent.talent}.description`, this.object.system.description);
            foundry.utils.setProperty(updateData, `data.talents.${parent.talent}.activation`, formData.data.activation.value);
            foundry.utils.setProperty(updateData, `data.talents.${parent.talent}.isRanked`, formData.data.ranks.ranked);
            foundry.utils.setProperty(updateData, `data.talents.${parent.talent}.isForceTalent`, formData.data.isForceTalent);
            foundry.utils.setProperty(updateData, `data.talents.${parent.talent}.isConflictTalent`, formData.data.isConflictTalent);

            // Remove attributes which are no longer used
            if (spec?.system?.talents?.[parent.talent]?.attributes) {
              for (let k of Object.keys(spec.system.talents[parent.talent].attributes)) {
                if (!formData.data.attributes.hasOwnProperty(k)) formData.data.attributes[`-=${k}`] = null;
              }
            }

            foundry.utils.setProperty(updateData, `data.talents.${parent.talent}.attributes`, formData.data.attributes);

            if (parent.id.includes(".OwnedItem.")) {
              const ids = parent.id.split(".OwnedItem.");
              const actor = await fromUuid(ids[0]);
              const item = await actor.items.get(ids[1]);
              foundry.utils.setProperty(updateData, `flags.starwarsffg.loaded`, false);
              await item.update(updateData);
              if (item.sheet?.rendered) await item.sheet.render(true);
            } else {
              foundry.utils.setProperty(updateData, `flags.starwarsffg.loaded`, false);
              await spec.update(updateData);
              if (spec.sheet?.rendered) await spec.sheet.render(true);
            }
          }
        }
      }
    } else if (this.object.type === "career") {
      // apply career skills from Careers
      const existingEffects = this.object.getEmbeddedCollection("ActiveEffect");
      const itemEffect = existingEffects.find(i => i.name === `(inherent)`);
      const changes = [];
      for (let i = 0; i < 8; i++) {
        let path;
        const skill = formData.data.careerSkills[`careerSkill${i}`];
        if (skill !== "(none)") {
          path = `system.skills.${skill}.careerskill`;
        } else {
          path = "(none)";
        }
        changes.push({
          key: path,
          mode: AE_MODES.ADD,
          value: true,
        });
      }
      if (itemEffect) {
        await ModifierHelpers.updateEffectChanges(itemEffect, changes);
      }
    } else if (this.object.type === "specialization") {
      // apply career skills from Careers
      const existingEffects = this.object.getEmbeddedCollection("ActiveEffect");
      const itemEffect = existingEffects.find(i => i.name === `(inherent)`);
      const changes = [];
      for (let i = 0; i < 5; i++) {
        let path;
        const skill = formData.data.careerSkills[`careerSkill${i}`];
        if (skill !== "(none)") {
          path = `system.skills.${skill}.careerskill`;
        } else {
          path = "(none)";
        }
        changes.push({
          key: path,
          mode: AE_MODES.ADD,
          value: true,
        });
      }
      if (itemEffect) {
        await ModifierHelpers.updateEffectChanges(itemEffect, changes);
      }
    }
  }

  /**
   * Bring an item's (inherent) effect back in line with the item's own stats, for the parts of that
   * effect that are nothing but a copy of them:
   *   - armour: soak and defence (melee + ranged). Encumbrance is left alone - the equip state owns
   *     it (updateEncumbranceOnEquip), and the actor derives encumbrance from its items anyway.
   *   - career / specialization: the career-skill changes.
   *
   * The OggDude importer only copies these into the effect if the effect already exists, after a
   * fixed wait for _onCreate to build it. When it lost that race the effect kept the zeroes it was
   * created with: 99 of 112 imported armours gave no soak or defence when worn, and most imported
   * careers and specializations granted no career skills - until someone happened to save the
   * item's sheet. Every copy dragged out of them inherited the same broken effect.
   *
   * Safe to call repeatedly: it writes only when something actually differs.
   * @param {Item} item
   * @returns {Promise<boolean>} whether the effect was updated
   */
  static async syncInherentStatEffect(item) {
    if (!["armour", "career", "specialization"].includes(item?.type)) return false;
    // Adversaries (minion / rival / nemesis) come from stat blocks whose soak, defence and skills
    // already include their gear, and the adversary importer deliberately leaves these effects at
    // zero so the armour is not counted twice. Only player characters derive their stats from their
    // items, so only their copies - and unowned items, which apply to nobody - are rebuilt.
    if (item.actor && item.actor.type !== "character") return false;
    const inherent = item.effects?.find((e) => e.name === "(inherent)");
    if (!inherent) return false;

    let changes;
    if (item.type === "armour") {
      changes = foundry.utils.deepClone(inherent._source.changes ?? []);
      const wanted = [
        ["Defence", Number(item.system?.defence?.value) || 0],
        ["Soak", Number(item.system?.soak?.value) || 0],
      ];
      for (const [stat, value] of wanted) {
        for (const mod of ModifierHelpers.explodeMod("Stat", stat)) {
          const key = ModifierHelpers.getModKeyPath(mod.modType, mod.mod);
          if (!key) continue;
          const existing = changes.find((c) => c.key === key);
          if (existing) existing.value = value;
          else changes.push({ key, mode: AE_MODES.ADD, value });
        }
      }
    } else {
      // An item predating careerSkills has nothing to rebuild from; leave its effect alone.
      if (!item.system?.careerSkills) return false;
      // Same shape the item sheet writes (see itemUpdate): one change per slot, "(none)" if empty.
      const slots = item.type === "career" ? 8 : 5;
      changes = [];
      for (let i = 0; i < slots; i++) {
        const skill = item.system.careerSkills[`careerSkill${i}`];
        changes.push({
          key: skill && skill !== "(none)" ? `system.skills.${skill}.careerskill` : "(none)",
          mode: AE_MODES.ADD,
          value: true,
        });
      }
    }
    const updated = await ModifierHelpers.updateEffectChanges(inherent, changes);
    // Armour that is not worn must not apply. Imported armour often arrives with its effect switched
    // on while unequipped - harmless while it held zeroes, but with its real values it would add soak
    // and defence from armour nobody is wearing.
    if (updated && item.type === "armour" && item.actor) {
      const equipped = ItemHelpers.isEffectivelyEquipped(item);
      if (inherent.disabled === equipped) await inherent.update({ disabled: !equipped });
    }
    return updated;
  }

  /**
   * Takes formData and move anything under .data into .system in preparation for an item.update() call
   * @param formData
   * @returns {*}
   */
  static normalizeDataStructure(formData) {
    const updatedData = foundry.utils.deepClone(formData);
    if (Object.keys(formData).includes('data')) {
      if (!Object.keys(formData).includes('system')) {
        // sometimes we get formData with a mix of data and system...
        updatedData.system = {};
      }
      updatedData.system = foundry.utils.mergeObject(
          updatedData.system,
          updatedData.data
      );
      delete updatedData.data;
    }
    // Initialize updatedData.system if the key is present with no value
    if (Object.keys(updatedData).includes('system') && typeof updatedData.system === "undefined")
      {
        updatedData.system = {};
      }
    return updatedData;
  }

  /**
   * Takes formData and converts certain fields into an array, rather than the odd name they have by default
   * For example, submitting a form with a modifier on it results in a field value of "itemmodifier[0]", rather than
   *  a field named "itemmodifier" with a single entry in an array
   * @param formData
   */
  static explodeFormData(formData) {
    // convert the formdata into a dict
    formData = foundry.utils.expandObject(formData);
    // collapse the resulting entries with an index into an array
    const relevantEntries = Object.keys(formData?.system).filter(i => i.includes("[") && i.includes("]"));
    for (const cur_entry in relevantEntries) {
      const updatedKeyName =  relevantEntries[cur_entry].replace(/\[.*\]/, "");
      if (!Object.keys(formData.system).includes(updatedKeyName)) {
        formData.system[updatedKeyName] = [];
      }
      formData.system[updatedKeyName].push(formData.system[relevantEntries[cur_entry]]);
      delete formData.system[relevantEntries[cur_entry]];
    }
    return formData;
  }

  /**
   * Determines if a given Active Effect should have a status updated or not - based on the item it's a part of
   * For example, if a piece of armor has an attachment with a modification with a mod that's not installed,
   *  that mod should not apply any effect to the actor - even if the armor is equipped / unequipped
   * Similarly, unpurchased talents on specializations should not do anything until they are purchased
   * @param item - the item the active effect is a part of
   * @param activeEffect - the specific active effect to check
   * @returns {Promise<boolean>} - bool representing if the changes should be applied or not
   *
   */
  static async shouldUpdateAEStatus(item, activeEffect) {
    CONFIG.logger.debug(`Checking if ${activeEffect.name} from ${item.name} should be applied`);
    if (["armour", "weapon", "shipweapon"].includes(item.type)) {
      // Find the modification that owns this effect and follow its installed state. This used to
      // return from inside the loop on the FIRST modification examined - "true" whenever that one
      // did not own the effect - so only the first modification of the first attachment was ever
      // checked, and equipping the item switched on the effects of optional modifications that
      // were never installed.
      for (const attachment of item.system.itemattachment ?? []) {
        for (const modification of attachment?.system?.itemmodifier ?? []) {
          if (modification?.system?.attributes?.[activeEffect.name] === undefined) continue;
          if (!modification.system.active) {
            CONFIG.logger.debug(`Mod ${activeEffect.name} is not active, not syncing AE status`);
            return false;
          }
          CONFIG.logger.debug(`Mod ${activeEffect.name} is active, syncing AE status`);
          return true;
        }
      }
    }
    CONFIG.logger.debug(`No reason to avoid updating status found, syncing AE status`);
    return true;
  }

  /**
   * Create the Active Effects a weapon, armour or ship weapon is missing for the actor-level
   * modifiers of what is installed on it: the attachments' own modifiers and their modifications,
   * and the qualities.
   *
   * A modifier only reaches the actor through an effect on the host item named after it. Items
   * built through their sheets get those effects from the modifications editor, but imported
   * attachments carry modifier rows and no effects at all, and installing one (a drag onto the
   * weapon or armour) only copied the effects it already had - so e.g. a Portable Plasma Shield
   * gave its wearer no melee defence until someone opened and saved the attachment's editor.
   *
   * Only modifiers with an actor path get an effect: weapon/armour stat modifiers are computed by
   * the item itself, and the actor derives encumbrance from its items. New effects follow the same
   * gating as the editor's: the host's equipped state, and for a modification whether it is
   * installed. Safe to call repeatedly - an existing effect is never touched.
   * @param {Item} host
   * @param {object[]} [sources] installed attachments/qualities to cover; defaults to all of them
   * @returns {Promise<number>} the number of effects created
   */
  static async createMissingModifierEffects(host, sources) {
    if (!["weapon", "armour", "shipweapon"].includes(host?.type)) return 0;
    sources ??= [...(host.system?.itemattachment ?? []), ...(host.system?.itemmodifier ?? [])];
    // Items without an equip slot (ship weapons) are always in use.
    const equipped = host.system?.equippable ? ItemHelpers.isEffectivelyEquipped(host) : true;
    const existing = new Set(host.effects.map((e) => e.name));
    const toCreate = [];
    const collect = (attributes, active, img) => {
      for (const [key, attr] of Object.entries(attributes ?? {})) {
        if (!attr || typeof attr !== "object" || existing.has(key)) continue;
        const changes = (ModifierHelpers.explodeMod(attr.modtype, attr.mod, host.type) ?? [])
          .map((m) => ({ key: ModifierHelpers.getModKeyPath(m.modType, m.mod), mode: AE_MODES.ADD, value: attr.value }))
          .filter((c) => c.key && c.key !== "system.stats.encumbrance.value");
        if (!changes.length) continue;
        existing.add(key);
        toCreate.push({ name: key, img: img ?? host.img, changes, disabled: !(equipped && active) });
      }
    };
    for (const source of sources) {
      collect(source?.system?.attributes, true, source?.img);
      for (const mod of source?.system?.itemmodifier ?? []) collect(mod?.system?.attributes, !!mod?.system?.active, mod?.img ?? source?.img);
    }
    if (!toCreate.length) return 0;
    const created = await host.createEmbeddedDocuments("ActiveEffect", toCreate);
    // scale quality effects by their ranks, as a drop or rank change does
    await ItemHelpers.syncAEStatus(host, created);
    return created.length;
  }

  /**
   * Determine whether a learned specialization tree talent is a duplicate copy of an unranked
   * talent the actor has already learned elsewhere (another tree, or an earlier node of the same
   * tree). Per the FFG cross-tree rule such a copy is gained for free (see
   * ActorHelpers.autoPurchaseConnectedTalents), but its passive modifiers must only apply once -
   * so only the canonical copy keeps its Active Effects enabled.
   *
   * Canonical selection is deterministic: specializations are walked in document-id order and
   * talent nodes in grid order; the first learned copy of the name wins. Ranked talents are never
   * duplicates (their ranks legitimately stack), nor are talents on items not embedded in an
   * actor.
   *
   * @param {Item} item - the specialization item owning the talent being checked
   * @param {string} talentKey - the tree node key (e.g. "talent7")
   * @returns {boolean} - true when this copy's modifiers should stay suspended
   */
  static isDuplicateUnrankedTreeTalent(item, talentKey) {
    const actor = item?.actor;
    if (!actor || item.type !== "specialization") return false;
    const talent = item.system?.talents?.[talentKey];
    // Tree node flags are not schema-typed, so legacy/imported worlds can hold "true"/"false"
    // strings; coerce the same way the cascade and the refund path do, or a copy carrying
    // isRanked:"false" is never flagged as a duplicate and applies its modifiers twice.
    if (!TalentTree._bool(talent?.islearned) || TalentTree._bool(talent?.isRanked) || !talent?.name) return false;
    // Canonical selection is at SPECIALIZATION granularity: within a single tree, every node of
    // the same talent shares the same attribute keys (copied verbatim from the source talent) and
    // therefore the same single Active Effect - so two learned copies inside one tree already
    // apply only once, and must not be flagged against each other. Only a copy in a *different*
    // tree (which owns its own AE for the same modifier) is a true duplicate.
    const specs = actor.items
      .filter((i) => i.type === "specialization")
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const spec of specs) {
      const hasLearnedCopy = Object.values(spec.system?.talents ?? {}).some(
        (t) => TalentTree._bool(t?.islearned) && !TalentTree._bool(t?.isRanked) && t?.name === talent.name
      );
      if (!hasLearnedCopy) continue;
      // the first specialization (in stable id order) holding a learned copy is canonical
      return spec.id !== item.id;
    }
    return false;
  }

  /**
   * Re-sync the Active Effect state of every specialization tree on an actor. Used after tree
   * changes that can shift which copy of a shared unranked talent is canonical (cross-tree
   * auto-purchase, refunds), so duplicates get suspended and, when a canonical copy is unlearned,
   * a surviving copy takes over as the modifier source.
   * @param {Actor} actor
   * @returns {Promise<void>}
   */
  static async syncActorTreeAEs(actor) {
    if (!actor) return;
    for (const spec of actor.items.filter((i) => i.type === "specialization")) {
      await ItemHelpers.syncAEStatus(spec, spec.getEmbeddedCollection("ActiveEffect"));
    }
  }

  /**
   * Sync the status of an active effect to the parent object when an item is updated
   * For example, enable an active effect on a talent as a part of a specialization when that talent is purchased
   * @param item
   * @param activeEffects
   * @returns {Promise<void>}
   */
  static async syncAEStatus(item, activeEffects) {
    CONFIG.logger.debug(`Syncing ${activeEffects.length} Active Effects status...`);
    if (["specialization", "signatureability"].includes(item.type)) {
      CONFIG.logger.debug("specialization, or signature ability, looking through AEs to sync");
      for (const activeEffect of activeEffects) {
        if (["specialization"].includes(item.type)) {
          // Resolve the state over EVERY box referencing this effect before writing it. Boxes are
          // normally re-keyed per drop so exactly one references a given effect, but a hand-built
          // tree (or a bulk modifier sync) can leave several boxes sharing one key - and updating
          // per box made the last box in grid order win, so one unlearned box behind a learned one
          // suspended a talent the character had actually bought. The effect belongs to the talent,
          // not to a single box: it applies as soon as any non-duplicate box holding it is learned.
          let found = false;
          let learnedNonDuplicate = false;
          for (const talentKey of Object.keys(item.system.talents)) {
            const talent = item.system.talents[talentKey];
            try {
              const locatedMod = talent.attributes[activeEffect.name]; // this can throw an exception; best to handle it
              if (locatedMod) {
                found = true;
                if (TalentTree._bool(talent.islearned)) {
                  // an unranked talent learned in more than one tree (the cross-tree rule gives
                  // the later copies for free) must only apply its passive modifiers once; keep
                  // every copy but the canonical one suspended
                  const duplicate = ItemHelpers.isDuplicateUnrankedTreeTalent(item, talentKey);
                  if (duplicate) {
                    CONFIG.logger.debug(`located attribute granting AE (${activeEffect.name}) for learned talent (${talent.name}), but it is a duplicate of an unranked talent learned elsewhere; keeping suspended`);
                  } else {
                    CONFIG.logger.debug(`located attribute granting AE (${activeEffect.name}) AND the talent (${talent.name}) is learned, unsuspending`);
                    learnedNonDuplicate = true;
                  }
                } else {
                  CONFIG.logger.debug(`located attribute granting AE (${activeEffect.name}), but the talent is not learned, suspending`);
                }
              }
            } catch {
              CONFIG.logger.debug("no attribute granting AE found");
            }
          }
          if (found) {
            await activeEffect.update({disabled: !learnedNonDuplicate});
          }
        }
      }
    } else if (["forcepower"].includes(item.type)) {
      CONFIG.logger.debug("force power, looking through AEs to sync");
      for (const activeEffect of activeEffects) {
        if (["forcepower"].includes(item.type)) {
          for (const upgradeKey of Object.keys(item.system.upgrades)) {
            const upgrade = item.system.upgrades[upgradeKey];
            try {
              const locatedMod = upgrade.attributes[activeEffect.name]; // this can throw an exception; best to handle it
              if (locatedMod) {
                if (TalentTree._bool(upgrade.islearned)) {
                  CONFIG.logger.debug(`located attribute granting AE (${activeEffect.name}) AND the upgrade (${upgrade.name}) is learned, unsuspending`);
                  await activeEffect.update({disabled: false});
                } else {
                  CONFIG.logger.debug(`located attribute granting AE (${activeEffect.name}), but the upgrade is not learned, suspending`);
                  await activeEffect.update({disabled: true});
                }
              }
            } catch {
              CONFIG.logger.debug("no attribute granting AE found");
            }
          }
        }
      }
    } else if (["armour", "weapon", "shipweapon"].includes(item.type)) {
      CONFIG.logger.debug("armor and weapon, checking modifiers to sync value to rank");
      // sync AEs to the rank value - that is, if we have a mod which adds 1 to max wounds with 4 ranks, the AE should have a value of 4, not 1
      const existingEffects = item.getEmbeddedCollection("ActiveEffect");
      for (const modifier of item.system.itemmodifier) {
        for (const attr of Object.keys(modifier.system.attributes)) {
          const matchingEffect = existingEffects.find(effect => effect.name === attr);
          if (matchingEffect) {
            // the mod should be applied once per rank
            const newValue = modifier.system.rank_current * modifier.system.attributes[attr].value;
            CONFIG.logger.debug(`Located ${attr}, updating with new value of ${newValue}`);
            // Only the value changes. Deep-clone the effect's stored `_source`
            // changes and edit that in place, rather than rebuilding the change
            // from its fields: V14 replaced the numeric `mode` with the string
            // `type` and kept `mode` as a deprecated getter (removed in V16), and
            // that getter is present on the live change AND on toObject()'s copy,
            // so any read of it warns. `_source` is the raw stored data with no
            // getters, so this touches nothing deprecated and preserves whichever
            // shape the effect actually has (plus key, priority, and any siblings).
            const changes = foundry.utils.deepClone(matchingEffect._source.changes ?? []);
            if (changes.length) {
              changes[0].value = newValue;
              await matchingEffect.update({ changes });
            }
          }
        }
      }
    } else if (item.type === "ability") {
      // Abilities have no learned state and no equip slot; their modifiers are gated purely by the
      // on/off toggle on the ability itself, so every effect the ability carries follows
      // `system.active`. Anything but an explicit `true` counts as off, matching the schema default
      // - an ability nobody has switched on applies nothing. Only write when the state actually
      // differs: this runs after every sheet save, and an unconditional update would re-render for
      // nothing.
      const abilityActive = item.system?.active === true;
      CONFIG.logger.debug(`ability ${item.name} is ${abilityActive ? "active" : "inactive"}, syncing AE status`);
      for (const activeEffect of activeEffects) {
        if (activeEffect.disabled === abilityActive) {
          await activeEffect.update({disabled: !abilityActive});
        }
      }
    } else {
      CONFIG.logger.debug(`'other' item type ${item.type}, no need to sync AE status'`);
    }
  }

  /**
   * Whether an item's modifiers should currently apply to its owner.
   *
   * Equip state is two independent facts: `carried` (is it on your person at all) and `equipped`
   * (is it worn / in hand). Only an item that is BOTH counts as equipped for the purpose of Active
   * Effects, so a blaster left on the ship applies nothing even if it was still flagged equipped
   * when it was set down.
   *
   * Always read from the item document rather than from an update's `changed` payload: a write
   * that touches only one of the two keys leaves the other undefined there, and treating that as
   * false would silently suspend every effect on the item.
   *
   * @param {Item} item - the item to test
   * @returns {boolean} true when the item is carried AND equipped
   */
  static isEffectivelyEquipped(item) {
    const equippable = item?.system?.equippable;
    if (!equippable) return false;
    return !!equippable.equipped && equippable.carried !== false;
  }

  /**
   * Update the inherent Encumbrance Active Effect when armor is equipped/unequipped
   * (because the encumbrance is reduced by 3 when worn)
   * @param item - item being equipped
   * @param activeEffect - inherent AE for that item
   * @param equipped - if the item is now equipped or not
   * @returns {Promise<void>} - N/A, updates the change on the AE
   */
  static async updateEncumbranceOnEquip(item, activeEffect, equipped) {
    CONFIG.logger.debug("Updating encumbrance Active Effect on equip state change");
    const realEncumbrance = item?.system?.encumbrance?.value;
    if (item.type === "armour" && realEncumbrance) {
      const encumbranceModPath = ModifierHelpers.getModKeyPath("Stat", "Encumbrance");
      let updatedEncumbrance;
      if (equipped) {
        updatedEncumbrance = Math.max(realEncumbrance - 3, 0);
      } else {
        updatedEncumbrance = realEncumbrance;
      }
      CONFIG.logger.debug(`Original encumbrance: ${realEncumbrance}, new encumbrance: ${updatedEncumbrance}`);
      let dirty = false;
      for (const change of activeEffect.changes) {
        if (change.key === encumbranceModPath) {
          // Only write when the value actually moves. This runs for every effect on every equip
          // state change, including the bulk pass the 2.1.34 carried-state migration puts every
          // gear item through, where the value is already correct - an unconditional update there
          // is one pointless document write per effect per item across the whole world.
          if (String(change.value) !== String(updatedEncumbrance)) {
            change.value = updatedEncumbrance;
            dirty = true;
          }
          break;
        }
      }
      if (!dirty) return;
      await activeEffect.update({changes: activeEffect.changes});
    }
  }

  /**
   * Ensures unique attribute keys for a dropped item by checking and modifying its attributes, modifiers, and attachments
   * to avoid key collisions within the parent item. Also updates any matching active effects to align with the new attribute keys.
   *
   * The re-keying happens on a DETACHED CLONE, never on the document that was dropped. `fromUuid`
   * hands back the live world/compendium Item, and this function used to rewrite that document's
   * attribute keys and Active Effect names in place. Neither write is persisted here - but the
   * renamed keys sit in the live document for the rest of the session, so the next time anything
   * saved that item (opening its sheet and submitting is enough) the NEW attribute keys were
   * written to the database while the effect renames, which live only in memory, were not. The two
   * then answer to different names, and since a modifier is bound to its effect BY NAME the item
   * silently stops applying it - and hands the same broken pairing to every copy dragged from it.
   * That is the drift behind ranked talents that showed three ranks and applied two. Cloning first
   * keeps every mutation below on a throwaway copy, which is all the callers need.
   *
   * @param {Object} droppedItem - The item being added or moved, whose attributes need to be checked and adjusted if necessary
   * @param {Object} parentItem - The target item that will contain the dropped item, used to determine existing keys for comparison
   * @return {Object} - A detached copy of the dropped item with updated attribute keys and effects
   */
  static async uniqueAttrs(droppedItem, parentItem) {
    CONFIG.logger.debug(`Unique-ing attributes for dropped item ${droppedItem.name} on parent item ${parentItem.name}`);
    // Detach before touching anything. `clone` keeps the pack and (with keepId) the id, so callers
    // that read `.id` / `.pack` / `.effects` off the result see exactly what they saw before.
    if (typeof droppedItem?.clone === "function") {
      droppedItem = droppedItem.clone({}, {keepId: true});
    } else {
      droppedItem = foundry.utils.deepClone(droppedItem);
    }
    // collect the existing attrs so we can determine if there's a collision
    let existingAttrs = Object.keys(parentItem.system.attributes || {}) || [];
    if (Object.keys(parentItem.system).includes("itemmodifier")) {
      for (const modifier of parentItem.system.itemmodifier) {
        existingAttrs = [...existingAttrs, ...Object.keys(modifier.system.attributes || {})];
      }
    }
    if (Object.keys(parentItem.system).includes("itemattachment")) {
      for (const attachment of parentItem.system.itemattachment) {
        existingAttrs = [...existingAttrs, ...Object.keys(attachment.system.attributes || {})];
        for (const modification of attachment.system.itemmodifier) {
          existingAttrs = [...existingAttrs, ...Object.keys(modification.system.attributes || {})];
        }
      }
    }
    if (Object.keys(parentItem.system).includes("talents")) {
      for (const talent of Object.keys(parentItem.system.talents)) {
        if (!Object.keys(parentItem.system.talents[talent]).includes("attributes")) {
          // some talent slots do not have the "attributes" key, so we can skip them
          continue;
        }
        existingAttrs = [...existingAttrs, ...Object.keys(parentItem.system.talents[talent].attributes)];
      }
    }
    CONFIG.logger.debug(`Existing attributes: ${JSON.stringify(existingAttrs)}`);

    // now that we know the existing attrs, start looking for ones in the dropped item
    if (Object.keys(droppedItem.system).includes("attributes")) {
      for (const attr of Object.keys(droppedItem.system.attributes)) {
        const matchingEffect = droppedItem.effects.find(effect => effect.name === attr);
        const newKey = `attr${new Date().getTime()}`;
        // copy the data to the new field
        droppedItem.system.attributes[newKey] = droppedItem.system.attributes[attr];
        // delete the old field
        delete droppedItem.system.attributes[attr];
        // update the active effect
        if (matchingEffect) {
          CONFIG.logger.debug(`located matching effect from attributes ${matchingEffect.name}, updating to ${newKey}`);
          matchingEffect.name = newKey;
        }
        // ensure further keys have a new entry
          await new Promise(r => setTimeout(r, 1));
      }
    }

    if (Object.keys(droppedItem.system).includes("itemmodifier")) {
      for (const droppedModifier of droppedItem.system.itemmodifier) {
        // a modification may have no modifiers (attributes); ensure the object exists
        if (!droppedModifier.system.attributes) {
          droppedModifier.system.attributes = {};
        }
        for (const attr of Object.keys(droppedModifier.system.attributes)) {
          CONFIG.logger.debug(`checking ${attr}`);
          const matchingEffect = droppedItem.effects.find(effect => effect.name === attr);
          const newKey = `attr${new Date().getTime()}`;
          CONFIG.logger.debug(`located matching effect from itemmodifier ${droppedModifier.name} for ${attr}, updating to ${newKey}`);
          // copy the data to the new field
          droppedModifier.system.attributes[newKey] = droppedModifier.system.attributes[attr];
          // delete the old field
          delete droppedModifier.system.attributes[attr];
          // update the active effect
          if (matchingEffect) {
            matchingEffect.name = newKey;
          }
          // ensure further keys have a new entry
          await new Promise(r => setTimeout(r, 1));
        }
      }
    }

    CONFIG.logger.debug(`Done Unique-ing attributes!`);
    return droppedItem;
  }
}
