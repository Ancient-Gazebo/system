const { DialogV2 } = foundry.applications.api;

export default class ItemOptions {
  /**
   * Per-item Sheet Options dialog instance, keyed by item uuid. Single-
   * instance guard so a second click on Sheet Options focuses the existing
   * dialog instead of stacking another one.
   */
  static _openDialogs = new Map();

  constructor(data, html) {
    this.data = data;
    this.options = {};
    this.init(html);
  }

  init(html) {
    const root = this._findSheetRoot(html);
    if (!root) {
      // Diagnostic: silent failure here means the Sheet Options button never
      // appears in the header. Most common cause is the sheet root not
      // matching `.starwarsffg.sheet.item[data-appid=...]` (e.g. a subclass
      // that strips one of the expected classes).
      console.warn(`starwarsffg | ItemOptions.init: could not resolve sheet root for appId="${this.data.appId}"; Sheet Options button will not be injected.`);
      return;
    }
    if (root.querySelector(":scope > .window-header > .ffg-sheet-options")) return;

    const header = root.querySelector(":scope > .window-header");
    if (!header) {
      console.warn(`starwarsffg | ItemOptions.init: sheet root for appId="${this.data.appId}" has no :scope > .window-header; Sheet Options button will not be injected.`);
      return;
    }

    const button = document.createElement("a");
    button.href = "#";
    button.classList.add("ffg-sheet-options");
    if (root.classList.contains("application")) button.classList.add("legacy-header-action");
    button.innerHTML = `<i class="fas fa-wrench"></i>${game.i18n.localize("SWFFG.SheetOptions")}`;
    button.addEventListener("click", this.handler.bind(this));
    // Stop the pointerdown from reaching V13's window-drag handler.
    //
    // The button lives in `.window-header`, which is ApplicationV2's drag
    // handle. Core's `#onWindowDragStart` (a bubble-phase pointerdown listener
    // on the header) only bails for `.header-control` elements; our injected
    // `<a>` is not one, so it starts a drag and, on the first `pointermove`,
    // calls `header.setPointerCapture()`. Pointer capture retargets the
    // matching `pointerup` to the header and suppresses the synthesized `click`
    // on the button -- so a press that includes ANY cursor movement (a normal,
    // slightly-jittery mouse click) is swallowed and Sheet Options appears to
    // need a second, stiller click. stopPropagation here keeps the header's
    // drag-start from engaging for presses that begin on the button; V13's
    // bring-to-front still fires (it is bound on the app root in the capture
    // phase, before this bubble-phase listener), so clicking still raises the
    // window. Mirrors the destiny-tracker pointer-capture fix (commit 97025d85).
    button.addEventListener("pointerdown", (event) => event.stopPropagation());

    const anchor = header.querySelector(":scope > a, :scope > button, :scope > [data-action]") ?? header.lastElementChild;
    header.insertBefore(button, anchor);
  }

  _findSheetRoot(html) {
    const appId = `${this.data.appId}`;
    const candidates = [];
    const addAncestors = (element) => {
      for (let node = element; node && node !== document; node = node.parentElement) {
        if (
          node.dataset?.appid === appId
          && node.classList?.contains("starwarsffg")
          && node.classList.contains("sheet")
          && node.classList.contains("item")
        ) {
          candidates.push(node);
        }
      }
    };

    const sheetElement = this.data.element?.jquery ? this.data.element[0] : this.data.element;
    const htmlElement = html?.jquery ? html[0] : html?.[0] ?? html;
    addAncestors(sheetElement);
    addAncestors(htmlElement);
    candidates.push(...document.querySelectorAll(`.starwarsffg.sheet.item[data-appid="${appId}"]`));

    return candidates.find((element) => element.querySelector(":scope > .window-header")) ?? candidates[0] ?? null;
  }

  async handler(event) {
    // The injected button is an <a href="#">; without preventDefault the
    // browser navigates to the page URL with `#` appended and can scroll
    // the page. stopPropagation keeps the click from bubbling into V13's
    // window header handling.
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const openKey = this.data.item.uuid;
    const existing = ItemOptions._openDialogs.get(openKey);
    if (existing?.rendered) {
      existing.bringToFront?.();
      return;
    }
    const title = `${game.i18n.localize("SWFFG.ItemSheet")} ${game.i18n.localize("SWFFG.Options")}: ${this.data.item.name}`;

    // Render the legacy options template ourselves; its `{{#each buttons}}`
    // loop stays empty (no `buttons` in context) so DialogV2's native button
    // bar is the only button row.
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/starwarsffg/templates/dialogs/ffg-sheet-options.html",
      { content: { options: this.options } }
    );

    const dialog = new DialogV2({
      window: { title },
      classes: ["dialog", "starwarsffg"],
      content,
      buttons: [
        {
          action: "one",
          icon: "fas fa-check",
          label: game.i18n.localize("SWFFG.ButtonAccept"),
          default: true,
          callback: async (event, button, dlg) => {
            const controls = dlg.element.querySelectorAll("input, select");

            let updateObject = {};

            for (let i = 0; i < controls.length; i += 1) {
              const control = controls[i];
              let value;
              if (control.dataset["dtype"] === "Boolean") {
                value = control.checked;
              } else {
                value = control.value;
              }

              updateObject[control.name] = value;
              this.options[control.id].value = value;
            }

            const item = await fromUuid(this.data.item.uuid);
            if (!item) {
              return ui.notifications.warn("Unable to find item");
            }
            for (const flag of Object.keys(updateObject)) {
              await item.setFlag("starwarsffg", flag, updateObject[flag]);
            }

            this.data.object.update(updateObject);
            this.data.object.sheet.render(true);
          },
        },
        {
          action: "two",
          icon: "fas fa-times",
          label: game.i18n.localize("SWFFG.Cancel"),
        },
      ],
    });
    ItemOptions._openDialogs.set(openKey, dialog);
    dialog.addEventListener("close", () => {
      if (ItemOptions._openDialogs.get(openKey) === dialog) {
        ItemOptions._openDialogs.delete(openKey);
      }
    }, { once: true });
    dialog.render({ force: true });
  }

  async register(optionName, options) {
    if (!this.options[optionName]) {
      this.options[optionName] = { ...options };
    }
    if (typeof this.data.object.flags?.starwarsffg?.config == "undefined") {
      await this.data.object.setFlag("starwarsffg", "config", {});
    }

    if (typeof this.data.object.flags?.starwarsffg?.config[optionName] !== "undefined") {
      this.options[optionName].value = this.data.object.flags?.starwarsffg?.config[optionName];
    } else {
      this.options[optionName].value = this.options[optionName].default;
    }
  }

  registerMany(optionsArray) {
    optionsArray.forEach((option) => {
      this.register(option.name, option.options);
    });
  }

  unregister(optionName) {
    delete this.options[optionName];
  }

  clear() {
    this.options = {};
  }
}
