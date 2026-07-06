/**
 * CurrencyManager
 *
 * A referenceable currency API for the Star Wars FFG system, modeled on the dnd5e CurrencyManager.
 * Other modules can call these static methods to read and modify the money held by an Actor without
 * needing to know the underlying data path.
 *
 * Data shape (per Actor):  actor.system.currency = { glass: 0, ... }
 * Config:                  CONFIG.FFG.currencies = { glass: { label, abbreviation, conversion, icon }, ... }
 *                          CONFIG.FFG.defaultCurrency = "glass"
 *
 * Every mutation routes through Actor#update and emits the "starwarsffgCurrencyChanged" hook:
 *   Hooks.on("starwarsffgCurrencyChanged", (actor, { denomination, previous, current, delta }) => { ... });
 *
 * Example (from another module):
 *   const cm = game.ffg.CurrencyManager;
 *   if (cm.canAfford(actor, 250)) await cm.deduct(actor, 250);   // spend 250 of the default currency
 *   await cm.add(actor, 1000);                                   // grant 1000
 *   const total = cm.totalValue(actor);                          // total worth in default-currency units
 */
export default class CurrencyManager {
  /* -------------------------------------------- */
  /*  Configuration helpers                       */
  /* -------------------------------------------- */

  /**
   * The live currency configuration.
   * @returns {Object<string, {label: string, abbreviation: string, conversion: number, icon: string}>}
   */
  static get currencies() {
    return CONFIG.FFG?.currencies ?? {};
  }

  /**
   * The key of the default (base) currency.
   * @returns {string}
   */
  static get defaultCurrency() {
    const cfg = CONFIG.FFG?.currencies ?? {};
    const def = CONFIG.FFG?.defaultCurrency;
    if (def && def in cfg) return def;
    // Fall back to the first configured currency if the configured default is missing.
    return Object.keys(cfg)[0];
  }

  /**
   * Resolve a denomination argument to a valid configured key, defaulting to the base currency.
   * @param {string} [denomination]
   * @returns {string|undefined}
   */
  static resolveDenomination(denomination) {
    const cfg = this.currencies;
    if (denomination && denomination in cfg) return denomination;
    return this.defaultCurrency;
  }

  /* -------------------------------------------- */
  /*  Reads                                       */
  /* -------------------------------------------- */

  /**
   * Get the full currency object for an actor, with every configured denomination present (0 default).
   * @param {Actor} actor
   * @returns {Object<string, number>}
   */
  static getCurrencies(actor) {
    const stored = actor?.system?.currency ?? {};
    const out = {};
    for (const key of Object.keys(this.currencies)) {
      out[key] = Number(stored[key]) || 0;
    }
    return out;
  }

  /**
   * Get the balance of a single denomination (default currency if none supplied).
   * @param {Actor} actor
   * @param {string} [denomination]
   * @returns {number}
   */
  static getBalance(actor, denomination) {
    const denom = this.resolveDenomination(denomination);
    return Number(actor?.system?.currency?.[denom]) || 0;
  }

  /**
   * Whether the actor can afford a cost in the given denomination, accounting for change made from
   * other denominations (see convertCurrencyToBase).
   * @param {Actor} actor
   * @param {number} amount
   * @param {string} [denomination]
   * @returns {boolean}
   */
  static canAfford(actor, amount, denomination) {
    if (!(amount > 0)) return true;
    const denom = this.resolveDenomination(denomination);
    const baseConversion = this.currencies[denom]?.conversion ?? 1;
    // Total worth expressed in the requested denomination's units.
    const totalInBase = this.totalValue(actor);
    const totalInDenom = totalInBase * baseConversion;
    return totalInDenom + 1e-9 >= amount;
  }

  /**
   * Total worth of all currency the actor holds, expressed in default-currency units.
   * @param {Actor} actor
   * @returns {number}
   */
  static totalValue(actor) {
    const currencies = this.getCurrencies(actor);
    let total = 0;
    for (const [denom, value] of Object.entries(currencies)) {
      const conversion = this.currencies[denom]?.conversion || 1;
      total += value / conversion;
    }
    return total;
  }

  /* -------------------------------------------- */
  /*  Mutations                                   */
  /* -------------------------------------------- */

  /**
   * Set a denomination to an exact integer value.
   * @param {Actor} actor
   * @param {number} amount         New value (clamped to >= 0 unless allowNegative).
   * @param {string} [denomination]
   * @param {object} [options]
   * @param {boolean} [options.allowNegative=false]
   * @returns {Promise<Actor>}
   */
  static async set(actor, amount, denomination, { allowNegative = false } = {}) {
    const denom = this.resolveDenomination(denomination);
    if (!denom) throw new Error("No currency denomination is configured.");
    let next = Math.trunc(Number(amount) || 0);
    if (!allowNegative) next = Math.max(0, next);
    const previous = this.getBalance(actor, denom);
    await actor.update({ [`system.currency.${denom}`]: next });
    this._notify(actor, denom, previous, next);
    return actor;
  }

  /**
   * Add currency to an actor.
   * @param {Actor} actor
   * @param {number} amount         Positive amount to add.
   * @param {string} [denomination]
   * @returns {Promise<Actor>|void}
   */
  static async add(actor, amount, denomination) {
    const value = Math.trunc(Number(amount) || 0);
    if (value === 0) return;
    const denom = this.resolveDenomination(denomination);
    const next = this.getBalance(actor, denom) + value;
    return this.set(actor, next, denom, { allowNegative: true });
  }

  /**
   * Deduct currency from an actor. Mirrors dnd5e behaviour: throws on insufficient funds unless
   * `allowNegative` is set. With multiple denominations and `makeChange`, larger denominations are
   * broken down into the requested one to cover the cost.
   * @param {Actor} actor
   * @param {number} amount
   * @param {string} [denomination]
   * @param {object} [options]
   * @param {boolean} [options.makeChange=true]    Break larger denominations to cover the cost.
   * @param {boolean} [options.allowNegative=false] Permit the balance to go below zero instead of throwing.
   * @returns {Promise<Actor>|void}
   */
  static async deduct(actor, amount, denomination, { makeChange = true, allowNegative = false } = {}) {
    const value = Math.trunc(Number(amount) || 0);
    if (value <= 0) return;
    const denom = this.resolveDenomination(denomination);

    const balance = this.getBalance(actor, denom);

    // Simple, single-denomination case (or no change-making requested).
    if (!makeChange || Object.keys(this.currencies).length === 1) {
      if (balance < value && !allowNegative) {
        throw new Error(
          game.i18n.format("SWFFG.Currency.Error.InsufficientFunds", {
            name: actor.name,
            amount: this.format(value, denom),
          })
        );
      }
      return this.set(actor, balance - value, denom, { allowNegative });
    }

    // Multi-denomination case: settle the bill in base-currency units, then redistribute.
    const baseConversion = this.currencies[denom]?.conversion ?? 1;
    const costInBase = value / baseConversion;
    if (this.totalValue(actor) + 1e-9 < costInBase && !allowNegative) {
      throw new Error(
        game.i18n.format("SWFFG.Currency.Error.InsufficientFunds", {
          name: actor.name,
          amount: this.format(value, denom),
        })
      );
    }

    // Take from the requested denomination first, then make change from the rest (largest first).
    const currencies = this.getCurrencies(actor);
    let remainingInBase = costInBase;

    const fromDenom = Math.min(currencies[denom], value);
    currencies[denom] -= fromDenom;
    remainingInBase -= fromDenom / baseConversion;

    const others = Object.entries(this.currencies)
      .filter(([k]) => k !== denom)
      .sort(([, a], [, b]) => (a.conversion || 1) - (b.conversion || 1)); // largest worth first

    for (const [k, cfg] of others) {
      if (remainingInBase <= 1e-9) break;
      const conv = cfg.conversion || 1;
      const haveInBase = currencies[k] / conv;
      const takeInBase = Math.min(haveInBase, remainingInBase);
      const takeUnits = Math.ceil(takeInBase * conv);
      currencies[k] -= takeUnits;
      remainingInBase -= takeUnits / conv;
    }

    // Any over-payment (from rounding up when breaking a larger denomination) returns as change in
    // the requested denomination.
    if (remainingInBase < -1e-9) {
      currencies[denom] += Math.round(-remainingInBase * baseConversion);
      remainingInBase = 0;
    }

    if (!allowNegative) {
      for (const k of Object.keys(currencies)) currencies[k] = Math.max(0, currencies[k]);
    }

    const previous = this.getBalance(actor, denom);
    await actor.update({ system: { currency: currencies } });
    this._notify(actor, denom, previous, currencies[denom]);
    return actor;
  }

  /**
   * Transfer currency from one actor to another.
   * @param {Actor} origin
   * @param {Actor} destination
   * @param {number} amount
   * @param {string} [denomination]
   * @returns {Promise<void>}
   */
  static async transfer(origin, destination, amount, denomination) {
    const value = Math.trunc(Number(amount) || 0);
    if (value <= 0) return;
    const denom = this.resolveDenomination(denomination);
    // Deduct first (this throws if the origin cannot pay), then credit the destination.
    await this.deduct(origin, value, denom);
    await this.add(destination, value, denom);
  }

  /**
   * Collapse an actor's holdings into the highest possible denominations using configured conversion
   * rates. No-op for a single-denomination configuration.
   * @param {Actor} actor
   * @returns {Promise<Actor>|void}
   */
  static async convert(actor) {
    const entries = Object.entries(this.currencies)
      .filter(([, c]) => c.conversion)
      .sort((a, b) => a[1].conversion - b[1].conversion); // highest worth (smallest conversion) first
    if (entries.length <= 1) return;

    const currency = this.getCurrencies(actor);
    const smallestConversion = entries.at(-1)[1].conversion;

    // Reduce everything to the smallest denomination's units.
    let amount = entries.reduce(
      (sum, [denom, cfg]) => sum + currency[denom] * (smallestConversion / cfg.conversion),
      0
    );

    // Re-distribute into the largest denominations possible.
    for (const [denom, cfg] of entries) {
      const ratio = smallestConversion / cfg.conversion;
      currency[denom] = Math.floor(amount / ratio);
      amount -= currency[denom] * ratio;
    }

    await actor.update({ system: { currency } });
    return actor;
  }

  /* -------------------------------------------- */
  /*  Formatting                                  */
  /* -------------------------------------------- */

  /**
   * Format an amount with its denomination label, using grouping separators.
   * @param {number} amount
   * @param {string} [denomination]
   * @returns {string}
   */
  static format(amount, denomination) {
    const denom = this.resolveDenomination(denomination);
    const value = Number(amount) || 0;
    let formatted;
    try {
      formatted = new Intl.NumberFormat(game.i18n?.lang || "en").format(value);
    } catch (e) {
      formatted = String(value);
    }
    return `${formatted} ${this.label(denom)}`;
  }

  /**
   * The localized label for a denomination. Falls back to the raw label string (so custom,
   * GM-renamed currencies that store a literal name still display correctly).
   * @param {string} [denomination]
   * @returns {string}
   */
  static label(denomination) {
    const denom = this.resolveDenomination(denomination);
    const raw = this.currencies[denom]?.label || denom || "";
    return game.i18n?.has?.(raw) ? game.i18n.localize(raw) : raw;
  }

  /* -------------------------------------------- */
  /*  Internal                                    */
  /* -------------------------------------------- */

  /**
   * Emit the currency-changed hook.
   * @param {Actor} actor
   * @param {string} denomination
   * @param {number} previous
   * @param {number} current
   * @private
   */
  static _notify(actor, denomination, previous, current) {
    if (previous === current) return;
    Hooks.callAll("starwarsffgCurrencyChanged", actor, {
      denomination,
      previous,
      current,
      delta: current - previous,
    });
  }
}
