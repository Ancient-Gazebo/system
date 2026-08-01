import ActorHelpers from "../helpers/actor-helpers.js";

const { DialogV2 } = foundry.applications.api;

export default class ActorOptions {
  /**
   * Per-actor cache of suspended Active Effect state, keyed by actor UUID.
   *
   * `ActorOptions` is reinstantiated on every sheet render (see
   * `actor-sheet-ffg.js` activateListeners), so instance state cannot survive
   * the `sheet.render(true)` call that the edit-mode handler issues itself.
   * The cache must live on the class so the next dialog open can find the
   * original AE state recorded when edit mode was first enabled and use it
   * to revert via `ActorHelpers.endEditMode`. Without this, toggling edit
   * mode OFF after a re-render finds an empty `this.suspended`, skips
   * `endEditMode`, and leaves AEs disabled until world reload.
   *
   * Lost on full page reload, which is acceptable — edit mode is a transient
   * authoring affordance, not persisted state.
   */
  static _suspendedAECache = new Map();

  /**
   * Per-actor Sheet Options dialog instance, keyed by actor uuid. Used to
   * enforce a single-instance policy: a second click on the Sheet Options
   * button while a dialog is already open should focus it rather than open
   * a second copy. Entries are removed when the dialog closes.
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
      // matching `.starwarsffg.sheet.actor[data-appid=...]` (e.g. unexpected
      // class list on a token actor sheet or a subclass that strips classes).
      console.warn(`starwarsffg | ActorOptions.init: could not resolve sheet root for appId="${this.data.appId}"; Sheet Options button will not be injected.`);
      return;
    }
    if (root.querySelector(":scope > .window-header > .ffg-sheet-options")) return;

    const header = root.querySelector(":scope > .window-header");
    if (!header) {
      console.warn(`starwarsffg | ActorOptions.init: sheet root for appId="${this.data.appId}" has no :scope > .window-header; Sheet Options button will not be injected.`);
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
          && node.classList.contains("actor")
        ) {
          candidates.push(node);
        }
      }
    };

    const sheetElement = this.data.element?.jquery ? this.data.element[0] : this.data.element;
    const htmlElement = html?.jquery ? html[0] : html?.[0] ?? html;
    addAncestors(sheetElement);
    addAncestors(htmlElement);
    candidates.push(...document.querySelectorAll(`.starwarsffg.sheet.actor[data-appid="${appId}"]`));

    return candidates.find((element) => element.querySelector(":scope > .window-header")) ?? candidates[0] ?? null;
  }

  async handler(event) {
    // The injected button is an <a href="#">; without preventDefault the
    // browser navigates to the page URL with `#` appended and can scroll
    // the page. stopPropagation keeps the click from bubbling into V13's
    // window header handling.
    event?.preventDefault?.();
    event?.stopPropagation?.();

    // Allow only one Sheet Options dialog per actor at a time. Repeated
    // clicks should focus the existing dialog rather than stacking new ones.
    const openKey = this.data.object.uuid;
    const existing = ActorOptions._openDialogs.get(openKey);
    if (existing?.rendered) {
      existing.bringToFront?.();
      return;
    }
    const title = `${game.i18n.localize("SWFFG.CharacterSheet")} ${game.i18n.localize("SWFFG.Options")}: ${this.data.actor.name}`;

    // Render the legacy options template ourselves. The template's own
    // `{{#each buttons}}` loop is left empty (we don't pass `buttons`) so
    // DialogV2's native button bar is the only button row.
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

              updateObject[`flags.starwarsffg.${control.name}`] = value;
              this.options[control.id].value = value;
            }

            // read the most recent version, not the registered flag version
            const editMode = updateObject['flags.starwarsffg.config.enableEditMode'];
            const cache = ActorOptions._suspendedAECache;
            const cacheKey = this.data.object.uuid;
            const stored = cache.get(cacheKey);
            if (editMode) {
              if (!stored) {
                // suspend AEs
                const suspended = await ActorHelpers.beginEditMode(this.data.object);
                cache.set(cacheKey, suspended);
                updateObject[`flags.starwarsffg.config.editModeActor`] = game.user.id;
              }
            } else {
              // unsuspend AEs
              if (stored) {
                await ActorHelpers.endEditMode(this.data.object, stored);
                cache.delete(cacheKey);
              }
              updateObject[`flags.starwarsffg.config.editModeActor`] = "";
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
    ActorOptions._openDialogs.set(openKey, dialog);
    // Drop the entry on close (button submit, × control, or Esc all fire the
    // DialogV2 close event) so a fresh click reopens a new dialog.
    dialog.addEventListener("close", () => {
      if (ActorOptions._openDialogs.get(openKey) === dialog) {
        ActorOptions._openDialogs.delete(openKey);
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
