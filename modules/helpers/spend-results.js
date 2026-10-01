/**
 * Spend Results.
 *
 * Every roll card that came up with advantage, threat, triumph or despair gets a strip showing what
 * is still unspent and a Spend button. The dialog behind it lists what those results can buy -
 * the standard combat table while a fight is running, a shorter narrative table otherwise, the
 * active qualities of the weapon when the roll was an attack, and any options the GM has added -
 * and spending one records it on the roll, announces it in chat, and applies the effect where the
 * effect is mechanical:
 *
 *   - strain recovered or suffered by the roller;
 *   - a boost / setback / upgrade on someone's next check (the system's own "Next Check" statuses,
 *     stacked - see helpers/status-effects.js);
 *   - a status on the roller or the target (Prone, and the weapon-quality conditions);
 *   - an extra hit, which Apply Damage then defaults to.
 *
 * What is spent lives in the roll message's flags (`flags.starwarsffg.spend`), so it is shared,
 * survives a reload, and can never exceed what was rolled.
 *
 * Who does the writing: effects routinely land on actors the spender does not own (the target of an
 * attack, an ally), and a player cannot update another player's roll message. So a spend is always
 * carried out by one client that can do all of it - the active GM when there is one, otherwise the
 * spender, limited to what they own. Requests travel over the system socket.
 */
import PopoutEditor from "../popout-editor.js";
import WeaponQualities from "./weapon-qualities.js";
import { applyToTargetActor } from "./gm-bridge.js";
import { NEXT_CHECK, STATUS, applyNextCheckLocal, nextCheckCount, statusLabel, strainTrack } from "./status-effects.js";
import { activeCombat, combatantDisposition, slotClaimant, usesSlots } from "./combat-turns.js";
import { escapeHTML, loc } from "./html.js";
import { FFGFormApplication } from "../apps/ffg-form-application.js";

const { ApplicationV2 } = foundry.applications.api;

const SOCKET = "system.starwarsffg";
const REQUEST_EVENT = "ffgSpendRequest";
const FEEDBACK_EVENT = "ffgSpendFeedback";
const FLAG = "spend";
const PENDING_FLAG = "pendingNextCheck";
const CUSTOM_SETTING = "spendCustomOptions";

const SYMBOLS = ["advantage", "triumph", "threat", "despair"];
const SYMBOL_CODE = { advantage: "[AD]", triumph: "[TR]", threat: "[TH]", despair: "[DE]" };
/** Players spend what they rolled in their favour; what went against them is the GM's to spend. */
const PLAYER_SYMBOLS = ["advantage", "triumph"];

/**
 * The built-in options. `costs` lists every way an option can be paid for; `target` says who an
 * automated effect lands on:
 *   "self"     the character who rolled
 *   "target"   the token the check was made against
 *   "ally"     a friendly token, chosen in the dialog (the roller included)
 *   "nextAlly" whoever takes the next allied initiative slot
 * Titles and descriptions are localized from SWFFG.Spend.Options.<id>.
 */
const POSITIVE = { advantage: 1, triumph: 1 };
const NEGATIVE = { threat: 1, despair: 1 };
const OPTIONS = {
  recoverStrain: { costs: POSITIVE, target: "self", automation: { type: "strain", delta: -1 } },
  boostNextAlly: { costs: POSITIVE, target: "nextAlly", automation: { type: "nextCheck", kind: "boost" } },
  noticeDetail: { costs: POSITIVE },
  freeManeuver: { costs: { advantage: 2, triumph: 1 } },
  setbackTarget: { costs: { advantage: 2, triumph: 1 }, target: "target", automation: { type: "nextCheck", kind: "setback" } },
  boostAnyAlly: { costs: { advantage: 2, triumph: 1 }, target: "ally", automation: { type: "nextCheck", kind: "boost" } },
  negateDefense: { costs: { advantage: 3, triumph: 1 } },
  ignoreEnvironment: { costs: { advantage: 3, triumph: 1 } },
  disableTarget: { costs: { advantage: 3, triumph: 1 } },
  gainDefense: { costs: { advantage: 3, triumph: 1 } },
  dropWeapon: { costs: { advantage: 3, triumph: 1 } },
  upgradeTargetDifficulty: { costs: { triumph: 1 }, target: "target", automation: { type: "nextCheck", kind: "upgradeDifficulty" } },
  upgradeAllyAbility: { costs: { triumph: 1 }, target: "ally", automation: { type: "nextCheck", kind: "upgradeAbility" } },
  doSomethingVital: { costs: { triumph: 1 } },
  destroyEquipment: { costs: { triumph: 2 } },

  sufferStrain: { costs: NEGATIVE, target: "self", automation: { type: "strain", delta: 1 } },
  loseManeuverBenefit: { costs: NEGATIVE },
  opponentFreeManeuver: { costs: { threat: 2, despair: 1 } },
  boostTarget: { costs: { threat: 2, despair: 1 }, target: "target", automation: { type: "nextCheck", kind: "boost" } },
  setbackAlly: { costs: { threat: 2, despair: 1 }, target: "ally", automation: { type: "nextCheck", kind: "setback" } },
  fallProne: { costs: { threat: 3, despair: 1 }, target: "self", automation: { type: "status", status: "prone" } },
  enemyAdvantage: { costs: { threat: 3, despair: 1 } },
  outOfAmmo: { costs: { despair: 1 }, automation: { type: "ammo" } },
  upgradeAllyDifficulty: { costs: { despair: 1 }, target: "ally", automation: { type: "nextCheck", kind: "upgradeDifficulty" } },
  weaponDamaged: { costs: { despair: 1 } },

  // narrative-only entries used by the general (non-combat) table
  extraInsight: { costs: { advantage: 2, triumph: 1 } },
  sideBenefit: { costs: { advantage: 3, triumph: 1 } },
  remarkableOutcome: { costs: { triumph: 1 } },
  minorSetback: { costs: { threat: 2, despair: 1 } },
  complication: { costs: { threat: 3, despair: 1 } },
  disaster: { costs: { despair: 1 } },
};

const TABLES = {
  combat: [
    "recoverStrain", "boostNextAlly", "noticeDetail",
    "freeManeuver", "setbackTarget", "boostAnyAlly",
    "negateDefense", "ignoreEnvironment", "disableTarget", "gainDefense", "dropWeapon",
    "upgradeTargetDifficulty", "upgradeAllyAbility", "doSomethingVital", "destroyEquipment",
    "sufferStrain", "loseManeuverBenefit",
    "opponentFreeManeuver", "boostTarget", "setbackAlly",
    "fallProne", "enemyAdvantage",
    "outOfAmmo", "upgradeAllyDifficulty", "weaponDamaged",
  ],
  general: [
    "recoverStrain", "boostAnyAlly", "noticeDetail",
    "extraInsight", "setbackTarget",
    "sideBenefit",
    "upgradeAllyAbility", "upgradeTargetDifficulty", "remarkableOutcome",
    "sufferStrain",
    "minorSetback", "boostTarget", "setbackAlly",
    "complication",
    "upgradeAllyDifficulty", "disaster",
  ],
};

/** Dice-symbol markup for a symbol name, as the rest of the system renders it. */
function symbolIcon(symbol) {
  return PopoutEditor.replaceDiceSymbols(SYMBOL_CODE[symbol]);
}

/** Escape free text, then render any dice codes ([BO], [SE], ...) the string carries. */
function richText(text) {
  return PopoutEditor.replaceDiceSymbols(escapeHTML(text));
}

export default class SpendResults {
  static get enabled() {
    return game.settings.get("starwarsffg", "enableSpendResults");
  }

  /** Message ids with a spend in flight on this client, so a double click cannot spend twice. */
  static _locks = new Set();

  /* -------------------------------------------- */
  /*  State                                       */
  /* -------------------------------------------- */

  /** @returns {?RollFFG} the FFG roll carried by a message */
  static roll(message) {
    return message?.rolls?.find?.((roll) => roll?.ffg && typeof roll.ffg === "object") ?? null;
  }

  /** @returns {{advantage: number, triumph: number, threat: number, despair: number}} as rolled */
  static rolled(message) {
    const ffg = this.roll(message)?.ffg ?? {};
    const out = {};
    for (const symbol of SYMBOLS) out[symbol] = Math.max(0, Math.trunc(Number(ffg[symbol]) || 0));
    return out;
  }

  /** The spend record on a message, normalized and never exceeding what was rolled. */
  static state(message) {
    const flag = message?.flags?.starwarsffg?.[FLAG] ?? {};
    const rolled = this.rolled(message);
    const spent = {};
    for (const symbol of SYMBOLS) spent[symbol] = Math.clamp(Math.trunc(Number(flag.spent?.[symbol]) || 0), 0, rolled[symbol]);
    return {
      spent,
      history: Array.isArray(flag.history) ? flag.history.slice(-50) : [],
      extraHits: Math.max(0, Math.trunc(Number(flag.extraHits) || 0)),
    };
  }

  /** @returns {{advantage: number, triumph: number, threat: number, despair: number}} still unspent */
  static remaining(message) {
    const rolled = this.rolled(message);
    const { spent } = this.state(message);
    const out = {};
    for (const symbol of SYMBOLS) out[symbol] = rolled[symbol] - spent[symbol];
    return out;
  }

  static _isInitiative(message) {
    return Boolean(message?.flags?.core?.initiativeRoll);
  }

  /** Whether a user may spend from this roll at all. */
  static canSpend(user, message) {
    if (!user || !message || this._isInitiative(message)) return false;
    if (user.isGM) return true;
    const authorId = message.author?.id ?? message.user?.id ?? message.user;
    if (authorId === user.id) return true;
    const actor = this.rollerActor(message);
    return Boolean(actor?.testUserPermission?.(user, "OWNER"));
  }

  /** The result symbols a user is allowed to spend. */
  static symbolsFor(user) {
    return user?.isGM ? SYMBOLS : PLAYER_SYMBOLS;
  }

  /* -------------------------------------------- */
  /*  Who rolled, and against whom                */
  /* -------------------------------------------- */

  static _scene(message) {
    return game.scenes.get(message?.speaker?.scene) ?? canvas?.scene ?? null;
  }

  /** @returns {?TokenDocument} the token that made the roll */
  static rollerToken(message) {
    const tokenId = message?.speaker?.token;
    if (tokenId) return this._scene(message)?.tokens?.get(tokenId) ?? null;
    // A roll made from a linked actor's sheet names the actor but no token. Its token on the scene
    // in view still says which side the roller is on, which is what "ally" is decided by.
    const actor = game.actors.get(message?.speaker?.actor);
    return actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  }

  /** @returns {?Actor} the actor that made the roll (the token's own actor for an unlinked token) */
  static rollerActor(message) {
    return this.rollerToken(message)?.actor ?? game.actors.get(message?.speaker?.actor) ?? null;
  }

  static _choice(tokenDocument) {
    return tokenDocument?.actor ? { uuid: tokenDocument.uuid, name: tokenDocument.name || tokenDocument.actor.name, actor: tokenDocument.actor } : null;
  }

  /**
   * Who an option with a target can be aimed at.
   * @param {ChatMessage} message
   * @param {"self"|"target"|"ally"} mode
   * @param {User} user  the spender (their live targets are the last fallback for "target")
   * @returns {{uuid: string, name: string, actor: Actor}[]}
   */
  static targetChoices(message, mode, user = game.user) {
    if (mode === "self") {
      const actor = this.rollerActor(message);
      return actor ? [{ uuid: actor.uuid, name: this.rollerToken(message)?.name || actor.name, actor }] : [];
    }

    if (mode === "target") {
      // What was targeted when the dice were rolled, as recorded on the message. Rolls made before
      // that was recorded (or made with nothing targeted) fall back to whatever the roller, and
      // then the spender, has targeted now.
      const recorded = (message.flags?.starwarsffg?.attack?.targets ?? [])
        .map((uuid) => { try { return fromUuidSync(uuid); } catch (err) { return null; } })
        .map((doc) => this._choice(doc))
        .filter(Boolean);
      if (recorded.length) return recorded;
      const author = message.author ?? game.users.get(message.user);
      for (const source of [author, user]) {
        const live = Array.from(source?.targets ?? []).map((token) => this._choice(token.document)).filter(Boolean);
        if (live.length) return live;
      }
      return [];
    }

    // "ally": everyone on the roller's side of the scene, the roller included.
    const scene = this._scene(message);
    const rollerToken = this.rollerToken(message);
    const side = rollerToken ? rollerToken.disposition : CONST.TOKEN_DISPOSITIONS.FRIENDLY;
    const choices = [];
    for (const tokenDocument of scene?.tokens ?? []) {
      if (tokenDocument.disposition !== side) continue;
      if (tokenDocument.hidden && !user.isGM) continue;
      const choice = this._choice(tokenDocument);
      if (choice) choices.push(choice);
    }
    choices.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    // the roller first: "an ally or yourself" is most often yourself
    if (rollerToken) {
      const own = choices.findIndex((choice) => choice.uuid === rollerToken.uuid);
      if (own > 0) choices.unshift(...choices.splice(own, 1));
    }
    if (!choices.length) return this.targetChoices(message, "self", user);
    return choices;
  }

  /**
   * The next initiative slot on the roller's side, after the current turn.
   * @returns {?{combat: Combat, turn: Combatant, round: number, claimant: ?Combatant}}
   */
  static nextAlliedSlot(message) {
    const combat = activeCombat();
    if (!combat?.turns?.length) return null;
    const side = this.rollerToken(message)?.disposition ?? combatantDisposition(combat.combatants.get(combat.turns[combat.turn]?.id));
    if (side === null || side === undefined) return null;
    const count = combat.turns.length;
    for (let offset = 1; offset <= count; offset++) {
      const index = (combat.turn + offset) % count;
      const turn = combat.turns[index];
      if (combatantDisposition(combat.combatants.get(turn.id) ?? turn) !== side) continue;
      const round = combat.round + (combat.turn + offset >= count ? 1 : 0);
      return { combat, turn, round, claimant: slotClaimant(combat, turn, round) };
    }
    return null;
  }

  /* -------------------------------------------- */
  /*  Options                                     */
  /* -------------------------------------------- */

  /** "combat" while an encounter is running on the scene, "general" otherwise. */
  static defaultContext() {
    const combat = activeCombat();
    if (!combat) return "general";
    const sceneId = combat.scene?.id ?? combat.scene ?? null;
    if (sceneId && canvas?.scene?.id && sceneId !== canvas.scene.id) return "general";
    return "combat";
  }

  /** GM-defined options from the world setting. */
  static customOptions() {
    const stored = game.settings.get("starwarsffg", CUSTOM_SETTING);
    if (!Array.isArray(stored)) return [];
    const options = [];
    for (const entry of stored) {
      const symbol = SYMBOLS.includes(entry?.symbol) ? entry.symbol : null;
      const cost = Math.trunc(Number(entry?.cost));
      const title = String(entry?.title ?? "").trim();
      if (!symbol || !Number.isFinite(cost) || cost < 1 || !title) continue;
      // A triumph can always stand in for an advantage option, and a despair for a threat one.
      const costs = { [symbol]: cost };
      if (symbol === "advantage") costs.triumph = 1;
      if (symbol === "threat") costs.despair = 1;
      options.push({ id: `custom-${entry.id}`, group: "custom", title, description: String(entry.description ?? "").trim(), costs });
    }
    return options;
  }

  /**
   * Everything that can be bought from a roll, in display order.
   * @param {ChatMessage} message
   * @param {"combat"|"general"} context
   * @returns {object[]} `{id, group, title, description, costs, max?, target?, automation?}`
   */
  static options(message, context = this.defaultContext()) {
    const options = [];
    const attack = WeaponQualities.attackContext(message);

    if (attack) {
      const targetActor = this.targetChoices(message, "target")[0]?.actor ?? null;
      options.push(...WeaponQualities.spendOptions(message, targetActor));
      if (attack.hit && attack.crit > 0) {
        options.push({
          id: "criticalInjury",
          group: "weapon",
          title: game.i18n.localize("SWFFG.Spend.Options.criticalInjury.Title"),
          description: game.i18n.format("SWFFG.Spend.Options.criticalInjury.Description", {
            vicious: attack.qualities.vicious ? game.i18n.format("SWFFG.Spend.Options.criticalInjury.Vicious", { bonus: attack.qualities.vicious.rank * 10 }) : "",
          }).trim(),
          costs: { advantage: attack.crit, triumph: 1 },
        });
      }
    }

    const rollerIsVehicle = this.rollerActor(message)?.type === "vehicle";
    for (const id of TABLES[context] ?? TABLES.general) {
      const definition = OPTIONS[id];
      // Running out of ammunition only means something for an attack.
      if (id === "outOfAmmo" && !attack) continue;
      // A vehicle cannot fall prone.
      if (id === "fallProne" && rollerIsVehicle) continue;
      options.push({
        id,
        group: "table",
        title: game.i18n.localize(`SWFFG.Spend.Options.${id}.Title`),
        description: game.i18n.localize(`SWFFG.Spend.Options.${id}.Description`),
        costs: definition.costs,
        target: definition.target ?? null,
        automation: definition.automation ?? null,
      });
    }

    options.push(...this.customOptions());
    return options;
  }

  /**
   * Why an option cannot do anything for this roll right now, or null when it can. Checked before a
   * spend is charged, and shown in the dialog in place of the pay buttons: strain cannot be
   * recovered by something with no strain track (a minion or rival takes strain as wounds, and has
   * none to give back), nor by a character who has not suffered any.
   * @param {ChatMessage} message
   * @param {object} option
   * @returns {?string}
   */
  static unavailableReason(message, option) {
    const automation = option?.automation;
    if (automation?.type !== "strain") return null;
    const roller = this.targetChoices(message, "self")[0];
    if (!roller) return game.i18n.localize("SWFFG.Spend.Errors.NoRoller");
    const suffering = automation.delta > 0;
    const track = strainTrack(roller.actor, suffering);
    if (!track) return game.i18n.format(suffering ? "SWFFG.Spend.Errors.NoTrack" : "SWFFG.Spend.Summary.NoStrainTrack", { actor: roller.name });
    if (!suffering && !(Number(roller.actor.system?.stats?.[track]?.value) > 0)) {
      return game.i18n.format("SWFFG.Spend.Summary.NoStrainTrack", { actor: roller.name });
    }
    return null;
  }

  /* -------------------------------------------- */
  /*  Chat card strip                             */
  /* -------------------------------------------- */

  /**
   * Add the "unspent results" strip and the Spend button to a roll card. Called from the system's
   * chat render hook, after it has finished rewriting the card's content.
   * @param {ChatMessage} message
   * @param {jQuery} html
   */
  static bindChatMessage(message, html) {
    if (!this.enabled || this._isInitiative(message)) return;
    if (message.isContentVisible === false) return;
    const rolled = this.rolled(message);
    if (!SYMBOLS.some((symbol) => rolled[symbol] > 0)) return;

    const content = html.find(".message-content")[0];
    if (!content || content.querySelector(".ffg-spend-strip")) return;

    const remaining = this.remaining(message);
    const badges = SYMBOLS.filter((symbol) => rolled[symbol] > 0)
      .map((symbol) => `<span class="ffg-spend-badge${remaining[symbol] ? "" : " spent"}" data-tooltip="${loc(`SWFFG.Spend.Symbols.${symbol}`)}">${symbolIcon(symbol)}<b>${remaining[symbol]}</b></span>`)
      .join("");

    const allowed = this.symbolsFor(game.user);
    const canSpend = this.canSpend(game.user, message) && allowed.some((symbol) => remaining[symbol] > 0);

    const strip = document.createElement("div");
    strip.className = "ffg-spend-strip";
    strip.innerHTML = `
      <span class="ffg-spend-label">${loc("SWFFG.Spend.Unspent")}</span>
      <span class="ffg-spend-badges">${badges}</span>
      ${canSpend ? `<button type="button" class="ffg-spend-open"><i class="fa-solid fa-coins"></i> ${loc("SWFFG.Spend.Button")}</button>` : ""}`;
    content.append(strip);

    strip.querySelector(".ffg-spend-open")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      SpendResultsDialog.open(message.id);
    });
  }

  /* -------------------------------------------- */
  /*  Spending                                    */
  /* -------------------------------------------- */

  /**
   * Ask for a spend. Runs it here when this client can do all of it, otherwise hands it to the GM.
   * @param {object} payload `{messageId, optionId, symbol, targetUuid, context}`
   * @returns {Promise<boolean>} false when the request could not even be sent
   */
  static async request(payload) {
    const request = { ...payload, userId: game.user.id };
    if (game.user.isGM || !game.users.activeGM) {
      await this.process(request);
      return true;
    }
    game.socket.emit(SOCKET, { event: REQUEST_EVENT, request });
    return true;
  }

  /** Report back to whoever asked, on whichever client they are. */
  static _feedback(userId, text, level = "warn") {
    if (userId === game.user.id) {
      ui.notifications[level]?.(text);
      SpendResultsDialog.settle();
    } else {
      game.socket.emit(SOCKET, { event: FEEDBACK_EVENT, userId, text, level });
    }
  }

  /**
   * Carry out a spend. Validates everything again here - the request came over a socket and the
   * roll may have been spent from since the dialog was drawn.
   * @param {object} request `{messageId, optionId, symbol, targetUuid, context, userId}`
   */
  static async process(request) {
    const user = game.users.get(request.userId);
    const message = game.messages.get(request.messageId);
    if (!user || !message) return;
    const fail = (key, data) => this._feedback(user.id, data ? game.i18n.format(key, data) : game.i18n.localize(key));

    if (!this.enabled) return fail("SWFFG.Spend.Errors.Disabled");
    if (!this.canSpend(user, message)) return fail("SWFFG.Spend.Errors.NoPermission");

    const option = this.options(message, request.context).find((entry) => entry.id === request.optionId);
    const symbol = request.symbol;
    const cost = option?.costs?.[symbol];
    if (!option || !cost) return fail("SWFFG.Spend.Errors.OptionMissing");
    if (!this.symbolsFor(user).includes(symbol)) return fail("SWFFG.Spend.Errors.GMOnly");
    const blocked = this.unavailableReason(message, option);
    if (blocked) return this._feedback(user.id, blocked);

    if (this._locks.has(message.id)) return fail("SWFFG.Spend.Errors.Busy");
    this._locks.add(message.id);
    try {
      const state = this.state(message);
      const available = this.rolled(message)[symbol] - state.spent[symbol];
      if (available < cost) {
        return fail("SWFFG.Spend.Errors.NotEnough", { symbol: game.i18n.localize(`SWFFG.Spend.Symbols.${symbol}`), cost, available });
      }
      if (option.max && state.history.filter((entry) => entry.option === option.id).length >= option.max) {
        return fail("SWFFG.Spend.Errors.MaxReached", { max: option.max });
      }

      // Resolve who the effect lands on, from the same list the dialog offered.
      let target = null;
      const mode = option.target === "nextAlly" && !activeCombat() ? "ally" : option.target;
      if (mode && mode !== "nextAlly") {
        const choices = this.targetChoices(message, mode, user);
        target = choices.find((choice) => choice.uuid === request.targetUuid) ?? (choices.length === 1 ? choices[0] : null);
        if (!target && option.automation) {
          return fail({ target: "SWFFG.Spend.Errors.NoTarget", self: "SWFFG.Spend.Errors.NoRoller" }[mode] ?? "SWFFG.Spend.Errors.TargetRequired");
        }
      }

      // The effect first, the bookkeeping second: a spend that could not be carried out must not
      // be charged for.
      let result;
      try {
        result = await this._automate(message, option, target, mode);
      } catch (err) {
        CONFIG.logger?.warn?.("Spend Results: automation failed", err);
        return this._feedback(user.id, err?.message || game.i18n.localize("SWFFG.Spend.Errors.Failed"), "error");
      }

      state.spent[symbol] += cost;
      state.extraHits += result?.extraHits ?? 0;
      state.history.push({ option: option.id, title: option.title, symbol, cost, user: user.id, target: target?.name ?? null, time: Date.now() });
      await message.update({ [`flags.starwarsffg.${FLAG}`]: state });
      await this._announce(message, user, option, symbol, cost, result?.summary ?? null);
      if (user.id === game.user.id) SpendResultsDialog.settle();
    } catch (err) {
      console.error("Star Wars FFG | Spend Results failed", err);
      this._feedback(user.id, game.i18n.localize("SWFFG.Spend.Errors.Failed"), "error");
    } finally {
      this._locks.delete(message.id);
    }
  }

  /**
   * Apply an option's mechanical effect.
   * @returns {Promise<?{summary: ?string, extraHits?: number}>}
   */
  static async _automate(message, option, target, mode) {
    const automation = option.automation;
    if (!automation) return null;
    const noGM = () => new Error(game.i18n.localize("SWFFG.GMBridge.NoGM"));

    if (automation.type === "quality") return WeaponQualities.applyQuality(message, automation, target);

    if (automation.type === "strain") {
      const actor = target?.actor;
      if (!actor) throw new Error(game.i18n.localize("SWFFG.Spend.Errors.NoRoller"));
      const stats = actor.system?.stats ?? {};
      // Strain, a vehicle's system strain, or wounds for the adversaries that take strain that way.
      const track = strainTrack(actor, automation.delta > 0);
      const before = Number(stats[track]?.value) || 0;
      // Normally caught by unavailableReason() before anything is charged; this is the backstop.
      if (!track || (automation.delta < 0 && before <= 0)) throw new Error(this.unavailableReason(message, option) ?? game.i18n.localize("SWFFG.Spend.Errors.Failed"));
      const after = Math.max(0, before + automation.delta);
      const applied = await applyToTargetActor(actor, { type: "damage", path: `system.stats.${track}.value`, delta: automation.delta, floor: true });
      if (!applied) throw noGM();
      const key = automation.delta < 0 ? "StrainRecovered" : track === "wounds" ? "StrainAsWounds" : "StrainSuffered";
      return { summary: game.i18n.format(`SWFFG.Spend.Summary.${key}`, { actor: target.name, before, after }) };
    }

    if (automation.type === "nextCheck") {
      const effect = statusLabel(NEXT_CHECK[automation.kind]);
      if (mode === "nextAlly") return this._grantNextAlly(message, automation.kind, effect);
      const actor = target?.actor;
      if (!actor) throw new Error(game.i18n.localize("SWFFG.Spend.Errors.TargetRequired"));
      const before = nextCheckCount(actor, automation.kind);
      const applied = await applyToTargetActor(actor, { type: "next-check", kind: automation.kind, amount: 1 });
      if (!applied) throw noGM();
      // A vehicle makes no checks of its own - its crew does, with their own skills - so on a vehicle
      // the status can only be a marker. Say so, rather than implying the dice have been handled.
      const key = actor.type === "vehicle" ? "SWFFG.Spend.Summary.NextCheckVehicle" : "SWFFG.Spend.Summary.NextCheck";
      return { summary: game.i18n.format(key, { effect, actor: target.name, count: before + 1 }) };
    }

    if (automation.type === "status") {
      const actor = target?.actor;
      if (!actor) throw new Error(game.i18n.localize("SWFFG.Spend.Errors.NoRoller"));
      const statusId = STATUS[automation.status];
      const applied = await applyToTargetActor(actor, { type: "status", status: { statusId } });
      if (!applied) throw noGM();
      return { summary: game.i18n.format("SWFFG.Spend.Summary.Status", { actor: target.name, status: statusLabel(statusId) }) };
    }

    if (automation.type === "ammo") {
      // Only meaningful for a weapon that is tracking ammunition; otherwise it stays narrative.
      const data = this.roll(message)?.data;
      const uuid = data?.flags?.starwarsffg?.uuid ?? data?.flags?.starwarsffg?.ffgUuid;
      const weapon = uuid ? await fromUuid(uuid) : null;
      if (!weapon?.isOwner || !weapon.getFlag("starwarsffg", "config.enableAmmo")) return null;
      await weapon.update({ "system.ammo.value": 0 });
      return { summary: game.i18n.format("SWFFG.Spend.Summary.OutOfAmmo", { weapon: weapon.name }) };
    }

    return null;
  }

  /**
   * "Add a boost to the next allied character's check". With slots, nobody knows who that is until
   * the slot is claimed, so the grant waits on the combat until then.
   */
  static async _grantNextAlly(message, kind, effect) {
    const slot = this.nextAlliedSlot(message);
    if (!slot) throw new Error(game.i18n.localize("SWFFG.Spend.Errors.NoAllySlot"));

    // Already known: a claimed slot, or a combat without slots at all.
    if (slot.claimant?.actor) {
      const applied = await applyToTargetActor(slot.claimant.actor, { type: "next-check", kind, amount: 1 });
      if (!applied) throw new Error(game.i18n.localize("SWFFG.GMBridge.NoGM"));
      return { summary: game.i18n.format("SWFFG.Spend.Summary.NextCheck", { effect, actor: slot.claimant.name, count: nextCheckCount(slot.claimant.actor, kind) || 1 }) };
    }

    if (!game.user.isGM) throw new Error(game.i18n.localize("SWFFG.GMBridge.NoGM"));
    const pending = foundry.utils.deepClone(slot.combat.getFlag("starwarsffg", PENDING_FLAG) ?? []);
    pending.push({ id: foundry.utils.randomID(), kind, slotId: slot.turn.id, round: slot.round });
    await slot.combat.setFlag("starwarsffg", PENDING_FLAG, pending);
    return { summary: game.i18n.format("SWFFG.Spend.Summary.NextAllyQueued", { effect }) };
  }

  /** Hand out queued "next ally" grants as their slots are claimed. Active GM only. */
  static async _resolvePending(combat) {
    if (!game.users.activeGM?.isSelf || !usesSlots(combat)) return;
    const pending = combat.getFlag("starwarsffg", PENDING_FLAG);
    if (!Array.isArray(pending) || !pending.length) return;
    if (this._locks.has(combat.id)) return;
    this._locks.add(combat.id);
    try {
      const keep = [];
      for (const entry of pending) {
        // The slot's round came and went without anyone taking it: the grant is lost with it.
        if (combat.round > entry.round) continue;
        const claimantId = combat.getSlotClaims(entry.round, entry.slotId);
        const claimant = claimantId ? combat.combatants.get(claimantId) : null;
        if (!claimant?.actor) {
          keep.push(entry);
          continue;
        }
        const { count } = await applyNextCheckLocal(claimant.actor, entry.kind, 1);
        await ChatMessage.create({
          content: `<div class="ffg-spend-card"><div class="ffg-spend-card-auto"><i class="fa-solid fa-bolt"></i> ${loc("SWFFG.Spend.Summary.NextCheck", { effect: statusLabel(NEXT_CHECK[entry.kind]), actor: claimant.name, count })}</div></div>`,
          speaker: { alias: claimant.name },
        });
      }
      if (keep.length !== pending.length) await combat.setFlag("starwarsffg", PENDING_FLAG, keep);
    } catch (err) {
      CONFIG.logger?.warn?.("Spend Results: failed to resolve a queued next-check grant", err);
    } finally {
      this._locks.delete(combat.id);
    }
  }

  /** Post the "X spent ..." card, with the same visibility as the roll it came from. */
  static async _announce(message, user, option, symbol, cost, summary) {
    const paid = `<span class="ffg-spend-badge">${symbolIcon(symbol)}<b>${cost}</b></span>`;
    const content = `
      <div class="ffg-spend-card">
        <div class="ffg-spend-card-title">${paid} <strong>${escapeHTML(option.title)}</strong></div>
        ${option.description ? `<div class="ffg-spend-card-desc">${richText(option.description)}</div>` : ""}
        ${summary ? `<div class="ffg-spend-card-auto"><i class="fa-solid fa-bolt"></i> ${escapeHTML(summary)}</div>` : ""}
        <div class="ffg-spend-card-by">${loc("SWFFG.Spend.SpentBy", { user: user.name })}</div>
      </div>`;
    const data = { content, speaker: message.speaker };
    const whisper = (message.whisper ?? []).map((entry) => entry?.id ?? entry).filter(Boolean);
    if (whisper.length) data.whisper = whisper;
    if (message.blind) data.blind = true;
    await ChatMessage.create(data);
  }

  /* -------------------------------------------- */
  /*  Registration                                */
  /* -------------------------------------------- */

  static registerSettings() {
    game.settings.registerMenu("starwarsffg", CUSTOM_SETTING, {
      name: game.i18n.localize("SWFFG.Spend.Settings.Name"),
      label: game.i18n.localize("SWFFG.Spend.Settings.Label"),
      hint: game.i18n.localize("SWFFG.Spend.Settings.Hint"),
      icon: "fa-solid fa-coins",
      type: SpendOptionsSettings,
      restricted: true,
    });
    game.settings.register("starwarsffg", CUSTOM_SETTING, {
      name: CUSTOM_SETTING,
      scope: "world",
      default: [],
      config: false,
      type: Object,
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
        SpendResultsDialog.settle();
      }
    });

    Hooks.on("updateChatMessage", (message) => SpendResultsDialog.refresh(message.id));
    Hooks.on("deleteChatMessage", (message) => SpendResultsDialog.instances.get(message.id)?.close());
    Hooks.on("targetToken", () => SpendResultsDialog.refresh());
    Hooks.on("updateCombat", (combat) => {
      this._resolvePending(combat);
      SpendResultsDialog.refresh();
    });
  }
}

/* -------------------------------------------- */
/*  Dialog                                      */
/* -------------------------------------------- */

/**
 * The spend dialog for one roll. It stays open across spends and redraws from the message, so what
 * it offers is always what is actually left.
 */
export class SpendResultsDialog extends ApplicationV2 {
  constructor(options = {}) {
    super(options);
    this.messageId = options.messageId;
    this.context = SpendResults.defaultContext();
    /** True between sending a spend and hearing how it went; the pay buttons are held meanwhile. */
    this.pending = false;
  }

  /** message id -> open dialog */
  static instances = new Map();

  static DEFAULT_OPTIONS = {
    classes: ["starwarsffg", "ffg-spend-dialog"],
    tag: "div",
    window: {
      title: "SWFFG.Spend.Dialog.Title",
      icon: "fa-solid fa-coins",
      resizable: true,
    },
    position: {
      width: 560,
      height: 620,
    },
  };

  static open(messageId) {
    let dialog = this.instances.get(messageId);
    if (!dialog) {
      dialog = new this({ id: `ffg-spend-${messageId}`, messageId });
      this.instances.set(messageId, dialog);
    }
    dialog.render({ force: true });
    return dialog;
  }

  /** Redraw one dialog, or all of them. */
  static refresh(messageId = null) {
    for (const [id, dialog] of this.instances) {
      if (messageId && id !== messageId) continue;
      if (messageId) dialog.pending = false;
      if (dialog.rendered) dialog.render();
    }
  }

  /** A spend this client asked for has been answered (either way): release the buttons. */
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
    SpendResultsDialog.instances.delete(this.messageId);
    return super.close(options);
  }

  _targetControl(option, message) {
    if (!option.target || !option.automation) return "";
    let mode = option.target;
    if (mode === "nextAlly") {
      if (activeCombat()) {
        const slot = SpendResults.nextAlliedSlot(message);
        if (!slot) return `<div class="ffg-spend-target missing">${loc("SWFFG.Spend.Errors.NoAllySlot")}</div>`;
        const who = slot.claimant?.name ?? game.i18n.localize("SWFFG.Spend.Target.NextSlot");
        return `<div class="ffg-spend-target"><i class="fa-solid fa-hourglass-half"></i> ${escapeHTML(who)}</div>`;
      }
      mode = "ally";
    }
    if (mode === "self") return "";
    const choices = SpendResults.targetChoices(message, mode, game.user);
    if (!choices.length) {
      return `<div class="ffg-spend-target missing">${loc(mode === "target" ? "SWFFG.Spend.Target.NoneTargeted" : "SWFFG.Spend.Target.NoAllies")}</div>`;
    }
    if (choices.length === 1) {
      return `<div class="ffg-spend-target"><i class="fa-solid fa-crosshairs"></i> ${escapeHTML(choices[0].name)}<input type="hidden" data-target value="${escapeHTML(choices[0].uuid)}" /></div>`;
    }
    const options = choices.map((choice) => `<option value="${escapeHTML(choice.uuid)}">${escapeHTML(choice.name)}</option>`).join("");
    return `<div class="ffg-spend-target"><i class="fa-solid fa-crosshairs"></i> <select data-target>${options}</select></div>`;
  }

  /** Whether an option's automated effect has somewhere to land. */
  _targetAvailable(option, message) {
    if (!option.target || !option.automation) return true;
    if (option.target === "nextAlly" && activeCombat()) return !!SpendResults.nextAlliedSlot(message);
    const mode = option.target === "nextAlly" ? "ally" : option.target;
    return SpendResults.targetChoices(message, mode, game.user).length > 0;
  }

  /** @override */
  async _renderHTML(_context, _options) {
    const root = document.createElement("div");
    root.className = "ffg-spend-body";
    const message = this.message;
    if (!message) {
      root.innerHTML = `<p class="notes">${loc("SWFFG.Spend.Errors.MessageGone")}</p>`;
      return root;
    }

    const rolled = SpendResults.rolled(message);
    const remaining = SpendResults.remaining(message);
    const state = SpendResults.state(message);
    const allowed = SpendResults.symbolsFor(game.user);
    const options = SpendResults.options(message, this.context);

    const header = SYMBOLS.filter((symbol) => rolled[symbol] > 0)
      .map((symbol) => `<span class="ffg-spend-badge${remaining[symbol] ? "" : " spent"}">${symbolIcon(symbol)}<b>${remaining[symbol]}</b><small>/ ${rolled[symbol]}</small></span>`)
      .join("");

    const tabs = ["combat", "general"]
      .map((context) => `<button type="button" class="ffg-spend-tab${context === this.context ? " active" : ""}" data-context="${context}">${loc(`SWFFG.Spend.Context.${context}`)}</button>`)
      .join("");

    const row = (option) => {
      const used = state.history.filter((entry) => entry.option === option.id).length;
      const exhausted = !!option.max && used >= option.max;
      const blocked = SpendResults.unavailableReason(message, option);
      const targetOk = !blocked && this._targetAvailable(option, message);
      const buttons = Object.entries(option.costs)
        .filter(([symbol]) => allowed.includes(symbol))
        .map(([symbol, cost]) => {
          const disabled = this.pending || exhausted || !targetOk || remaining[symbol] < cost;
          return `<button type="button" class="ffg-spend-pay" data-option="${escapeHTML(option.id)}" data-symbol="${symbol}" ${disabled ? "disabled" : ""}>${symbolIcon(symbol)}<b>${cost}</b></button>`;
        })
        .join("");
      if (!buttons) return "";
      const count = option.max ? ` <span class="ffg-spend-count">${used}/${option.max}</span>` : used ? ` <span class="ffg-spend-count">×${used}</span>` : "";
      return `
        <div class="ffg-spend-option${exhausted ? " exhausted" : ""}">
          <div class="ffg-spend-option-text">
            <div class="ffg-spend-option-title">${escapeHTML(option.title)}${count}</div>
            ${option.description ? `<div class="ffg-spend-option-desc">${richText(option.description)}</div>` : ""}
            ${blocked ? `<div class="ffg-spend-target missing">${escapeHTML(blocked)}</div>` : this._targetControl(option, message)}
          </div>
          <div class="ffg-spend-option-pay">${buttons}</div>
        </div>`;
    };

    const section = (group, positive) => {
      const rows = options
        .filter((option) => option.group === group)
        .filter((option) => positive === null || positive === PLAYER_SYMBOLS.some((symbol) => symbol in option.costs))
        .map(row)
        .join("");
      return rows;
    };

    const blocks = [];
    const weapon = section("weapon", null);
    if (weapon) blocks.push(`<h3>${loc("SWFFG.Spend.Groups.Weapon")}</h3>${weapon}`);
    const positive = section("table", true);
    if (positive) blocks.push(`<h3>${loc("SWFFG.Spend.Groups.Positive")}</h3>${positive}`);
    const negative = section("table", false);
    if (negative) blocks.push(`<h3>${loc("SWFFG.Spend.Groups.Negative")}</h3>${negative}`);
    const custom = section("custom", null);
    if (custom) blocks.push(`<h3>${loc("SWFFG.Spend.Groups.Custom")}</h3>${custom}`);

    root.innerHTML = `
      <header class="ffg-spend-header">
        <div class="ffg-spend-badges">${header}</div>
        <div class="ffg-spend-tabs">${tabs}</div>
      </header>
      ${game.user.isGM ? "" : `<p class="notes">${loc("SWFFG.Spend.Dialog.PlayerNote")}</p>`}
      <div class="ffg-spend-options">${blocks.join("") || `<p class="notes">${loc("SWFFG.Spend.Dialog.Nothing")}</p>`}</div>`;
    return root;
  }

  /** @override */
  _replaceHTML(result, content, _options) {
    const scroll = content.querySelector(".ffg-spend-options")?.scrollTop ?? 0;
    content.replaceChildren(result);
    const list = content.querySelector(".ffg-spend-options");
    if (list) list.scrollTop = scroll;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    for (const tab of root.querySelectorAll(".ffg-spend-tab")) {
      tab.addEventListener("click", () => {
        this.context = tab.dataset.context;
        this.render();
      });
    }
    for (const button of root.querySelectorAll(".ffg-spend-pay")) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        if (this.pending) return;
        const rowElement = button.closest(".ffg-spend-option");
        this.pending = true;
        for (const other of root.querySelectorAll(".ffg-spend-pay")) other.disabled = true;
        // If the answer never comes (the GM dropped mid-request), do not hold the dialog forever.
        setTimeout(() => {
          if (!this.pending) return;
          this.pending = false;
          if (this.rendered) this.render();
        }, 5000);
        await SpendResults.request({
          messageId: this.messageId,
          optionId: button.dataset.option,
          symbol: button.dataset.symbol,
          targetUuid: rowElement?.querySelector("[data-target]")?.value ?? null,
          context: this.context,
        });
      });
    }
  }
}

/* -------------------------------------------- */
/*  Custom options                              */
/* -------------------------------------------- */

/** Settings window for the GM's own spend options. */
export class SpendOptionsSettings extends FFGFormApplication {
  static DEFAULT_OPTIONS = {
    id: "ffg-spend-options",
    classes: ["starwarsffg", "ffg-spend-options"],
    window: {
      title: "SWFFG.Spend.Settings.Title",
      resizable: true,
    },
    position: {
      width: 640,
      height: 520,
    },
    form: {
      closeOnSubmit: true,
    },
  };

  static PARTS = {
    content: {
      root: true,
      template: "systems/starwarsffg/templates/dialogs/ffg-spend-options.html",
    },
  };

  async _prepareContext(_options) {
    const stored = game.settings.get("starwarsffg", CUSTOM_SETTING);
    return {
      options: (Array.isArray(stored) ? stored : []).map((option) => ({ ...option, symbols: this._symbolChoices(option.symbol) })),
      blank: { id: "", title: "", description: "", cost: 1, symbols: this._symbolChoices("advantage") },
    };
  }

  _symbolChoices(selected) {
    return SYMBOLS.map((symbol) => ({ value: symbol, label: game.i18n.localize(`SWFFG.Spend.Symbols.${symbol}`), selected: symbol === selected }));
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    const list = root.querySelector("[data-option-list]");
    const template = root.querySelector("template[data-option-template]");
    root.querySelector("[data-add-option]")?.addEventListener("click", (event) => {
      event.preventDefault();
      list.append(template.content.cloneNode(true));
      list.lastElementChild?.querySelector("input[name='title']")?.focus();
    });
    root.addEventListener("click", (event) => {
      const remove = event.target.closest?.("[data-remove-option]");
      if (!remove) return;
      event.preventDefault();
      remove.closest("[data-option-row]")?.remove();
    });
    root.querySelector("button[name='reset']")?.addEventListener("click", (event) => {
      event.preventDefault();
      list.replaceChildren();
    });
  }

  /** @override */
  async _updateObject(_event, formData) {
    // The marker field is always present; without it the form data never reached us, and writing
    // would wipe every custom option (see LanguageSettings for the failure this guards against).
    if (formData["spend-options-form"] === undefined) {
      CONFIG.logger?.warn?.("SpendOptionsSettings: submit contained no form marker; ignoring.");
      return;
    }
    // Repeated field names arrive as a string for one row and an array for several.
    const list = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
    const titles = list(formData.title);
    const ids = list(formData.id);
    const symbols = list(formData.symbol);
    const costs = list(formData.cost);
    const descriptions = list(formData.description);

    const options = [];
    titles.forEach((rawTitle, index) => {
      const title = String(rawTitle ?? "").trim();
      if (!title) return;
      options.push({
        id: ids[index] || foundry.utils.randomID(),
        title,
        symbol: SYMBOLS.includes(symbols[index]) ? symbols[index] : "advantage",
        cost: Math.clamp(Math.trunc(Number(costs[index])) || 1, 1, 20),
        description: String(descriptions[index] ?? "").trim(),
      });
    });
    await game.settings.set("starwarsffg", CUSTOM_SETTING, options);
  }
}
