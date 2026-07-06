/**
 * Currency configuration for the Star Wars FFG system.
 *
 * Modeled on `CONFIG.DND5E.currencies`: an object mapping a denomination key to a definition.
 * Each definition carries a localizable `label`, a short `abbreviation`, a `conversion` rate
 * (how many of that denomination equal ONE unit of the default currency), and an optional `icon`.
 *
 * The system ships with a single denomination ("glass"), but the structure supports any number of
 * denominations. The live config is `CONFIG.FFG.currencies`; modules may read or extend it, and the
 * GM may edit it via the Currency settings menu (stored in the world setting "currencies").
 *
 * @enum {{label: string, abbreviation: string, conversion: number, icon: string}}
 */
export const currencies = {
  glass: {
    label: "SWFFG.Currency.Glass.Label",
    abbreviation: "SWFFG.Currency.Glass.Abbr",
    // conversion is relative to the default currency. The default is always 1.
    conversion: 1,
    icon: "",
  },
};

/**
 * The default currency. Used for data-model defaults and as the base unit for conversions.
 * @type {string}
 */
export const defaultCurrency = "glass";
