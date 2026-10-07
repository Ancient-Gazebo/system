/**
 * Bond Invocations (house rule).
 *
 * A limited number of times per session (two by default) a character may spend a Destiny Point to
 * invoke one of their bonds, adding symbols to a check that has already been rolled. What a bond
 * grants depends on its level:
 *
 *   level 1-5   [SU][AD]
 *   level 6-9   [SU][AD][AD]
 *   level 10    [TR][TR]
 *
 * Bonds are the relationships kept by GlitchSmith's Stylish Relationship Tracker, and a bond's level
 * is the relationship's rank (the same 1-10 scale). The tracker is a protected module, so it is only
 * read through its public API - `listRelationshipProgress`, which applies the tracker's own
 * visibility rules for the asking user - plus the display fields (name, portrait) of the entries that
 * API returned. Organizations (reputation, not bonds), negative relationships and rank 0 are never
 * offered.
 *
 * The roll card's right-click menu offers "Invoke a Bond"; the dialog behind it lists the roller's
 * bonds. Invoking one rewrites the roll itself: its net results, with the new symbols cancelling
 * failure and threat exactly as dice would, plus "added results" lines tagged as the bond's. The card,
 * Spend Results, Apply Damage and the weapon card's damage all read the roll, so they all follow. A
 * roll takes one bond at most, as a check takes one Destiny Point.
 *
 * Paying for it and counting it per session are shared with Destiny Rerolls (helpers/destiny-session.js):
 * a player's character spends a light side point, an NPC a dark side one, and the GM's Request Destiny
 * Roll starts a new session. The destiny pool is a world setting and the roll may be someone else's
 * message, so the invocation is carried out by the active GM; requests travel over the system socket,
 * as Spend Results' do.
 */
import PopoutEditor from "../popout-editor.js";
import SpendResults from "./spend-results.js";
import DestinySession from "./destiny-session.js";
import { escapeHTML, loc } from "./html.js";

const { ApplicationV2 } = foundry.applications.api;

const SOCKET = "system.starwarsffg";
const REQUEST_EVENT = "ffgBondRequest";
const FEEDBACK_EVENT = "ffgBondFeedback";
const FLAG = "bond";
const ENABLE_SETTING = "enableBondInvocations";
const LIMIT_SETTING = "bondInvocationsPerSession";
const TRACKER_ID = "stylish-relationship-tracker";
const TRACKER_FLAG = "relationshipData";

/** What a bond adds to a roll, checked top down. A rank above 10 (the tracker allows up to 99) counts as 10. */
const TIERS = [
  { min: 10, grant: { triumph: 2 } },
  { min: 6, grant: { success: 1, advantage: 2 } },
  { min: 1, grant: { success: 1, advantage: 1 } },
];

/** The roll's `addedResults` entry for each symbol a bond can grant, as RollFFG writes its own. */
const ADDED = {
  success: { type: "Success", symbol: "[SU]" },
  advantage: { type: "Advantage", symbol: "[AD]" },
  triumph: { type: "Triumph", symbol: "[TR]" },
};

/** @returns {?object} what a bond of this rank grants, or null when it grants nothing */
function grantFor(rank) {
  return TIERS.find((tier) => rank >= tier.min)?.grant ?? null;
}

/** The grant as a row of dice symbols. Tolerates a grant read back from a message flag. */
function grantIcons(grant) {
  const codes = Object.entries(grant ?? {})
    .filter(([symbol]) => symbol in ADDED)
    .map(([symbol, count]) => ADDED[symbol].symbol.repeat(Math.clamp(Math.trunc(Number(count)) || 0, 0, 5)))
    .join("");
  return PopoutEditor.replaceDiceSymbols(codes);
}

/**
 * Add a grant to a roll's net results. RollFFG stores results after cancellation, and cancellation
 * is plain subtraction, so the new successes and advantages first eat any failure and threat left
 * over. A triumph is also a success, as it is on the die.
 * @param {object} ffg  the roll's stored `ffg` results
 * @param {object} grant
 * @returns {object}
 */
function applyGrant(ffg, grant) {
  const out = { ...ffg };
  const count = (value) => Math.trunc(Number(value)) || 0;
  const successes = count(out.success) - count(out.failure) + count(grant.success) + count(grant.triumph);
  out.success = Math.max(0, successes);
  out.failure = Math.max(0, -successes);
  const advantages = count(out.advantage) - count(out.threat) + count(grant.advantage);
  out.advantage = Math.max(0, advantages);
  out.threat = Math.max(0, -advantages);
  out.triumph = count(out.triumph) + count(grant.triumph);
  return out;
}

/** The chat message a context-menu entry was opened on (an HTMLElement on V14, jQuery on V13). */
function messageFrom(li) {
  const element = li instanceof HTMLElement ? li : li?.[0];
  return game.messages.get(element?.dataset?.messageId) ?? null;
}

export default class BondInvocation {
  /** @returns {?object} the tracker's API, when the module is active */
  static get api() {
    const tracker = game.modules.get(TRACKER_ID);
    return tracker?.active ? tracker.api ?? null : null;
  }

  static get enabled() {
    return Boolean(game.settings.get("starwarsffg", ENABLE_SETTING) && this.api?.listRelationshipProgress);
  }

  /** How many bonds each character may invoke per session. */
  static get limit() {
    return Math.max(1, Math.trunc(Number(game.settings.get("starwarsffg", LIMIT_SETTING))) || 2);
  }

  /** Message ids and actor uuids with an invocation in flight on this client. */
  static _locks = new Set();

  /* -------------------------------------------- */
  /*  The roll                                    */
  /* -------------------------------------------- */

  /** @returns {?object} the bond already invoked on a roll message */
  static invoked(message) {
    return message?.flags?.starwarsffg?.[FLAG] ?? null;
  }

  /** @returns {?Actor} the actor that made the roll */
  static rollerActor(message) {
    return SpendResults.rollerActor(message);
  }

  /** The name the roller goes by on the card: its token's, else the actor's. */
  static rollerName(message) {
    return SpendResults.rollerToken(message)?.name || this.rollerActor(message)?.name || "";
  }

  /** @returns {?string} a localization key saying why this roll cannot take a bond, or null when it can */
  static rollProblem(message) {
    if (!SpendResults.roll(message)?.hasFFG) return "SWFFG.Bond.Errors.NoRoll";
    // The initiative order was settled when the dice were rolled; changing the card would not move it.
    if (message.flags?.core?.initiativeRoll) return "SWFFG.Bond.Errors.Initiative";
    if (this.invoked(message)) return "SWFFG.Bond.Errors.AlreadyInvoked";
    // A Destiny Reroll replaced this roll; the bond belongs on the new one.
    if (message.flags?.starwarsffg?.destinyRerolledAs) return "SWFFG.Bond.Errors.Rerolled";
    if (!this.rollerActor(message)) return "SWFFG.Bond.Errors.NoActor";
    return null;
  }

  /** Whether a user may invoke a bond on this roll: the GM, whoever rolled it, or the roller's owner. */
  static canInvoke(user, message) {
    if (!user || !message) return false;
    if (user.isGM) return true;
    const authorId = message.author?.id ?? message.user?.id ?? message.user;
    if (authorId === user.id) return true;
    return Boolean(this.rollerActor(message)?.testUserPermission?.(user, "OWNER"));
  }

  /**
   * A copy of the message's stored rolls with the grant added to its FFG roll. Works on the stored
   * JSON rather than the prepared Roll, which rendering has already decorated.
   * @returns {?string[]} null when the message carries no FFG roll
   */
  static _rollsWithGrant(message, grant) {
    const rolls = (message._source.rolls ?? []).map((source) => (typeof source === "string" ? source : JSON.stringify(source)));
    for (let index = 0; index < rolls.length; index++) {
      let data;
      try {
        data = JSON.parse(rolls[index]);
      } catch (err) {
        continue;
      }
      if (!data?.hasFFG || !data.ffg || typeof data.ffg !== "object") continue;
      data.ffg = applyGrant(data.ffg, grant);
      const added = Object.entries(grant).map(([symbol, value]) => ({ ...ADDED[symbol], value, negative: false, source: "bond" }));
      data.addedResults = [...(Array.isArray(data.addedResults) ? data.addedResults : []), ...added];
      rolls[index] = JSON.stringify(data);
      return rolls;
    }
    return null;
  }

  /* -------------------------------------------- */
  /*  Bonds                                       */
  /* -------------------------------------------- */

  /**
   * The bonds an actor can invoke, as a user may see them, strongest first.
   * @param {Actor} actor
   * @param {User} user
   * @returns {{id: string, name: string, img: string, rank: number, grant: object}[]}
   */
  static bonds(actor, user = game.user) {
    const api = this.api;
    if (!api?.listRelationshipProgress || !actor || !user) return [];
    let progress;
    try {
      progress = api.listRelationshipProgress(actor, { userId: user.id });
    } catch (err) {
      CONFIG.logger?.warn?.("Bond Invocations: could not read the relationships", err);
      return [];
    }
    // The progress projection carries no name or picture; those come from the tracker's own record,
    // and only for entries the projection has already cleared for this user.
    const stored = actor.getFlag(TRACKER_ID, TRACKER_FLAG)?.relationships;
    const records = new Map((Array.isArray(stored) ? stored : []).map((record) => [record?.id, record]));
    const bonds = [];
    for (const entry of Array.isArray(progress) ? progress : []) {
      if (entry?.entryType === "organization" || entry?.isNegative) continue;
      const rank = Math.trunc(Number(entry.rank)) || 0;
      const grant = grantFor(rank);
      if (!grant) continue;
      const record = records.get(entry.relationshipId) ?? {};
      const target = this._target(entry.targetUuid, user);
      bonds.push({
        id: entry.relationshipId,
        name: String(record.customName || target?.name || record.categoryLabel || "???"),
        img: record.listImage || record.portrait || target?.img || "icons/svg/mystery-man.svg",
        rank,
        grant,
      });
    }
    return bonds.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name, game.i18n.lang));
  }

  /** The bond's actor, when the user may see it (the tracker shows them a name only then). */
  static _target(uuid, user) {
    if (!uuid) return null;
    let actor = null;
    try {
      actor = fromUuidSync(uuid);
    } catch (err) {
      return null;
    }
    if (!actor || !(user.isGM || actor.testUserPermission?.(user, "LIMITED"))) return null;
    return { name: actor.name, img: actor.img };
  }

  /* -------------------------------------------- */
  /*  Session uses and the destiny pool           */
  /* -------------------------------------------- */

  /** How many bonds an actor has invoked this session. */
  static used(actor) {
    return DestinySession.used(actor, "bond");
  }

  /**
   * Why an actor cannot invoke a bond right now (used up, or no point to spend), or null when it can.
   * @returns {?string} localized text
   */
  static blockedReason(message) {
    const actor = this.rollerActor(message);
    if (this.used(actor) >= this.limit) return game.i18n.format("SWFFG.Bond.Errors.NoUses", { actor: this.rollerName(message), limit: this.limit });
    return DestinySession.emptyReason(DestinySession.side(actor));
  }

  /* -------------------------------------------- */
  /*  Invoking                                    */
  /* -------------------------------------------- */

  /**
   * Ask for an invocation. The GM carries it out here; a player hands it to the active GM.
   * @returns {Promise<boolean>} false when the request could not even be sent
   */
  static async request(messageId, relationshipId) {
    const request = { messageId, relationshipId, userId: game.user.id };
    if (game.user.isGM) {
      await this.process(request);
      return true;
    }
    if (!game.users.activeGM) {
      ui.notifications.warn(game.i18n.localize("SWFFG.DestinySession.Errors.NoGM"));
      return false;
    }
    game.socket.emit(SOCKET, { event: REQUEST_EVENT, request });
    return true;
  }

  /** Report back to whoever asked, on whichever client they are. */
  static _feedback(userId, text, level = "warn") {
    if (userId === game.user.id) {
      ui.notifications[level]?.(text);
      BondInvocationDialog.settle();
    } else {
      game.socket.emit(SOCKET, { event: FEEDBACK_EVENT, userId, text, level });
    }
  }

  /**
   * Carry out an invocation. Everything is checked again here: the request came over a socket, and
   * the pool, the session count or the roll may have changed since the dialog was drawn.
   * @param {{messageId: string, relationshipId: string, userId: string}} request
   */
  static async process(request) {
    const user = game.users.get(request.userId);
    if (!user) return;
    const fail = (key, data) => this._feedback(user.id, data ? game.i18n.format(key, data) : game.i18n.localize(key));
    const message = game.messages.get(request.messageId);
    if (!message) return fail("SWFFG.Bond.Errors.MessageGone");
    if (!this.enabled) return fail("SWFFG.Bond.Errors.Disabled");
    if (!this.canInvoke(user, message)) return fail("SWFFG.Bond.Errors.NoPermission");
    const problem = this.rollProblem(message);
    if (problem) return fail(problem);
    const actor = this.rollerActor(message);

    const locks = [message.id, actor.uuid];
    if (locks.some((key) => this._locks.has(key))) return fail("SWFFG.Bond.Errors.Busy");
    for (const key of locks) this._locks.add(key);
    try {
      // The bond as the requesting user sees it: one the tracker hides from them cannot be invoked.
      const bond = this.bonds(actor, user).find((entry) => entry.id === request.relationshipId);
      if (!bond) return fail("SWFFG.Bond.Errors.BondMissing");
      const blocked = this.blockedReason(message);
      if (blocked) return this._feedback(user.id, blocked);
      const used = this.used(actor);
      const side = DestinySession.side(actor);

      // The symbols first, the costs second: an invocation that could not be applied costs nothing.
      const rolls = this._rollsWithGrant(message, bond.grant);
      if (!rolls) return fail("SWFFG.Bond.Errors.NoRoll");
      await message.update({
        rolls,
        [`flags.starwarsffg.${FLAG}`]: { relationshipId: bond.id, name: bond.name, rank: bond.rank, grant: bond.grant, actorUuid: actor.uuid, side, userId: user.id, time: Date.now() },
      });
      const after = await DestinySession.spend(side);
      await DestinySession.record(actor, "bond", { messageId: message.id, relationshipId: bond.id });

      await this._announce(message, user, bond, side, after, used + 1);
      if (user.id === game.user.id) BondInvocationDialog.settle();
    } catch (err) {
      console.error("Star Wars FFG | Bond invocation failed", err);
      this._feedback(user.id, game.i18n.localize("SWFFG.Bond.Errors.Failed"), "error");
    } finally {
      for (const key of locks) this._locks.delete(key);
    }
  }

  /** Post the "bond invoked" card, with the same visibility as the roll it changed. */
  static async _announce(message, user, bond, side, pool, used) {
    const content = `
      <div class="ffg-bond-card">
        <div class="ffg-bond-card-title"><i class="fa-solid fa-link"></i> <strong>${loc("SWFFG.Bond.Card.Title")}</strong> <span class="ffg-bond-grant">${grantIcons(bond.grant)}</span></div>
        <div>${loc("SWFFG.Bond.Card.Body", { actor: this.rollerName(message), bond: bond.name, rank: bond.rank })}</div>
        <div class="ffg-bond-card-auto">${escapeHTML(DestinySession.spentText(side, pool))}</div>
        <div class="ffg-bond-card-by">${loc("SWFFG.Bond.Card.By", { user: user.name, used, limit: this.limit })}</div>
      </div>`;
    const data = { content, speaker: message.speaker };
    const whisper = (message.whisper ?? []).map((entry) => entry?.id ?? entry).filter(Boolean);
    if (whisper.length) data.whisper = whisper;
    if (message.blind) data.blind = true;
    await ChatMessage.create(data);
  }

  /* -------------------------------------------- */
  /*  Chat                                        */
  /* -------------------------------------------- */

  /**
   * Mark a roll card that a bond was invoked on. Called from the system's chat render hook, after it
   * has finished rewriting the card's content, and before the Spend Results strip goes on.
   * @param {ChatMessage} message
   * @param {jQuery} html
   */
  static bindChatMessage(message, html) {
    const record = this.invoked(message);
    if (!record || message.isContentVisible === false) return;
    const content = html.find(".message-content")[0];
    if (!content || content.querySelector(".ffg-bond-strip")) return;
    const strip = document.createElement("div");
    strip.className = "ffg-bond-strip";
    strip.innerHTML = `<i class="fa-solid fa-link"></i> <span>${loc("SWFFG.Bond.Strip", { bond: record.name ?? "???", rank: record.rank ?? "?" })}</span> <span class="ffg-bond-grant">${grantIcons(record.grant)}</span>`;
    content.append(strip);
  }

  /** Whether the right-click entry belongs on this message for the current user. */
  static menuAvailable(message) {
    if (!message || !this.enabled) return false;
    if (message.isContentVisible === false || !this.canInvoke(game.user, message)) return false;
    if (this.rollProblem(message)) return false;
    return this.bonds(this.rollerActor(message), game.user).length > 0;
  }

  /* -------------------------------------------- */
  /*  Registration                                */
  /* -------------------------------------------- */

  static registerSettings() {
    game.settings.register("starwarsffg", LIMIT_SETTING, {
      name: game.i18n.localize("SWFFG.Settings.tools.bondInvocationsPerSession.Name"),
      hint: game.i18n.localize("SWFFG.Settings.tools.bondInvocationsPerSession.Hint"),
      scope: "world",
      config: false,
      default: 2,
      type: Number,
      range: { min: 1, max: 5, step: 1 },
      onChange: () => BondInvocationDialog.refresh(),
    });
  }

  /**
   * The chat log collects its context-menu entries when it first renders, before `ready`, so this has
   * to be registered during init. Whether the feature is on is checked when the menu opens.
   * Both the V13 (name/condition/callback) and V14 (label/visible/onClick) entry keys are given.
   */
  static registerContextMenu() {
    Hooks.on("getChatMessageContextOptions", (_app, options) => {
      const visible = (li) => {
        try {
          return this.menuAvailable(messageFrom(li));
        } catch (err) {
          CONFIG.logger?.warn?.("Bond Invocations: could not check a message", err);
          return false;
        }
      };
      const open = (li) => {
        const message = messageFrom(li);
        if (message) BondInvocationDialog.open(message.id);
      };
      const label = game.i18n.localize("SWFFG.Bond.MenuEntry");
      options.push({
        name: label,
        label,
        icon: '<i class="fa-solid fa-link"></i>',
        condition: visible,
        visible,
        callback: (li) => open(li),
        onClick: (_event, li) => open(li),
      });
    });
  }

  /** Socket and document hooks. Call once, at ready. */
  static register() {
    game.socket.on(SOCKET, async (data) => {
      if (data?.event === REQUEST_EVENT) {
        // one executor: the active GM
        if (game.users.activeGM?.isSelf) await this.process(data.request);
      } else if (data?.event === FEEDBACK_EVENT && data.userId === game.user.id) {
        ui.notifications[data.level]?.(data.text);
        BondInvocationDialog.settle();
      }
    });

    Hooks.on("updateChatMessage", (message) => {
      const dialog = BondInvocationDialog.instances.get(message.id);
      if (!dialog) return;
      // One bond per roll: once one is on, there is nothing left to choose.
      if (this.invoked(message)) dialog.close();
      else BondInvocationDialog.refresh(message.id);
    });
    Hooks.on("deleteChatMessage", (message) => BondInvocationDialog.instances.get(message.id)?.close());

    // The pool and the session count decide whether the Invoke buttons are live.
    const onSetting = (setting) => {
      if (DestinySession.WATCHED_SETTINGS.includes(setting?.key)) BondInvocationDialog.refresh();
    };
    Hooks.on("createSetting", onSetting);
    Hooks.on("updateSetting", onSetting);
  }
}

/* -------------------------------------------- */
/*  Dialog                                      */
/* -------------------------------------------- */

/** The bond picker for one roll. Redraws from the message, the pool and the session count. */
export class BondInvocationDialog extends ApplicationV2 {
  constructor(options = {}) {
    super(options);
    this.messageId = options.messageId;
    /** True between asking for an invocation and hearing how it went; the buttons are held meanwhile. */
    this.pending = false;
  }

  /** message id -> open dialog */
  static instances = new Map();

  static DEFAULT_OPTIONS = {
    classes: ["starwarsffg", "ffg-bond-dialog"],
    tag: "div",
    window: {
      title: "SWFFG.Bond.Dialog.Title",
      icon: "fa-solid fa-link",
      resizable: true,
    },
    position: {
      width: 440,
      height: "auto",
    },
  };

  static open(messageId) {
    let dialog = this.instances.get(messageId);
    if (!dialog) {
      dialog = new this({ id: `ffg-bond-${messageId}`, messageId });
      this.instances.set(messageId, dialog);
    }
    dialog.render({ force: true });
    return dialog;
  }

  /** Redraw one dialog, or all of them. */
  static refresh(messageId = null) {
    for (const [id, dialog] of this.instances) {
      if (messageId && id !== messageId) continue;
      if (dialog.rendered) dialog.render();
    }
  }

  /** An invocation this client asked for has been answered (either way): release the buttons. */
  static settle() {
    for (const dialog of this.instances.values()) {
      if (!dialog.pending) continue;
      dialog.pending = false;
      if (dialog.rendered) dialog.render();
    }
  }

  get message() {
    return game.messages.get(this.messageId) ?? null;
  }

  /** @override */
  async close(options) {
    BondInvocationDialog.instances.delete(this.messageId);
    return super.close(options);
  }

  /** @override */
  async _renderHTML(_context, _options) {
    const root = document.createElement("div");
    root.className = "ffg-bond-body";
    const message = this.message;
    const problem = message ? BondInvocation.rollProblem(message) : "SWFFG.Bond.Errors.MessageGone";
    if (problem) {
      root.innerHTML = `<p class="notes">${loc(problem)}</p>`;
      return root;
    }

    const actor = BondInvocation.rollerActor(message);
    const name = BondInvocation.rollerName(message);
    const used = BondInvocation.used(actor);
    const limit = BondInvocation.limit;
    const side = DestinySession.side(actor);
    const sideLabel = DestinySession.poolLabel(side);
    const points = DestinySession.pool()[side];
    const blocked = BondInvocation.blockedReason(message);
    const bonds = BondInvocation.bonds(actor, game.user);

    const rows = bonds
      .map((bond) => `
        <div class="ffg-bond-row">
          <img class="ffg-bond-portrait" src="${escapeHTML(bond.img)}" alt="" />
          <div class="ffg-bond-text">
            <div class="ffg-bond-name">${escapeHTML(bond.name)}</div>
            <div class="ffg-bond-level">${loc("SWFFG.Bond.Dialog.Level", { rank: bond.rank })}</div>
          </div>
          <span class="ffg-bond-grant">${grantIcons(bond.grant)}</span>
          <button type="button" class="ffg-bond-invoke" data-bond="${escapeHTML(bond.id)}" ${this.pending || blocked ? "disabled" : ""}>${loc("SWFFG.Bond.Dialog.Invoke")}</button>
        </div>`)
      .join("");

    root.innerHTML = `
      <header class="ffg-bond-header">
        <span class="ffg-bond-actor">${escapeHTML(name)}</span>
        <span class="ffg-spend-badge${used >= limit ? " spent" : ""}">${loc("SWFFG.Bond.Dialog.Uses", { used, limit })}</span>
        <span class="ffg-spend-badge${points < 1 ? " spent" : ""}">${escapeHTML(sideLabel)} <b>${points}</b></span>
      </header>
      <p class="${blocked ? "ffg-bond-blocked" : "notes"}">${blocked ? escapeHTML(blocked) : loc("SWFFG.Bond.Dialog.Cost", { side: sideLabel })}</p>
      <div class="ffg-bond-list">${rows || `<p class="notes">${loc("SWFFG.Bond.Dialog.NoBonds", { actor: name })}</p>`}</div>`;
    return root;
  }

  /** @override */
  _replaceHTML(result, content, _options) {
    content.replaceChildren(result);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    for (const button of this.element.querySelectorAll(".ffg-bond-invoke")) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        if (this.pending) return;
        this.pending = true;
        for (const other of this.element.querySelectorAll(".ffg-bond-invoke")) other.disabled = true;
        // If the answer never comes (the GM dropped mid-request), do not hold the dialog forever.
        setTimeout(() => {
          if (!this.pending) return;
          this.pending = false;
          if (this.rendered) this.render();
        }, 5000);
        const sent = await BondInvocation.request(this.messageId, button.dataset.bond);
        if (!sent) BondInvocationDialog.settle();
      });
    }
  }
}
