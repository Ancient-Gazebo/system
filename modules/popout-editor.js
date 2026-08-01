import {migrateDataToSystem} from "./helpers/migration.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A specialized window used to pop out a ProseMirror editor for a document
 * field. Saving is driven by the native <prose-mirror> `save` event; the
 * caller positions/sizes the window via the legacy (object, options) call.
 * @extends {ApplicationV2}
 */
export default class PopoutEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "popout-editor",
    classes: ["starwarsffg", "sheet"],
    tag: "div",
    window: {
      title: "Pop-out Editor",
      resizable: true,
    },
    position: {
      width: 320,
      height: 320,
    },
  };

  static PARTS = {
    content: {
      root: true,
      template: "systems/starwarsffg/templates/popout-editor.html",
    },
  };

  /**
   * @param {foundry.abstract.Document} object  The document whose field is edited.
   * @param {object} [options]                  Legacy options: `name` (the field
   *   path), `title`, and `width`/`height`/`left`/`top` position hints.
   */
  constructor(object = {}, options = {}) {
    const { name, title, width, height, left, top, ...rest } = options;
    super({
      ...rest,
      window: { ...(rest.window ?? {}), ...(title ? { title } : {}) },
      position: {
        ...(rest.position ?? {}),
        ...(Number.isFinite(width) ? { width } : {}),
        ...(Number.isFinite(height) ? { height } : {}),
        ...(Number.isFinite(left) ? { left } : {}),
        ...(Number.isFinite(top) ? { top } : {}),
      },
    });
    this.object = object;
    this._name = name;
  }

  /**
   * Minimum window size. The editor toolbar (~440px of buttons) wraps to
   * multiple rows in a narrow window and the editing area is unusably small;
   * clamp to a size that keeps the toolbar on one row with a comfortable
   * editing area. Enforced by setPosition below.
   */
  _minDimensions() {
    return { width: 720, height: 520 };
  }

  /** Track the minimize animation so setPosition doesn't fight the collapse. */
  async minimize(...args) {
    this._minimizing = true;
    try {
      return await super.minimize(...args);
    } finally {
      this._minimizing = false;
    }
  }

  /** Clamp interactive resize to the editor's usable minimum. */
  setPosition(position = {}) {
    if (!this.element?.parentElement) return position;
    if (this._minimizing || this.minimized) return super.setPosition(position);
    const min = this._minDimensions();
    const clamped = { ...position };
    if (typeof clamped.width === "number" && clamped.width < min.width) clamped.width = min.width;
    if (typeof clamped.height === "number" && clamped.height < min.height) clamped.height = min.height;
    return super.setPosition(clamped);
  }

  /**
   * Return a reference to the target attribute
   * @type {String}
   */
  get attribute() {
    return this._name;
  }

  /** @override */
  async _prepareContext(_options) {
    // Get current value
    let attr = foundry.utils.getProperty(this.object.system, this.attribute.replace('data.', ''));

    // Return data
    return {
      value: attr,
      cssClass: "editable popout-editor-window",
    };
  }

  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element;
    // The `root` PARTS entry strips the template's wrapping <form>, injecting
    // the sheet-body straight into .window-content -- so the flex container we
    // own (and must keep filled) is the window-content itself.
    const content = el?.querySelector(".window-content");
    const sheetBody = el?.querySelector("section.sheet-body");
    const pm = el?.querySelector("prose-mirror");

    // Make the editor fill the window instead of leaving a gap below it.
    // sheet-body / prose-mirror otherwise take only their content height; the
    // mandar theme sets flex with !important and beats plain inline styles, so
    // set the column container and our fill rules with "important" too.
    if (content) {
      content.style.setProperty("display", "flex", "important");
      content.style.setProperty("flex-direction", "column", "important");
    }
    if (sheetBody) {
      sheetBody.style.setProperty("flex", "1 1 auto", "important");
      sheetBody.style.setProperty("min-height", "0", "important");
    }
    if (pm) {
      pm.style.setProperty("flex", "1 1 auto", "important");
      pm.style.setProperty("min-height", "0", "important");
      pm.style.setProperty("height", "auto", "important");
    }

    // The native <prose-mirror> element's save button dispatches a `save`
    // event -- the editor's only save path. Persist the value and close on
    // save. The element fires `save` twice (menu button + keymap);
    // _saveAndClose guards re-entry. Bind once per element.
    if (pm && !pm.dataset.ffgSaveBound) {
      pm.dataset.ffgSaveBound = "1";
      pm.addEventListener("save", () => this._saveAndClose(pm.value));
    }
  }

  async _saveAndClose(value) {
    if (this._saving) return;
    this._saving = true;
    const updateData = {};
    updateData[`${this.attribute}`] = value;
    await this.object.update(migrateDataToSystem(updateData));
    await this.close();
  }

  /**
   * Renders the dice symbols based on strings
   * @param  {String} string
   */
  static async renderDiceImages(str, actorData) {
    let html = str || "";

    html = this.replaceRollTags(html, actorData);
    try {
      html = await foundry.applications.ux.TextEditor.implementation.enrichHTML(html, { secrets: true, documents: true, async: false });
    } catch (err) {
      // ignore the message below, it means that we already created an entity link (this could be part of an editor text)
      if (err.message !== "An Entity subclass must configure the EntityCollection it belongs to.") {
        CONFIG.logger.error(err);
      }
    }

    const dicetheme = game.settings.get("starwarsffg", "dicetheme");

    const replaceValues = [
      {
        type: "ability",
        character: "d",
        class: "starwars",
        pattern: /:(ability):|\[(AB)(ILITY)?\]/gim,
      },
      {
        type: "advantage",
        character: "a",
        class: dicetheme,
        pattern: /:(advantage):|\[(AD)(VANTAGE)?\]/gim,
      },
      {
        type: "difficulty",
        character: "di",
        class: "starwars",
        pattern: /:(average):/gim,
      },
      {
        type: "boost",
        character: "b",
        class: "starwars",
        pattern: /:(boost):|\[(BO)(OST)?\]/gim,
      },
      {
        type: "challenge",
        character: "c",
        class: "starwars",
        pattern: /:(challenge):|\[(CH)(ALLENGE)?\]/gim,
      },
      {
        type: "dark",
        character: "z",
        class: "starwars",
        pattern: /:(darkside):|\[(DA)(RK)?\]/gim,
      },
      {
        type: "difficulty",
        character: "dddd",
        class: "starwars",
        pattern: /:(daunting):/gim,
      },
      {
        type: "despair",
        character: dicetheme === "starwars" ? "y" : "d",
        class: dicetheme,
        pattern: /:(despair):|\[(DE)(SPAIR)?\]/gim,
      },
      {
        type: "difficulty",
        character: "d",
        class: "starwars",
        pattern: /:(difficulty):|\[(DI)(FFICULTY)?\]/gim,
      },
      {
        type: "difficulty",
        character: "d",
        class: "starwars",
        pattern: /:(easy):/gim,
      },
      {
        type: "challenge",
        character: "c",
        class: "starwars",
        pattern: /:(easy-1):/gim,
      },
      {
        type: "forcepoint",
        character: "Y",
        class: "starwars",
        pattern: /:(forcepip):|\[(FP|FORCEPOINT)\]/gim,
      },
      {
        type: "difficulty",
        character: "ddddd",
        class: "starwars",
        pattern: /:(formidable):/gim,
      },
      {
        type: "failure",
        character: "f",
        class: dicetheme,
        pattern: /:(failure):|\[(FA)(ILURE)?\]/gim,
      },
      {
        type: "force",
        character: "C",
        class: "starwars",
        pattern: /:(force):|\[(FO)(RCE)?\]/gim,
      },
      {
        type: "difficulty",
        character: "ddd",
        class: "starwars",
        pattern: /:(hard):/gim,
      },
      {
        type: "light",
        character: "Z",
        class: "starwars",
        pattern: /:(lightside):|\[(LI)(GHT)?\]/gim,
      },
      {
        type: "proficiency",
        character: "c",
        class: "starwars",
        pattern: /:(proficiency):|\[(PR)(OFICIENCY)?\]/gim,
      },
      {
        type: "remsetback",
        character: "b",
        class: "starwars",
        pattern: /\[(RS*|REMSETBACK)\]/gim,
      },
      {
        type: "restricted",
        character: "z",
        class: "starwars",
        pattern: /\[(RE)(STRICTED)?\]/gim,
      },
      {
        type: "setback",
        character: "b",
        class: "starwars",
        pattern: /:(setback):|\[(SE)(TBACK)?\]/gim,
      },
      {
        type: "success",
        character: "s",
        class: dicetheme,
        pattern: /:(success):|\[(SU)(CCESS)?\]/gim,
      },
      {
        type: "threat",
        character: dicetheme === "starwars" ? "t" : "h",
        class: dicetheme,
        pattern: /:(threat):|\[(TH)(REAT)?\]/gim,
      },
      {
        type: "triumph",
        character: dicetheme === "starwars" ? "x" : "t",
        class: dicetheme,
        pattern: /:(triumph):|\[(TR)(IUMPH)?\]/gim,
      },
      {
        type: "adddifficulty",
        character: "d",
        class: "starwars",
        pattern: /\[(DD|ADDDIFFICULTY)\]/gim,
      },
      {
        type: "updifficulty",
        character: "d",
        class: "starwars",
        pattern: /\[(UD|UPDIFFICULTY)\]/gim,
      },
      {
        type: "cancelthreat",
        character: "t",
        class: dicetheme,
        pattern: /\[(CT|CANCELTHREAT)\]/gim,
      },
    ];

    replaceValues.forEach((item) => {
      html = html.toString().replace(item.pattern, `<span class='dietype ${item.class} ${item.type}'>${item.character}</span>`);
    });

    const regex = /:([\w]*)-(\d):/gim;
    let m;
    while ((m = regex.exec(html)) !== null) {
      // This is necessary to avoid infinite loops with zero-width matches
      if (m.index === regex.lastIndex) {
        regex.lastIndex++;
      }

      let symbolCount = 0;
      let replaceString = "";

      switch (m[1]) {
        case "average": {
          symbolCount = 2;
          break;
        }
        case "hard": {
          symbolCount = 3;
          break;
        }
        case "daunting": {
          symbolCount = 4;
          break;
        }
        case "formidable": {
          symbolCount = 5;
          break;
        }
      }

      for (let i = 0; i < symbolCount; i += 1) {
        if (i + 1 <= parseInt(m[2], 10)) {
          replaceString += `<span class='dietype starwars challenge'>c</span>`;
        } else {
          replaceString += `<span class='dietype starwars difficulty'>d</span>`;
        }
      }

      html = html.toString().replace(m[0], replaceString);
    }

    const oggdudeTags = [
      {
        startTag: "<span class='bold'>",
        endTag: "</span>",
        pattern: /(\[B\])(.[^\[]*)\[b\]/gm,
      },
      {
        startTag: "<p>",
        endTag: "</p>",
        pattern: /(\[P\])(.[^\[]*)/gm,
      },
      {
        startTag: "<br />",
        endTag: "",
        pattern: /(\[BR\])(.[^\[]*)/gm,
      },
      {
        startTag: "<span class='italic'>",
        endTag: "</span>",
        pattern: /(\[I\])(.[^\[]*)\[i\]/gm,
      },
      {
        startTag: "<h1>",
        endTag: "</h1>",
        pattern: /(\[H1\])(.[^\[]*)\[h1\]/gm,
      },
      {
        startTag: "<h2>",
        endTag: "</h2>",
        pattern: /(\[H2\])(.[^\[]*)\[h2\]/gm,
      },
      {
        startTag: "<h3>",
        endTag: "</h3>",
        pattern: /(\[H3\])(.[^\[]*)\[h3\]/gm,
      },
      {
        startTag: "<h4>",
        endTag: "</h4>",
        pattern: /(\[H4\])(.[^\[]*)\[h4\]/gm,
      },
    ];

    oggdudeTags.forEach((item) => {
      html = html.toString().replace(item.pattern, `${item.startTag}$2${item.endTag}`);
    });

    return html;
  }

  /**
   * Synchronous variant of renderDiceImages that performs roll-tag and dice/symbol
   * replacement without the async enrichHTML pass, so it can be used from Handlebars helpers.
   */
  static renderDiceImagesSync(str, actorData) {
    let html = str || "";
    html = this.replaceRollTags(html, actorData);
    return this.replaceDiceSymbols(html);
  }

  /**
   * Replace FFG dice/symbol codes (e.g. [AD], :advantage:) in already-prepared HTML with
   * rendered symbol markup. Synchronous.
   */
  static replaceDiceSymbols(html) {
    const dicetheme = game.settings.get("starwarsffg", "dicetheme");

    const replaceValues = [
      {
        type: "ability",
        character: "d",
        class: "starwars",
        pattern: /:(ability):|\[(AB)(ILITY)?\]/gim,
      },
      {
        type: "advantage",
        character: "a",
        class: dicetheme,
        pattern: /:(advantage):|\[(AD)(VANTAGE)?\]/gim,
      },
      {
        type: "difficulty",
        character: "di",
        class: "starwars",
        pattern: /:(average):/gim,
      },
      {
        type: "boost",
        character: "b",
        class: "starwars",
        pattern: /:(boost):|\[(BO)(OST)?\]/gim,
      },
      {
        type: "challenge",
        character: "c",
        class: "starwars",
        pattern: /:(challenge):|\[(CH)(ALLENGE)?\]/gim,
      },
      {
        type: "dark",
        character: "z",
        class: "starwars",
        pattern: /:(darkside):|\[(DA)(RK)?\]/gim,
      },
      {
        type: "difficulty",
        character: "dddd",
        class: "starwars",
        pattern: /:(daunting):/gim,
      },
      {
        type: "despair",
        character: dicetheme === "starwars" ? "y" : "d",
        class: dicetheme,
        pattern: /:(despair):|\[(DE)(SPAIR)?\]/gim,
      },
      {
        type: "difficulty",
        character: "d",
        class: "starwars",
        pattern: /:(difficulty):|\[(DI)(FFICULTY)?\]/gim,
      },
      {
        type: "difficulty",
        character: "d",
        class: "starwars",
        pattern: /:(easy):/gim,
      },
      {
        type: "challenge",
        character: "c",
        class: "starwars",
        pattern: /:(easy-1):/gim,
      },
      {
        type: "forcepoint",
        character: "Y",
        class: "starwars",
        pattern: /:(forcepip):|\[(FP|FORCEPOINT)\]/gim,
      },
      {
        type: "difficulty",
        character: "ddddd",
        class: "starwars",
        pattern: /:(formidable):/gim,
      },
      {
        type: "failure",
        character: "f",
        class: dicetheme,
        pattern: /:(failure):|\[(FA)(ILURE)?\]/gim,
      },
      {
        type: "force",
        character: "C",
        class: "starwars",
        pattern: /:(force):|\[(FO)(RCE)?\]/gim,
      },
      {
        type: "difficulty",
        character: "ddd",
        class: "starwars",
        pattern: /:(hard):/gim,
      },
      {
        type: "light",
        character: "Z",
        class: "starwars",
        pattern: /:(lightside):|\[(LI)(GHT)?\]/gim,
      },
      {
        type: "proficiency",
        character: "c",
        class: "starwars",
        pattern: /:(proficiency):|\[(PR)(OFICIENCY)?\]/gim,
      },
      {
        type: "remsetback",
        character: "b",
        class: "starwars",
        pattern: /\[(RS*|REMSETBACK)\]/gim,
      },
      {
        type: "restricted",
        character: "z",
        class: "starwars",
        pattern: /\[(RE)(STRICTED)?\]/gim,
      },
      {
        type: "setback",
        character: "b",
        class: "starwars",
        pattern: /:(setback):|\[(SE)(TBACK)?\]/gim,
      },
      {
        type: "success",
        character: "s",
        class: dicetheme,
        pattern: /:(success):|\[(SU)(CCESS)?\]/gim,
      },
      {
        type: "threat",
        character: dicetheme === "starwars" ? "t" : "h",
        class: dicetheme,
        pattern: /:(threat):|\[(TH)(REAT)?\]/gim,
      },
      {
        type: "triumph",
        character: dicetheme === "starwars" ? "x" : "t",
        class: dicetheme,
        pattern: /:(triumph):|\[(TR)(IUMPH)?\]/gim,
      },
      {
        type: "adddifficulty",
        character: "d",
        class: "starwars",
        pattern: /\[(DD|ADDDIFFICULTY)\]/gim,
      },
      {
        type: "updifficulty",
        character: "d",
        class: "starwars",
        pattern: /\[(UD|UPDIFFICULTY)\]/gim,
      },
      {
        type: "cancelthreat",
        character: "t",
        class: dicetheme,
        pattern: /\[(CT|CANCELTHREAT)\]/gim,
      },
    ];

    replaceValues.forEach((item) => {
      html = html.toString().replace(item.pattern, `<span class='dietype ${item.class} ${item.type}'>${item.character}</span>`);
    });

    const regex = /:([\w]*)-(\d):/gim;
    let m;
    while ((m = regex.exec(html)) !== null) {
      // This is necessary to avoid infinite loops with zero-width matches
      if (m.index === regex.lastIndex) {
        regex.lastIndex++;
      }

      let symbolCount = 0;
      let replaceString = "";

      switch (m[1]) {
        case "average": {
          symbolCount = 2;
          break;
        }
        case "hard": {
          symbolCount = 3;
          break;
        }
        case "daunting": {
          symbolCount = 4;
          break;
        }
        case "formidable": {
          symbolCount = 5;
          break;
        }
      }

      for (let i = 0; i < symbolCount; i += 1) {
        if (i + 1 <= parseInt(m[2], 10)) {
          replaceString += `<span class='dietype starwars challenge'>c</span>`;
        } else {
          replaceString += `<span class='dietype starwars difficulty'>d</span>`;
        }
      }

      html = html.toString().replace(m[0], replaceString);
    }

    const oggdudeTags = [
      {
        startTag: "<span class='bold'>",
        endTag: "</span>",
        pattern: /(\[B\])(.[^\[]*)\[b\]/gm,
      },
      {
        startTag: "<p>",
        endTag: "</p>",
        pattern: /(\[P\])(.[^\[]*)/gm,
      },
      {
        startTag: "<br />",
        endTag: "",
        pattern: /(\[BR\])(.[^\[]*)/gm,
      },
      {
        startTag: "<span class='italic'>",
        endTag: "</span>",
        pattern: /(\[I\])(.[^\[]*)\[i\]/gm,
      },
      {
        startTag: "<h1>",
        endTag: "</h1>",
        pattern: /(\[H1\])(.[^\[]*)\[h1\]/gm,
      },
      {
        startTag: "<h2>",
        endTag: "</h2>",
        pattern: /(\[H2\])(.[^\[]*)\[h2\]/gm,
      },
      {
        startTag: "<h3>",
        endTag: "</h3>",
        pattern: /(\[H3\])(.[^\[]*)\[h3\]/gm,
      },
      {
        startTag: "<h4>",
        endTag: "</h4>",
        pattern: /(\[H4\])(.[^\[]*)\[h4\]/gm,
      },
    ];

    oggdudeTags.forEach((item) => {
      html = html.toString().replace(item.pattern, `${item.startTag}$2${item.endTag}`);
    });

    return html;
  }

  static replaceRollTags(html, actorData) {
    const rollTag = /(\[ROLL\])(.[^\[]*)\[\/ROLL\]/gm;
    const formula = html.toString().replace(rollTag, function (content) {
      content = content.replace(rollTag, `$2`);
      const args = content.split(",").map(function (arg) {
        return arg.trim();
      });
      const di = "[DI]";
      let difficulty = "";
      switch (args[1]) {
        case "0":
          difficulty = "Simple";
          break;
        case "1":
          difficulty = "Easy";
          break;
        case "2":
          difficulty = "Average";
          break;
        case "3":
          difficulty = "Hard";
          break;
        case "4":
          difficulty = "Daunting";
          break;
        case "5":
          difficulty = "Formidable";
          break;
      }
      const id = actorData?._id ? actorData._id : "";

      let formula = `<span class="rollable rollSkillDirect" data-skill="${args[0]}" data-difficulty="${args[1]}" data-actor-id="${id}"><strong>${difficulty} (${di.repeat(args[1])}) ${args[0]}</strong></span>`;
      return formula;
    });

    return formula;
  }
}
