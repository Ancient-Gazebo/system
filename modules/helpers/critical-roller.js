/**
 * Critical Injury / Critical Hit roller.
 *
 * Rolls 1d100 against the d100 ranges stored on `criticalinjury` / `criticaldamage`
 * Items, applying user-supplied modifiers (the roller never derives the modifier
 * values itself - it only asks how many of each apply and does the arithmetic).
 *
 * Per-rule modifiers (each queried, never auto-detected):
 *   +10  per Critical Injury / Hit the target already has
 *   +10  per rank of the Lethal Blows talent
 *   -10  per rank of the Durable talent the target possesses
 *   +10  per time the weapon's Critical rating is activated
 *
 * Resolving the result onto an actor is intentionally out of scope: the roller
 * only rolls and reports.
 *
 * @extends {FormApplication}
 */

const CRIT_TYPES = {
  criticalinjury: {
    labelKey: "SWFFG.CriticalRoller.Type.Injury",
    titleKey: "SWFFG.CriticalRoller.Title.Injury",
    icon: "fa-solid fa-user-injured",
  },
  criticaldamage: {
    labelKey: "SWFFG.CriticalRoller.Type.Hit",
    titleKey: "SWFFG.CriticalRoller.Title.Hit",
    icon: "fa-solid fa-burst",
  },
};

// Each modifier contributes (count * STEP) to the d100 roll. Durable is negative.
const MOD_STEP = 10;
const MODIFIERS = [
  { key: "existing", sign: 1, labelKey: "SWFFG.CriticalRoller.Mod.Existing", hintKey: "SWFFG.CriticalRoller.Mod.ExistingHint" },
  { key: "lethal", sign: 1, labelKey: "SWFFG.CriticalRoller.Mod.Lethal", hintKey: "SWFFG.CriticalRoller.Mod.LethalHint" },
  { key: "durable", sign: -1, labelKey: "SWFFG.CriticalRoller.Mod.Durable", hintKey: "SWFFG.CriticalRoller.Mod.DurableHint" },
  { key: "critrating", sign: 1, labelKey: "SWFFG.CriticalRoller.Mod.CritRating", hintKey: "SWFFG.CriticalRoller.Mod.CritRatingHint" },
];

export default class CriticalRollerFFG extends FormApplication {
  constructor(options = {}) {
    super({}, options);
    // Remember the last type chosen by this user so re-opening is sticky.
    const stored = options.critType || game.user.getFlag("starwarsffg", "criticalRollerType");
    this.critType = CRIT_TYPES[stored] ? stored : "criticalinjury";
    // Selections persisted across re-renders (a type change re-renders the form).
    this.selection = {
      twice: false,
      mods: { existing: 0, lethal: 0, durable: 0, critrating: 0, other: 0 },
    };
  }

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "ffg-critical-roller",
      classes: ["starwarsffg", "ffg-critical-roller"],
      template: "systems/starwarsffg/templates/dialogs/ffg-critical-roller.html",
      width: 420,
      height: "auto",
      resizable: true,
      submitOnChange: false,
      closeOnSubmit: false,
    });
  }

  /** @override */
  get title() {
    return game.i18n.localize(CRIT_TYPES[this.critType].titleKey);
  }

  /**
   * Convenience launcher used by menus / macros: CriticalRollerFFG.launch("criticaldamage").
   */
  static launch(critType) {
    return new CriticalRollerFFG({ critType }).render(true);
  }

  /* -------------------------------------------- */
  /*  Source discovery                            */
  /* -------------------------------------------- */

  /**
   * The pool of criticals to roll against is determined entirely by the type:
   * critical injuries roll from criticalinjury items, critical hits from
   * criticaldamage items. Every world Item of that type is included, so the GM
   * organizes them by keeping each kind in its own folder.
   */
  _resolvePool(critType) {
    return game.items.filter((i) => i.type === critType);
  }

  /* -------------------------------------------- */
  /*  Form data                                   */
  /* -------------------------------------------- */

  /** @override */
  async getData() {
    const mods = MODIFIERS.map((m) => ({
      key: m.key,
      label: game.i18n.localize(m.labelKey),
      hint: game.i18n.localize(m.hintKey),
      signLabel: m.sign < 0 ? "\u2212" : "+", // − or +
      step: MOD_STEP,
      value: this.selection.mods[m.key] ?? 0,
    }));

    const total = this._computeTotalModifier();
    const poolCount = this._resolvePool(this.critType).length;

    return {
      critType: this.critType,
      types: Object.entries(CRIT_TYPES).map(([key, def]) => ({
        key,
        label: game.i18n.localize(def.labelKey),
        selected: key === this.critType,
      })),
      poolCount,
      mods,
      other: this.selection.mods.other ?? 0,
      twice: this.selection.twice,
      total,
      totalDisplay: `${total > 0 ? "+" : ""}${total}`,
      totalClass: total > 0 ? "positive" : total < 0 ? "negative" : "",
    };
  }

  /** Snapshot the current form values into this.selection (used before re-render / roll). */
  _readForm(html) {
    const root = html instanceof jQuery ? html[0] : html;
    if (!root) return;
    const num = (sel) => {
      const el = root.querySelector(sel);
      const v = parseInt(el?.value, 10);
      return Number.isFinite(v) ? v : 0;
    };
    this.selection.twice = !!root.querySelector('[name="twice"]')?.checked;
    for (const m of MODIFIERS) this.selection.mods[m.key] = Math.max(0, num(`[name="mod-${m.key}"]`));
    this.selection.mods.other = num('[name="mod-other"]');
  }

  _computeTotalModifier() {
    let total = 0;
    for (const m of MODIFIERS) total += m.sign * MOD_STEP * (this.selection.mods[m.key] ?? 0);
    total += this.selection.mods.other ?? 0;
    return total;
  }

  /** Human-readable breakdown of the modifier (for the chat card). */
  _modifierBreakdown() {
    const lines = [];
    for (const m of MODIFIERS) {
      const count = this.selection.mods[m.key] ?? 0;
      if (count === 0) continue;
      const contribution = m.sign * MOD_STEP * count;
      lines.push({
        label: game.i18n.localize(m.labelKey),
        count,
        contribution,
      });
    }
    const other = this.selection.mods.other ?? 0;
    if (other !== 0) {
      lines.push({ label: game.i18n.localize("SWFFG.CriticalRoller.Mod.Other"), count: null, contribution: other });
    }
    return lines;
  }

  /* -------------------------------------------- */
  /*  Listeners                                   */
  /* -------------------------------------------- */

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];

    // Switching the critical type re-renders so the source list (folders/packs) refreshes.
    html.find('[name="critType"]').on("change", async (ev) => {
      this._readForm(html);
      this.critType = ev.currentTarget.value;
      await game.user.setFlag("starwarsffg", "criticalRollerType", this.critType);
      this.render(true);
    });

    // Live-update the modifier total readout as the user types.
    const refreshTotal = () => {
      this._readForm(html);
      const total = this._computeTotalModifier();
      const out = root.querySelector(".crit-total-value");
      if (out) {
        const sign = total > 0 ? "+" : "";
        out.textContent = `${sign}${total}`;
        out.classList.toggle("positive", total > 0);
        out.classList.toggle("negative", total < 0);
      }
    };
    html.find('input[type="number"]').on("input change", refreshTotal);

    html.find(".crit-roll-button").on("click", async (ev) => {
      ev.preventDefault();
      this._readForm(html);
      await this._onRoll();
    });
  }

  /** @override */
  async _updateObject() {} // rolling is handled by the explicit Roll button

  /* -------------------------------------------- */
  /*  Rolling                                     */
  /* -------------------------------------------- */

  async _onRoll() {
    const pool = this._resolvePool(this.critType);
    if (!pool.length) {
      ui.notifications.warn(game.i18n.localize("SWFFG.CriticalRoller.NoCriticals"));
      return;
    }

    const modifier = this._computeTotalModifier();
    const breakdown = this._modifierBreakdown();
    const rollCount = this.selection.twice ? 2 : 1;

    const results = [];
    for (let i = 0; i < rollCount; i++) {
      const formula = modifier === 0 ? "1d100" : `1d100 ${modifier > 0 ? "+" : "-"} ${Math.abs(modifier)}`;
      const roll = new Roll(formula);
      await roll.evaluate();
      const die = roll.dice?.[0]?.total ?? roll.total - modifier;
      const critical = CriticalRollerFFG.resolveCritical(pool, roll.total);
      results.push({ roll, die, total: roll.total, critical });
    }

    await CriticalRollerFFG.postResults({
      critType: this.critType,
      modifier,
      breakdown,
      results,
    });
  }

  /**
   * Match a (possibly modified) d100 total to a critical in the pool.
   * Over the top of the table -> most severe entry; below the table -> least severe.
   */
  static resolveCritical(pool, total) {
    let match = pool.find((i) => total >= (i.system.min ?? 0) && total <= (i.system.max ?? 0));
    if (match) return match;

    const asc = [...pool].sort((a, b) => (a.system.min ?? 0) - (b.system.min ?? 0));
    if (total < (asc[0].system.min ?? 0)) return asc[0];
    // Above a range / in a gap: take the highest range whose min is at or below the total,
    // falling back to the most severe (last) entry.
    const atOrBelow = asc.filter((i) => (i.system.min ?? 0) <= total);
    return atOrBelow.length ? atOrBelow[atOrBelow.length - 1] : asc[asc.length - 1];
  }

  /* -------------------------------------------- */
  /*  Chat output                                 */
  /* -------------------------------------------- */

  /** Build the inner HTML describing a single matched critical. */
  static async _renderCriticalBlock(critType, critical, rollInfo) {
    const severity = Math.max(0, Math.min(5, parseInt(critical.system.severity, 10) || 0));
    const severitySymbols = severity > 0 ? "[DI]".repeat(severity) : "";
    const description = await foundry.applications.ux.TextEditor.enrichHTML(critical.system.description || "");
    const uuid = critical.uuid;

    let rollLine = "";
    if (rollInfo) {
      if (rollInfo.modifier === 0) {
        rollLine = game.i18n.format("SWFFG.CriticalRoller.Card.RollSimple", { die: rollInfo.die });
      } else {
        const sign = rollInfo.modifier > 0 ? "+" : "-";
        rollLine = game.i18n.format("SWFFG.CriticalRoller.Card.RollModified", {
          die: rollInfo.die,
          sign,
          mod: Math.abs(rollInfo.modifier),
          total: rollInfo.total,
        });
      }
    }

    return `
      <div class="ffg-crit-result">
        ${rollLine ? `<div class="crit-roll-line">${rollLine}</div>` : ""}
        <div class="crit-name">
          <img class="crit-icon" src="${critical.img}" alt="${critical.name}" />
          <span class="crit-title">@UUID[${uuid}]{${critical.name}}</span>
        </div>
        <div class="crit-meta">
          <span class="crit-range">${game.i18n.localize("SWFFG.CriticalRoller.Card.Range")}: ${critical.system.min}-${critical.system.max}</span>
          ${severity > 0 ? `<span class="crit-severity">${game.i18n.localize("SWFFG.Severity")}: ${severitySymbols}</span>` : ""}
        </div>
        <div class="crit-description">${description}</div>
      </div>`;
  }

  /** Modifier breakdown block shared by single and double rolls. */
  static _renderBreakdown(breakdown, modifier) {
    if (!breakdown.length) return "";
    const rows = breakdown
      .map((b) => {
        const sign = b.contribution > 0 ? "+" : "";
        const label = b.count !== null ? `${b.label} (${b.count})` : b.label;
        return `<div class="crit-mod-row"><span>${label}</span><span>${sign}${b.contribution}</span></div>`;
      })
      .join("");
    const sign = modifier > 0 ? "+" : "";
    return `
      <details class="crit-breakdown">
        <summary>${game.i18n.localize("SWFFG.CriticalRoller.Card.Modifiers")}: ${sign}${modifier}</summary>
        ${rows}
      </details>`;
  }

  static async postResults({ critType, modifier, breakdown, results }) {
    const typeLabel = game.i18n.localize(CRIT_TYPES[critType].titleKey);
    const icon = CRIT_TYPES[critType].icon;
    const breakdownHtml = CriticalRollerFFG._renderBreakdown(breakdown, modifier);

    let body = "";
    const flagChoices = [];

    if (results.length === 1) {
      const r = results[0];
      body = await CriticalRollerFFG._renderCriticalBlock(critType, r.critical, {
        die: r.die,
        modifier,
        total: r.total,
      });
    } else {
      // Roll-twice-and-choose: show both, with a button to confirm the pick.
      const blocks = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const block = await CriticalRollerFFG._renderCriticalBlock(critType, r.critical, {
          die: r.die,
          modifier,
          total: r.total,
        });
        blocks.push(`
          <div class="crit-option" data-choice-index="${i}">
            <div class="crit-option-header">${game.i18n.format("SWFFG.CriticalRoller.Card.Option", { n: i + 1 })}</div>
            ${block}
            <button type="button" class="crit-choose" data-choice-index="${i}">
              <i class="fa-solid fa-circle-check"></i> ${game.i18n.localize("SWFFG.CriticalRoller.Card.Choose")}
            </button>
          </div>`);
        flagChoices.push({
          uuid: r.critical.uuid,
          name: r.critical.name,
          img: r.critical.img,
          min: r.critical.system.min,
          max: r.critical.system.max,
          severity: r.critical.system.severity,
          description: r.critical.system.description,
          die: r.die,
          total: r.total,
        });
      }
      body = `<div class="crit-options crit-twice">${blocks.join("")}</div>
        <p class="crit-choose-hint">${game.i18n.localize("SWFFG.CriticalRoller.Card.ChooseHint")}</p>`;
    }

    const content = `
      <div class="starwarsffg ffg-critical-card">
        <header class="crit-card-header"><i class="${icon}"></i> ${typeLabel}</header>
        ${breakdownHtml}
        ${body}
      </div>`;

    const rollMode = game.settings.get("core", "rollMode");
    // Resolve rollMode into whisper/blind targets for both the dice animation and the card.
    let whisper = null;
    let blind = false;
    if (rollMode === "gmroll" || rollMode === "blindroll") {
      whisper = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
      blind = rollMode === "blindroll";
    } else if (rollMode === "selfroll") {
      whisper = [game.user.id];
    }

    // Animate the percentile dice via Dice So Nice if present. The raw Roll is intentionally
    // NOT attached to the chat message: some FFG add-on modules iterate message.rolls and read
    // an `.ffg` narrative-result object that a plain 1d100 roll does not have, which would throw.
    if (game.dice3d) {
      for (const r of results) {
        try {
          await game.dice3d.showForRoll(r.roll, game.user, true, whisper, blind);
        } catch (err) {
          CONFIG.logger?.warn?.(`Critical roller dice animation failed: ${err}`);
        }
      }
    }

    const messageData = {
      user: game.user.id,
      speaker: { alias: game.i18n.localize("SWFFG.CriticalRoller.Speaker") },
      content,
      // Only play the fallback dice sound when Dice So Nice isn't handling it.
      sound: game.dice3d ? null : CONFIG.sounds.dice,
      flags: {
        starwarsffg: {
          criticalRoller: {
            critType,
            modifier,
            choices: flagChoices,
          },
        },
      },
    };
    ChatMessage.applyRollMode(messageData, rollMode);
    await ChatMessage.create(messageData);
  }

  /* -------------------------------------------- */
  /*  Chat interactivity (choose one of two)      */
  /* -------------------------------------------- */

  static registerChatListeners() {
    Hooks.on("renderChatMessage", (message, html) => {
      const data = message.flags?.starwarsffg?.criticalRoller;
      if (!data?.choices?.length) return;
      const $html = html instanceof jQuery ? html : $(html);
      // Delegate from the message root so the binding survives the system's chat-content
      // rewrite (renderDiceImages replaces .message-content innerHTML on render).
      $html.off("click.ffgCritChoose").on("click.ffgCritChoose", ".crit-choose", async (ev) => {
        ev.preventDefault();
        const idx = parseInt(ev.currentTarget.dataset.choiceIndex, 10);
        const choice = data.choices[idx];
        if (!choice) return;
        await CriticalRollerFFG._postChosen(data.critType, data.modifier, choice);
      });
    });
  }

  /** Post a clean confirmation card for the option the controller picked. */
  static async _postChosen(critType, modifier, choice) {
    const typeLabel = game.i18n.localize(CRIT_TYPES[critType].titleKey);
    const icon = CRIT_TYPES[critType].icon;
    const severity = Math.max(0, Math.min(5, parseInt(choice.severity, 10) || 0));
    const severitySymbols = severity > 0 ? "[DI]".repeat(severity) : "";
    const description = await foundry.applications.ux.TextEditor.enrichHTML(choice.description || "");

    let rollLine;
    if (modifier === 0) {
      rollLine = game.i18n.format("SWFFG.CriticalRoller.Card.RollSimple", { die: choice.die });
    } else {
      const sign = modifier > 0 ? "+" : "-";
      rollLine = game.i18n.format("SWFFG.CriticalRoller.Card.RollModified", {
        die: choice.die,
        sign,
        mod: Math.abs(modifier),
        total: choice.total,
      });
    }

    const content = `
      <div class="starwarsffg ffg-critical-card">
        <header class="crit-card-header"><i class="${icon}"></i> ${typeLabel} — ${game.i18n.localize("SWFFG.CriticalRoller.Card.Chosen")}</header>
        <div class="ffg-crit-result">
          <div class="crit-roll-line">${rollLine}</div>
          <div class="crit-name">
            <img class="crit-icon" src="${choice.img}" alt="${choice.name}" />
            <span class="crit-title">@UUID[${choice.uuid}]{${choice.name}}</span>
          </div>
          <div class="crit-meta">
            <span class="crit-range">${game.i18n.localize("SWFFG.CriticalRoller.Card.Range")}: ${choice.min}-${choice.max}</span>
            ${severity > 0 ? `<span class="crit-severity">${game.i18n.localize("SWFFG.Severity")}: ${severitySymbols}</span>` : ""}
          </div>
          <div class="crit-description">${description}</div>
        </div>
      </div>`;

    const rollMode = game.settings.get("core", "rollMode");
    const messageData = {
      user: game.user.id,
      speaker: { alias: game.i18n.localize("SWFFG.CriticalRoller.Speaker") },
      content,
    };
    ChatMessage.applyRollMode(messageData, rollMode);
    await ChatMessage.create(messageData);
  }
}
