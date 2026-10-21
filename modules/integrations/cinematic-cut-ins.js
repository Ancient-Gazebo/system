/**
 * Cinematic Cut-ins compatibility shim (Foundry V14).
 *
 * Cinematic Cut-ins plays an actor's Turn Start and Turn End cut-ins from an `updateCombat` hook. Two
 * things go wrong with it here:
 *
 *  1. It decides that the turn has moved on by comparing `combat.previous.combatantId` with the
 *     current combatant. Through V13 core rewrote `previous` on every update to a Combat, so an update
 *     that left the turn alone compared equal. V14 only moves `previous` when the round, turn or
 *     combatant actually changes (Combat#_onUpdate, `#recordStateChange`); for the rest of the turn it
 *     keeps pointing at the turn before. So once an encounter was under way the module saw "a new
 *     turn" on every update to the Combat - claiming an initiative slot, a "next allied check" bought
 *     with Spend Results waiting on its slot, any flag a module keeps on the encounter - and played the
 *     current combatant's Turn Start cut-in again each time. With the round-1 entrance cut-ins this
 *     table gives its adversaries, that was the cut-in replaying all through round 1.
 *
 *  2. It knows nothing of initiative slots. `combat.combatant` is whoever ROLLED the slot's
 *     initiative; the unit that acts is whoever claims it (see helpers/combat-turns.js). So a slot
 *     claimed by someone else played the roller's entrance.
 *
 * The shim finds the module's handler and decides itself when a turn starts and ends, then runs the
 * handler against a view of the Combat whose `combatant` is the acting unit and whose
 * `previous.combatantId` is the unit whose turn just ended:
 *   - a turn starts when its slot is claimed (at once, when the slot is already claimed as the turn
 *     comes round); an unclaimed slot starts nobody's turn;
 *   - a turn ends when the encounter moves to another slot or round. Releasing a claim is a
 *     correction, not the end of a turn, and a unit claiming the same slot again in the same round
 *     does not get its Turn Start a second time;
 *   - anything else (flags, other modules' bookkeeping) passes nothing to the module at all.
 * A combat without slots (generic slots switched off) has the turn's combatant acting, as the
 * module assumed. Round Start / Combat Start scene cut-ins still see the real update.
 *
 * Soft dependency: no-op on V13, when the module is absent or inactive, or when its handler cannot be
 * recognised (a release that restructured it).
 */

import { slotClaimant } from "../helpers/combat-turns.js";

const MODULE_ID = "cinematic-cut-ins";

/**
 * The module registers the handler when its script is imported (automation/combat-hooks.js). It is
 * recognised by what it handles rather than by name, which survives a rename or a move.
 * @param {Function} fn
 * @returns {boolean}
 */
function isTurnTriggerHandler(fn) {
  const source = Function.prototype.toString.call(fn);
  return source.includes("triggerOnCombatStart") && source.includes("turnStart");
}

/**
 * Where an encounter stands: the round, the slot whose turn it is, and who is acting in it.
 * @param {Combat} combat
 * @param {number} [round]
 * @param {?string} [slotId]
 * @returns {{round: ?number, slotId: ?string, actingId: ?string}}
 */
function standing(combat, round = combat.round, slotId = combat.turns?.[combat.turn]?.id ?? null) {
  const slot = slotId ? combat.combatants.get(slotId) ?? null : null;
  return { round: round ?? null, slotId, actingId: slot ? slotClaimant(combat, slot, round)?.id ?? null : null };
}

/**
 * Decides, update by update, whose turn starts and whose ends. State lives in memory: at ready every
 * encounter's current turn counts as started already, so a reload never replays an entrance.
 */
function turnTracker() {
  const last = new WeakMap(); // combat -> standing as of the last update
  const started = new WeakMap(); // combat -> Set of "round:slot:unit" whose Turn Start has played

  const startedIn = (combat) => {
    let keys = started.get(combat);
    if (!keys) started.set(combat, (keys = new Set()));
    return keys;
  };
  const keyOf = (state) => `${state.round}:${state.slotId}:${state.actingId}`;

  return {
    /** Take an encounter's current turn as already started. */
    remember(combat) {
      const now = standing(combat);
      last.set(combat, now);
      if (now.actingId) startedIn(combat).add(keyOf(now));
    },

    /**
     * @param {Combat} combat
     * @param {object} changed
     * @returns {?{starts: ?Combatant, endsId: ?string}} null when the update starts and ends nothing
     */
    decide(combat, changed) {
      const now = standing(combat);
      let before = last.get(combat);
      last.set(combat, now);
      if (!before) {
        // Not seen yet (created elsewhere after this client loaded): only a real turn change counts,
        // measured against core's record of the turn before it.
        if (!("round" in changed) && !("turn" in changed)) return null;
        const previous = combat.previous ?? {};
        before = standing(combat, previous.round ?? null, previous.combatantId ?? null);
      }

      const turnMoved = before.round !== now.round || before.slotId !== now.slotId;
      if (!turnMoved && before.actingId === now.actingId) return null;

      let starts = null;
      if (now.actingId && !startedIn(combat).has(keyOf(now))) {
        startedIn(combat).add(keyOf(now));
        starts = combat.combatants.get(now.actingId) ?? null;
      }
      // a released or repeated claim inside the same turn neither ends nor starts anything
      if (!turnMoved && !starts) return null;
      return { starts, endsId: turnMoved ? before.actingId : null };
    },
  };
}

/**
 * The Combat as the module should see it for one update.
 * @param {Combat} combat
 * @param {{starts: ?Combatant, endsId: ?string}} turn
 * @returns {Combat}
 */
function viewOf(combat, { starts, endsId }) {
  const previous = { ...(combat.previous ?? {}), combatantId: endsId };
  return new Proxy(combat, {
    get(target, key) {
      if (key === "combatant") return starts;
      if (key === "previous") return previous;
      const value = Reflect.get(target, key, target);
      // methods run against the real document (private fields do not survive a Proxy receiver)
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function registerCinematicCutInsShim() {
  Hooks.once("ready", () => {
    try {
      if (game.release.generation < 14) return;
      if (!game.modules.get(MODULE_ID)?.active) return;
      const entry = (Hooks.events.updateCombat ?? []).find(
        (hooked) => typeof hooked?.fn === "function" && isTurnTriggerHandler(hooked.fn)
      );
      if (!entry) {
        CONFIG.logger.debug("Cinematic Cut-ins is active but its turn trigger handler was not recognised; skipping shim");
        return;
      }

      const tracker = turnTracker();
      for (const combat of game.combats) tracker.remember(combat);
      Hooks.on("createCombat", (combat) => tracker.remember(combat));

      // Core calls `entry.fn` when the hook fires, so replacing it keeps the handler's place in the
      // hook order.
      const original = entry.fn;
      entry.fn = function (combat, changed, ...args) {
        const turn = tracker.decide(combat, changed ?? {});
        if (!turn) return;
        return original.call(this, viewOf(combat, turn), changed, ...args);
      };
      CONFIG.logger.info("Applied the Cinematic Cut-ins turn trigger shim (Turn Start/End follow initiative slot claims)");
    } catch (err) {
      CONFIG.logger.warn(`Failed to apply the Cinematic Cut-ins shim: ${err}`);
    }
  });
}
