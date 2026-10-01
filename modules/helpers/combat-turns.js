/**
 * Slot-aware "whose turn is it" helpers.
 *
 * With generic initiative slots (the default) the Combatant at `combat.turns[combat.turn]` is only
 * the SLOT - the unit that rolled that initiative value. The unit actually acting is whichever
 * combatant claimed the slot this round, and an unclaimed slot belongs to nobody yet. Anything that
 * asks "is it this actor's turn" has to go through the claim, or it answers for the wrong unit.
 *
 * With generic slots switched off the stock Combat document is in use, there are no claims, and the
 * turn's combatant is the one acting. Every helper here handles both.
 */

/**
 * The viewed combat, but only once it is actually running.
 * @returns {?Combat}
 */
export function activeCombat() {
  const combat = game.combat;
  if (!combat) return null;
  if (!(combat.started === true || Number(combat.round) > 0)) return null;
  return combat;
}

/**
 * @param {?Combat} combat
 * @returns {boolean} whether this combat tracks initiative as claimable slots
 */
export function usesSlots(combat) {
  return typeof combat?.getSlotClaims === "function";
}

/**
 * The combatant acting in a given turn entry: the slot's claimant in slot mode (null while the slot
 * is unclaimed), the entry itself otherwise.
 * @param {Combat} combat
 * @param {?Combatant} turn   an entry of `combat.turns`
 * @param {number} [round]
 * @returns {?Combatant}
 */
export function slotClaimant(combat, turn, round = combat?.round) {
  if (!combat || !turn) return null;
  if (!usesSlots(combat)) return turn;
  const claimantId = combat.getSlotClaims(round, turn.id);
  return claimantId ? combat.combatants.get(claimantId) ?? null : null;
}

/**
 * @param {?Combat} [combat]
 * @returns {?Combatant} the combatant whose turn it currently is, if anyone's
 */
export function currentCombatant(combat = activeCombat()) {
  if (!combat) return null;
  return slotClaimant(combat, combat.turns?.[combat.turn]);
}

/**
 * A string that changes whenever the acting unit changes: a new round, a new turn, or the current
 * slot being claimed. Used to tell "still the same turn" apart from "a new one began".
 * @param {?Combat} [combat]
 * @returns {?string}
 */
export function turnKey(combat = activeCombat()) {
  if (!combat) return null;
  return `${combat.id}:${combat.round}:${combat.turn}:${currentCombatant(combat)?.id ?? "open"}`;
}

/**
 * @param {?Actor} actor
 * @param {?Combat} [combat]
 * @returns {boolean} whether the acting combatant is this actor. Compared by uuid, so an unlinked
 *   token's actor only matches its own token and not its siblings.
 */
export function isActorsTurn(actor, combat = activeCombat()) {
  if (!actor || !combat) return false;
  const acting = currentCombatant(combat)?.actor;
  return !!acting && acting.uuid === actor.uuid;
}

/**
 * Token disposition of a combatant. CombatantFFG exposes it directly (it also covers extra slots
 * that have no token behind them); the stock Combatant only has it on its token.
 * @param {?Combatant} combatant
 * @returns {?number}
 */
export function combatantDisposition(combatant) {
  const raw = combatant?.disposition ?? combatant?.token?.disposition ?? combatant?.actor?.prototypeToken?.disposition;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Whether a combatant's token is hidden from players on its scene.
 * @param {?Combatant} combatant
 * @returns {boolean}
 */
export function combatantHidden(combatant) {
  return Boolean(combatant?.token?.hidden ?? combatant?.hidden ?? false);
}
