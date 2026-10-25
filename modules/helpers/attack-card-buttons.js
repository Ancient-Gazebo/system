/**
 * The Apply Damage and Apply Crit buttons of an attack card, handled once for the whole page.
 *
 * The weapon card is drawn inside the roll's `.dice-roll`, which carries core's
 * `data-action="expandRoll"`. A click on either button that no listener of ours stops reaches the
 * chat log's action handler, which finds that ancestor and toggles the dice breakdown - so a button
 * without its listener "only expands the roll". Each button used to get that listener from the
 * system's renderChatMessageHTML hook, which binds it only after awaiting a re-render of the card's
 * dice symbols whenever the card's text holds one (a `[XX` or `:word:` code, which a bracketed item
 * or quality name is enough for), so a copy of the card could be without it:
 *   - a click while that await was still running (core inserts the card before it resolves);
 *   - a card whose markup something replaced after the bind (the hook's own rewrite runs first, but
 *     nothing stops a later one);
 *   - a hook run that stopped before reaching the bind.
 * Which of these happened depended on the card's content and on timing, so the failure came and
 * went.
 *
 * One capture-phase listener per document runs before any listener on the card and before core's
 * action handler, whatever state that copy of the card is in: the chat log, its notifications, the
 * chat popout, and a chat log moved into a detached window of its own. The listener the render hook
 * still binds on each button only answers if this one is somehow bypassed.
 */
import { ApplyDamage } from "./apply-damage.js";
import { ApplyCrit } from "./apply-crit.js";

const BUTTONS = ".ffg-apply-damage, .ffg-apply-crit";

/** @param {MouseEvent} event */
function onClick(event) {
  // duck-typed: a node in a detached window is not an instance of this window's Element
  const button = typeof event.target?.closest === "function" ? event.target.closest(BUTTONS) : null;
  if (!button) return;
  const message = game.messages?.get(button.closest("[data-message-id]")?.dataset.messageId);
  if (!message) return;
  event.preventDefault();
  // stopped here, in the capture phase, the click never reaches the card or core's expandRoll action
  event.stopPropagation();
  if (button.classList.contains("ffg-apply-damage")) ApplyDamage.click(message);
  else ApplyCrit.click(message);
}

/** Start handling the buttons. Call once. */
export function registerAttackCardButtons() {
  document.addEventListener("click", onClick, { capture: true });
  Hooks.on("openDetachedWindow", (_id, win) => {
    win?.document?.addEventListener("click", onClick, { capture: true });
  });
}
