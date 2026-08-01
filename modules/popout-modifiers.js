import ModifierHelpers from "./helpers/modifiers.js";
import { FFGFormApplication } from "./apps/ffg-form-application.js";

/**
 * Pop-out window for editing an item / upgrade / talent's modifier (attribute)
 * list. Live-edits: each change submits and re-renders, and closing flushes a
 * final submit (submitOnClose).
 * @extends {FFGFormApplication}
 */
export default class PopoutModifiers extends FFGFormApplication {
  static DEFAULT_OPTIONS = {
    id: "popout-modifiers",
    classes: ["starwarsffg", "sheet"],
    window: {
      title: "Pop-out Modifiers",
      resizable: true,
    },
    position: {
      width: 320,
      height: 320,
    },
    form: {
      submitOnChange: true,
      closeOnSubmit: false,
    },
    submitOnClose: true,
  };

  static PARTS = {
    content: {
      root: true,
      template: "systems/starwarsffg/templates/items/dialogs/ffg-popout-modifiers.html",
    },
  };

  /** @override */
  async _prepareContext(_options) {
    const data = {
      data: this.object.system,
      modTypeSelected: "all",
      modifierTypes: CONFIG.FFG.allowableModifierTypes,
      modifierChoices: CONFIG.FFG.allowableModifierChoices,
    };

    if (this.object.isUpgrade) {
      data.data = this.object.parent.system.upgrades[this.object.keyname];
    } else if (this.object.isTalent) {
      data.data = this.object.parent.system.talents[this.object.keyname];
    }

    data.FFG = CONFIG.FFG;
    data.cssClass = "editable popout-modifiers-window attributes";

    // Return data
    return data;
  }

  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // window-content is the <form> (contentTag); the `root` PARTS entry strips
    // the template's own <form>, so `.attributes` is a direct child of
    // window-content. Constrain the (potentially long) modifier list to scroll
    // within the window instead of overflowing the frame -- a flex column so
    // the list takes the remaining height. Inline + !important so the mandar
    // theme can't win the cascade and reintroduce overflow.
    const content = this.element?.querySelector(".window-content");
    const attributes = content?.querySelector(":scope > .attributes");
    if (content && attributes) {
      content.style.setProperty("display", "flex", "important");
      content.style.setProperty("flex-direction", "column", "important");
      attributes.style.setProperty("flex", "1 1 auto", "important");
      attributes.style.setProperty("min-height", "0", "important");
      attributes.style.setProperty("overflow-y", "auto", "important");
    }

    if (this.isEditable && content) {
      // Delegated add/remove modifier-row controls. `.attributes` is re-created
      // on every render, so (re)bind here. onClickAttributeControl reads
      // `this.form` and calls `this._onSubmit` -- both provided by the base.
      $(content).find(".attributes").on("click", ".attribute-control", ModifierHelpers.onClickAttributeControl.bind(this));
    }
  }

  /* -------------------------------------------- */

  /** @override */
  async _updateObject(event, formData) {
    formData = foundry.utils.expandObject(formData);

    // Handle the free-form attributes list
    const formAttrs = foundry.utils.expandObject(formData)?.data?.attributes || {};
    const attributes = Object.values(formAttrs).reduce((obj, v) => {
      let k = v["key"].trim();
      if (/[\s\.]/.test(k)) return ui.notifications.error("Attribute keys may not contain spaces or periods");
      delete v["key"];
      obj[k] = v;
      return obj;
    }, {});

    // Remove attributes which are no longer used
    if (this.object.system?.attributes) {
      for (let k of Object.keys(this.object.system.attributes)) {
        if (!attributes.hasOwnProperty(k)) attributes[`-=${k}`] = null;
      }
    }

    // recombine attributes to formData
    if (Object.keys(attributes).length > 0) {
      foundry.utils.setProperty(formData, `data.attributes`, attributes);
    }

    if (this.object.isUpgrade) {
      // redo the earlier code but with the proper attribute path
      // Remove attributes which are no longer used
      if (this.object.parent.system.upgrades[this.object.keyname].attributes) {
        for (let k of Object.keys(this.object.parent.system.upgrades[this.object.keyname].attributes)) {
          if (!attributes.hasOwnProperty(k)) attributes[`-=${k}`] = null;
        }
      }

      // recombine attributes to formData
      if (Object.keys(attributes).length > 0) {
        foundry.utils.setProperty(formData, `data.attributes`, attributes);
      }

      let data = attributes;

      let upgradeFormData = {};
      foundry.utils.setProperty(upgradeFormData, `data.upgrades.${this.object.keyname}.attributes`, data);

      upgradeFormData.system = upgradeFormData.data;
      delete upgradeFormData.data;
      delete upgradeFormData._id;

      await this.object.parent.update(upgradeFormData);
    } else if (this.object.isTalent) {
      // redo the earlier code but with the proper attribute path
      // Remove attributes which are no longer used
      if (this.object.parent.system.talents[this.object.keyname].attributes) {
        for (let k of Object.keys(this.object.parent.system.talents[this.object.keyname].attributes)) {
          if (!attributes.hasOwnProperty(k)) {
            attributes[`-=${k}`] = null;
          }
        }
      }
      let test_item = await game.items.get(this.object.parent.system.talents[this.object.keyname]?.itemId);
      if (this.object.parent.system.talents[this.object.keyname].pack || test_item) {
        ui.notifications.error(game.i18n.localize("SWFFG.Notifications.TalentEditGlobally"));
        return;
      }

      // recombine attributes to formData
      if (Object.keys(attributes).length > 0) {
        foundry.utils.setProperty(formData, `data.attributes`, attributes);
      }

      let data = attributes;

      let upgradeFormData = {};
      foundry.utils.setProperty(upgradeFormData, `data.talents.${this.object.keyname}.attributes`, data);

      upgradeFormData.system = upgradeFormData.data;
      delete upgradeFormData.data;
      delete upgradeFormData._id;
      await this.object.parent.update(upgradeFormData);
    } else {
      // Update the Item
      const syncFormData = foundry.utils.deepClone(formData);
      if (syncFormData?.data?.attributes) {
        for (const attr of Object.keys(syncFormData.data.attributes)) {
          if (attr.startsWith("-=")) {
            delete syncFormData.data.attributes[attr];
          }
        }
      }
      await ModifierHelpers.applyActiveEffectOnUpdate(this.object, syncFormData);
      // sets _id, which is not settable
      formData.system = formData.data;
      delete formData.data;
      delete formData._id;
      await this.object.update(formData);
    }
    this.render();
  }
}
