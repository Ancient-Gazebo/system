/**
 * Which token the Apply Damage and Apply Crit buttons on an attack card act on.
 *
 * They used to read only the clicking user's targeted token. That missed two common cases:
 *   - targets do not last: Monk's Combat Details releases a user's targets when their turn ends (its
 *     Clear Targets option, on by default), and targeting the next enemy replaces them;
 *   - a GM who points at the victim by selecting its token rather than targeting it. The click then
 *     only warned "Target a token", easy to miss, while the dice breakdown expanded underneath.
 *
 * So, in order:
 *   1. the token the user has targeted now (lets Blast or Auto-fire damage go to another token);
 *   2. the token the attack was rolled against, which the card records when the dice are rolled
 *      (`flags.starwarsffg.attack.targets`, see RollBuilderFFG) and Spend Results already acts on;
 *   3. the token the user has selected - only when exactly one is, and never the attacker's own,
 *      which is usually the one selected when a GM rolls for it.
 * For a player, a targeted token they do not own comes after 2: on an adversary's attack (see
 * playersMayApply) the player is usually the one hit, with their own last target still set on an
 * enemy.
 */

/** Attacker types whose attack cards any player may resolve, not only the GM and the roller. */
const PLAYER_APPLY_ATTACKERS = ["minion", "rival", "nemesis", "vehicle"];

/**
 * @param {ChatMessage} message  the attack's chat message
 * @returns {?Actor} who made the attack: the speaker's token actor where there is one, else its actor
 */
export function attackerActor(message) {
  const speaker = message?.speaker ?? {};
  let actor = null;
  try {
    actor = ChatMessage.implementation.getSpeakerActor(speaker);
  } catch (err) {
    actor = null;
  }
  return actor ?? game.actors.get(speaker.actor) ?? null;
}

/**
 * Whether any player may use Apply Damage and Apply Crit on an attack card, rather than only the GM
 * (and, for Apply Crit, the roller). True for an attack by a minion, rival or nemesis, and for a
 * vehicle's: rolled from the vehicle sheet, or a ship weapon a crew member fired, whose card speaks for
 * the crew member rather than the vehicle. The player using them is usually the one hit, applying the
 * damage to their own character and choosing their own Block or Deflect.
 * @param {ChatMessage} message
 * @returns {boolean}
 */
export function playersMayApply(message) {
  if (message?.rolls?.[0]?.data?.type === "shipweapon") return true;
  return PLAYER_APPLY_ATTACKERS.includes(attackerActor(message)?.type);
}

/**
 * @param {TokenDocument} token
 * @param {ChatMessage} message
 * @returns {boolean} whether the token is the one that made the attack
 */
function isAttacker(token, message) {
  const speaker = message?.speaker ?? {};
  if (speaker.token) return token.id === speaker.token;
  return !!speaker.actor && token.actorLink && token.actorId === speaker.actor;
}

/**
 * @param {ChatMessage} message  the attack's chat message
 * @returns {?TokenDocument} the target to apply to, or null when there is none
 */
export function attackTarget(message) {
  const live = Array.from(game.user.targets ?? [])[0]?.document;
  if (live && (game.user.isGM || live.isOwner)) return live;
  for (const uuid of message?.flags?.starwarsffg?.attack?.targets ?? []) {
    let token = null;
    try {
      token = fromUuidSync(uuid);
    } catch (err) {
      token = null;
    }
    if (token?.actor) return token;
  }
  if (live) return live;
  const selected = (canvas?.tokens?.controlled ?? [])
    .map((token) => token.document)
    .filter((token) => token?.actor && !isAttacker(token, message));
  return selected.length === 1 ? selected[0] : null;
}
