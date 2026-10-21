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
 */

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
  if (live) return live;
  for (const uuid of message?.flags?.starwarsffg?.attack?.targets ?? []) {
    let token = null;
    try {
      token = fromUuidSync(uuid);
    } catch (err) {
      token = null;
    }
    if (token?.actor) return token;
  }
  const selected = (canvas?.tokens?.controlled ?? [])
    .map((token) => token.document)
    .filter((token) => token?.actor && !isAttacker(token, message));
  return selected.length === 1 ? selected[0] : null;
}
