/**
 * Improvised Detonation builder (table tool).
 *
 * The talent family - Improvised Detonation and its Improved and Supreme upgrades - has the character
 * make a Mechanics check to throw an explosive together, and nearly everything about the result moves:
 *
 *  - the difficulty: Hard, or Average with Improved, and one step harder for every quality Supreme
 *    adds. Once that reaches five difficulty dice, each further step upgrades one of them instead, up
 *    to five challenge dice;
 *  - the damage: Intellect + Mechanics (twice Mechanics with Improved) + the check's successes, and
 *    two more for each triumph spent on it, with Blast at the same value - one more per rank of
 *    Powerful Blast;
 *  - the qualities Supreme adds, the ranked ones each chosen up to three times.
 *
 * The builder works all of that out, rolls the check through the ordinary roll dialog (so the
 * character's own modifiers still apply), and reads the result back off the chat card - following a
 * bond invoked on it, or a Destiny Reroll that replaced it. The finished device goes on the sheet as a
 * weapon: Mechanics, Engaged, no critical rating, encumbrance, rarity, price or hard points.
 *
 * Its damage is final. The weapon is flagged `fixedDamage`, so attacking with it later (to set it off,
 * and to spend advantage on its qualities) shows that damage rather than adding the new roll's
 * successes a second time - see the weapon card, Apply Damage and WeaponQualities.attackContext.
 *
 * Opened from a button on the talent's chat card, the talent row's right-click menu, a button on the
 * check's own card (for a builder closed before its result was used), or a macro:
 *   game.ffg.ImprovisedDetonation.open(actor)
 */
import DiceHelpers from "../helpers/dice-helpers.js";
import PopoutEditor from "../popout-editor.js";
import SpendResults from "../helpers/spend-results.js";
import DestinySession from "../helpers/destiny-session.js";
import { bareQualityName } from "../helpers/weapon-qualities.js";
import { escapeHTML, loc } from "../helpers/html.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const ENABLE_SETTING = "enableImprovisedDetonation";
/** On the check's chat message: whose device it is and which qualities it was rolled with. */
const FLAG = "improvisedDetonation";
/** On the actor: when the talent was last used, for the once-per-session reminder. */
const USE_FLAG = "improvisedDetonationUse";
const SKILL = "Mechanics";

/** Difficulty dice before Supreme's extra steps start upgrading them instead. */
const MAX_DICE = 5;
/** Five dice, all of them upgraded: as hard as the check can get. */
const MAX_STEPS = 10;
/** How many times each ranked quality may be chosen. */
const MAX_PICKS = 3;
/** Extra damage for each triumph spent on the device. */
const TRIUMPH_DAMAGE = 2;
const DEVICE_IMG = "icons/weapons/thrown/bomb-timer.webp";
const QUALITY_IMG = "icons/svg/item-bag.svg";

const DIFFICULTY_NAMES = {
  2: "SWFFG.DifficultyAverage",
  3: "SWFFG.DifficultyHard",
  4: "SWFFG.DifficultyDaunting",
  5: "SWFFG.DifficultyFormidable",
};

/**
 * The qualities Supreme Improvised Detonation can add. `step` is what one choice adds to the rating
 * (Pierce +2 chosen twice is Pierce 4); 0 marks an unranked quality, which is chosen once at most.
 * `name` is the quality's name on the weapon, which is how the rest of the system recognises it.
 */
const QUALITIES = [
  { key: "burn", name: "Burn", step: 1 },
  { key: "concussive", name: "Concussive", step: 1 },
  { key: "ensnare", name: "Ensnare", step: 1 },
  { key: "ion", name: "Ion", step: 0 },
  { key: "knockdown", name: "Knockdown", step: 0 },
  { key: "pierce", name: "Pierce", step: 2 },
  { key: "stun", name: "Stun", step: 2 },
  { key: "stundamage", name: "Stun Damage", step: 0 },
];

/**
 * Which of the three talents a name is, if any: "Improvised Detonation", "Improvised Detonation
 * (Improved)", "Improvised Detonation (Supreme)" - and "Improved Improvised Detonation" and the like.
 * @param {string} name
 * @returns {?("base"|"improved"|"supreme")}
 */
export function talentTier(name) {
  const text = String(name ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (!text.includes("improvised detonation")) return null;
  if (/\bsupreme\b/.test(text)) return "supreme";
  if (/\bimproved\b/.test(text)) return "improved";
  return text === "improvised detonation" ? "base" : null;
}

/** Whether a talent is Powerful Blast, which adds its ranks to the Blast of the explosives the character uses. */
function isPowerfulBlast(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim() === "powerful blast";
}

/** Quality choices, as stored: only known keys, each within its limit. */
function cleanPicks(picks) {
  const out = {};
  for (const quality of QUALITIES) {
    const count = Math.clamp(Math.trunc(Number(picks?.[quality.key]) || 0), 0, quality.step ? MAX_PICKS : 1);
    if (count) out[quality.key] = count;
  }
  return out;
}

function pickCount(picks) {
  return Object.values(picks ?? {}).reduce((sum, count) => sum + count, 0);
}

function count(value) {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

/** Escape free text, then render any dice codes ([SU], [TR], ...) it carries. */
function richText(text) {
  return PopoutEditor.replaceDiceSymbols(escapeHTML(text));
}

export default class ImprovisedDetonation extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {Actor} actor  the character building the device
   * @param {object} [options]
   */
  constructor(actor, options = {}) {
    super({ id: `ffg-improvised-detonation-${actor.uuid.replace(/\./g, "-")}`, ...options });
    this.actor = actor;
    this._state = {
      /** Supreme's quality choices: key -> times chosen */
      picks: {},
      /** the check's chat message once rolled - the newest, after any Destiny Reroll */
      messageId: null,
      /** the message carrying the builder's flag (the first roll, before any Destiny Reroll) */
      originId: null,
      /** {success, triumph, despair}, null until the check has been made */
      result: null,
      /** the result as last read from the card, so a later card update only overwrites a real change */
      readKey: null,
      /** where the result came from: "card", "manual", "hidden" (a blind roll) or "gone" (deleted) */
      source: null,
      triumphsSpent: 0,
    };
  }

  static DEFAULT_OPTIONS = {
    classes: ["starwarsffg", "ffg-improvised-detonation"],
    tag: "div",
    window: {
      title: "SWFFG.ImprovisedDetonation.Name",
      icon: "fa-solid fa-bomb",
      resizable: true,
    },
    position: {
      width: 480,
    },
    actions: {
      pick: ImprovisedDetonation.#onPick,
      spend: ImprovisedDetonation.#onSpend,
      roll: ImprovisedDetonation.#onRoll,
      manual: ImprovisedDetonation.#onManual,
      startOver: ImprovisedDetonation.#onStartOver,
      addToSheet: ImprovisedDetonation.#onAddToSheet,
    },
  };

  static PARTS = {
    content: {
      root: true,
      template: "systems/starwarsffg/templates/dialogs/ffg-improvised-detonation.html",
    },
  };

  /** Open builders, by actor uuid: one per character. */
  static instances = new Map();

  /** Quality items found in the world or a compendium, by bare name (null when there is none). */
  static _templates = new Map();

  static get enabled() {
    return Boolean(game.settings.get("starwarsffg", ENABLE_SETTING));
  }

  /** @override */
  get title() {
    return game.i18n.format("SWFFG.ImprovisedDetonation.WindowTitle", { actor: this.actor.name });
  }

  /* -------------------------------------------- */
  /*  Opening                                     */
  /* -------------------------------------------- */

  /**
   * Open (or bring forward) an actor's builder.
   * @param {Actor} actor
   * @param {object} [options]
   * @param {?string} [options.messageId]  a check already rolled: its result and qualities are loaded
   * @returns {?ImprovisedDetonation}
   */
  static open(actor, { messageId = null } = {}) {
    if (!actor) return null;
    if (!this.enabled) {
      ui.notifications.warn(game.i18n.localize("SWFFG.ImprovisedDetonation.Errors.Disabled"));
      return null;
    }
    if (!actor.isOwner) {
      ui.notifications.warn(game.i18n.format("SWFFG.ImprovisedDetonation.Errors.NoPermission", { actor: actor.name }));
      return null;
    }
    if (!this.hasTalent(actor)) {
      ui.notifications.warn(game.i18n.format("SWFFG.ImprovisedDetonation.Errors.NoTalent", { actor: actor.name }));
      return null;
    }
    // Edit mode suspends the actor's Active Effects - XP-bought skill ranks among them - so the damage
    // and the dice pool would both be worked out from the base values.
    if (actor.verifyEditModeIsNotEnabled && !actor.verifyEditModeIsNotEnabled()) return null;

    let app = this.instances.get(actor.uuid);
    if (!app) {
      app = new this(actor);
      this.instances.set(actor.uuid, app);
    }
    if (messageId) app._attach(messageId, { restoreDesign: true });
    app.render({ force: true });
    return app;
  }

  /** @override */
  async close(options) {
    if (ImprovisedDetonation.instances.get(this.actor.uuid) === this) ImprovisedDetonation.instances.delete(this.actor.uuid);
    return super.close(options);
  }

  /* -------------------------------------------- */
  /*  The rules                                   */
  /* -------------------------------------------- */

  /**
   * Which of the three talents an actor has, from its talent list (specialization trees included) and
   * any talent items it carries directly.
   * @param {Actor} actor
   * @returns {{base: boolean, improved: boolean, supreme: boolean}}
   */
  static tiers(actor) {
    const tiers = { base: false, improved: false, supreme: false };
    const names = [...(actor?.talentList ?? []).map((talent) => talent?.name), ...(actor?.items ?? []).filter((item) => item.type === "talent").map((item) => item.name)];
    for (const name of names) {
      const tier = talentTier(name);
      if (tier) tiers[tier] = true;
    }
    return tiers;
  }

  static hasTalent(actor) {
    const tiers = this.tiers(actor);
    return tiers.base || tiers.improved || tiers.supreme;
  }

  /**
   * The numbers the device is built from, as the sheet shows them (Active Effects applied): the two the
   * damage comes from, and the ranks of Powerful Blast added to its Blast.
   */
  static stats(actor) {
    return {
      intellect: count(actor?.system?.characteristics?.Intellect?.value),
      mechanics: count(actor?.system?.skills?.[SKILL]?.rank),
      powerfulBlast: this.powerfulBlast(actor),
    };
  }

  /**
   * Ranks of Powerful Blast. The talent list already adds up a ranked talent learned in several trees
   * or carried as items; an unranked copy counts as one rank.
   * @param {Actor} actor
   * @returns {number}
   */
  static powerfulBlast(actor) {
    const talents =
      actor?.talentList ??
      (actor?.items ?? [])
        .filter((item) => item.type === "talent")
        .map((item) => ({ name: item.name, isRanked: item.system?.ranks?.ranked, rank: item.system?.ranks?.current }));
    let ranks = 0;
    for (const talent of talents) {
      if (isPowerfulBlast(talent?.name)) ranks += talent.isRanked ? Math.max(1, count(talent.rank)) : 1;
    }
    return ranks;
  }

  /**
   * The check's difficulty: Hard (Average with Improved) plus a step per quality chosen. The first five
   * steps are difficulty dice; each one past that upgrades a die, to five challenge dice at most.
   * @param {boolean} improved
   * @param {object} picks
   * @returns {{steps: number, dice: number, upgrades: number}}
   */
  static difficulty(improved, picks) {
    const steps = Math.min(MAX_STEPS, (improved ? 2 : 3) + pickCount(picks));
    const dice = Math.min(steps, MAX_DICE);
    return { steps, dice, upgrades: steps - dice };
  }

  /**
   * What the check's result makes of the device.
   *
   * A successful check builds it: base + successes, and two more per triumph spent, with Blast at the
   * same value plus the builder's ranks of Powerful Blast. A despair sets it off at once in the
   * builder's face - with the full damage and Blast if the check would otherwise have succeeded, and
   * with the base damage alone (no Blast) if it failed. A check that failed without a despair builds
   * nothing.
   *
   * @param {number} base  Intellect + Mechanics (twice Mechanics with Improved)
   * @param {?{success: number, triumph: number, despair: number}} result
   * @param {number} triumphsSpent
   * @param {number} [powerfulBlast]  ranks of Powerful Blast
   */
  static outcome(base, result, triumphsSpent, powerfulBlast = 0) {
    if (!result) return null;
    const succeeded = result.success > 0;
    const spent = succeeded ? Math.clamp(triumphsSpent, 0, result.triumph) : 0;
    const damage = succeeded ? base + result.success + TRIUMPH_DAMAGE * spent : base;
    return {
      succeeded,
      spent,
      damage,
      blast: succeeded ? damage + powerfulBlast : 0,
      premature: result.despair > 0,
      canBuild: succeeded || result.despair > 0,
    };
  }

  /** When the actor last used the talent, if no new session has started since. */
  static usedThisSession(actor) {
    const use = actor?.getFlag?.("starwarsffg", USE_FLAG);
    if (!use?.time) return null;
    return (use.session ?? null) === (DestinySession.state().session ?? null) ? use : null;
  }

  /* -------------------------------------------- */
  /*  The check's chat card                       */
  /* -------------------------------------------- */

  /** The card carrying the builder's flag: this one, or the one a chain of Destiny Rerolls began at. */
  static origin(message) {
    const seen = new Set();
    let current = message;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.flags?.starwarsffg?.[FLAG]) return current;
      current = game.messages.get(current.flags?.starwarsffg?.destinyReroll?.of);
    }
    return null;
  }

  /** The card whose result counts: this one, or the Destiny Reroll that replaced it. */
  static latest(message) {
    const seen = new Set();
    let current = message;
    while (current?.flags?.starwarsffg?.destinyRerolledAs && !seen.has(current.id)) {
      seen.add(current.id);
      const next = game.messages.get(current.flags.starwarsffg.destinyRerolledAs);
      if (!next) break;
      current = next;
    }
    return current;
  }

  /** @returns {?{success: number, triumph: number, despair: number}} null when the roll cannot be read */
  static result(message) {
    if (!message || message.isContentVisible === false) return null;
    const ffg = SpendResults.roll(message)?.ffg;
    if (!ffg) return null;
    return { success: count(ffg.success), triumph: count(ffg.triumph), despair: count(ffg.despair) };
  }

  /**
   * Load a check's card into the builder.
   * @param {string} messageId
   * @param {object} [options]
   * @param {boolean} [options.restoreDesign]  take the qualities from the card, as rolled
   */
  _attach(messageId, { restoreDesign = false } = {}) {
    const message = game.messages.get(messageId);
    if (!message) return false;
    const origin = ImprovisedDetonation.origin(message);
    const latest = ImprovisedDetonation.latest(message);
    if (restoreDesign && origin) this._state.picks = cleanPicks(origin.flags.starwarsffg[FLAG].picks);
    this._state.originId = origin?.id ?? latest.id;
    this._state.messageId = latest.id;
    this._state.readKey = null;
    this._readResult(latest);
    return true;
  }

  /** Take the result off the card, unless it is the same one already read (and perhaps corrected). */
  _readResult(message) {
    const result = ImprovisedDetonation.result(message);
    if (!result) {
      // A blind roll: the player sees no result and has to be told it.
      this._state.source = "hidden";
      this._state.result ??= { success: 0, triumph: 0, despair: 0 };
      return;
    }
    const key = JSON.stringify(result);
    if (key === this._state.readKey) return;
    this._state.readKey = key;
    this._state.source = "card";
    this._state.result = result;
    this._state.triumphsSpent = Math.min(this._state.triumphsSpent, result.triumph);
  }

  /** A bond invoked on the check, or a Destiny Reroll replacing it, changes the result. */
  _onMessageChanged(message) {
    if (!this._state.messageId || message.id !== this._state.messageId) return;
    const latest = ImprovisedDetonation.latest(message);
    this._state.messageId = latest.id;
    this._readResult(latest);
    this.render();
  }

  _onMessageDeleted(message) {
    if (!this._state.messageId || message.id !== this._state.messageId) return;
    this._state.messageId = null;
    this._state.source = "gone";
    this.render();
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** Everything the window shows and the buttons act on, worked out from the live actor. */
  _compute() {
    const tiers = ImprovisedDetonation.tiers(this.actor);
    const picks = tiers.supreme ? this._state.picks : {};
    const plan = ImprovisedDetonation.difficulty(tiers.improved, picks);
    const stats = ImprovisedDetonation.stats(this.actor);
    const multiplier = tiers.improved ? 2 : 1;
    const base = stats.intellect + multiplier * stats.mechanics;
    const outcome = ImprovisedDetonation.outcome(base, this._state.result, this._state.triumphsSpent, stats.powerfulBlast);
    return { tiers, picks, plan, stats, multiplier, base, outcome, result: this._state.result };
  }

  /** "Intellect 3 + Mechanics 2 × 2" */
  static _formula({ stats, multiplier }) {
    const mechanics = multiplier > 1 ? `${stats.mechanics} × ${multiplier}` : `${stats.mechanics}`;
    return game.i18n.format("SWFFG.ImprovisedDetonation.Formula", { intellect: stats.intellect, mechanics });
  }

  /**
   * "7 + 2 [SU] + 2 (1 [TR])", the damage's parts once the check is known.
   * @param {object} computed  from {@link ImprovisedDetonation#_compute}
   * @param {string} [head]    what to show for the base damage (the number by default)
   */
  static _breakdown({ base, outcome, result }, head = `${base}`) {
    const parts = [head];
    if (outcome.succeeded) {
      parts.push(`${result.success} [SU]`);
      if (outcome.spent) parts.push(`${TRIUMPH_DAMAGE * outcome.spent} (${outcome.spent} [TR])`);
    }
    return parts.join(" + ");
  }

  /** "Blast: 10 + 2 (Powerful Blast) = 12", or "" when Powerful Blast adds nothing */
  static _blastBreakdown({ stats, outcome }) {
    if (!outcome?.blast || !stats.powerfulBlast) return "";
    return game.i18n.format("SWFFG.ImprovisedDetonation.BlastBreakdown", { damage: outcome.damage, ranks: stats.powerfulBlast, blast: outcome.blast });
  }

  static _difficultyName(plan) {
    const name = game.i18n.localize(DIFFICULTY_NAMES[plan.dice] ?? "SWFFG.DifficultyFormidable");
    return plan.upgrades ? game.i18n.format("SWFFG.ImprovisedDetonation.Upgraded", { difficulty: name, count: plan.upgrades }) : name;
  }

  /** "[CH][CH][DI][DI][DI]" */
  static _difficultyCodes(plan) {
    return "[CH]".repeat(plan.upgrades) + "[DI]".repeat(plan.dice - plan.upgrades);
  }

  /** @override */
  async _prepareContext(_options) {
    const computed = this._compute();
    const { tiers, picks, plan, stats, base, outcome, result } = computed;
    const state = this._state;
    const rolled = Boolean(result);
    // Choices still possible before the check is as hard as it gets.
    const room = MAX_STEPS - plan.steps;

    const qualities = QUALITIES.map((quality) => {
      const chosen = picks[quality.key] ?? 0;
      const label = game.i18n.localize(`SWFFG.Qualities.Name.${quality.key}`);
      return {
        key: quality.key,
        label: quality.step ? `${label} +${quality.step}` : label,
        ranked: Boolean(quality.step),
        count: chosen,
        rating: chosen ? (quality.step ? `${label} ${quality.step * chosen}` : label) : "",
        atMin: rolled || chosen <= 0,
        atMax: rolled || chosen >= (quality.step ? MAX_PICKS : 1) || room <= 0,
      };
    });

    const used = ImprovisedDetonation.usedThisSession(this.actor);
    const usedNotice =
      used && used.messageId !== state.originId
        ? game.i18n.format("SWFFG.ImprovisedDetonation.UsedThisSession", { time: new Date(used.time).toLocaleTimeString(game.i18n.lang, { hour: "2-digit", minute: "2-digit" }) })
        : "";

    let outcomeText = "";
    let outcomeClass = "";
    if (outcome) {
      const data = { actor: this.actor.name, damage: outcome.damage, blast: outcome.blast };
      if (outcome.premature) {
        outcomeClass = "premature";
        outcomeText = loc(outcome.succeeded ? "SWFFG.ImprovisedDetonation.Outcome.PrematureSuccess" : "SWFFG.ImprovisedDetonation.Outcome.PrematureFailure", data);
      } else if (outcome.succeeded) {
        outcomeClass = "built";
        outcomeText = loc("SWFFG.ImprovisedDetonation.Outcome.Built", data);
      } else {
        outcomeClass = "failed";
        outcomeText = loc("SWFFG.ImprovisedDetonation.Outcome.Failed");
      }
      if (outcome.succeeded) outcomeText += `<span class="ffg-id-breakdown">${richText(`${ImprovisedDetonation._breakdown(computed)} = ${outcome.damage}`)}</span>`;
      const blastBreakdown = ImprovisedDetonation._blastBreakdown(computed);
      if (blastBreakdown) outcomeText += `<span class="ffg-id-breakdown">${escapeHTML(blastBreakdown)}</span>`;
    }

    const tierLabels = { base: "SWFFG.ImprovisedDetonation.Tier.base", improved: "SWFFG.ImprovisedDetonation.Tier.improved", supreme: "SWFFG.ImprovisedDetonation.Tier.supreme" };

    return {
      actor: { name: this.actor.name, img: this.actor.img },
      statsText: [
        game.i18n.format("SWFFG.ImprovisedDetonation.Stats", stats),
        stats.powerfulBlast ? game.i18n.format("SWFFG.ImprovisedDetonation.PowerfulBlast", { ranks: stats.powerfulBlast }) : "",
      ]
        .filter(Boolean)
        .join(" · "),
      tiers: Object.entries(tierLabels).map(([tier, label]) => ({ label: game.i18n.localize(label), owned: tiers[tier] })),
      usedNotice,
      supreme: tiers.supreme,
      qualities,
      qualityHint: game.i18n.format("SWFFG.ImprovisedDetonation.QualityHint", { max: MAX_PICKS }),
      difficultyDice: [...Array(plan.upgrades).fill(CONFIG.FFG.CHALLENGE_ICON), ...Array(plan.dice - plan.upgrades).fill(CONFIG.FFG.DIFFICULTY_ICON)],
      difficultyName: ImprovisedDetonation._difficultyName(plan),
      damageHint: [
        game.i18n.localize("SWFFG.ImprovisedDetonation.DamageHint"),
        stats.powerfulBlast ? game.i18n.format("SWFFG.ImprovisedDetonation.PowerfulBlastHint", { ranks: stats.powerfulBlast }) : "",
      ]
        .filter(Boolean)
        .join(" "),
      damageText: `<strong>${base}</strong> + ${richText("[SU]")} <span class="ffg-id-formula">(${escapeHTML(ImprovisedDetonation._formula(computed))})</span>`,
      rolled,
      resultSource: state.source ? game.i18n.localize(`SWFFG.ImprovisedDetonation.Source.${state.source}`) : "",
      resultFields: rolled
        ? [
            { name: "success", icon: richText("[SU]"), label: game.i18n.localize("SWFFG.ImprovisedDetonation.Fields.success"), value: result.success },
            { name: "triumph", icon: richText("[TR]"), label: game.i18n.localize("SWFFG.ImprovisedDetonation.Fields.triumph"), value: result.triumph },
            { name: "despair", icon: richText("[DE]"), label: game.i18n.localize("SWFFG.ImprovisedDetonation.Fields.despair"), value: result.despair },
          ]
        : [],
      canSpendTriumph: Boolean(outcome?.succeeded && result.triumph > 0),
      spendLabel: game.i18n.format("SWFFG.ImprovisedDetonation.SpendTriumphs", { damage: TRIUMPH_DAMAGE }),
      spent: outcome?.spent ?? 0,
      spendAtMin: !outcome?.spent,
      spendAtMax: !outcome || outcome.spent >= (result?.triumph ?? 0),
      outcomeText,
      outcomeClass,
      canBuild: Boolean(outcome?.canBuild),
    };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // The result fields only commit on change, so typing a number never loses focus to a re-render.
    for (const input of this.element.querySelectorAll(".ffg-id-result-fields input")) {
      input.addEventListener("change", (event) => {
        const field = event.currentTarget.name;
        if (!this._state.result || !(field in this._state.result)) return;
        this._state.result[field] = count(event.currentTarget.value);
        this._state.triumphsSpent = Math.min(this._state.triumphsSpent, this._state.result.triumph);
        if (this._state.source === "card") this._state.source = "edited";
        this.render();
      });
    }
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** @this {ImprovisedDetonation} */
  static #onPick(_event, target) {
    if (this._state.result) return;
    const quality = QUALITIES.find((entry) => entry.key === target.dataset.key);
    if (!quality) return;
    const delta = Math.sign(parseInt(target.dataset.delta, 10) || 0);
    const { tiers } = this._compute();
    const picks = { ...this._state.picks, [quality.key]: (this._state.picks[quality.key] ?? 0) + delta };
    // Refuse a choice that would take the check past five challenge dice.
    if (delta > 0 && ImprovisedDetonation.difficulty(tiers.improved, this._state.picks).steps >= MAX_STEPS) return;
    this._state.picks = cleanPicks(picks);
    this.render();
  }

  /** @this {ImprovisedDetonation} */
  static #onSpend(_event, target) {
    const delta = Math.sign(parseInt(target.dataset.delta, 10) || 0);
    this._state.triumphsSpent = Math.clamp(this._state.triumphsSpent + delta, 0, this._state.result?.triumph ?? 0);
    this.render();
  }

  /** Roll the check through the ordinary roll dialog, at the difficulty worked out here. @this {ImprovisedDetonation} */
  static async #onRoll() {
    const actor = this.actor;
    if (actor.verifyEditModeIsNotEnabled && !actor.verifyEditModeIsNotEnabled()) return;
    const { picks, plan } = this._compute();

    const rolled = await DiceHelpers.assemblePool({ actorData: actor.system, baseSkillKey: SKILL, baseDifficulty: plan.dice });
    rolled.dicePool.upgradeDifficulty(plan.upgrades);
    const label = game.i18n.localize(rolled.label);
    const sheetData = await actor.sheet.getData();

    // "Improvised Detonation: Burn 2, Pierce 4" above the dice on the card
    const chosen = QUALITIES.filter((quality) => picks[quality.key]).map((quality) => {
      const name = game.i18n.localize(`SWFFG.Qualities.Name.${quality.key}`);
      return quality.step ? `${name} ${quality.step * picks[quality.key]}` : name;
    });
    const talent = game.i18n.localize("SWFFG.ImprovisedDetonation.Name");
    const flavor = chosen.length ? `${talent}: ${chosen.join(", ")}` : talent;

    await DiceHelpers.displayRollDialog(sheetData, rolled.dicePool, `${game.i18n.localize("SWFFG.Rolling")} ${label}`, rolled.label, { name: label, type: "skill" }, flavor, undefined, {
      messageFlags: { [FLAG]: { actorUuid: actor.uuid, picks: { ...picks }, steps: plan.steps } },
      onRolled: (message) => ImprovisedDetonation._onRolled(actor, message),
    });
  }

  /** The check is on the table: show its result, reopening the builder if it was closed meanwhile. */
  static _onRolled(actor, message) {
    this.open(actor, { messageId: message.id });
    actor
      .setFlag("starwarsffg", USE_FLAG, { session: DestinySession.state().session ?? null, time: Date.now(), messageId: message.id })
      .catch((err) => CONFIG.logger.warn("Improvised Detonation: could not record the use", err));
  }

  /** The check was rolled somewhere else: type its result in. @this {ImprovisedDetonation} */
  static #onManual() {
    Object.assign(this._state, { result: { success: 0, triumph: 0, despair: 0 }, source: "manual", messageId: null, originId: null, readKey: null, triumphsSpent: 0 });
    this.render();
  }

  /** Back to choosing qualities. The rolled card keeps its own button to come back to it. @this {ImprovisedDetonation} */
  static #onStartOver() {
    Object.assign(this._state, { result: null, source: null, messageId: null, originId: null, readKey: null, triumphsSpent: 0 });
    this.render();
  }

  /** @this {ImprovisedDetonation} */
  static async #onAddToSheet(_event, target) {
    const actor = this.actor;
    if (actor.verifyEditModeIsNotEnabled && !actor.verifyEditModeIsNotEnabled()) return;
    const computed = this._compute();
    if (!computed.outcome?.canBuild) return ui.notifications.warn(game.i18n.localize("SWFFG.ImprovisedDetonation.Errors.NotBuilt"));

    target.disabled = true;
    try {
      const data = await ImprovisedDetonation.deviceData(actor, computed, this._state);
      const [item] = await actor.createEmbeddedDocuments("Item", [data]);
      if (!item) throw new Error("the item was not created");
      // So the check's card stops offering to finish a device that already exists.
      const origin = game.messages.get(this._state.originId);
      if (origin?.flags?.starwarsffg?.[FLAG] && origin.canUserModify(game.user, "update")) {
        await origin.setFlag("starwarsffg", `${FLAG}.built`, item.id);
      }
      ui.notifications.info(game.i18n.format("SWFFG.ImprovisedDetonation.Added", { name: item.name, actor: actor.name }));
      await this.close();
    } catch (err) {
      CONFIG.logger.error("Improvised Detonation: could not add the device", err);
      ui.notifications.error(game.i18n.localize("SWFFG.ImprovisedDetonation.Errors.Failed"));
      target.disabled = false;
    }
  }

  /* -------------------------------------------- */
  /*  The device                                  */
  /* -------------------------------------------- */

  /**
   * The weapon item for a finished device.
   * @param {Actor} actor
   * @param {object} computed  from {@link ImprovisedDetonation#_compute}
   * @param {object} state     the builder's state (for the record kept on the item)
   */
  static async deviceData(actor, computed, state) {
    const { tiers, picks, plan, stats, outcome, result } = computed;
    const damage = outcome.damage;

    const qualities = [];
    if (outcome.blast) qualities.push({ key: "blast", name: "Blast", rank: outcome.blast });
    for (const quality of QUALITIES) {
      const chosen = picks[quality.key];
      if (chosen) qualities.push({ key: quality.key, name: quality.name, rank: quality.step ? quality.step * chosen : 1 });
    }
    const itemmodifier = [];
    for (const quality of qualities) itemmodifier.push(await this._qualityEntry(quality));

    // " (Improved, Supreme)", or nothing for the talent alone
    const upgrades = ["improved", "supreme"].filter((tier) => tiers[tier]).map((tier) => game.i18n.localize(`SWFFG.ImprovisedDetonation.Tier.${tier}`));
    const lines = [
      game.i18n.format("SWFFG.ImprovisedDetonation.Description.Check", {
        actor: actor.name,
        talent: game.i18n.localize("SWFFG.ImprovisedDetonation.Name") + (upgrades.length ? ` (${upgrades.join(", ")})` : ""),
        difficulty: this._difficultyName(plan),
        dice: this._difficultyCodes(plan),
      }),
      game.i18n.format("SWFFG.ImprovisedDetonation.Description.Damage", {
        breakdown: this._breakdown(computed, this._formula(computed)),
        damage,
      }),
    ];
    const blastBreakdown = this._blastBreakdown(computed);
    if (blastBreakdown) lines.push(`${blastBreakdown}.`);
    if (outcome.premature) lines.push(game.i18n.format("SWFFG.ImprovisedDetonation.Description.Premature", { actor: actor.name }));
    const description = lines.map((line) => `<p>${escapeHTML(line)}</p>`).join("");

    return {
      name: game.i18n.localize("SWFFG.ImprovisedDetonation.DeviceName"),
      type: "weapon",
      img: DEVICE_IMG,
      system: {
        description,
        skill: { value: SKILL, useBrawn: false },
        characteristic: { value: "" },
        damage: { value: damage, adjusted: damage },
        crit: { value: 0, adjusted: 0 },
        range: { value: "Engaged", adjusted: "Engaged" },
        encumbrance: { value: 0, adjusted: 0 },
        price: { value: 0, adjusted: 0 },
        rarity: { value: 0, adjusted: 0, isrestricted: false },
        hardpoints: { value: 0, adjusted: 0 },
        quantity: { value: 1 },
        special: { value: "" },
        status: "None",
        itemmodifier,
        itemattachment: [],
      },
      flags: {
        starwarsffg: {
          fixedDamage: true,
          [FLAG]: {
            intellect: stats.intellect,
            mechanics: stats.mechanics,
            powerfulBlast: stats.powerfulBlast,
            improved: tiers.improved,
            successes: result.success,
            triumphsSpent: outcome.spent,
            despair: result.despair,
            picks: { ...picks },
            steps: plan.steps,
            messageId: state.originId ?? null,
          },
        },
      },
    };
  }

  /**
   * A quality as embedded on the weapon. The world's or a compendium's own quality item is used for
   * its name, icon and description when there is one, so the device's qualities read like those of
   * any imported weapon; its modifiers are not copied, so nothing but the rank comes along.
   */
  static async _qualityEntry({ key, name, rank }) {
    const template = await this._qualityTemplate(name);
    const importId = template?.flags?.starwarsffg?.ffgimportid;
    return {
      _id: foundry.utils.randomID(),
      name: template?.name ?? name,
      type: "itemmodifier",
      img: template?.img ?? QUALITY_IMG,
      system: {
        description: template?.system?.description || game.i18n.localize(`SWFFG.ImprovisedDetonation.QualityText.${key}`),
        attributes: {},
        type: "all",
        rank,
        showInQualities: true,
        itemmodifier: [],
        adjusteditemmodifer: [],
      },
      flags: importId ? { starwarsffg: { ffgimportid: importId } } : {},
    };
  }

  /** A quality item by name: the world's first, then the compendiums'. */
  static async _qualityTemplate(name) {
    const wanted = bareQualityName(name);
    if (this._templates.has(wanted)) return this._templates.get(wanted);
    let found = game.items.find((item) => item.type === "itemmodifier" && bareQualityName(item.name) === wanted)?.toObject() ?? null;
    if (!found) {
      for (const pack of game.packs) {
        if (pack.documentName !== "Item") continue;
        const entry = pack.index.find((indexed) => (!indexed.type || indexed.type === "itemmodifier") && bareQualityName(indexed.name) === wanted);
        if (!entry) continue;
        const document = await pack.getDocument(entry._id);
        if (document?.type !== "itemmodifier") continue;
        found = document.toObject();
        break;
      }
    }
    this._templates.set(wanted, found);
    return found;
  }

  /* -------------------------------------------- */
  /*  Chat                                        */
  /* -------------------------------------------- */

  /**
   * Put a button on the talent's own card (Send to Chat) to open the builder, and on a check rolled
   * from it to come back to the result, until the device has been added to a sheet. Only for users who
   * own the character. Called from the system's chat render hook.
   * @param {ChatMessage} message
   * @param {jQuery} html
   */
  static bindChatMessage(message, html) {
    if (!this.enabled || message.isContentVisible === false) return;
    const root = html?.[0] ?? html;
    const content = root?.querySelector?.(".message-content");
    if (!content || content.querySelector(".ffg-detonation-actions")) return;

    const origin = this.origin(message);
    if (origin) {
      // The card that replaced this one carries the button now.
      if (message.flags?.starwarsffg?.destinyRerolledAs) return;
      const flag = origin.flags.starwarsffg[FLAG];
      if (flag.built) return;
      const actor = fromUuidSync(flag.actorUuid);
      if (!actor?.isOwner) return;
      content.append(this._chatButton("SWFFG.ImprovisedDetonation.Finish", () => this.open(actor, { messageId: message.id })));
      return;
    }

    const card = content.querySelector(".item-card");
    if (!card || !talentTier(card.querySelector(".card-header .title")?.textContent)) return;
    const actor = SpendResults.rollerActor(message);
    if (!actor?.isOwner || !this.hasTalent(actor)) return;
    card.append(this._chatButton("SWFFG.ImprovisedDetonation.Build", () => this.open(actor)));
  }

  static _chatButton(labelKey, onClick) {
    const actions = document.createElement("div");
    actions.className = "ffg-chat-actions ffg-detonation-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<i class="fa-solid fa-bomb"></i> ${loc(labelKey)}`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    actions.append(button);
    return actions;
  }

  /** Keep open builders in step with their check's card. Called once, at ready. */
  static register() {
    Hooks.on("updateChatMessage", (message) => {
      for (const app of this.instances.values()) app._onMessageChanged(message);
    });
    Hooks.on("deleteChatMessage", (message) => {
      for (const app of this.instances.values()) app._onMessageDeleted(message);
    });
  }
}
