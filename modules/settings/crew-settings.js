import { FFGFormApplication } from "../apps/ffg-form-application.js";

export default class CrewSettings extends FFGFormApplication {
  static DEFAULT_OPTIONS = {
    id: "data-importer",
    classes: ["starwarsffg", "data-import"],
    window: {
      title: "SWFFG.UISettingsLabel",
      resizable: true,
    },
    position: {
      height: 265,
    },
    form: {
      closeOnSubmit: true,
    },
  };

  static PARTS = {
    content: {
      root: true,
      template: "systems/starwarsffg/templates/dialogs/crew-settings.html",
    },
  };

  async _prepareContext(_options) {
    const gs = game.settings;
    const canConfigure = game.user.can("SETTINGS_MODIFY");

    const data = {
      system: { title: game.system.title, menus: [], settings: [] },
    };

    // Classify all settings
    for (let setting of gs.settings.values()) {
      // Exclude settings the user cannot change
      if (!setting.key.includes("arrayCrewRoles") || (!canConfigure && setting.scope !== "client")) continue;

      // Update setting data
      const s = foundry.utils.duplicate(setting);
      s.name = game.i18n.localize(s.name);
      s.hint = game.i18n.localize(s.hint);
      s.value = game.settings.get(s.namespace, s.key);
      s.type = setting.type instanceof Function ? setting.type.name : "String";
      s.isCheckbox = setting.type === Boolean;
      s.isSelect = s.choices !== undefined;
      s.isRange = setting.type === Number && s.range;
      s.isFilePicker = setting.valueType === "FilePicker";

      // Classify setting
      if (s.namespace === game.system.id && s.key.includes("arrayCrewRoles")) data.system.settings.push(s);
    }

    data.skills = CONFIG.FFG.skills;
    data.initiativeRole = game.settings.get('starwarsffg', 'initiativeCrewRole');

    // Return data
    return {
      user: game.user,
      canConfigure: canConfigure,
      systemTitle: game.system.title,
      data: data,
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const html = $(this.element);
    html.find('button[name="reset"]').click(this._onResetDefaults.bind(this));
  }

  /* -------------------------------------------- */

  /**
   * Handle button click to reset default settings
   * @param event {Event}   The initial button click event
   * @private
   */
  _onResetDefaults(event) {
    event.preventDefault();
    const defaults = game.settings.settings.get("starwarsffg.arrayCrewRoles").default;
    game.settings.set("starwarsffg", "arrayCrewRoles", defaults);
    this.close();
  }


  /* -------------------------------------------- */

  /** @override */
  async _updateObject(event, formData) {
    const existing_settings = game.settings.get("starwarsffg", "arrayCrewRoles");
    // As in LanguageSettings: a submit with no role fields means the data never reached us, not
    // that every role was deleted. Bail rather than dereference undefined (which aborted the save
    // mid-way and left the roles looking like they simply refused to save).
    if (typeof formData['role_name'] === "undefined") {
      CONFIG.logger?.warn?.("CrewSettings: submit contained no role fields; ignoring.");
      return;
    }
    const toArray = (v) => (typeof v === "undefined" ? [] : Array.isArray(v) ? v : [v]);
    const roleNames = toArray(formData['role_name']);
    const roleSkills = toArray(formData['role_skill']);
    const useHandling = toArray(formData['use_handling']);
    const useWeapons = toArray(formData['use_weapons']);
    let new_settings = [];
    // convert the arrays into the format expected
    for (let i = 0; i < roleNames.length; i++) {
      new_settings.push({
        'role_name': roleNames[i],
        'role_skill': roleSkills[i],
        'use_handling': useHandling[i],
        'use_weapons': useWeapons[i],
      })
    }
    // update the settings if they don't match the old ones
    if (existing_settings !== new_settings) {
      await game.settings.set("starwarsffg", "arrayCrewRoles", new_settings);
    }
    const updateData = {
      "role_name":  formData['initiativeCrewRole'],
      "role_skill": undefined,
      "use_weapons": false,
      "use_handling": false
    };
    await game.settings.set("starwarsffg", "initiativeCrewRole", updateData);
  }
}
