/**
 * Weapon quality automation.
 *
 * Most of what a quality does was already covered before this file existed, and is left alone:
 *
 *  - Accurate / Inaccurate / Superior / Inferior and anything else that changes the dice pool are
 *    ordinary modifiers on the quality item, read by DiceHelpers.getModifiers.
 *  - Pierce and Breach are read by Apply Damage; Vicious by Apply Crit.
 *
 * What was missing, and is handled here:
 *
 *  - Cumbersome: the difficulty increase when the wielder's Brawn is short of the rating.
 *  - Auto-fire: the declared +1 difficulty, as a tick box in the roll dialog.
 *  - A reminder in the roll dialog for the qualities that are rules about WHEN a weapon may fire
 *    (Prepare, Slow-Firing, Limited Ammo), which no dice pool change can express.
 *  - The ACTIVE qualities - the ones triggered by spending advantage or a triumph after the roll
 *    (Auto-fire's extra hits, Blast, Burn, Concussive, Disorient, Ensnare, Guided, Knockdown,
 *    Linked, Stun, Sunder). These are offered by the Spend Results dialog, and where the effect is
 *    mechanical it is applied: a status on the target, strain, or an extra hit that Apply Damage
 *    picks up.
 *
 * Damage itself is deliberately NOT applied from here. Apply Damage is the single place a hit is
 * resolved (soak, Pierce / Breach, vehicle scale, Block / Deflect), and a second path that skipped
 * any of that would disagree with it.
 */
import { applyToTargetActor } from "./gm-bridge.js";
import { STATUS, strainTrack } from "./status-effects.js";
import { escapeHTML } from "./html.js";

/**
 * Canonical quality keys and the names they are recognised by.
 *
 * A name matches when it is the quality's name and nothing else, give or take a rank and the word
 * "Quality": "Burn", "Burn 2", "Burn Quality" and "Burn Quality 2" are all Burn. It is NOT matched
 * on its first word - "Stun Setting" (the weapon may be switched to stun) is a different quality
 * from "Stun 3" (advantage inflicts strain), and reading one as the other offered a Stun activation
 * on weapons that have none. Anything unrecognised is simply left alone.
 */
const QUALITY_ALIASES = [
  ["stundamage", ["stun damage"]],
  // recognised only so that it is never mistaken for Stun; nothing is automated for it
  ["stunsetting", ["stun setting"]],
  ["slowfiring", ["slow-firing", "slow firing"]],
  ["limitedammo", ["limited ammo"]],
  ["autofire", ["auto-fire", "auto fire", "autofire"]],
  ["blast", ["blast"]],
  ["burn", ["burn"]],
  ["concussive", ["concussive"]],
  ["cumbersome", ["cumbersome"]],
  ["disorient", ["disorient"]],
  ["ensnare", ["ensnare"]],
  ["guided", ["guided"]],
  ["ion", ["ion"]],
  ["knockdown", ["knockdown"]],
  ["linked", ["linked"]],
  ["prepare", ["prepare"]],
  ["stun", ["stun"]],
  ["sunder", ["sunder"]],
  ["vicious", ["vicious"]],
];

/**
 * The active qualities: what they cost, how often they can be triggered on one attack, whether they
 * need the attack to have hit, and what they act on.
 *
 * `advantage` is the standard cost; every one of them can instead be paid for with a single triumph.
 * `personal` marks the ones that act on a body - knocked prone, staggered, disoriented, strain -
 * and so are not offered when the attack was made against a vehicle.
 */
const ACTIVE_QUALITIES = {
  autofire: { advantage: 2, max: null, when: "hit", needsDeclared: true },
  linked: { advantage: 2, max: "rank", when: "hit" },
  blast: { advantage: 2, missAdvantage: 3, max: 1, when: "any", target: true },
  burn: { advantage: 2, max: 1, when: "hit", target: true },
  concussive: { advantage: 2, max: 1, when: "hit", target: true, personal: true },
  disorient: { advantage: 2, max: 1, when: "hit", target: true, personal: true },
  ensnare: { advantage: 2, max: 1, when: "hit", target: true },
  knockdown: { advantage: 2, perSilhouette: true, max: 1, when: "hit", target: true, personal: true },
  stun: { advantage: 2, max: 1, when: "hit", target: true, personal: true },
  sunder: { advantage: 1, max: null, when: "hit", target: true },
  guided: { advantage: 3, max: 1, when: "miss" },
};

function normalizeName(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalQuality(name) {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  // the name with any rank and any "quality" suffix taken off
  const bare = normalized
    .split(" ")
    .filter((word) => word !== "quality" && !/^[0-9]+$/.test(word))
    .join(" ");
  for (const [key, aliases] of QUALITY_ALIASES) {
    if (aliases.includes(bare)) return key;
  }
  return null;
}

export default class WeaponQualities {
  /** @returns {boolean} whether the GM has the feature switched on */
  static get enabled() {
    return game.settings.get("starwarsffg", "enableWeaponQualities");
  }

  /**
   * The recognised qualities on a weapon, keyed canonically, with ranks summed across the weapon's
   * own qualities and the active modifications of its attachments - the same aggregation the item
   * sheet shows ("Burn 3" rather than "Burn 1" plus "Burn 2 from an attachment").
   *
   * Works on a live Item and on the plain copy embedded in an attack's chat message alike.
   *
   * @param {Item|object} item
   * @returns {Object<string, {key: string, name: string, rank: number, configured: boolean}>}
   */
  static qualities(item) {
    const system = item?.system ?? {};
    const found = {};
    const visit = (mod) => {
      if (!mod || mod.system?.showInQualities === false) return;
      const key = canonicalQuality(mod.name);
      if (!key) return;
      const rank = Number(mod.system?.rank);
      const entry = (found[key] ??= { key, name: String(mod.name ?? key).replace(/<[^>]*>/g, "").trim(), rank: 0, configured: false });
      entry.rank += Number.isFinite(rank) && rank > 0 ? rank : 0;
      // A quality the GM has given modifiers of its own already does whatever it is meant to do;
      // nothing here should then be layered on top of it.
      if (Object.keys(mod.system?.attributes ?? {}).length) entry.configured = true;
    };
    for (const mod of system.itemmodifier ?? []) visit(mod);
    for (const attachment of system.itemattachment ?? []) {
      for (const mod of attachment?.system?.itemmodifier ?? []) {
        if (mod?.system?.active) visit(mod);
      }
    }
    // An unranked quality (Auto-fire, Knockdown) stores no rank; treat its presence as rank 1.
    for (const entry of Object.values(found)) entry.rank = Math.max(1, entry.rank);
    return found;
  }

  /**
   * Cumbersome X: each point the wielder's Brawn falls short of X adds a difficulty die to every
   * check made with the weapon.
   *
   * @param {?Item} item
   * @param {?object} actorData  the wielder's `system` data
   * @returns {number} difficulty dice to add
   */
  static cumbersomePenalty(item, actorData) {
    if (item?.type !== "weapon" || !this.enabled) return 0;
    const cumbersome = this.qualities(item).cumbersome;
    if (!cumbersome || cumbersome.configured) return 0;
    const brawn = Number(actorData?.characteristics?.Brawn?.value);
    if (!Number.isFinite(brawn)) return 0;
    return Math.max(0, cumbersome.rank - brawn);
  }

  /* -------------------------------------------- */
  /*  Roll dialog                                 */
  /* -------------------------------------------- */

  /**
   * Add the quality panel to the roll dialog: what was applied for the wielder, the Auto-fire tick
   * box, and reminders for qualities that restrict when the weapon can be used. Called on every
   * render of the dialog; renders nothing when there is nothing to say.
   *
   * @param {RollBuilderFFG} app
   * @param {jQuery} html
   */
  static decorateRollBuilder(app, html) {
    const item = app?.roll?.item;
    if (!item || !["weapon", "shipweapon"].includes(item.type) || !this.enabled) return;
    const root = html?.[0] ?? html;
    const anchor = root?.querySelector?.(".dice-pool-dialog .dice-pool");
    if (!anchor || root.querySelector(".ffg-quality-panel")) return;

    const qualities = this.qualities(item);
    const lines = [];
    const note = (icon, text) => lines.push(`<div class="ffg-quality-line"><i class="${icon}"></i><span>${escapeHTML(text)}</span></div>`);

    const actorData = app.roll.data?.data ?? app.roll.data?.document?.system;
    const penalty = this.cumbersomePenalty(item, actorData);
    if (penalty > 0) {
      note("fa-solid fa-weight-hanging", game.i18n.format("SWFFG.Qualities.RollDialog.Cumbersome", {
        rank: qualities.cumbersome.rank,
        brawn: Number(actorData?.characteristics?.Brawn?.value) || 0,
        count: penalty,
      }));
    }
    for (const key of ["prepare", "slowfiring", "limitedammo"]) {
      if (qualities[key]) note("fa-solid fa-triangle-exclamation", game.i18n.format(`SWFFG.Qualities.RollDialog.${key}`, { rank: qualities[key].rank }));
    }
    if (qualities.linked) note("fa-solid fa-link", game.i18n.format("SWFFG.Qualities.RollDialog.linked", { rank: qualities.linked.rank }));

    const autofire = qualities.autofire
      ? `<label class="ffg-quality-autofire"><input type="checkbox" ${app._autoFire ? "checked" : ""} /> ${escapeHTML(game.i18n.localize("SWFFG.Qualities.RollDialog.AutoFire"))}</label>`
      : "";

    if (!lines.length && !autofire) return;

    const panel = document.createElement("div");
    panel.className = "ffg-quality-panel";
    panel.innerHTML = `${autofire}${lines.join("")}`;
    anchor.before(panel);

    panel.querySelector(".ffg-quality-autofire input")?.addEventListener("change", (event) => {
      const wanted = event.currentTarget.checked;
      if (wanted === Boolean(app._autoFire)) return;
      app._autoFire = wanted;
      app.dicePool.difficulty = Math.max(0, app.dicePool.difficulty + (wanted ? 1 : -1));
      app._initializeInputs(html);
    });
  }

  /* -------------------------------------------- */
  /*  Attack context                              */
  /* -------------------------------------------- */

  /**
   * What an attack's chat message says about the weapon that made it.
   * @param {ChatMessage} message
   * @returns {?object} null when the message is not a weapon attack
   */
  static attackContext(message) {
    const roll = message?.rolls?.find?.((r) => r?.ffg && typeof r.ffg === "object");
    const item = roll?.data;
    if (!item || !["weapon", "shipweapon"].includes(item.type)) return null;
    const system = item.system ?? {};
    const shown = (stat) => {
      const adjusted = Number(stat?.adjusted) || 0;
      return adjusted !== 0 ? adjusted : Number(stat?.value) || 0;
    };
    const successes = Number(roll.ffg.success) || 0;
    return {
      item,
      name: item.name ?? "",
      baseDamage: shown(system.damage),
      crit: shown(system.crit),
      successes,
      hit: successes > 0,
      qualities: this.qualities(item),
      autofireDeclared: message.flags?.starwarsffg?.attack?.autofire,
    };
  }

  /**
   * The options Spend Results offers for this attack's active qualities.
   * @param {ChatMessage} message
   * @param {?Actor} [targetActor]  the attack's target, when known (Knockdown's cost depends on it)
   * @returns {object[]} option definitions in the shape SpendResults expects
   */
  static spendOptions(message, targetActor = null) {
    if (!this.enabled) return [];
    const context = this.attackContext(message);
    if (!context) return [];

    const options = [];
    for (const [key, definition] of Object.entries(ACTIVE_QUALITIES)) {
      const quality = context.qualities[key];
      if (!quality) continue;
      if (definition.when === "hit" && !context.hit) continue;
      if (definition.when === "miss" && context.hit) continue;
      // Auto-fire only generates extra hits when it was declared (and paid for with the extra
      // difficulty) before the roll. Messages rolled before that was recorded are given the
      // benefit of the doubt.
      if (definition.needsDeclared && context.autofireDeclared === false) continue;
      if (definition.personal && targetActor?.type === "vehicle") continue;

      let advantage = definition.advantage;
      if (key === "blast" && !context.hit) advantage = definition.missAdvantage;
      if (definition.perSilhouette) {
        const silhouette = Number(targetActor?.system?.stats?.silhouette?.value) || 1;
        advantage += Math.max(0, silhouette - 1);
      }

      const ranked = quality.rank > 1 || ["blast", "burn", "concussive", "disorient", "ensnare", "linked", "stun", "guided"].includes(key);
      options.push({
        id: `quality-${key}`,
        group: "weapon",
        title: game.i18n.format("SWFFG.Spend.Quality.Activate", { quality: ranked ? `${game.i18n.localize(`SWFFG.Qualities.Name.${key}`)} ${quality.rank}` : game.i18n.localize(`SWFFG.Qualities.Name.${key}`) }),
        description: game.i18n.format(`SWFFG.Spend.Quality.${key}.Description`, this._qualityData(context, key, quality.rank)),
        costs: { advantage, triumph: 1 },
        max: definition.max === "rank" ? quality.rank : definition.max,
        target: definition.target ? "target" : null,
        automation: { type: "quality", quality: key, rank: quality.rank },
      });
    }
    return options;
  }

  static _qualityData(context, key, rank) {
    return {
      rank,
      weapon: context.name,
      damage: key === "blast" ? rank + (context.hit ? context.successes : 0) : context.baseDamage,
    };
  }

  /**
   * Carry out an activated quality.
   *
   * @param {ChatMessage} message          the attack
   * @param {object} automation            `{quality, rank}` from the option
   * @param {?{actor: Actor, name: string}} target
   * @returns {Promise<{summary: string, extraHits?: number}>}
   */
  static async applyQuality(message, automation, target) {
    const context = this.attackContext(message);
    if (!context) throw new Error(game.i18n.localize("SWFFG.Spend.Errors.NotAnAttack"));
    const key = automation.quality;
    const rank = Math.max(1, Number(automation.rank) || 1);
    const data = { ...this._qualityData(context, key, rank), target: target?.name ?? game.i18n.localize("SWFFG.Spend.Target.Unknown") };
    const summary = (suffix = "Summary") => game.i18n.format(`SWFFG.Spend.Quality.${key}.${suffix}`, data);

    if (key === "autofire" || key === "linked") return { summary: summary(), extraHits: 1 };
    if (["blast", "guided", "sunder"].includes(key)) return { summary: summary() };

    const actor = target?.actor;
    if (!actor) throw new Error(game.i18n.localize("SWFFG.Spend.Errors.TargetRequired"));

    const applyStatus = async (status) => {
      const result = await applyToTargetActor(actor, { type: "status", status });
      if (!result) throw new Error(game.i18n.localize("SWFFG.GMBridge.NoGM"));
    };

    switch (key) {
      case "burn":
        await applyStatus({
          statusId: STATUS.burning,
          name: game.i18n.format("SWFFG.Spend.Quality.burn.EffectName", data),
          rounds: rank,
        });
        break;
      case "concussive":
        await applyStatus({
          key: "staggered",
          name: game.i18n.localize("SWFFG.Status.Staggered"),
          img: "icons/svg/daze.svg",
          rounds: rank,
        });
        break;
      case "disorient":
        await applyStatus({ statusId: STATUS.disoriented, rounds: rank });
        break;
      case "ensnare":
        await applyStatus({ statusId: STATUS.immobilized, rounds: rank });
        break;
      case "knockdown":
        await applyStatus({ statusId: STATUS.prone });
        break;
      case "stun": {
        // Strain, or wounds for the adversaries (minions, rivals) that take strain that way.
        const track = strainTrack(actor, true);
        if (!track) throw new Error(summary("NoTrack"));
        const result = await applyToTargetActor(actor, { type: "damage", path: `system.stats.${track}.value`, delta: rank });
        if (!result) throw new Error(game.i18n.localize("SWFFG.GMBridge.NoGM"));
        return { summary: summary(track === "wounds" ? "SummaryWounds" : "Summary") };
      }
    }
    return { summary: summary() };
  }

  /**
   * Which track Apply Damage should open on for this weapon: strain for a Stun Damage weapon, and
   * system strain for an Ion weapon striking a vehicle.
   * @param {object} itemData   the weapon data embedded in the attack's chat message
   * @param {boolean} vehicleTarget
   * @returns {"wounds"|"strain"}
   */
  static defaultDamagePool(itemData, vehicleTarget) {
    if (!this.enabled) return "wounds";
    const qualities = this.qualities(itemData);
    if (vehicleTarget) return qualities.ion ? "strain" : "wounds";
    return qualities.stundamage ? "strain" : "wounds";
  }
}
