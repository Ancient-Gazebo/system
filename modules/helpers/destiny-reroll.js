/**
 * Destiny Rerolls (house rule).
 *
 * Once per session (the number is a setting) a character may spend a Destiny Point to reroll a check.
 * It is an entry of its own on the roll card's right-click menu, beside the plain Reroll: talents and
 * other effects that grant a reroll keep using that one, free and uncounted.
 *
 * The reroll is the same pool with the same added symbols (dice/reroll.js, shared with Reroll), less
 * any bond invoked on the old roll - that was paid for there. Paying and counting are shared with Bond
 * Invocations (helpers/destiny-session.js): a player's character spends a light side point, an NPC a
 * dark side one, and the GM's Request Destiny Roll starts a new session.
 *
 * The active GM does all of it - checks, rolls, pays, counts - so a reroll that is made is always paid
 * for, and nothing is paid for a reroll that failed. The new card is posted as the user who asked for
 * it, with the old card's speaker and visibility, and says what was spent. The old card is marked as
 * replaced and cannot be destiny-rerolled a second time.
 */
import { buildReroll } from "../dice/reroll.js";
import SpendResults from "./spend-results.js";
import DestinySession from "./destiny-session.js";
import { escapeHTML, loc } from "./html.js";
import { GuardedDialogV2 as DialogV2 } from "./dialog-helpers.js";

const SOCKET = "system.starwarsffg";
const REQUEST_EVENT = "ffgDestinyRerollRequest";
const FEEDBACK_EVENT = "ffgDestinyRerollFeedback";
const ENABLE_SETTING = "enableDestinyRerolls";
const LIMIT_SETTING = "destinyRerollsPerSession";
/** On the new roll: what was paid for it. */
const FLAG = "destinyReroll";
/** On the old roll: the id of the roll that replaced it. */
const REPLACED_FLAG = "destinyRerolledAs";

/** The chat message a context-menu entry was opened on (an HTMLElement on V14, jQuery on V13). */
function messageFrom(li) {
  const element = li instanceof HTMLElement ? li : li?.[0];
  return game.messages.get(element?.dataset?.messageId) ?? null;
}

export default class DestinyReroll {
  static get enabled() {
    return Boolean(game.settings.get("starwarsffg", ENABLE_SETTING));
  }

  /** How many Destiny Rerolls each character may make per session. */
  static get limit() {
    return Math.max(1, Math.trunc(Number(game.settings.get("starwarsffg", LIMIT_SETTING))) || 1);
  }

  /** Message ids and actor uuids with a reroll in flight on this client. */
  static _locks = new Set();

  /* -------------------------------------------- */
  /*  The roll                                    */
  /* -------------------------------------------- */

  static rollerActor(message) {
    return SpendResults.rollerActor(message);
  }

  static rollerName(message) {
    return SpendResults.rollerToken(message)?.name || this.rollerActor(message)?.name || "";
  }

  /** @returns {?string} a localization key saying why this roll cannot be destiny-rerolled, or null */
  static rollProblem(message) {
    if (!SpendResults.roll(message)?.hasFFG) return "SWFFG.DestinyReroll.Errors.NoRoll";
    // The initiative order was settled when the dice were rolled; a new card would not move it.
    if (message.flags?.core?.initiativeRoll) return "SWFFG.DestinyReroll.Errors.Initiative";
    if (message.flags?.starwarsffg?.[REPLACED_FLAG]) return "SWFFG.DestinyReroll.Errors.AlreadyRerolled";
    if (!this.rollerActor(message)) return "SWFFG.DestinyReroll.Errors.NoActor";
    return null;
  }

  /** How many Destiny Rerolls an actor has made this session. */
  static used(actor) {
    return DestinySession.used(actor, "reroll");
  }

  /** @returns {?string} localized text when the roller has none left or there is no point to spend */
  static blockedReason(message) {
    const actor = this.rollerActor(message);
    if (this.used(actor) >= this.limit) return game.i18n.format("SWFFG.DestinyReroll.Errors.NoUses", { actor: this.rollerName(message), limit: this.limit });
    return DestinySession.emptyReason(DestinySession.side(actor));
  }

  /** Whether the right-click entry belongs on this message for the current user. */
  static menuAvailable(message) {
    if (!message || !this.enabled || message.isContentVisible === false) return false;
    // The GM, whoever rolled it, or the roller's owner - the same people who may spend its results.
    if (!SpendResults.canSpend(game.user, message)) return false;
    return !this.rollProblem(message);
  }

  /* -------------------------------------------- */
  /*  Rerolling                                   */
  /* -------------------------------------------- */

  /** Say what it will cost, and ask for it once confirmed. */
  static async prompt(message) {
    const problem = this.rollProblem(message);
    if (problem) return ui.notifications.warn(game.i18n.localize(problem));
    const blocked = this.blockedReason(message);
    if (blocked) return ui.notifications.warn(blocked);
    if (!game.user.isGM && !game.users.activeGM) return ui.notifications.warn(game.i18n.localize("SWFFG.DestinySession.Errors.NoGM"));

    const actor = this.rollerActor(message);
    const side = DestinySession.side(actor);
    const label = DestinySession.poolLabel(side);
    const confirmed = await DialogV2.confirm({
      window: { title: "SWFFG.DestinyReroll.Confirm.Title", icon: "fa-solid fa-dharmachakra" },
      content: `
        <p>${loc("SWFFG.DestinyReroll.Confirm.Body", { actor: this.rollerName(message), side: label })}</p>
        <p class="notes">${loc("SWFFG.DestinyReroll.Confirm.Status", { used: this.used(actor), limit: this.limit, side: label, points: DestinySession.pool()[side] })}</p>`,
      yes: { label: "SWFFG.DestinyReroll.Confirm.Yes", icon: "fa-solid fa-dharmachakra" },
      no: { label: "Cancel" },
      rejectClose: false,
    });
    if (confirmed) await this.request(message.id);
  }

  /** Ask for a reroll. The GM carries it out here; a player hands it to the active GM. */
  static async request(messageId) {
    const request = { messageId, userId: game.user.id };
    if (game.user.isGM) return this.process(request);
    if (!game.users.activeGM) return ui.notifications.warn(game.i18n.localize("SWFFG.DestinySession.Errors.NoGM"));
    game.socket.emit(SOCKET, { event: REQUEST_EVENT, request });
  }

  /** Report a refusal to whoever asked, on whichever client they are. */
  static _feedback(userId, text, level = "warn") {
    if (userId === game.user.id) ui.notifications[level]?.(text);
    else game.socket.emit(SOCKET, { event: FEEDBACK_EVENT, userId, text, level });
  }

  /**
   * Carry out a reroll. Everything is checked again here: the request came over a socket, and the
   * pool or the session count may have changed since it was confirmed.
   * @param {{messageId: string, userId: string}} request
   */
  static async process(request) {
    const user = game.users.get(request.userId);
    if (!user) return;
    const fail = (key, data) => this._feedback(user.id, data ? game.i18n.format(key, data) : game.i18n.localize(key));
    const message = game.messages.get(request.messageId);
    if (!message) return fail("SWFFG.DestinyReroll.Errors.MessageGone");
    if (!this.enabled) return fail("SWFFG.DestinyReroll.Errors.Disabled");
    if (!SpendResults.canSpend(user, message)) return fail("SWFFG.DestinyReroll.Errors.NoPermission");
    const problem = this.rollProblem(message);
    if (problem) return fail(problem);
    const actor = this.rollerActor(message);

    const locks = [message.id, actor.uuid];
    if (locks.some((key) => this._locks.has(key))) return fail("SWFFG.DestinyReroll.Errors.Busy");
    for (const key of locks) this._locks.add(key);
    try {
      const blocked = this.blockedReason(message);
      if (blocked) return this._feedback(user.id, blocked);
      const side = DestinySession.side(actor);
      const used = this.used(actor) + 1;

      // The reroll first, the costs second: a reroll that could not be made costs nothing.
      const reroll = buildReroll(SpendResults.roll(message));
      await reroll.evaluate();
      const tag = game.i18n.localize("SWFFG.DestinyReroll.Tag");
      const data = {
        user: user.id,
        author: user.id,
        speaker: message.speaker,
        flavor: message.flavor ? `${message.flavor} (${tag})` : tag,
        flags: { starwarsffg: { [FLAG]: { of: message.id, side, userId: user.id, pool: DestinySession.afterSpend(side), used, limit: this.limit } } },
      };
      const draft = await reroll.toMessage(data, { create: false });
      // Same visibility as the roll it replaces, not the GM's current roll mode.
      draft.updateSource({ whisper: (message.whisper ?? []).map((entry) => entry?.id ?? entry).filter(Boolean), blind: Boolean(message.blind) });
      const created = await ChatMessage.implementation.create(draft.toObject());
      if (!created) return fail("SWFFG.DestinyReroll.Errors.Failed");

      await message.update({ [`flags.starwarsffg.${REPLACED_FLAG}`]: created.id });
      await DestinySession.spend(side);
      await DestinySession.record(actor, "reroll", { messageId: message.id, rerollId: created.id });
    } catch (err) {
      console.error("Star Wars FFG | Destiny Reroll failed", err);
      this._feedback(user.id, game.i18n.localize("SWFFG.DestinyReroll.Errors.Failed"), "error");
    } finally {
      for (const key of locks) this._locks.delete(key);
    }
  }

  /* -------------------------------------------- */
  /*  Chat                                        */
  /* -------------------------------------------- */

  /**
   * Say on the new card what the reroll cost, and on the old one that it was replaced. Called from the
   * system's chat render hook, after it has finished rewriting the card's content.
   * @param {ChatMessage} message
   * @param {jQuery} html
   */
  static bindChatMessage(message, html) {
    const paid = message.flags?.starwarsffg?.[FLAG];
    const replaced = message.flags?.starwarsffg?.[REPLACED_FLAG];
    if ((!paid && !replaced) || message.isContentVisible === false) return;
    const content = html.find(".message-content")[0];
    if (!content || content.querySelector(".ffg-destiny-reroll-strip")) return;

    const strip = document.createElement("div");
    strip.className = "ffg-destiny-reroll-strip";
    if (paid) {
      const side = paid.side === "dark" ? "dark" : "light";
      const pool = { light: Number(paid.pool?.light) || 0, dark: Number(paid.pool?.dark) || 0 };
      strip.innerHTML = `
        <i class="fa-solid fa-dharmachakra"></i>
        <span><strong>${loc("SWFFG.DestinyReroll.Tag")}</strong> ${escapeHTML(DestinySession.spentText(side, pool))}
        ${loc("SWFFG.DestinyReroll.Count", { used: paid.used ?? "?", limit: paid.limit ?? "?" })}</span>`;
    } else {
      strip.classList.add("replaced");
      strip.innerHTML = `<i class="fa-solid fa-dharmachakra"></i> <span>${loc("SWFFG.DestinyReroll.Replaced")}</span>`;
    }
    content.append(strip);
  }

  /* -------------------------------------------- */
  /*  Registration                                */
  /* -------------------------------------------- */

  static registerSettings() {
    game.settings.register("starwarsffg", LIMIT_SETTING, {
      name: game.i18n.localize("SWFFG.Settings.tools.destinyRerollsPerSession.Name"),
      hint: game.i18n.localize("SWFFG.Settings.tools.destinyRerollsPerSession.Hint"),
      scope: "world",
      config: false,
      default: 1,
      type: Number,
      range: { min: 1, max: 5, step: 1 },
    });
  }

  /**
   * The chat log collects its context-menu entries when it first renders, before `ready`, so this has
   * to be registered during init. Both the V13 (name/condition/callback) and V14 (label/visible/
   * onClick) entry keys are given.
   */
  static registerContextMenu() {
    Hooks.on("getChatMessageContextOptions", (_app, options) => {
      const visible = (li) => {
        try {
          return this.menuAvailable(messageFrom(li));
        } catch (err) {
          CONFIG.logger?.warn?.("Destiny Reroll: could not check a message", err);
          return false;
        }
      };
      const open = (li) => {
        const message = messageFrom(li);
        if (message) this.prompt(message);
      };
      const label = game.i18n.localize("SWFFG.DestinyReroll.MenuEntry");
      options.push({
        name: label,
        label,
        icon: '<i class="fa-solid fa-dharmachakra"></i>',
        condition: visible,
        visible,
        callback: (li) => open(li),
        onClick: (_event, li) => open(li),
      });
    });
  }

  /** The socket. Call once, at ready. */
  static register() {
    game.socket.on(SOCKET, async (data) => {
      if (data?.event === REQUEST_EVENT) {
        // one executor: the active GM
        if (game.users.activeGM?.isSelf) await this.process(data.request);
      } else if (data?.event === FEEDBACK_EVENT && data.userId === game.user.id) {
        ui.notifications[data.level]?.(data.text);
      }
    });
  }
}
