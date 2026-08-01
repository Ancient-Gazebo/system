/**
 * Settings menu for configuring the master list of languages that can be added to actor sheets.
 * Mirrors CrewSettings: a simple editable list of names backed by the world setting "arrayLanguages".
 */
import { FFGFormApplication } from "../apps/ffg-form-application.js";

export default class LanguageSettings extends FFGFormApplication {
  static DEFAULT_OPTIONS = {
    id: "ffg-language-settings",
    classes: ["starwarsffg", "data-import"],
    window: {
      title: "SWFFG.Languages.Settings.Title",
      resizable: true,
    },
    position: {
      width: 350,
      height: 400,
    },
    form: {
      // V1 FormApplication closed on submit by default; keep that behavior.
      closeOnSubmit: true,
    },
  };

  static PARTS = {
    content: {
      root: true,
      template: "systems/starwarsffg/templates/dialogs/language-settings.html",
    },
  };

  async _prepareContext(_options) {
    const languages = game.settings.get("starwarsffg", "arrayLanguages") || [];
    return {
      systemTitle: game.system.title,
      languages: Array.isArray(languages) ? languages : [],
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const html = $(this.element);
    html.find('button[name="reset"]').click(this._onResetDefaults.bind(this));
  }

  /**
   * Reset the language list back to the system default.
   * @param event {Event}
   * @private
   */
  _onResetDefaults(event) {
    event.preventDefault();
    const defaults = game.settings.settings.get("starwarsffg.arrayLanguages").default;
    game.settings.set("starwarsffg", "arrayLanguages", defaults);
    this.close();
  }

  /** @override */
  async _updateObject(event, formData) {
    // The text inputs all share the name "language_name"; with one row it is a string, with many
    // it is an array. Normalize, trim, drop blanks, and de-duplicate (case-insensitive) while
    // preserving the entered order.
    let raw = formData["language_name"];
    if (typeof raw === "undefined") raw = [];
    if (!Array.isArray(raw)) raw = [raw];

    const seen = new Set();
    const languages = [];
    for (const entry of raw) {
      const name = (entry ?? "").toString().trim();
      if (!name) continue;
      const key = name.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      languages.push(name);
    }

    await game.settings.set("starwarsffg", "arrayLanguages", languages);
  }
}
