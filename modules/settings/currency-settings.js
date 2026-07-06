import { currencies as defaultCurrencies, defaultCurrency } from "../config/ffg-currency.js";

/**
 * Settings menu for configuring the currency denominations available in the world.
 * Mirrors LanguageSettings: an editable list backed by the world setting "currencies".
 * Each row defines a denomination key, display label, abbreviation, and conversion rate (how many
 * of that denomination equal one unit of the default currency).
 */
export default class CurrencySettings extends FormApplication {
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "ffg-currency-settings",
      classes: ["starwarsffg", "data-import"],
      title: `${game.i18n.localize("SWFFG.Currency.Settings.Title")}`,
      height: 480,
      width: 480,
      resizable: true,
      template: "systems/starwarsffg/templates/dialogs/currency-settings.html",
    });
  }

  getData(options) {
    const stored = game.settings.get("starwarsffg", "currencies") || {};
    const config = foundry.utils.isEmpty(stored) ? defaultCurrencies : stored;
    const defaultKey = game.settings.get("starwarsffg", "defaultCurrency") || defaultCurrency;
    // Convert the keyed object into an ordered array of rows for the form.
    const rows = Object.entries(config).map(([key, cfg]) => ({
      key,
      // Resolve i18n keys to readable text for editing; literal labels pass through unchanged.
      label: game.i18n.has(cfg.label) ? game.i18n.localize(cfg.label) : cfg.label || key,
      abbreviation: game.i18n.has(cfg.abbreviation)
        ? game.i18n.localize(cfg.abbreviation)
        : cfg.abbreviation || "",
      conversion: cfg.conversion ?? 1,
      isDefault: key === defaultKey,
    }));
    return {
      systemTitle: game.system.title,
      currencies: rows,
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find('button[name="reset"]').click(this._onResetDefaults.bind(this));
  }

  /**
   * Reset the currency configuration back to the system default (single "glass" denomination).
   * @param {Event} event
   * @private
   */
  async _onResetDefaults(event) {
    event.preventDefault();
    const defaults = game.settings.settings.get("starwarsffg.currencies").default;
    await game.settings.set("starwarsffg", "currencies", defaults);
    await game.settings.set("starwarsffg", "defaultCurrency", defaultCurrency);
    this.close();
    this._reload();
  }

  /** @override */
  async _updateObject(event, formData) {
    // Each row contributes parallel arrays of key/label/abbreviation/conversion plus a single
    // "defaultKey" radio. Normalize single-row (scalar) values into arrays first.
    const toArray = (v) => (typeof v === "undefined" ? [] : Array.isArray(v) ? v : [v]);
    const keys = toArray(formData["currency_key"]);
    const labels = toArray(formData["currency_label"]);
    const abbrs = toArray(formData["currency_abbr"]);
    const conversions = toArray(formData["currency_conversion"]);
    const defaultKeyRaw = (formData["defaultKey"] ?? "").toString().trim();

    const seen = new Set();
    const currencies = {};
    for (let i = 0; i < keys.length; i++) {
      // Sanitize the key: lowercase, strip anything but a-z0-9_ (it becomes an object key and a
      // form-input path segment, so it must be safe).
      let key = (keys[i] ?? "").toString().trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      const conversion = Number(conversions[i]);
      currencies[key] = {
        label: (labels[i] ?? "").toString().trim() || key,
        abbreviation: (abbrs[i] ?? "").toString().trim(),
        conversion: Number.isFinite(conversion) && conversion > 0 ? conversion : 1,
        icon: "",
      };
    }

    // Never allow an empty currency list; fall back to the system default.
    if (foundry.utils.isEmpty(currencies)) {
      await game.settings.set("starwarsffg", "currencies", defaultCurrencies);
      await game.settings.set("starwarsffg", "defaultCurrency", defaultCurrency);
      this._reload();
      return;
    }

    // Resolve the default currency: chosen key if still present, else the first row.
    const keysList = Object.keys(currencies);
    const resolvedDefault = keysList.includes(defaultKeyRaw) ? defaultKeyRaw : keysList[0];

    await game.settings.set("starwarsffg", "currencies", currencies);
    await game.settings.set("starwarsffg", "defaultCurrency", resolvedDefault);
    this._reload();
  }

  /**
   * Currency config is read into CONFIG.FFG at init, so a reload is the clean way to apply changes
   * everywhere (sheets, the manager, other modules). Prompt rather than forcing it.
   * @private
   */
  _reload() {
    Dialog.confirm({
      title: game.i18n.localize("SWFFG.Currency.Settings.Reload.Title"),
      content: `<p>${game.i18n.localize("SWFFG.Currency.Settings.Reload.Content")}</p>`,
      yes: () => foundry.utils.debouncedReload(),
      no: () => {},
      defaultYes: true,
    });
  }
}
