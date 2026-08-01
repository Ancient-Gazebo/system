import { FFGFormApplication } from "../apps/ffg-form-application.js";

class ffgSettings extends FFGFormApplication {
  static DEFAULT_OPTIONS = {
    form: {
      closeOnSubmit: true,
    },
  };

  async _onRender(context, options) {
    await super._onRender(context, options);
    const html = $(this.element);
    html.find("button.filepicker").click(this._onFilePicker.bind(this));
    // The V1 SettingsConfig reset listener is not carried over by the ApplicationV2
    // port, so the "Reset Defaults" button is inert unless we wire it here.
    html.find("button[name='reset']").click(this._onResetDefaults.bind(this));
  }

  /**
   * Reset every field in this settings form to its registered default value.
   * Non-destructive: it only repopulates the inputs, so the change is persisted
   * when the user clicks Save (mirroring core's reset-then-save behavior).
   */
  _onResetDefaults(event) {
    event.preventDefault();
    const form = this.form;
    if (!form) return;
    for (const el of form.elements) {
      const setting = el.name ? game.settings.settings.get(el.name) : null;
      if (!setting) continue;
      const def = setting.default;
      if (el.type === "checkbox") {
        el.checked = Boolean(def);
      } else {
        el.value = def ?? "";
        // Keep a range slider's value readout in sync with its reset value.
        if (el.type === "range") {
          const readout = el.parentElement?.querySelector(".range-value");
          if (readout) {
            if (readout.tagName === "INPUT") readout.value = el.value;
            else readout.innerHTML = el.value;
          }
        }
      }
    }
  }

  _buildSettingsContext(acceptableSettings) {
    const canConfigure = game.user.can("SETTINGS_MODIFY");
    let includeSettings = [];
    for (const setting of game.settings.settings) {
      if (acceptableSettings.includes(setting[0])) {
        // World-scoped settings are GM-only; hide them from users without
        // SETTINGS_MODIFY so non-restricted menus (e.g. Codex) show players just
        // the per-client settings they can actually change.
        if (setting[1].scope === "world" && !canConfigure) continue;
        const s = foundry.utils.duplicate(setting[1]);
        s.name = game.i18n.localize(s.name);
        s.hint = game.i18n.localize(s.hint);
        s.value = game.settings.get(s.namespace, s.key);
        s.type = setting.type instanceof Function ? setting.type.name : "String";
        s.isCheckbox = setting[1].type === Boolean;
        s.isSelect = s.choices !== undefined;
        s.isRange = setting[1].type === Number && s.range;
        s.isFilePicker = setting.valueType === "FilePicker";
        includeSettings.push(s);
      }
    }

    const data = {
      system: {title: game.system.title, menus: [], settings: includeSettings},
    };

    // Return data
    return {
      user: game.user,
      canConfigure: canConfigure,
      systemTitle: game.system.title,
      data: data,
    };
  }

  _onFilePicker(event) {
    event.preventDefault();

    const fp = new foundry.applications.apps.FilePicker.implementation({
      type: "image",
      callback: (path) => {
        $(event.currentTarget).prev().val(path);
        //this._onSubmit(event);
      },
      top: this.position.top + 40,
      left: this.position.left + 10,
    });
    return fp.browse();
  }

    /** @override */
  async _updateObject(event, formData) {
    for (let [k, v] of Object.entries(foundry.utils.flattenObject(formData))) {
      let s = game.settings.settings.get(k);
      let current = game.settings.get(s.namespace, s.key);
      if (v !== current) {
        await game.settings.set(s.namespace, s.key, v);
      }
    }
  }
}

export class rulesetSettings extends ffgSettings {
  static DEFAULT_OPTIONS = {
    id: "ruleset-settings",
    classes: ["starwarsffg", "ruleset-settings"],
    window: { title: "SWFFG.Settings.ruleset.Title" },
  };

  static PARTS = {
    content: { root: true, template: "systems/starwarsffg/templates/dialogs/ffg-ui-settings.html" },
  };

  async _prepareContext(_options) {
    const includeSettingsNames = [
        "starwarsffg.dicetheme",
        "starwarsffg.vehicleRangeBand",
        "starwarsffg.skilltheme",
        "starwarsffg.enableForceDie",
    ];
    return this._buildSettingsContext(includeSettingsNames);
  }
}

export class uiSettings extends ffgSettings {
  static DEFAULT_OPTIONS = {
    id: "ui-settings",
    classes: ["starwarsffg", "ui-settings"],
    window: { title: "SWFFG.Settings.ui.Title" },
  };

  static PARTS = {
    content: { root: true, template: "systems/starwarsffg/templates/dialogs/ffg-ui-settings.html" },
  };

  async _prepareContext(_options) {
    const includeSettingsNames = [
      "starwarsffg.ui-uitheme",
      "starwarsffg.ui-pausedImage",
      "starwarsffg.ui-token-healthy",
      "starwarsffg.ui-token-wounded",
      "starwarsffg.ui-token-overwounded",
      "starwarsffg.ui-token-stamina-ok",
      "starwarsffg.ui-token-stamina-damaged",
      "starwarsffg.ui-token-stamina-over",
      "starwarsffg.displaySimulation",
      "starwarsffg.rollSimulation",
    ];
    return this._buildSettingsContext(includeSettingsNames);
  }
}

export class combatSettings extends ffgSettings {
  static DEFAULT_OPTIONS = {
    id: "combat-settings",
    classes: ["starwarsffg", "combat-settings"],
    window: { title: "SWFFG.Settings.combat.Title" },
  };

  static PARTS = {
    content: { root: true, template: "systems/starwarsffg/templates/dialogs/ffg-ui-settings.html" },
  };

  async _prepareContext(_options) {
    const includeSettingsNames = [
      "starwarsffg.useGenericSlots",
      "starwarsffg.initiativeRule",
      "starwarsffg.removeCombatantAction",
      "starwarsffg.useDefense",
      "starwarsffg.additionalStatuses",
    ];
    return this._buildSettingsContext(includeSettingsNames);
  }
}

export class actorSettings extends ffgSettings {
  static DEFAULT_OPTIONS = {
    id: "actor-settings",
    classes: ["starwarsffg", "actor-settings"],
    window: { title: "SWFFG.Settings.actor.Title" },
  };

  static PARTS = {
    content: { root: true, template: "systems/starwarsffg/templates/dialogs/ffg-ui-settings.html" },
  };

  async _prepareContext(_options) {
    const includeSettingsNames = [
      "starwarsffg.enableSoakCalc",
      "starwarsffg.talentSorting",
      "starwarsffg.showMinionCount",
      "starwarsffg.showAdversaryCount",
      "starwarsffg.adversaryItemName",
      "starwarsffg.enableAdversaryCalc",
      "starwarsffg.maxAttribute",
      "starwarsffg.maxSkill",
      "starwarsffg.medItemName",
      "starwarsffg.HealingItemAction",
      "starwarsffg.consumeHealingItem",
      "starwarsffg.RivalTokenPrepend",
    ];
    return this._buildSettingsContext(includeSettingsNames);
  }
}

export class xpSpendingSettings extends ffgSettings {
  static DEFAULT_OPTIONS = {
    id: "xpSpending",
    classes: ["starwarsffg", "xpSpending"],
    window: { title: "SWFFG.Settings.xpSpending.Title" },
  };

  static PARTS = {
    content: { root: true, template: "systems/starwarsffg/templates/dialogs/ffg-ui-settings.html" },
  };

  async _prepareContext(_options) {
    const includeSettingsNames = [
      "starwarsffg.specializationCompendiums",
      "starwarsffg.signatureAbilityCompendiums",
      "starwarsffg.forcePowerCompendiums",
      "starwarsffg.talentCompendiums",
      "starwarsffg.backgroundCompendiums",
      "starwarsffg.obligationCompendiums",
      "starwarsffg.speciesCompendiums",
      "starwarsffg.careerCompendiums",
      "starwarsffg.motivationCompendiums",
      "starwarsffg.itemCompendiums",
      "starwarsffg.notifyOnXpSpend",
      "starwarsffg.defaultObligation",
      "starwarsffg.defaultDuty",
      "starwarsffg.defaultMorality",
      "starwarsffg.maxRarity",
      "starwarsffg.allowRestricted",
      "starwarsffg.defaultCredits",
    ];
    return this._buildSettingsContext(includeSettingsNames);
  }
}

export class localizationSettings extends ffgSettings {
  static DEFAULT_OPTIONS = {
    id: "localization",
    classes: ["starwarsffg", "localization"],
    window: { title: "SWFFG.Settings.localization.Title" },
  };

  static PARTS = {
    content: { root: true, template: "systems/starwarsffg/templates/dialogs/ffg-ui-settings.html" },
  };

  async _prepareContext(_options) {
    const includeSettingsNames = [
      "starwarsffg.skillSorting",
      "starwarsffg.destiny-pool-light",
      "starwarsffg.destiny-pool-dark",
      "starwarsffg.labelCredits",
      "starwarsffg.labelObligation",
      "starwarsffg.labelMorality",
      "starwarsffg.labelDuty",
      "starwarsffg.labelConflict",
    ];
    return this._buildSettingsContext(includeSettingsNames);
  }
}

export class groupManagerSettings extends ffgSettings {
  static DEFAULT_OPTIONS = {
    id: "group-manager-settings",
    classes: ["starwarsffg", "group-manager"],
    window: { title: "SWFFG.Settings.groupManager.Title" },
  };

  static PARTS = {
    content: { root: true, template: "systems/starwarsffg/templates/dialogs/ffg-ui-settings.html" },
  };

  async _prepareContext(_options) {
    const includeSettingsNames = [
      "starwarsffg.pcListMode",
      "starwarsffg.privateTriggers",
      "starwarsffg.GMCharactersInGroupManager"
    ];
    return this._buildSettingsContext(includeSettingsNames);
  }
}

export class codexSettings extends ffgSettings {
  static DEFAULT_OPTIONS = {
    id: "codex-settings",
    classes: ["starwarsffg", "codex-settings"],
    window: { title: "SWFFG.Settings.codex.Title" },
  };

  static PARTS = {
    content: { root: true, template: "systems/starwarsffg/templates/dialogs/ffg-ui-settings.html" },
  };

  async _prepareContext(_options) {
    const includeSettingsNames = [
      "starwarsffg.defaultSheetTheme",
      "starwarsffg.codexAdvantageHealsStrain",
    ];
    return this._buildSettingsContext(includeSettingsNames);
  }
}
