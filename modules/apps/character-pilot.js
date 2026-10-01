/**
 * Character Pilot: a small control panel for running one character through a combat turn.
 *
 * It tracks what the turn has to spend - the action, and the maneuvers (one free, a second by
 * suffering strain or by giving up the action, never more than the character's limit) - and puts
 * the common maneuvers one click away, each applying its effect with the system's own statuses:
 *
 *   Aim             a boost on the next check ("Boost Next Check", stacked)
 *   Guarded Stance  +1 melee defence and a setback on your own combat checks, until the end of
 *                   your next turn
 *   Take Cover      +1 ranged defence until you leave it
 *   Stand Up        clears Prone
 *   Assist          a boost on an ally's next check
 *   Draw / Holster  toggles a weapon's equipped state
 *
 * The turn bookkeeping is stored on the actor (`flags.starwarsffg.pilot`), so it is the same for
 * the player and for a GM looking at the same character, and it resets itself whenever a new turn
 * of that character begins.
 *
 * "Whose turn is it" follows the initiative slots: a character's turn starts when it claims the
 * current slot, not when a slot it happened to roll comes up (see helpers/combat-turns.js).
 */
import DiceHelpers from "../helpers/dice-helpers.js";
import { applyToTargetActor } from "../helpers/gm-bridge.js";
import {
  STATUS,
  applyNextCheckLocal,
  applyStatusLocal,
  findStatusEffect,
  removeStatusLocal,
  stackCount,
  statusLabel,
  strainTrack,
  temporaryStatusEffects,
} from "../helpers/status-effects.js";
import { activeCombat, combatantDisposition, currentCombatant, isActorsTurn, turnKey, usesSlots } from "../helpers/combat-turns.js";
import { escapeHTML, loc } from "../helpers/html.js";
import { GuardedDialogV2 as DialogV2 } from "../helpers/dialog-helpers.js";

const { ApplicationV2 } = foundry.applications.api;

const FLAG = "pilot";
const DEFAULT_MAX_MANEUVERS = 2;
const EXTRA_MANEUVER_STRAIN = 2;
const FREE_KEY = "free";

/** Statuses the GM can toggle on a target from the panel. */
const GM_STATUSES = ["prone", "disoriented", "immobilized", "blinded", "invisible"];
const NEXT_CHECK_BUTTONS = [
  ["boost", "fa-solid fa-plus"],
  ["setback", "fa-solid fa-minus"],
  ["upgradeAbility", "fa-solid fa-arrow-up"],
  ["upgradeDifficulty", "fa-solid fa-triangle-exclamation"],
];

function canPilot(actor) {
  return !!actor && ["character", "nemesis", "rival", "minion"].includes(actor.type) && (game.user.isGM || actor.isOwner);
}

/** The actors this user could be piloting right now: their tokens on the scene, and their character. */
function pilotableActors() {
  const actors = new Map();
  for (const token of canvas?.tokens?.placeables ?? []) {
    if (canPilot(token.actor)) actors.set(token.actor.uuid, { actor: token.actor, name: token.name || token.actor.name });
  }
  const character = game.user.character;
  if (canPilot(character) && ![...actors.values()].some((entry) => entry.actor.id === character.id)) {
    actors.set(character.uuid, { actor: character, name: character.name });
  }
  return [...actors.values()].sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
}

function preferredActor() {
  const controlled = canvas?.tokens?.controlled?.find((token) => canPilot(token.actor));
  if (controlled) return controlled.actor;
  const character = game.user.character;
  if (canPilot(character)) return character.getActiveTokens?.()[0]?.actor ?? character;
  return pilotableActors()[0]?.actor ?? null;
}

export default class CharacterPilot extends ApplicationV2 {
  constructor(options = {}) {
    super(options);
    this.actorUuid = options.actorUuid ?? preferredActor()?.uuid ?? null;
  }

  /** The one panel each client keeps. */
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: "ffg-character-pilot",
    classes: ["starwarsffg", "ffg-character-pilot"],
    tag: "div",
    window: {
      title: "SWFFG.Pilot.Title",
      icon: "fa-solid fa-gamepad",
      resizable: true,
    },
    position: {
      width: 440,
    },
  };

  static get enabled() {
    return game.settings.get("starwarsffg", "enableCharacterPilot");
  }

  /**
   * Open the panel, optionally on a specific actor.
   * @param {?Actor} [actor]
   */
  static open(actor = null) {
    if (!this.enabled) return null;
    if (!this.instance) this.instance = new this({ actorUuid: canPilot(actor) ? actor.uuid : undefined });
    else if (canPilot(actor)) this.instance.actorUuid = actor.uuid;
    this.instance.render({ force: true });
    return this.instance;
  }

  static refresh() {
    if (this.instance?.rendered) this.instance.render();
  }

  /** @override */
  async close(options) {
    CharacterPilot.instance = null;
    return super.close(options);
  }

  get actor() {
    let actor = null;
    try {
      actor = this.actorUuid ? fromUuidSync(this.actorUuid) : null;
    } catch (err) {
      actor = null;
    }
    if (canPilot(actor)) return actor;
    actor = preferredActor();
    this.actorUuid = actor?.uuid ?? null;
    return actor;
  }

  /* -------------------------------------------- */
  /*  Turn bookkeeping                            */
  /* -------------------------------------------- */

  static maxManeuvers(actor) {
    const stored = Math.trunc(Number(actor.getFlag("starwarsffg", FLAG)?.maxManeuvers));
    return Number.isFinite(stored) && stored >= DEFAULT_MAX_MANEUVERS ? stored : DEFAULT_MAX_MANEUVERS;
  }

  /**
   * The turn record for an actor, reset if it belongs to an earlier turn. Read-only: nothing is
   * written until the character actually does something.
   */
  static turnState(actor) {
    const combat = activeCombat();
    const key = combat ? (isActorsTurn(actor, combat) ? turnKey(combat) : null) : FREE_KEY;
    const stored = actor.getFlag("starwarsffg", FLAG)?.turn;
    const fresh = { key: key ?? stored?.key ?? FREE_KEY, actionUsed: false, actionConverted: false, maneuversUsed: 0, extraManeuvers: 0 };
    // A different key means a different turn: this character's turn has come round again, or the
    // fight ended. While it is someone else's turn the last record is kept, so it can still be read.
    if (!stored || (key && stored.key !== key)) return fresh;
    return {
      key: stored.key,
      actionUsed: !!stored.actionUsed,
      actionConverted: !!stored.actionConverted,
      maneuversUsed: Math.max(0, Math.trunc(Number(stored.maneuversUsed)) || 0),
      extraManeuvers: Math.max(0, Math.trunc(Number(stored.extraManeuvers)) || 0),
    };
  }

  /** Maneuvers available this turn: one free, plus those paid for, capped at the limit. */
  static capacity(actor, state) {
    return Math.min(this.maxManeuvers(actor), 1 + state.extraManeuvers + (state.actionConverted ? 1 : 0));
  }

  static async saveTurn(actor, state) {
    await actor.setFlag("starwarsffg", FLAG, { turn: state });
  }

  /** In combat, a character only acts on its own turn. Out of combat there is nothing to wait for. */
  static canAct(actor) {
    if (!activeCombat() || isActorsTurn(actor)) return true;
    ui.notifications.warn(game.i18n.localize("SWFFG.Pilot.Errors.NotYourTurn"));
    return false;
  }

  /** Spend one maneuver. @returns {Promise<boolean>} whether there was one to spend */
  static async spendManeuver(actor) {
    if (!this.canAct(actor)) return false;
    const state = this.turnState(actor);
    if (state.maneuversUsed >= this.capacity(actor, state)) {
      ui.notifications.warn(game.i18n.localize("SWFFG.Pilot.Errors.NoManeuver"));
      return false;
    }
    state.maneuversUsed += 1;
    await this.saveTurn(actor, state);
    return true;
  }

  /** Mark the action as used. Never blocks: the roll it accompanies has usually already been made. */
  static async spendAction(actor) {
    if (activeCombat() && !isActorsTurn(actor)) return;
    const state = this.turnState(actor);
    if (state.actionUsed) return;
    state.actionUsed = true;
    await this.saveTurn(actor, state);
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _renderHTML(_context, _options) {
    const root = document.createElement("div");
    root.className = "ffg-pilot-body";
    const actor = this.actor;
    if (!actor) {
      root.innerHTML = `<p class="notes">${loc("SWFFG.Pilot.Errors.NoActor")}</p>`;
      return root;
    }

    const combat = activeCombat();
    const ownTurn = isActorsTurn(actor, combat);
    const state = CharacterPilot.turnState(actor);
    const max = CharacterPilot.maxManeuvers(actor);
    const capacity = CharacterPilot.capacity(actor, state);
    // Where this actor takes strain: its strain track, or wounds for a minion or rival. The card and
    // the second-maneuver cost both follow it, so an adversary is never shown (or charged on) a
    // strain track it does not really have.
    const strainKey = strainTrack(actor, true);
    const strain = strainKey ? actor.system.stats[strainKey] : null;
    const blocked = !!combat && !ownTurn;

    const button = (action, label, icon, { disabled = false, active = false, data = "" } = {}) =>
      `<button type="button" data-pilot="${action}" ${data} class="${active ? "active" : ""}" ${disabled ? "disabled" : ""}><i class="${icon}"></i><span>${escapeHTML(label)}</span></button>`;
    const t = (key, data) => (data ? game.i18n.format(`SWFFG.Pilot.${key}`, data) : game.i18n.localize(`SWFFG.Pilot.${key}`));

    const actors = pilotableActors();
    const actorOptions = actors
      .map((entry) => `<option value="${escapeHTML(entry.actor.uuid)}" ${entry.actor.uuid === actor.uuid ? "selected" : ""}>${escapeHTML(entry.name)}</option>`)
      .join("");

    // turn banner, with the claim shortcut when the open slot is this character's to take
    let banner;
    if (!combat) banner = `<i class="fa-solid fa-mug-hot"></i> ${loc("SWFFG.Pilot.Turn.OutOfCombat")}`;
    else if (ownTurn) banner = `<i class="fa-solid fa-bolt"></i> ${loc("SWFFG.Pilot.Turn.Yours")}`;
    else {
      const slot = combat.turns?.[combat.turn];
      const open = usesSlots(combat) && slot && !currentCombatant(combat);
      const token = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
      const sameSide = open && token && combatantDisposition(combat.combatants.get(slot.id) ?? slot) === token.disposition;
      // only while this character still has a turn to take this round
      const waiting = sameSide && combat.combatants.some((c) => c.actor?.uuid === actor.uuid && !c.isDefeated && !combat.findSlotClaims(combat.round, c.id));
      banner = `<i class="fa-solid fa-hourglass-half"></i> ${loc("SWFFG.Pilot.Turn.NotYours")}`;
      if (waiting) banner += ` <button type="button" data-pilot="claim" class="ffg-pilot-claim">${loc("SWFFG.Notifications.Combat.Claim.Claim")}</button>`;
    }

    const cover = !!findStatusEffect(actor, STATUS.cover);
    const guarded = !!findStatusEffect(actor, STATUS.guardedStance);
    const prone = !!findStatusEffect(actor, STATUS.prone);

    // A character attacks with what is in hand. Adversaries are stat blocks: their weapons are
    // rarely flagged equipped at all, so for them (and for a character with nothing equipped) the
    // list is every weapon they are carrying.
    const carried = actor.items.filter((item) => item.type === "weapon" && item.system?.equippable?.carried !== false);
    const equipped = carried.filter((item) => item.system?.equippable?.equipped);
    const weapons = actor.type === "character" && equipped.length ? equipped : carried;
    const weaponButtons = weapons.length
      ? weapons.map((item) => button("attack", item.name, "fa-solid fa-crosshairs", { data: `data-item-id="${item.id}"` })).join("")
      : `<span class="notes">${loc("SWFFG.Pilot.NoWeapons")}</span>`;

    const effects = temporaryStatusEffects(actor).filter((effect) => !effect.disabled);
    // With Status Icon Counters the stack count lives on the token badge rather than in the
    // effect's name, so spell it out here; without the module the name already carries it.
    const chipLabel = (effect) => {
      const count = stackCount(effect);
      return count > 1 && !effect.name.endsWith(`×${count}`) ? `${effect.name} ×${count}` : effect.name;
    };
    const effectChips = effects.length
      ? effects
          .map((effect) => `<span class="ffg-pilot-chip"><img src="${escapeHTML(effect.img ?? "icons/svg/aura.svg")}" alt="" />${escapeHTML(chipLabel(effect))}<a data-pilot="remove-effect" data-effect-id="${effect.id}" data-tooltip="${loc("SWFFG.Pilot.RemoveEffect")}"><i class="fa-solid fa-xmark"></i></a></span>`)
          .join("")
      : `<span class="notes">${loc("SWFFG.Pilot.NoEffects")}</span>`;

    const targets = Array.from(game.user.targets ?? []);
    const targetChips = targets.length
      ? targets.map((token) => `<span class="ffg-pilot-chip"><img src="${escapeHTML(token.document?.texture?.src ?? "icons/svg/mystery-man.svg")}" alt="" />${escapeHTML(token.name)}</span>`).join("")
      : `<span class="notes">${loc("SWFFG.Pilot.NoTarget")}</span>`;

    const gmTools = game.user.isGM
      ? `
      <section class="ffg-pilot-section">
        <h3><i class="fa-solid fa-crosshairs"></i> ${loc("SWFFG.Pilot.Sections.Target")}</h3>
        <div class="ffg-pilot-chips">${targetChips}</div>
        <div class="ffg-pilot-grid three">
          ${button("target-strain", t("Target.StrainPlus"), "fa-solid fa-bolt", { disabled: targets.length !== 1, data: `data-delta="1"` })}
          ${button("target-strain", t("Target.StrainMinus"), "fa-solid fa-heart", { disabled: targets.length !== 1, data: `data-delta="-1"` })}
          ${NEXT_CHECK_BUTTONS.map(([kind, icon]) => button("target-next", t(`Target.${kind}`), icon, { disabled: targets.length !== 1, data: `data-kind="${kind}"` })).join("")}
          ${GM_STATUSES.map((status) => button("target-status", statusLabel(STATUS[status]), "fa-solid fa-circle-dot", { disabled: targets.length !== 1, data: `data-status="${status}"` })).join("")}
          ${button("target-clear", t("Target.Clear"), "fa-solid fa-broom", { disabled: targets.length !== 1 })}
        </div>
      </section>
      <section class="ffg-pilot-section ffg-pilot-config">
        <label>${loc("SWFFG.Pilot.MaxManeuvers")} <input type="number" min="${DEFAULT_MAX_MANEUVERS}" step="1" value="${max}" data-pilot-max /></label>
      </section>`
      : "";

    root.innerHTML = `
      <header class="ffg-pilot-header">
        <img src="${escapeHTML(actor.token?.texture?.src ?? actor.img ?? "icons/svg/mystery-man.svg")}" alt="" />
        <div class="ffg-pilot-heading">
          <select data-pilot-actor>${actorOptions}</select>
        </div>
        <button type="button" data-pilot="sheet" data-tooltip="${loc("SWFFG.Pilot.OpenSheet")}"><i class="fa-solid fa-address-card"></i></button>
      </header>

      <div class="ffg-pilot-banner${blocked ? " blocked" : ""}">${banner}</div>

      <section class="ffg-pilot-state">
        <div class="ffg-pilot-stat ${state.actionUsed ? "spent" : "ready"}"><span>${loc("SWFFG.Pilot.Action")}</span><strong>${loc(state.actionUsed ? "SWFFG.Pilot.Used" : "SWFFG.Pilot.Available")}</strong></div>
        <div class="ffg-pilot-stat ${state.maneuversUsed < capacity ? "ready" : "spent"}"><span>${loc("SWFFG.Pilot.Maneuvers")}</span><strong>${state.maneuversUsed} / ${capacity}</strong><small>${loc("SWFFG.Pilot.Limit", { max })}</small></div>
        <div class="ffg-pilot-stat"><span>${loc(strainKey === "wounds" ? "SWFFG.Wounds" : "SWFFG.Strain")}</span><strong>${strain ? `${Number(strain.value) || 0} / ${Number(strain.max) || 0}` : "&mdash;"}</strong></div>
      </section>

      <section class="ffg-pilot-section">
        <h3><i class="fa-solid fa-list-check"></i> ${loc("SWFFG.Pilot.Sections.Turn")}</h3>
        <div class="ffg-pilot-grid">
          ${button("toggle-action", t(state.actionUsed ? "Turn.RestoreAction" : "Turn.UseAction"), "fa-solid fa-burst", { disabled: blocked })}
          ${button("convert-action", t("Turn.ActionToManeuver"), "fa-solid fa-arrow-right-arrow-left", { disabled: blocked || state.actionUsed || capacity >= max })}
          ${button("extra-maneuver", t(strainKey === "wounds" ? "Turn.ExtraManeuverWounds" : "Turn.ExtraManeuver", { cost: EXTRA_MANEUVER_STRAIN }), "fa-solid fa-forward", { disabled: blocked || capacity >= max || !strain })}
          ${button("reset-turn", t("Turn.Reset"), "fa-solid fa-rotate-left")}
        </div>
      </section>

      <section class="ffg-pilot-section">
        <h3><i class="fa-solid fa-person-running"></i> ${loc("SWFFG.Pilot.Sections.Maneuvers")}</h3>
        <div class="ffg-pilot-grid three">
          ${button("aim", t("Maneuver.Aim"), "fa-solid fa-crosshairs", { disabled: blocked })}
          ${button("guarded", t("Maneuver.GuardedStance"), "fa-solid fa-shield-halved", { disabled: blocked || guarded, active: guarded })}
          ${button("cover", t(cover ? "Maneuver.LeaveCover" : "Maneuver.TakeCover"), "fa-solid fa-shield", { disabled: blocked && !cover, active: cover })}
          ${button("stand-up", t("Maneuver.StandUp"), "fa-solid fa-person", { disabled: blocked || !prone })}
          ${button("assist", t("Maneuver.Assist"), "fa-solid fa-handshake-angle", { disabled: blocked })}
          ${button("move", t("Maneuver.Move"), "fa-solid fa-person-walking", { disabled: blocked })}
          ${button("gear", t("Maneuver.Gear"), "fa-solid fa-gun", { disabled: blocked })}
        </div>
      </section>

      <section class="ffg-pilot-section">
        <h3><i class="fa-solid fa-burst"></i> ${loc("SWFFG.Pilot.Sections.Attack")}</h3>
        <div class="ffg-pilot-grid">${weaponButtons}</div>
      </section>

      <section class="ffg-pilot-section">
        <h3><i class="fa-solid fa-wand-magic-sparkles"></i> ${loc("SWFFG.Pilot.Sections.Effects")}</h3>
        <div class="ffg-pilot-chips">${effectChips}</div>
      </section>

      ${combat ? `<section class="ffg-pilot-section"><div class="ffg-pilot-grid">${button("end-turn", t("Turn.End"), "fa-solid fa-forward-step", { disabled: !ownTurn })}</div></section>` : ""}

      ${gmTools}`;
    return root;
  }

  /** @override */
  _replaceHTML(result, content, _options) {
    content.replaceChildren(result);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;

    root.querySelector("[data-pilot-actor]")?.addEventListener("change", (event) => {
      this.actorUuid = event.currentTarget.value;
      this.render();
    });
    root.querySelector("[data-pilot-max]")?.addEventListener("change", async (event) => {
      const actor = this.actor;
      if (!actor || !game.user.isGM) return;
      const value = Math.max(DEFAULT_MAX_MANEUVERS, Math.trunc(Number(event.currentTarget.value)) || DEFAULT_MAX_MANEUVERS);
      await actor.setFlag("starwarsffg", FLAG, { maxManeuvers: value });
    });
    for (const control of root.querySelectorAll("[data-pilot]")) {
      control.addEventListener("click", async (event) => {
        event.preventDefault();
        if (control.disabled) return;
        try {
          await this._onAction(control.dataset.pilot, control.dataset);
        } catch (err) {
          console.error("Star Wars FFG | Character Pilot action failed", err);
          ui.notifications.error(err?.message || game.i18n.localize("SWFFG.Pilot.Errors.Failed"));
        }
        if (this.rendered) this.render();
      });
    }
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  async _onAction(action, data) {
    const actor = this.actor;
    if (!actor) return;
    const Pilot = CharacterPilot;

    switch (action) {
      case "sheet":
        return actor.sheet?.render(true);

      case "claim": {
        const combat = activeCombat();
        // Claim for the character this panel is open on, not for whichever token is selected on the
        // canvas: a GM piloting a minion with a player's token selected would otherwise claim (or be
        // refused) for the wrong one. Without a token in view the usual selection rules apply.
        const token = actor.token?.object ?? actor.getActiveTokens?.()[0] ?? null;
        return combat?.claimSlotWithToken?.(combat.turn, token);
      }

      case "toggle-action": {
        if (!Pilot.canAct(actor)) return;
        const state = Pilot.turnState(actor);
        if (state.actionUsed) {
          // Taking the action back also takes back the maneuver it was traded for - unless that
          // maneuver has already been spent.
          if (state.actionConverted && state.maneuversUsed > Math.min(Pilot.maxManeuvers(actor), 1 + state.extraManeuvers)) {
            return ui.notifications.warn(game.i18n.localize("SWFFG.Pilot.Errors.ConvertedSpent"));
          }
          state.actionUsed = false;
          state.actionConverted = false;
        } else {
          state.actionUsed = true;
        }
        return Pilot.saveTurn(actor, state);
      }

      case "convert-action": {
        if (!Pilot.canAct(actor)) return;
        const state = Pilot.turnState(actor);
        if (state.actionUsed || Pilot.capacity(actor, state) >= Pilot.maxManeuvers(actor)) return;
        state.actionUsed = true;
        state.actionConverted = true;
        return Pilot.saveTurn(actor, state);
      }

      case "extra-maneuver": {
        if (!Pilot.canAct(actor)) return;
        const state = Pilot.turnState(actor);
        if (Pilot.capacity(actor, state) >= Pilot.maxManeuvers(actor)) return;
        // suffered as wounds by the adversaries that have no strain track
        const track = strainTrack(actor, true);
        if (!track) return;
        const current = Number(actor.system.stats[track]?.value) || 0;
        await actor.update({ [`system.stats.${track}.value`]: current + EXTRA_MANEUVER_STRAIN });
        state.extraManeuvers += 1;
        return Pilot.saveTurn(actor, state);
      }

      case "reset-turn": {
        const combat = activeCombat();
        const key = combat ? (isActorsTurn(actor, combat) ? turnKey(combat) : Pilot.turnState(actor).key) : FREE_KEY;
        return Pilot.saveTurn(actor, { key, actionUsed: false, actionConverted: false, maneuversUsed: 0, extraManeuvers: 0 });
      }

      case "aim":
        if (!(await Pilot.spendManeuver(actor))) return;
        return applyNextCheckLocal(actor, "boost", 1);

      case "guarded":
        if (findStatusEffect(actor, STATUS.guardedStance)) return;
        if (!(await Pilot.spendManeuver(actor))) return;
        return applyStatusLocal(actor, { statusId: STATUS.guardedStance, untilEndOfNextTurn: true });

      case "cover":
        // Leaving cover is free; getting into it is the maneuver.
        if (findStatusEffect(actor, STATUS.cover)) return removeStatusLocal(actor, STATUS.cover);
        if (!(await Pilot.spendManeuver(actor))) return;
        return applyStatusLocal(actor, { statusId: STATUS.cover });

      case "stand-up":
        if (!findStatusEffect(actor, STATUS.prone)) return;
        if (!(await Pilot.spendManeuver(actor))) return;
        return removeStatusLocal(actor, STATUS.prone);

      case "move":
        return Pilot.spendManeuver(actor);

      case "assist": {
        if (!Pilot.canAct(actor)) return;
        const ally = await this._chooseAlly(actor);
        if (!ally) return;
        if (!(await Pilot.spendManeuver(actor))) return;
        return applyToTargetActor(ally, { type: "next-check", kind: "boost", amount: 1 });
      }

      case "gear": {
        if (!Pilot.canAct(actor)) return;
        const weapon = await this._chooseWeapon(actor);
        if (!weapon) return;
        if (!(await Pilot.spendManeuver(actor))) return;
        const equipped = !weapon.system.equippable.equipped;
        // the same two-key write the sheet's equip toggle makes: equipping implies carrying
        const update = { "system.equippable.equipped": equipped };
        if (equipped) update["system.equippable.carried"] = true;
        return weapon.update(update);
      }

      case "attack": {
        const item = actor.items.get(data.itemId);
        if (!item) return;
        if (item.getFlag("starwarsffg", "config.enableAmmo") && item.system.ammo.value <= 0) {
          return ui.notifications.warn(game.i18n.localize("SWFFG.Pilot.Errors.NoAmmo"));
        }
        await Pilot.spendAction(actor);
        return DiceHelpers.rollItem(item.id, actor);
      }

      case "remove-effect":
        return actor.effects.get(data.effectId)?.delete();

      case "end-turn": {
        const combat = activeCombat();
        if (!combat || !isActorsTurn(actor, combat)) return;
        return combat.nextTurn();
      }

      case "target-strain":
      case "target-next":
      case "target-status":
      case "target-clear":
        return this._onTargetAction(action, data);
    }
  }

  /** GM tools: act on the single token the GM has targeted. */
  async _onTargetAction(action, data) {
    if (!game.user.isGM) return;
    const targets = Array.from(game.user.targets ?? []);
    const target = targets.length === 1 ? targets[0].actor : null;
    if (!target) return ui.notifications.warn(game.i18n.localize("SWFFG.Pilot.Errors.OneTarget"));

    if (action === "target-strain") {
      const delta = Number(data.delta) || 0;
      // strain, a vehicle's system strain, or wounds for adversaries that take strain that way
      const track = strainTrack(target, delta > 0);
      if (!track) return ui.notifications.warn(game.i18n.format("SWFFG.Spend.Summary.NoStrainTrack", { actor: target.name }));
      const value = Math.max(0, (Number(target.system.stats[track].value) || 0) + delta);
      return target.update({ [`system.stats.${track}.value`]: value });
    }
    if (action === "target-next") return applyNextCheckLocal(target, data.kind, 1);
    if (action === "target-status") {
      const statusId = STATUS[data.status];
      if (findStatusEffect(target, statusId)) return removeStatusLocal(target, statusId);
      return applyStatusLocal(target, { statusId });
    }
    if (action === "target-clear") {
      const effects = temporaryStatusEffects(target);
      if (!effects.length) return;
      const confirmed = await DialogV2.confirm({
        window: { title: game.i18n.localize("SWFFG.Pilot.Target.Clear") },
        content: `<p>${loc("SWFFG.Pilot.Target.ClearConfirm", { name: target.name, count: effects.length })}</p>`,
        classes: ["dialog", "starwarsffg"],
        rejectClose: false,
      });
      if (!confirmed) return;
      return target.deleteEmbeddedDocuments("ActiveEffect", effects.map((effect) => effect.id));
    }
  }

  /** Friendly tokens on the scene other than the actor's own, for Assist. */
  async _chooseAlly(actor) {
    const own = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
    const side = own?.disposition ?? CONST.TOKEN_DISPOSITIONS.FRIENDLY;
    const allies = (canvas?.scene?.tokens ?? [])
      .filter((token) => token.actor && token.actor.uuid !== actor.uuid && token.disposition === side && (!token.hidden || game.user.isGM))
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    if (!allies.length) {
      ui.notifications.warn(game.i18n.localize("SWFFG.Pilot.Errors.NoAllies"));
      return null;
    }
    const uuid = await this._choose(
      game.i18n.localize("SWFFG.Pilot.Maneuver.Assist"),
      game.i18n.localize("SWFFG.Pilot.ChooseAlly"),
      allies.map((token) => ({ value: token.uuid, label: token.name }))
    );
    return uuid ? allies.find((token) => token.uuid === uuid)?.actor ?? null : null;
  }

  async _chooseWeapon(actor) {
    const weapons = actor.items.filter((item) => item.type === "weapon");
    if (!weapons.length) {
      ui.notifications.warn(game.i18n.localize("SWFFG.Pilot.NoWeapons"));
      return null;
    }
    const id = await this._choose(
      game.i18n.localize("SWFFG.Pilot.Maneuver.Gear"),
      game.i18n.localize("SWFFG.Pilot.ChooseWeapon"),
      weapons.map((item) => ({
        value: item.id,
        label: `${item.name} (${game.i18n.localize(item.system?.equippable?.equipped ? "SWFFG.Pilot.Drawn" : "SWFFG.Pilot.Holstered")})`,
      }))
    );
    return id ? actor.items.get(id) ?? null : null;
  }

  /** A one-dropdown prompt. @returns {Promise<?string>} the chosen value, or null on cancel */
  async _choose(title, label, choices) {
    const options = choices.map((choice) => `<option value="${escapeHTML(choice.value)}">${escapeHTML(choice.label)}</option>`).join("");
    const result = await DialogV2.wait({
      window: { title },
      classes: ["dialog", "starwarsffg"],
      content: `<div class="form-group"><label>${escapeHTML(label)}</label><select name="choice" style="width:100%;">${options}</select></div>`,
      buttons: [
        {
          action: "ok",
          icon: "fas fa-check",
          label: game.i18n.localize("SWFFG.Pilot.Choose"),
          default: true,
          callback: (_event, _button, dialog) => dialog.element.querySelector("select[name='choice']")?.value ?? null,
        },
        { action: "cancel", icon: "fas fa-times", label: game.i18n.localize("SWFFG.Cancel"), callback: () => null },
      ],
      rejectClose: false,
    });
    return result || null;
  }

  /* -------------------------------------------- */
  /*  Registration                                */
  /* -------------------------------------------- */

  /** Keep the open panel in step with the world, and add the Token HUD shortcut. Call at ready. */
  static register() {
    if (!this.enabled) return;
    const refresh = () => this.refresh();
    const forActor = (actor) => {
      const current = this.instance?.actorUuid;
      if (current && actor?.uuid === current) refresh();
    };

    Hooks.on("controlToken", (token, controlled) => {
      if (!controlled || !this.instance?.rendered || !canPilot(token.actor)) return;
      this.instance.actorUuid = token.actor.uuid;
      refresh();
    });
    Hooks.on("targetToken", (user) => {
      if (user?.id === game.user.id) refresh();
    });
    Hooks.on("updateActor", forActor);
    Hooks.on("updateItem", (item) => forActor(item.parent));
    for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
      Hooks.on(hook, (effect) => forActor(effect.parent));
    }
    for (const hook of ["updateCombat", "deleteCombat", "createCombat"]) Hooks.on(hook, refresh);

    Hooks.on("renderTokenHUD", (hud, html) => {
      const root = html instanceof HTMLElement ? html : html?.[0] ?? hud.element;
      const actor = hud.object?.actor ?? hud.document?.actor;
      if (!root || !canPilot(actor) || root.querySelector("[data-ffg-pilot]")) return;
      const control = document.createElement("button");
      control.type = "button";
      control.className = "control-icon";
      control.dataset.ffgPilot = "true";
      control.dataset.tooltip = game.i18n.localize("SWFFG.Pilot.Title");
      control.innerHTML = '<i class="fa-solid fa-gamepad" inert></i>';
      control.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        CharacterPilot.open(actor);
      });
      (root.querySelector(".col.right") ?? root).append(control);
    });
  }
}
