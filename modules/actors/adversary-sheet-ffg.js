import { ActorSheetFFG } from "./actor-sheet-ffg.js";
import ActorOptions from "./actor-ffg-options.js";

export class AdversarySheetFFG extends ActorSheetFFG {
  constructor(...args) {
    super(...args);
  }

  /** @override */
  get template() {
    const path = "systems/starwarsffg/templates/actors";
    return `${path}/ffg-adversary-sheet.html`;
  }

  // Only the adversary-specific delta from ActorSheetFFG. `position`, `tabs`,
  // and `scrollY` are inherited and intentionally NOT re-declared: DEFAULT_OPTIONS
  // arrays concatenate across the inheritance chain, so re-declaring `tabs` would
  // bind two Tabs instances. The per-type template comes from get template().
  static DEFAULT_OPTIONS = {
    classes: ["starwarsffg", "sheet", "actor", "adversary", "v2"],
  };

  /**
   * @override
   * NOTE: `getData` MUST be async and MUST await `super.getData()` - the parent
   * `ActorSheetFFG.getData` is async (returns a Promise). A sync `super.getData()`
   * here hands back a Promise, so every read below (`data.limited`, `data.talentList`,
   * ...) sees `undefined` and the `data.items` tweak lands on the Promise wrapper
   * and is silently lost.
   */
  async getData() {
    const data = await super.getData();
    switch (this.actor.type) {
      case "character":
        this.position.width = 595;
        this.position.height = 783;
        if (data.limited) {
          this.position.height = 165;
        }

        break;
      default:
    }

    data.items = this.actor.items.map((item) => item);

    return data;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    if (!this.options.editable) return;

    if (this.actor.type === "character") {
      this.sheetoptions.clear();
      this.sheetoptions.register("enableAutoSoakCalculation", {
        name: game.i18n.localize("SWFFG.EnableSoakCalc"),
        hint: game.i18n.localize("SWFFG.EnableSoakCalcHint"),
        type: "Boolean",
        default: true,
      });
      this.sheetoptions.register("enableForcePool", {
        name: game.i18n.localize("SWFFG.EnableForcePool"),
        hint: game.i18n.localize("SWFFG.EnableForcePoolHint"),
        type: "Boolean",
        default: true,
      });
      this.sheetoptions.register("enableStrainThreshold", {
        name: game.i18n.localize("SWFFG.EnableStrainThreshold"),
        hint: game.i18n.localize("SWFFG.EnableStrainThresholdHint"),
        type: "Boolean",
        default: true,
      });
      this.sheetoptions.register("talentSorting", {
        name: game.i18n.localize("SWFFG.EnableSortTalentsByActivation"),
        hint: game.i18n.localize("SWFFG.EnableSortTalentsByActivationHint"),
        type: "Array",
        default: 0,
        options: [game.i18n.localize("SWFFG.UseGlobalSetting"), game.i18n.localize("SWFFG.OptionValueYes"), game.i18n.localize("SWFFG.OptionValueNo")],
      });
    }
  }
}
