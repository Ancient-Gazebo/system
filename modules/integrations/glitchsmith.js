/**
 * GlitchSmith Library integration.
 *
 * Registers the Star Wars FFG currency (Glass, plus any GM-added denominations) with the
 * GlitchSmith Library (`glitchsmith-lib`) so its modules (Stylish Shop, Smartphone Widget, etc.)
 * treat it as a native SHEET currency rather than requiring virtual currencies.
 *
 * How it works:
 *   - GlitchSmith fires `glitchsmith-lib.registerSystemPresets` during its init hook with a
 *     { register(systemId, preset) } callback. We register a preset describing our currency,
 *     mapped to the actor data path `system.currency.<id>`.
 *   - GlitchSmith's built-in "path driver" reads that path with foundry.utils.getProperty and
 *     writes it with actor.update({ "system.currency.<id>": value }). Because our currency is a
 *     plain integer at that path, no custom sheet-currency driver is needed.
 *
 * This is a soft dependency: if GlitchSmith is not installed the hooks simply never fire, so these
 * listeners cost nothing and never error.
 *
 * Preset / currency field mapping (FFG -> GlitchSmith):
 *   id          <- currency key (e.g. "glass")
 *   name        <- localized label
 *   symbol      <- localized abbreviation
 *   rate        <- value relative to the base (least-valuable) unit; derived from our `conversion`
 *   actorPath   <- "system.currency.<id>"
 *   primary     <- true for the default currency
 *   type        <- "sheet"
 *   integer     <- true (our currencies are whole-number)
 *   precision   <- 0
 *
 * Stylish Shop item quantity:
 *   Stylish Shop reads and writes item quantity at a per-system path that defaults to
 *   `system.quantity`. Ours is a { value, type } object, so the shop overwrote it with the bought
 *   count, the DataModel cast that number back to an empty object, and every multi-unit purchase
 *   arrived as a single item. The shop has no API for the path, only a world setting keyed by
 *   system id, so the active GM seeds it with `system.quantity.value` (see seedStylishShopQuantityPath).
 */

import { currencies as defaultCurrencies, defaultCurrency as shippedDefault } from "../config/ffg-currency.js";

const GLITCHSMITH_ID = "glitchsmith-lib";
const STYLISH_SHOP_ID = "stylish-shop";
const STYLISH_SHOP_QUANTITY_PATHS = "itemQuantityPaths";
const FFG_ITEM_QUANTITY_PATH = "system.quantity.value";

/**
 * Resolve the currency configuration to advertise. Prefers the GM-edited world setting, then the
 * live CONFIG.FFG config, then the shipped default. Wrapped in try/catch because, depending on
 * module/system init ordering, the world setting may not be registered yet when GlitchSmith fires
 * its registration hook.
 * @returns {{config: Object, defaultKey: string}}
 */
function resolveCurrencyConfig() {
  let config;
  try {
    const stored = game.settings.get("starwarsffg", "currencies");
    if (stored && !foundry.utils.isEmpty(stored)) config = stored;
  } catch (e) {
    /* setting not registered yet; fall through */
  }
  if (!config || foundry.utils.isEmpty(config)) {
    config = (CONFIG.FFG?.currencies && !foundry.utils.isEmpty(CONFIG.FFG.currencies))
      ? CONFIG.FFG.currencies
      : defaultCurrencies;
  }

  let defaultKey;
  try {
    defaultKey = game.settings.get("starwarsffg", "defaultCurrency");
  } catch (e) {
    /* ignore */
  }
  if (!defaultKey || !(defaultKey in config)) {
    defaultKey = (CONFIG.FFG?.defaultCurrency in config) ? CONFIG.FFG.defaultCurrency : shippedDefault;
  }
  if (!(defaultKey in config)) defaultKey = Object.keys(config)[0];

  return { config, defaultKey };
}

/**
 * Localize an i18n key, falling back to the literal string (so GM-entered custom labels pass
 * through unchanged).
 * @param {string} key
 * @returns {string}
 */
function localizeOrLiteral(key) {
  if (!key) return "";
  return game.i18n?.has?.(key) ? game.i18n.localize(key) : key;
}

/**
 * Build a GlitchSmith system preset from the FFG currency configuration.
 * @returns {{base: string, currencies: Object}}
 */
export function buildGlitchSmithPreset() {
  const { config, defaultKey } = resolveCurrencyConfig();
  const entries = Object.entries(config);

  // GlitchSmith `rate` is "how many base units this denomination is worth", with the base (least
  // valuable) unit at rate 1. Our `conversion` is "how many of this equal one default-currency
  // unit" (larger conversion => less valuable). The least-valuable unit therefore has the largest
  // conversion and becomes the base.
  const conversions = entries.map(([, c]) => Number(c.conversion) > 0 ? Number(c.conversion) : 1);
  const maxConversion = Math.max(...conversions, 1);
  let baseId = entries[0]?.[0];
  let baseConv = -Infinity;
  for (const [key, c] of entries) {
    const conv = Number(c.conversion) > 0 ? Number(c.conversion) : 1;
    if (conv > baseConv) { baseConv = conv; baseId = key; }
  }

  const currencies = {};
  for (const [key, c] of entries) {
    const conv = Number(c.conversion) > 0 ? Number(c.conversion) : 1;
    currencies[key] = {
      name: localizeOrLiteral(c.label || key),
      symbol: localizeOrLiteral(c.abbreviation || ""),
      rate: maxConversion / conv,
      type: "sheet",
      actorPath: `system.currency.${key}`,
      primary: key === defaultKey,
      icon: typeof c.icon === "string" ? c.icon : "",
      integer: true,
      precision: 0,
    };
  }

  return { base: baseId, currencies };
}

/**
 * Point Stylish Shop's item quantity path for this system at `system.quantity.value`. Only an unset
 * entry or the module's own default (`system.quantity`, which can never work here) is replaced, so a
 * path a GM chose in the shop's settings is left alone.
 * @returns {Promise<boolean>} true when the setting was written
 */
export async function seedStylishShopQuantityPath() {
  if (!game.modules.get(STYLISH_SHOP_ID)?.active) return false;
  if (!game.users.activeGM?.isSelf) return false;
  if (!game.settings.settings.has(`${STYLISH_SHOP_ID}.${STYLISH_SHOP_QUANTITY_PATHS}`)) return false;

  const stored = game.settings.get(STYLISH_SHOP_ID, STYLISH_SHOP_QUANTITY_PATHS);
  const paths = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  const systemId = game.system.id;
  const current = typeof paths[systemId] === "string" ? paths[systemId].trim() : "";
  if (current && current !== "system.quantity") return false;

  await game.settings.set(STYLISH_SHOP_ID, STYLISH_SHOP_QUANTITY_PATHS, { ...paths, [systemId]: FFG_ITEM_QUANTITY_PATH });
  CONFIG.logger?.log?.(`Set Stylish Shop's item quantity path to ${FFG_ITEM_QUANTITY_PATH}.`);
  return true;
}

/**
 * Register the init-time hook listeners that hand our preset to GlitchSmith. Must run before
 * GlitchSmith's own init hook fires; calling this at the top of the system's init hook satisfies
 * that (systems initialize before modules).
 */
export function registerGlitchSmithIntegration() {
  // Primary mechanism: respond to GlitchSmith's preset-registration hook.
  Hooks.on(`${GLITCHSMITH_ID}.registerSystemPresets`, ({ register }) => {
    try {
      register("starwarsffg", buildGlitchSmithPreset());
      CONFIG.logger?.log?.("Registered Star Wars FFG currency preset with GlitchSmith Library.");
    } catch (e) {
      CONFIG.logger?.warn?.(`Failed to register currency preset with GlitchSmith Library: ${e}`);
    }
  });

  // Fallback: if GlitchSmith is already initialized (e.g. this system reloads its config after
  // GlitchSmith's init has passed), register directly against its public API at our ready hook.
  Hooks.once("ready", () => {
    const gs = game.modules.get(GLITCHSMITH_ID);
    if (!gs?.active || !gs.api?.currency?.registerSystemPreset) return;
    if (gs.api.currency.getSystemPreset?.("starwarsffg")) return; // already registered via the hook
    try {
      gs.api.currency.registerSystemPreset("starwarsffg", buildGlitchSmithPreset());
      CONFIG.logger?.log?.("Registered Star Wars FFG currency preset with GlitchSmith Library (ready fallback).");
    } catch (e) {
      CONFIG.logger?.warn?.(`GlitchSmith ready-fallback registration failed: ${e}`);
    }
  });

  Hooks.once("ready", () => {
    seedStylishShopQuantityPath().catch((e) => {
      CONFIG.logger?.warn?.(`Failed to set Stylish Shop's item quantity path: ${e}`);
    });
  });
}
