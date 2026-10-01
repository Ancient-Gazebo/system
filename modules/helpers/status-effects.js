/**
 * Status-effect primitives shared by the table tools (Spend Results, Character Pilot, weapon
 * quality activation).
 *
 * Three things live here:
 *
 *  1. "Next check" dice statuses that STACK. The system already ships Boost / Setback / Upgrade /
 *     Upgrade Difficulty "Next Check" statuses (see swffg-main.js) and the roll builder already
 *     consumes them after one roll. Core keeps one effect per status per actor, so granting a second
 *     boost has to raise a count on the existing effect instead - ActiveEffectFFG#getStackCount
 *     multiplies the effect's additive changes by it during data preparation.
 *
 *  2. Statuses with a lifetime: "for 2 rounds" (Burn, Disorient, Ensnare, ...) or "until the end of
 *     your next turn" (Guarded Stance). The lifetime is tracked in `flags.starwarsffg.expiry` and
 *     enforced by the active GM in {@link registerStatusExpiry}; core's own duration is filled in
 *     as well, but only so the Effects tab and the token icon read correctly.
 *
 *  3. Everything here is the LOCAL write. Callers that may be acting on an actor they do not own
 *     go through gm-bridge's `applyToTargetActor` ("next-check" / "status" operations), which lands
 *     back in these functions on the GM's client.
 */
import { currentCombatant, turnKey } from "./combat-turns.js";

/** Next-check kinds -> the status effect that implements them. */
export const NEXT_CHECK = Object.freeze({
  boost: "starwarsffg-boost-once",
  setback: "starwarsffg-setback-once",
  upgradeAbility: "starwarsffg-upgrade-once",
  upgradeDifficulty: "starwarsffg-upgrade-difficulty-once",
});

/** Statuses the tools apply by name. Prone keeps its historical id (it was once "Staggered"). */
export const STATUS = Object.freeze({
  prone: "starwarsffg-staggered",
  disoriented: "starwarsffg-disoriented",
  immobilized: "starwarsffg-immobilized",
  cover: "starwarsffg-cover",
  guardedStance: "starwarsffg-guarded-stance",
  burning: "burning",
  blinded: "blinded",
  invisible: "invisible",
});

/**
 * The track an actor suffers or recovers strain on.
 *
 * Characters and nemeses have a strain track. A vehicle's equivalent is system strain. Minions and
 * rivals have neither: by the rules strain they suffer is taken as wounds, and they have nothing
 * to recover.
 *
 * This is decided by actor TYPE, not by which fields exist. The minion data model declares a
 * `stats.strain` block that nothing reads and no sheet shows, so "has a strain field" sent a
 * minion's strain into a number nobody could see. A character or nemesis whose strain threshold has
 * been switched off in Sheet Options is treated like the adversaries that have none.
 *
 * @param {?Actor} actor
 * @param {boolean} suffering  whether strain is being added (true) or recovered (false)
 * @returns {?("strain"|"systemStrain"|"wounds")} the key under `system.stats`, or null
 */
export function strainTrack(actor, suffering) {
  if (!actor) return null;
  const stats = actor.system?.stats ?? {};
  if (actor.type === "vehicle") return stats.systemStrain ? "systemStrain" : null;
  const usesStrain =
    ["character", "nemesis"].includes(actor.type) &&
    !!stats.strain &&
    actor.flags?.starwarsffg?.config?.enableStrainThreshold !== false;
  if (usesStrain) return "strain";
  return suffering && stats.wounds ? "wounds" : null;
}

/**
 * @param {string} statusId
 * @returns {?object} the CONFIG.statusEffects entry
 */
export function statusDefinition(statusId) {
  return CONFIG.statusEffects?.find?.((status) => status?.id === statusId) ?? null;
}

/**
 * @param {string} statusId
 * @returns {string} the localized status name, or the id when it is not registered
 */
export function statusLabel(statusId) {
  const status = statusDefinition(statusId);
  return status ? game.i18n.localize(status.name ?? status.label ?? statusId) : statusId;
}

/**
 * @param {?Actor} actor
 * @param {string} statusId
 * @returns {?ActiveEffect} the actor's enabled effect carrying that status
 */
export function findStatusEffect(actor, statusId) {
  if (!actor || !statusId) return null;
  return actor.effects.find((effect) => !effect.disabled && effect.statuses?.has?.(statusId)) ?? null;
}

/**
 * @param {?ActiveEffect} effect
 * @returns {number} how many stacks the effect is worth; 0 for no effect
 */
export function stackCount(effect) {
  if (!effect) return 0;
  return effect.getStackCount?.() ?? 1;
}

/**
 * @param {?Actor} actor
 * @param {string} kind  a key of {@link NEXT_CHECK}
 * @returns {number} stacks of that next-check status currently on the actor
 */
export function nextCheckCount(actor, kind) {
  return stackCount(findStatusEffect(actor, NEXT_CHECK[kind]));
}

function counterModuleActive() {
  return Boolean(game.modules?.get?.("statuscounter")?.active);
}

/**
 * The effect's display name for a stack count. Without Status Icon Counters the count has nowhere
 * else to show, so it rides on the name ("Boost Next Check ×2"). With the module its badge on the
 * token icon shows the count - and a GM can change that badge by hand, which would leave a count
 * baked into the name stale - so the name is left bare.
 */
function stackedName(baseName, count) {
  return count > 1 && !counterModuleActive() ? `${baseName} ×${count}` : baseName;
}

/**
 * Write a stack count onto an existing effect, deleting it at zero. When Status Icon Counters is
 * running the count goes through the module's own counter, so its badge (and whether the badge is
 * shown at all, which is the module's setting) stays the module's business.
 */
async function writeStackCount(effect, count) {
  if (count <= 0) {
    await effect.delete();
    return 0;
  }
  const baseName = effect.flags?.starwarsffg?.baseName ?? statusLabel([...(effect.statuses ?? [])][0]);
  await effect.update({
    name: stackedName(baseName, count),
    "flags.starwarsffg.stacks": count,
    "flags.starwarsffg.baseName": baseName,
  });
  if (counterModuleActive()) {
    const counter = effect.statusCounter;
    if (typeof counter?.setValue === "function") await counter.setValue(count);
    else await effect.update({ "flags.statuscounter.value": count, "flags.statuscounter.visible": count > 1 });
  }
  return count;
}

/**
 * Add stacks of a next-check status to an actor the current client can modify.
 * @param {Actor} actor
 * @param {string} kind         a key of {@link NEXT_CHECK}
 * @param {number} [amount=1]
 * @returns {Promise<{count: number, previous: number}>}
 */
export async function applyNextCheckLocal(actor, kind, amount = 1) {
  const statusId = NEXT_CHECK[kind];
  if (!actor || !statusId) throw new Error(`Unknown next-check effect: ${kind}`);
  amount = Math.max(1, Math.trunc(Number(amount) || 1));

  const existing = findStatusEffect(actor, statusId);
  if (existing) {
    const previous = stackCount(existing);
    return { count: await writeStackCount(existing, previous + amount), previous };
  }

  // Built the way Actor#toggleStatusEffect builds it, so the effect is indistinguishable from one
  // toggled on the Token HUD (same static id, same `duration: "once"` flag the roll builder reads).
  const effect = await ActiveEffect.implementation.fromStatusEffect(statusId, { parent: actor });
  const baseName = effect.name;
  effect.updateSource({ name: stackedName(baseName, amount), flags: { starwarsffg: { stacks: amount, baseName } } });
  const created = await ActiveEffect.implementation.create(effect.toObject(), { parent: actor, keepId: true });
  // Status Icon Counters gives a new effect its own default counter (a count of one) as it is
  // created; anything above one is then set through that counter like any later change.
  if (amount > 1 && created && counterModuleActive()) await writeStackCount(created, amount);
  return { count: amount, previous: 0 };
}

/**
 * Remove stacks of a next-check status from an actor the current client can modify.
 * @returns {Promise<{count: number, previous: number}>}
 */
export async function removeNextCheckLocal(actor, kind, amount = 1) {
  const existing = findStatusEffect(actor, NEXT_CHECK[kind]);
  if (!existing) return { count: 0, previous: 0 };
  amount = Math.max(1, Math.trunc(Number(amount) || 1));
  const previous = stackCount(existing);
  return { count: await writeStackCount(existing, Math.max(0, previous - amount)), previous };
}

/**
 * Core's duration model for "N rounds", in whichever shape the running generation stores.
 */
function roundsDuration(rounds) {
  if (game.release.generation >= 14) return { value: rounds, units: "rounds" };
  return {
    rounds,
    startRound: game.combat?.round ?? null,
    startTurn: game.combat?.turn ?? null,
    combat: game.combat?.id ?? null,
  };
}

/**
 * Apply a status to an actor the current client can modify, optionally with a lifetime.
 *
 * @param {Actor} actor
 * @param {object} spec
 * @param {?string} [spec.statusId]  a registered status id. Omit for a free-form marker effect.
 * @param {?string} [spec.key]       identity for a free-form effect, so re-applying refreshes it
 *                                   instead of stacking a duplicate
 * @param {?string} [spec.name]      overrides the status name (e.g. "Burn 2 (6 damage per round)")
 * @param {?string} [spec.img]
 * @param {?number} [spec.rounds]    remove after this many full rounds of the current combat
 * @param {boolean} [spec.untilEndOfNextTurn]  remove when the actor's next turn ends
 * @returns {Promise<?ActiveEffect>}
 */
export async function applyStatusLocal(actor, { statusId = null, key = null, name = null, img = null, rounds = null, untilEndOfNextTurn = false } = {}) {
  if (!actor) return null;
  const combat = game.combat;
  const data = {};
  if (name) data.name = name;
  if (img) data.img = img;

  let expiry = null;
  rounds = Math.trunc(Number(rounds));
  if (Number.isFinite(rounds) && rounds > 0) {
    data.duration = roundsDuration(rounds);
    // No running combat means nothing ever advances the round: leave the lifetime to the GM.
    if (combat?.started) expiry = { type: "rounds", combatId: combat.id, endRound: combat.round + rounds };
  } else if (untilEndOfNextTurn && combat?.started) {
    expiry = { type: "afterNextTurn", combatId: combat.id, createdTurnKey: turnKey(combat), armed: false };
  }

  const toolFlags = { tool: key ?? statusId };
  if (expiry) toolFlags.expiry = expiry;

  const existing = statusId
    ? findStatusEffect(actor, statusId)
    : actor.effects.find((effect) => effect.flags?.starwarsffg?.tool === key) ?? null;
  if (existing) {
    const update = { ...data, "flags.starwarsffg.tool": toolFlags.tool };
    if (expiry) update["flags.starwarsffg.expiry"] = expiry;
    await existing.update(update);
    // An effect re-applied WITHOUT a lifetime must stop expiring on the old one.
    if (!expiry && existing.flags?.starwarsffg?.expiry) await existing.unsetFlag("starwarsffg", "expiry");
    return existing;
  }

  if (statusId && statusDefinition(statusId)) {
    const effect = await ActiveEffect.implementation.fromStatusEffect(statusId, { parent: actor });
    effect.updateSource({ ...data, flags: { starwarsffg: toolFlags } });
    return ActiveEffect.implementation.create(effect.toObject(), { parent: actor, keepId: true });
  }

  const marker = {
    name: name ?? key ?? "Effect",
    img: img ?? "icons/svg/aura.svg",
    disabled: false,
    flags: { starwarsffg: toolFlags },
  };
  if (data.duration) marker.duration = data.duration;
  // V14 only draws the token icon of a non-status effect while it is "temporary"; a marker with no
  // lifetime (applied outside combat) would otherwise be invisible.
  const showAlways = CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS;
  if (showAlways !== undefined) marker.showIcon = showAlways;
  const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [marker]);
  return created ?? null;
}

/**
 * Remove a status from an actor the current client can modify.
 * @returns {Promise<boolean>} whether anything was removed
 */
export async function removeStatusLocal(actor, statusId) {
  const effect = findStatusEffect(actor, statusId);
  if (!effect) return false;
  await effect.delete();
  return true;
}

/**
 * The effects the tools are allowed to sweep away: statuses and tool-created markers. Never the
 * actor's other effects - XP purchases, species and talent modifiers are Active Effects too, and
 * deleting those would silently rewrite the character.
 * @param {Actor} actor
 * @returns {ActiveEffect[]}
 */
export function temporaryStatusEffects(actor) {
  return actor?.effects?.filter?.((effect) => (effect.statuses?.size ?? 0) > 0 || !!effect.flags?.starwarsffg?.tool) ?? [];
}

/* -------------------------------------------- */
/*  Expiry                                      */
/* -------------------------------------------- */

function expiringEffects(actor, predicate) {
  return actor?.effects?.filter?.((effect) => {
    const expiry = effect.flags?.starwarsffg?.expiry;
    return !!expiry && predicate(expiry, effect);
  }) ?? [];
}

async function deleteEffects(actor, effects) {
  const ids = effects.map((effect) => effect.id).filter((id) => actor.effects.has(id));
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

function combatActors(combat) {
  const actors = new Map();
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (actor) actors.set(actor.uuid, actor);
  }
  return [...actors.values()];
}

/**
 * Enforce status lifetimes as a combat advances. Safe to call on every client: only the active GM
 * acts, so an effect is never deleted twice.
 *
 *  - "rounds": removed once the combat has moved past the round the effect was due to end in.
 *  - "afterNextTurn": armed when its actor's next turn begins and removed when that turn ends. An
 *    effect created during the actor's own turn (Guarded Stance) is not armed by that same turn, so
 *    it survives until the end of the FOLLOWING one, as the rule reads.
 */
export function registerStatusExpiry() {
  // combat id -> { key, combatantId } of the turn last seen; in memory only, so a GM reload simply
  // misses one "turn ended" edge rather than expiring something early.
  const lastTurn = new Map();

  const onCombatChange = async (combat) => {
    if (!game.users.activeGM?.isSelf) return;
    if (!combat?.started) return;

    const acting = currentCombatant(combat);
    const current = { key: turnKey(combat), combatantId: acting?.id ?? null };
    const previous = lastTurn.get(combat.id) ?? null;
    if (previous?.key === current.key) return;
    lastTurn.set(combat.id, current);

    try {
      // the turn that just ended
      const leaving = previous?.combatantId ? combat.combatants.get(previous.combatantId)?.actor : null;
      if (leaving) {
        await deleteEffects(leaving, expiringEffects(leaving, (expiry) => expiry.type === "afterNextTurn" && expiry.armed));
      }

      // the turn that just began
      const entering = acting?.actor;
      if (entering) {
        const toArm = expiringEffects(
          entering,
          (expiry) => expiry.type === "afterNextTurn" && !expiry.armed && expiry.createdTurnKey !== current.key
        );
        for (const effect of toArm) await effect.update({ "flags.starwarsffg.expiry.armed": true });
      }

      // round-based lifetimes
      for (const actor of combatActors(combat)) {
        await deleteEffects(
          actor,
          expiringEffects(actor, (expiry) => expiry.type === "rounds" && expiry.combatId === combat.id && combat.round > expiry.endRound)
        );
      }
    } catch (err) {
      CONFIG.logger?.warn?.("Status expiry failed", err);
    }
  };

  Hooks.on("updateCombat", (combat) => onCombatChange(combat));

  // The encounter is over: anything that was counting its rounds or turns has nothing left to count.
  Hooks.on("deleteCombat", async (combat) => {
    lastTurn.delete(combat.id);
    if (!game.users.activeGM?.isSelf) return;
    try {
      for (const actor of combatActors(combat)) {
        await deleteEffects(actor, expiringEffects(actor, (expiry) => expiry.combatId === combat.id));
      }
    } catch (err) {
      CONFIG.logger?.warn?.("Status cleanup on combat end failed", err);
    }
  });
}
