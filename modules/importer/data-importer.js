import ImportHelpers from "./import-helpers.js";
import OggDude from "./oggdude/oggdude.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

export default class DataImporter extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "data-importer",
    tag: "form",
    form: {
      handler: DataImporter._startImport,
      submitOnChange: false,
      closeOnSubmit: false
    },
    window: {
      title: "Data Importer",
      contentClasses: ["standard-form"]
    },
    actions: {
      loadFile: DataImporter._loadFile,
      selectAll: DataImporter._enableImportAll,
    },
  }

  static PARTS = {
    importer: {
      template: "systems/starwarsffg/templates/importer/data-importer.html",
      classes: ["starwarsffg", "data-import"],
    },
    footer: {
      template: "templates/generic/form-footer.hbs",
    }
  }

  /** @override */
  constructor(options) {
    super(options);
    this.oggdude = OggDude;
    this.importers = this.oggdude.Meta;
    this.canImport = {};
    this.shouldImport = {};
  }

  /**
   * Return a reference to the target attribute
   * @type {String}
   */
  get attribute() {
    return this.options.name;
  }

  /** @override */
  async _prepareContext() {
    let data = await foundry.applications.apps.FilePicker.browse("data", "", { bucket: null, extensions: [".zip", ".ZIP"], wildcard: false });
    const files = data.files.map((file) => decodeURIComponent(file));

    document.querySelectorAll('.import-progress').forEach(el => el.classList.add('import-hidden'));

    if (!CONFIG?.temporary) {
      CONFIG.temporary = {};
    }

    return {
      importers: this.importers,
      data,
      files,
      cssClass: "data-importer-window",
      buttons: [
        { type: "submit", icon: "fas fa-file-import", label: "SWFFG.ImportFile", disabled: true }
      ]
    };
  }

  /** @override */
  _onRender(context, options) {
    // Add debug log option to window header
    const debugSpan = document.createElement("span");
    debugSpan.className = "debug";
    debugSpan.innerHTML = `<label><input type="checkbox" /> Generate Log</label>`;
    const headerCloseButton = this.element?.querySelector("#data-importer header button[data-action=close]");
    if (headerCloseButton && headerCloseButton.parentNode) {
      headerCloseButton.parentNode.insertBefore(debugSpan, headerCloseButton);
    }

    // Use a short timeout to ensure all async DOM updates are complete before positioning
    setTimeout(this.setPosition.bind(this), 50);
  }

  _importLog = [];
  _importLogger(message) {
    let checked = false;
    checked = Array.from(document.querySelectorAll('.debug input')).some(el => el.checked);
    if (checked) {
      this._importLog.push(`[${new Date().getTime()}] ${message}`);
    }
    CONFIG.logger.debug(message)
  }

  /**
   * Enable all checkboxes for import rather than forcing the user to click them all one at a time
   * @private
   */
  static _enableImportAll(event, target) {
    // Scoped for the same reason as _loadFile: never touch another window's checkboxes.
    const scope = this.element ?? document;
    scope.querySelectorAll("input[type='checkbox'][name='imports']").forEach(el => el.checked = true);
  }

  static async _readFile(scope = document) {
    let selectedFile, form, file, zip;

    const input = scope.querySelector("#import-file");
    selectedFile = input ? input.value : "";

    if (selectedFile) {
      // Read file on server from selector
      zip = await fetch(`/${selectedFile}`)
        .then(function (response) {
          if (response.status === 200 || response.status === 0) {
            return Promise.resolve(response.blob());
          } else {
            return Promise.reject(new Error(response.statusText));
          }
        })
        .then(JSZip.loadAsync);
    } else {
      // Read local file from picker
      form = scope.querySelector("form.data-importer-window");
      file = form?.data?.files[0];

      if (typeof file !== "undefined") {
        zip = await ImportHelpers.readBlobFromFile(file).then(JSZip.loadAsync);
      } else {
        ui.notifications.warn(game.i18n.localize("SWFFG.Notifications.Import.NoFileWarning"));
        return undefined;
      }
    }
    return zip;
  }

  static async _loadFile(event, target) {
    // Reset defaults
    const form = target.closest("form");
    if (form) {
      form.querySelectorAll("input[type='checkbox'][name='imports']").forEach(el => el.disabled = true);
    }

    try {
      let zip = await DataImporter._readFile(this.element);
      if (typeof zip === "undefined") return;

      // Scope every lookup to this application's own root element. Two separate things go wrong
      // otherwise. A bare document.querySelector returns the FIRST match in the whole page, so
      // with any other window open that has a submit button -- the GM screen module is one --
      // `button[type='submit']` resolved to that window's button instead, leaving Start Import
      // disabled. But `target.closest("form")` is not the app root either: the template's own
      // <form class="data-importer-window"> nests inside the app's form, and the Start Import
      // button is rendered by the separate footer part, outside that inner form -- so scoping to
      // it matches nothing and the enable below silently no-ops. `this.element` is the app root:
      // it contains every part of this window and nothing belonging to any other window.
      const scope = this.element ?? form ?? document;

      const selectAll = scope.querySelector("[data-action='selectAll']");
      // Was `if (importAll !== null)`, and `importAll` is declared nowhere: in a module (always
      // strict mode) that reference throws a ReferenceError, which the surrounding catch turned
      // into a generic "file load error" -- skipping the rest of this block, including the line
      // that enables Start Import. Test the variable actually being used.
      if (selectAll !== null) selectAll.disabled = false;

      for (const importer of Object.values(this.importers)) {
        this.canImport[importer.itemName] = this._enableImportSelection(importer.displayName, importer.className, zip.files);
      }

      const startImport = scope.querySelector("button[type='submit']")
      if (startImport !== null) startImport.disabled = false;

    } catch (err) {
      ui.notifications.error(game.i18n.localize("SWFFG.Notifications.Import.FileLoadError"));
      console.error(err);
    }
  }

  static async _startImport(event, form, formData) {
    CONFIG.logger.debug("Importing Data Files");
    this._importLogger(`Starting import`);

    let zip = await DataImporter._readFile(this.element);
    if (typeof zip === "undefined") {
      this._importLogger("zip file not found, exiting!");
      return;
    }

    // As in _loadFile: scope to this application ROOT, not the whole document (another open
    // window's submit button or checkboxes must not be read or disabled instead of ours) and not
    // a nested form (the footer button sits outside the template's inner form). `form` from the
    // ApplicationV2 form handler is the app root here, but keep the two paths identical.
    const scope = this.element ?? form ?? document;

    // Disable submit button to prevent double clicking
    const startImport = scope.querySelector("button[type='submit']")
    if (startImport !== null) startImport.disabled = true;

    let importFiles = Array.from(scope.querySelectorAll("input[type='checkbox'][name='imports']:checked")).map(el => (
      el.dataset.itemtype
    ));

    for (const importer of scope.querySelectorAll("input[type='checkbox'][name='imports']")) {
      const itemName = $(importer).data("itemtype");
      this.shouldImport[itemName] = importer.checked;
    }

    if (scope.querySelector("#deleteExisting")?.checked) {
      for (const itemType of importFiles) {
        await this._deleteCompendium(itemType);
      }
    }

    // If skills are not selected for import, pre-populate the skills cache so other importers
    // (weapons, species, careers, etc.) can still resolve skill keys without errors.
    if (!this.shouldImport["skills"]) {
      CONFIG.temporary["skills"] = {};
      const skillsPack = game.packs.get("world.oggdudeskilldescriptions");
      if (skillsPack) {
        this._importLogger("Skills not selected for import - loading skills from world compendium");
        const skillDocs = await skillsPack.getDocuments();
        for (const doc of skillDocs) {
          const importId = doc.flags?.starwarsffg?.ffgimportid;
          if (importId) {
            CONFIG.temporary.skills[importId] = doc.name;
          }
        }
        this._importLogger(`Loaded ${Object.keys(CONFIG.temporary.skills).length} skills from world compendium`);
      }
    }

    for (let cur_phase = 1; cur_phase < 9; cur_phase++) {
      this._importLogger(`Beginning import phase ${cur_phase}`);
      const cur_phase_promises = [];
      const cur_phase_imports = Object.values(this.importers).filter(i => i.phase === cur_phase);
      await this.asyncForEach(cur_phase_imports, async (curImport) => {
        if (!this.shouldImport[curImport.itemName]) {
          this._importLogger(`Skipping unselected import of ${curImport.displayName}`);
        } else {
          if (curImport.filesAreDir && !["background"].includes(curImport.itemName) ) {
            cur_phase_promises.push(
              OggDude.Import[curImport.className](zip)
            );
          } else {
            for (const curFilename of curImport.fileNames) {
              this._importLogger(`Importing from ${curFilename}`);
              const selectedFile = Object.values(zip.files).find(f => f.name.includes(curFilename));
              if (!selectedFile) {
                this._importLogger(`Skipping '${curFilename}' — no matching file found in the imported data set.`);
                continue;
              }
              const data = await zip.file(selectedFile.name).async("text");
              const xmlDoc = ImportHelpers.stringToXml(data);

              cur_phase_promises.push(
                OggDude.Import[curImport.className](xmlDoc, zip)
              );
            }
          }
        }
      });
      await Promise.all(cur_phase_promises);
      this._importLogger(`Done importing phase ${cur_phase}!`);
    }
    this._importLogger("Done with import!");

    let checked = false;
    checked = Array.from(document.querySelectorAll('.debug input')).some(el => el.checked);
    if (checked) {
      foundry.utils.saveDataToFile(this._importLog.join("\n"), "text/plain", "import-log.txt");
    }

    CONFIG.temporary = {};
    this.close();
  }

  /**
   * Called when Load File is clicked - enables checkboxes for item types which are in the selected ZIP
   * @param displayName - the display name of the item type we're checking for (used for logging)
   * @param className - the class name of the item type we're checking for (used to find the input)
   * @param files - files object for the uploaded ZIP
   * @private
   */
  _enableImportSelection(displayName, className, files) {
    const element = $(this.element).find(`#import${className}`);
    const canEnable = this.canEnable(displayName, element, files);
    if (canEnable) {
      element.removeAttr("disabled");
    }
    return canEnable;
  }

  /**
   * Checks if a given input should be enabled based on the presence of pre-defined files in the selected ZIP
   * @param displayName - the display name of the input we're checking for (used for logging)
   * @param element - input element which contains additional metadata
   * @param zipFiles - files object for the uploaded ZIP
   * @returns {boolean} - should this be enabled or not?
   * @private
   */
  canEnable(displayName, element, zipFiles) {
    this._importLogger(`Determining if we should enable import for ${displayName}`);
    const fileNames = element.data("filenames").split(",");
    const filesAreDir = element.data("filesaredir");
    let shouldEnable = true;

    for (const file of fileNames) {
      const foundFile = Object.values(zipFiles).filter(i => i.name.includes(file) && i.dir === filesAreDir).length > 0;
      if (!foundFile) {
        shouldEnable = false;
        break;
      }
    }

    this._importLogger(`Should include outcome for ${displayName}: ${shouldEnable}`);
    return shouldEnable;
  }

  asyncForEach = async (array, callback) => {
    for (let index = 0; index < array.length; index += 1) {
      await callback(array[index], index, array);
    }
  };

  async _deleteCompendium(itemType) {
    const typeToCompendium = {
      armor: ["world.oggdudearmor"],
      background: ["world.oggdudebackgrounds"],
      career: ["world.oggdudecareers"],
      forcepower: ["world.oggdudeforcepowers"],
      gear: ["world.oggdudegear"],
      itemmodifier: ["world.oggdudearmormods", "world.oggdudeweaponmods", "world.oggdudegenericmods", "world.oggdudevehiclemods"],
      itemattachment: ["world.oggdudearmorattachments", "world.oggdudeweaponattachments", "world.oggdudegenericattachments", "world.oggdudevehicleattachments"],
      motivation: ["world.oggdudemotivations"],
      obligation: ["world.oggdudeobligation"],
      signatureability: ["world.oggdudesignatureabilities"],
      skills: ["world.oggdudeskilldescriptions"],
      specialization: ["world.oggdudespecializations"],
      species: ["world.oggdudespecies"],
      talent: ["world.oggdudetalents"],
      vehicle: ["world.oggdudevehiclesplanetary", "world.oggdudevehiclesspace"],
      weapon: ["world.oggdudeweapons", "world.oggdudevehicleweapons"],
    };

    for (const curType of typeToCompendium[itemType]) {
      const pack = game.packs.get(curType);
      if (pack) {
        this._importLogger(`Deleting compendium: ${pack.metadata.name}`);
        await pack.deleteCompendium();
      }
    }
  }
}
