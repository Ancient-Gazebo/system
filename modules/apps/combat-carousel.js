/**
 * Combat carousel: the round's initiative order as a strip of cards along the top of the canvas.
 *
 * It shows the same thing as the sidebar tracker - each slot, which side it belongs to, who has
 * claimed it, and which one is up - for players who keep the sidebar on chat during a fight, and it
 * lets the acting side claim the open slot without leaving the canvas.
 *
 * It is a view over the combat document and nothing else: it stores no state of its own (beyond
 * whether this user has it collapsed), and every action goes through the same Combat methods the
 * tracker calls, so the two cannot disagree.
 *
 * Works with and without generic slots; without them every card is simply its combatant.
 */
import PopoutEditor from "../popout-editor.js";
import { activeCombat, combatantDisposition, combatantHidden, slotClaimant, usesSlots } from "../helpers/combat-turns.js";
import { escapeHTML, loc } from "../helpers/html.js";

const ELEMENT_ID = "ffg-combat-carousel";
const COLLAPSED_SETTING = "combatCarouselCollapsed";
const HIDDEN_IMG = "systems/starwarsffg/images/combat/hidden.png";

let renderTimer = null;

function sideOf(disposition) {
  const D = CONST.TOKEN_DISPOSITIONS;
  if (disposition === D.FRIENDLY) return "friendly";
  if (disposition === D.HOSTILE) return "hostile";
  if (disposition === D.SECRET) return "secret";
  return "neutral";
}

/** Initiative as the tracker prints it: successes, then advantages, then triumphs, as symbols. */
function initiativeMarkup(initiative) {
  if (!Number.isFinite(initiative)) return "";
  const text = initiative.toFixed(2);
  const dot = text.indexOf(".");
  const parts = [
    [parseInt(text.substring(0, dot), 10), "[SU]"],
    [parseInt(text.substring(dot + 2, dot + 3), 10), "[AD]"],
    [parseInt(text.substring(dot + 1, dot + 2), 10), "[TR]"],
  ];
  return parts
    .filter(([count]) => count > 0)
    .map(([count, code]) => `<span>${count}${PopoutEditor.replaceDiceSymbols(code)}</span>`)
    .join("");
}

/** Units of a side that are alive and have not acted this round. */
function waitingCount(combat, disposition) {
  return combat.combatants.filter(
    (combatant) =>
      combatantDisposition(combatant) === disposition &&
      !combatant.getFlag("starwarsffg", "fake") &&
      !combatant.isDefeated &&
      !combat.hasClaims(combatant.id)
  ).length;
}

/**
 * One entry per turn, in initiative order.
 * @param {Combat} combat
 */
function buildSlots(combat) {
  const slotMode = usesSlots(combat);
  const freeSeen = new Map();
  const waiting = new Map();

  // Without slots a hidden combatant is left out for players altogether, as the stock tracker does.
  // With slots the card stays (the slot itself is public knowledge) and only its occupant is masked.
  const visible = (slot) => slotMode || !slot.hidden;

  return (combat.turns ?? []).map((turn, index) => {
    const holder = combat.combatants.get(turn.id) ?? turn;
    const disposition = combatantDisposition(holder) ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL;
    const claimant = slotClaimant(combat, turn);
    const active = combat.turn === index;
    const passed = index < combat.turn;

    // A side with more slots than units left to act leaves its last open slots unused. Slots the
    // round has already moved past are not counted: they were skipped, not held back.
    let unused = false;
    if (slotMode && !claimant && !passed) {
      const seen = (freeSeen.get(disposition) ?? 0) + 1;
      freeSeen.set(disposition, seen);
      if (!waiting.has(disposition)) waiting.set(disposition, waitingCount(combat, disposition));
      unused = seen > waiting.get(disposition);
    }

    const hidden = claimant ? combatantHidden(claimant) && !game.user.isGM : false;
    return {
      index,
      side: sideOf(disposition),
      active,
      passed,
      unused,
      claimed: !!claimant,
      claimantId: claimant?.id ?? null,
      hidden,
      defeated: !!claimant?.isDefeated,
      name: claimant ? (hidden ? game.i18n.localize("SWFFG.Combats.Actors.Hidden") : claimant.name) : null,
      img: claimant ? (hidden ? HIDDEN_IMG : claimant.img ?? claimant.token?.texture?.src ?? claimant.actor?.img ?? CONST.DEFAULT_TOKEN) : null,
      initiative: initiativeMarkup(holder.initiative),
      canClaim: slotMode && active && !claimant && !unused && (game.user.isGM || disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY),
    };
  }).filter(visible);
}

function slotMarkup(slot) {
  const classes = ["ffg-cc-slot", `ffg-cc-${slot.side}`];
  if (slot.active) classes.push("active");
  if (slot.passed) classes.push("passed");
  if (slot.unused) classes.push("unused");
  if (slot.defeated) classes.push("defeated");
  classes.push(slot.claimed ? "claimed" : "open");

  let body;
  if (slot.claimed) {
    body = `
      <button type="button" class="ffg-cc-portrait" data-focus="${escapeHTML(slot.claimantId)}" ${slot.hidden ? "disabled" : ""} data-tooltip="${escapeHTML(slot.name)}">
        <img src="${escapeHTML(slot.img)}" alt="" />
      </button>
      <div class="ffg-cc-name">${escapeHTML(slot.name)}</div>`;
  } else {
    const label = slot.unused ? "SWFFG.Carousel.Unused" : `SWFFG.Carousel.Open.${slot.side}`;
    body = `
      <div class="ffg-cc-portrait ffg-cc-empty"><i class="fa-solid ${slot.unused ? "fa-ban" : "fa-user-plus"}"></i></div>
      <div class="ffg-cc-name">${loc(label)}</div>`;
  }

  return `
    <div class="${classes.join(" ")}" data-index="${slot.index}">
      ${body}
      <div class="ffg-cc-init">${slot.initiative}</div>
      ${slot.canClaim ? `<button type="button" class="ffg-cc-claim" data-claim="${slot.index}">${loc("SWFFG.Notifications.Combat.Claim.Claim")}</button>` : ""}
    </div>`;
}

function removeCarousel() {
  document.getElementById(ELEMENT_ID)?.remove();
}

/** Select and pan to a claimant's token, when the user is allowed to see it. */
async function focusCombatant(combat, combatantId) {
  const combatant = combat.combatants.get(combatantId);
  const token = combatant?.token?.object ?? canvas.tokens?.get(combatant?.tokenId);
  if (!token || (token.document.hidden && !game.user.isGM)) return;
  if (token.isOwner) token.control({ releaseOthers: true });
  await canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
}

function centerActive(root) {
  const track = root.querySelector(".ffg-cc-track");
  const card = root.querySelector(".ffg-cc-slot.active");
  if (!track || !card) return;
  track.scrollLeft = Math.max(0, card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2);
}

function render({ center = false } = {}) {
  const combat = activeCombat();
  const sceneId = combat?.scene?.id ?? null;
  if (
    !game.settings.get("starwarsffg", "enableCombatCarousel") ||
    !combat?.turns?.length ||
    (sceneId && canvas?.scene?.id && sceneId !== canvas.scene.id)
  ) {
    removeCarousel();
    return;
  }

  const previous = document.getElementById(ELEMENT_ID);
  const previousScroll = previous?.querySelector(".ffg-cc-track")?.scrollLeft ?? 0;
  const collapsed = game.settings.get("starwarsffg", COLLAPSED_SETTING);
  const slots = buildSlots(combat);

  // Whoever the tracker would hand the turn controls to gets them here as well.
  const acting = slotClaimant(combat, combat.turns[combat.turn]);
  const ownsTurn = !game.user.isGM && !!acting?.isOwner;

  const root = document.createElement("div");
  root.id = ELEMENT_ID;
  root.className = `ffg-combat-carousel${collapsed ? " collapsed" : ""}`;
  root.innerHTML = `
    <div class="ffg-cc-bar">
      ${game.user.isGM ? `<button type="button" class="ffg-cc-nav" data-turn="-1" data-tooltip="${loc("COMBAT.TurnPrev")}"><i class="fa-solid fa-chevron-left"></i></button>` : ""}
      <span class="ffg-cc-round">${loc("SWFFG.Carousel.Round", { round: combat.round })}</span>
      ${game.user.isGM ? `<button type="button" class="ffg-cc-nav" data-turn="1" data-tooltip="${loc("COMBAT.TurnNext")}"><i class="fa-solid fa-chevron-right"></i></button>` : ""}
      ${ownsTurn ? `<button type="button" class="ffg-cc-end" data-turn="1"><i class="fa-solid fa-check"></i> ${loc("COMBAT.TurnEnd")}</button>` : ""}
      <button type="button" class="ffg-cc-toggle" data-tooltip="${loc(collapsed ? "SWFFG.Carousel.Expand" : "SWFFG.Carousel.Collapse")}"><i class="fa-solid ${collapsed ? "fa-chevron-down" : "fa-chevron-up"}"></i></button>
    </div>
    ${collapsed ? "" : `<div class="ffg-cc-track">${slots.map(slotMarkup).join("")}</div>`}`;

  root.querySelector(".ffg-cc-toggle").addEventListener("click", async () => {
    await game.settings.set("starwarsffg", COLLAPSED_SETTING, !collapsed);
    render({ center: true });
  });
  for (const button of root.querySelectorAll("[data-turn]")) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        if (Number(button.dataset.turn) < 0) await combat.previousTurn();
        else await combat.nextTurn();
      } catch (err) {
        CONFIG.logger?.warn?.("Combat carousel: could not change the turn", err);
      }
    });
  }
  for (const button of root.querySelectorAll("[data-claim]")) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await combat.claimSlotWithToken(Number(button.dataset.claim));
      } finally {
        button.disabled = false;
      }
    });
  }
  for (const button of root.querySelectorAll("[data-focus]")) {
    button.addEventListener("click", () => focusCombatant(combat, button.dataset.focus));
  }
  // a mouse wheel over the strip scrolls it sideways
  root.querySelector(".ffg-cc-track")?.addEventListener("wheel", (event) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    event.currentTarget.scrollLeft += event.deltaY;
  }, { passive: false });

  // #ui-top is the centred column between the left controls and the sidebar: sitting in it keeps
  // the strip clear of both, and scaled with the rest of the interface.
  const host = document.getElementById("ui-top") ?? document.body;
  if (previous) previous.replaceWith(root);
  else host.prepend(root);

  const track = root.querySelector(".ffg-cc-track");
  if (track) {
    if (center || !previous) centerActive(root);
    else track.scrollLeft = previousScroll;
  }
}

/**
 * Coalesce the burst of hooks a single combat change produces into one redraw.
 * @param {boolean} [center] scroll the active slot into the middle afterwards
 */
function queueRender(center = false) {
  queueRender.center ||= center;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    const options = { center: queueRender.center };
    queueRender.center = false;
    try {
      render(options);
    } catch (err) {
      CONFIG.logger?.warn?.("Combat carousel failed to render", err);
    }
  }, 40);
}

/** Register the per-user collapsed state. Call at init. */
export function registerCombatCarouselSettings() {
  game.settings.register("starwarsffg", COLLAPSED_SETTING, {
    name: COLLAPSED_SETTING,
    scope: "client",
    default: false,
    config: false,
    type: Boolean,
  });
}

/** Start following the combat. Call once, at ready. */
export function registerCombatCarousel() {
  if (!game.settings.get("starwarsffg", "enableCombatCarousel")) return;
  Hooks.on("updateCombat", (_combat, changed) => queueRender("turn" in (changed ?? {}) || "round" in (changed ?? {})));
  for (const hook of ["createCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant"]) {
    Hooks.on(hook, () => queueRender());
  }
  Hooks.on("canvasReady", () => queueRender(true));
  // Switching the tracker to another encounter changes game.combat without touching any document,
  // so no combat hook fires for it; the tracker's own re-render is the only signal there is.
  Hooks.on("renderCombatTracker", () => queueRender());
  // a token being hidden or revealed changes what players may see of its card
  Hooks.on("updateToken", (_token, changed) => {
    if ("hidden" in (changed ?? {})) queueRender();
  });
  // defeated is a status effect on the actor
  for (const hook of ["createActiveEffect", "deleteActiveEffect"]) {
    Hooks.on(hook, (effect) => {
      if (effect?.statuses?.has?.(CONFIG.specialStatusEffects.DEFEATED)) queueRender();
    });
  }
  queueRender(true);
}
