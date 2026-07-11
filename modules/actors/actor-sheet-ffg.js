/**
 * Extend the basic ActorSheet with some very simple modifications
 * @extends {ActorSheet}
 */
import PopoutEditor from "../popout-editor.js";
import DiceHelpers from "../helpers/dice-helpers.js";
import { preparedSystemCopy } from "../datamodels/sheet-data.js";
import ActorOptions from "./actor-ffg-options.js";
import ImportHelpers from "../importer/import-helpers.js";
import ModifierHelpers from "../helpers/modifiers.js";
import ActorHelpers, {xpLogEarn, xpLogSpend} from "../helpers/actor-helpers.js";
import TalentTree from "../helpers/talent-tree.js";
import ItemHelpers from "../helpers/item-helpers.js";
import StackHelpers from "../helpers/stack-helpers.js";
import EmbeddedItemHelpers from "../helpers/embeddeditem-helpers.js";
import EffectHelpers from "../helpers/effects.js";
import TalentOrganization from "../helpers/talent-organization.js";
import GearOrganization from "../helpers/gear-organization.js";
import WeaponOrganization from "../helpers/weapon-organization.js";
import AbilityOrganization from "../helpers/ability-organization.js";
import {
  change_role,
  deregister_crew,
  build_crew_roll,
  updateRoles,
  handlePilotCheck,
  buildPilotRoll
} from "../helpers/crew.js";
import {DicePoolFFG} from "../dice/pool.js";
import {get_dice_pool} from "../helpers/dice-helpers.js";
import {itemPillHover} from "../swffg-main.js";

export class ActorSheetFFG extends foundry.appv1.sheets.ActorSheet {
  constructor(...args) {
    super(...args);
    /**
     * Track the set of filters which are applied
     * @type {Set}
     */
    this._filters = {
      skills: new Set(),
    };
    this.object.setFlag("starwarsffg", "config.enableEditMode", false);
    this.object.setFlag("starwarsffg", "config.editModeActor", "");
  }

  pools = new Map();

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["starwarsffg", "sheet", "actor"],
      template: "systems/starwarsffg/templates/actors/ffg-character-sheet.html",
      width: 710,
      height: 650,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "characteristics" }],
      scrollY: [".tableWithHeader", ".tab", ".skillsGrid", ".skillsTablesGrid"],
    });
  }

  /** @override */
  get template() {
    const path = "systems/starwarsffg/templates/actors";
    return `${path}/ffg-${this.actor.type}-sheet.html`;
  }

  /** @override */
  setPosition(position = {}) {
    const result = super.setPosition(position);
    // Remember user-driven resizes so subsequent re-renders (drag-reorder, new tab, etc.)
    // don't resnap the sheet back to its default size. getData restores from these values.
    if (this.rendered && Number.isFinite(this.position?.width) && Number.isFinite(this.position?.height)) {
      this.sheetWidth = this.position.width;
      this.sheetHeight = this.position.height;
    }
    return result;
  }

  /** @override */
  async _onDropItem(event, data) {
    if(!this.actor.verifyEditModeIsNotEnabled()) return false;

    if (data?.type === "Item") {
      // this is the stock implementation, except that we do not pass "true" to item.toObject
      if ( !this.actor.isOwner ) return false;
      const item = await Item.implementation.fromDropData(data);
      // do not Draw values from the underlying data source rather than transformed values - we want to use adjusted values
      const itemData = item.toObject(false);

      // Handle item sorting within the same Actor
      if ( this.actor.uuid === item.parent?.uuid ) return this._onSortItem(event, itemData);

      if (["character", "minion", "rival"].includes(this.actor.type) && ["itemmodifier", "itemattachment"].includes(itemData.type)) {
        ui.notifications.warn("You cannot add Item Modifiers or Attachments directly to actors.");
        return false;
      }

      if (this.actor.type === "character" && itemData.type === "species") {
        // add starting XP from species
        const curAvailable = parseInt(this.actor.system?.experience?.available);
        const curTotal = parseInt(this.actor.system?.experience?.total);
        const startingXP = parseInt(itemData.system?.startingXP);
        await this.actor.update(
          {
            system: {
              experience: {
                available: curAvailable + startingXP,
                total: curTotal + startingXP,
              }
            }
          }
        );
        await xpLogEarn(this.actor, startingXP, curAvailable + startingXP, curTotal + startingXP, game.i18n.format("SWFFG.GrantXPSpecies", {species: itemData.name}) );
      }

      if (this.actor.type === "character" && ["talent", "specialization", "signatureability", "forcepower"].includes(itemData.type)) {
        const cost = await this.calcPurchasePrice(itemData);
        // Always ask the player to Purchase or Grant whenever the item has a cost. Previously this
        // was gated on `cost < availableXP`, which silently granted the item for free whenever the
        // character could not currently afford it (e.g. before a species had added starting XP).
        if (cost > 0) {
          // Shared purchase routine so the standard and mentor-discounted buttons don't duplicate
          // the XP-deduction/logging logic. `effectiveCost` is what actually gets charged.
          const performPurchase = async (effectiveCost, noteSuffix = "") => {
            if (!this.actor.verifyEditModeIsNotEnabled()) return false;
            if (effectiveCost <= 0) return;
            const updatedAvailableXP = this.actor.system.experience.available;
            if (effectiveCost > updatedAvailableXP) {
              // Can't afford it: warn and leave XP untouched rather than going negative.
              ui.notifications.warn(game.i18n.localize("SWFFG.Actors.Sheets.Purchase.NotEnoughXP"));
              return;
            }
            const AEState = await ActorHelpers.beginEditMode(this.actor, true);
            await this.object.update({
              system: {
                experience: {
                  available: updatedAvailableXP - effectiveCost,
                }
              }
            });
            // For a base Force power or signature ability, record refund metadata so it can be
            // refunded from the XP log. The item id is not known yet (it is created after this
            // dialog), so match by name later.
            let refundMeta;
            if (itemData.type === "forcepower") {
              refundMeta = {kind: "forcepower-base", name: itemData.name};
            } else if (itemData.type === "signatureability") {
              refundMeta = {kind: "signatureability-base", name: itemData.name};
            } else {
              refundMeta = undefined;
            }
            await xpLogSpend(
                this.actor, `${game.i18n.localize("SWFFG.DragDrop.XPLog")} ${itemData.type} ${itemData.name}${noteSuffix}`,
                effectiveCost,
                this.actor.system.experience.available,
                this.actor.system.experience.total,
                undefined,
                refundMeta
            );
            await ActorHelpers.endEditMode(this.actor, AEState, true);
          };

          const buttons = {
            purchase: {
              icon: '<i class="fas fa-hourglass"></i>',
              label: game.i18n.localize("SWFFG.DragDrop.PurchaseItem"),
              callback: async () => await performPurchase(cost),
            },
          };

          // Force and Destiny mentor rule: the basic form of a Force power can be learned for a
          // 5 XP discount (to a minimum cost of 5 XP) when the character has a mentor. Offer it as
          // an explicit choice; it only applies to the base power purchased here, not upgrades.
          if (itemData.type === "forcepower") {
            const mentorCost = Math.max(cost - 5, 5);
            if (mentorCost < cost) {
              buttons.mentor = {
                icon: '<i class="fas fa-user-graduate"></i>',
                label: game.i18n.format("SWFFG.DragDrop.PurchaseItemMentor", { cost: mentorCost }),
                callback: async () => await performPurchase(mentorCost, ` (${game.i18n.localize("SWFFG.DragDrop.MentorDiscountLog")})`),
              };
            }
          }

          buttons.grant = {
            icon: '<i class="fas fa-recycle"></i>',
            label: game.i18n.localize("SWFFG.DragDrop.GrantItem"),
          };

          new Dialog(
          {
            title: game.i18n.localize("SWFFG.DragDrop.Title"),
            buttons: buttons,
          },
          {
            classes: ["dialog", "starwarsffg"],
          }
        ).render(true);
        }
      }

      if (Object.keys(itemData).includes("effects") && ["armour", "weapon"].includes(itemData.type)) {
        // make sure all non-inherent AEs are disabled on the item before the drag-and-drop
        for (const effect of itemData.effects) {
          if (effect.name !== "(inherent)") {
            effect.disabled = true;
          }
        }
      }

      // Create the owned item
      return this._onDropItemCreate(itemData);
    } else {
      return super._onDropItem(event, data);
    }
  }

  async calcPurchasePrice(itemData) {
    let cost = 0;
    if (itemData.type === "specialization") {
      // check if the specialization is in career
      const career = this.actor.items.find(i => i.type === "career");
      if (career) {
        const inCareerSpecializations = Object.values(career?.system?.specializations) || [];
        let inCareer = false;
        for (const careerSpecialization of inCareerSpecializations) {
          if (careerSpecialization.name === itemData.name) {
            inCareer = true;
            break;
          }
        }
        const specializationCount = (this.actor.items.filter(i => i.type === "specialization") || []).length;
        cost = (specializationCount + 1) * 10;
        return cost;
      } else {
        return -1;
      }
    } else if (itemData.type === "talent" && game.settings.get("starwarsffg", "dicetheme") === "genesys") {
      return itemData.system.tier * 5;
    } else if (itemData.type === "signatureability") {
      return itemData.system.base_cost;
    } else if (itemData.type === "forcepower") {
      return itemData.system.base_cost;
    }
    return -1;
  }

  /* -------------------------------------------- */

  /** @override */
  async getData(options) {
    const data = await super.getData();
    data.classType = this.constructor.name;

    // Compatibility for Foundry 0.8.x with backwards compatibility (hopefully) for 0.7.x
    const actorData = this.actor.toObject(false);
    data.actor = actorData;
    // `toObject` only serializes schema fields, dropping derived data (skilltypes,
    // *OverThreshold, merged/localized skills, ...) once a DataModel is registered.
    // Source the mutable display copy from the live prepared system instead.
    data.data = preparedSystemCopy(this.actor);

    // Force Presence balance-point scale. Dark points fill from the left edge, light points from
    // the right edge, and the remainder stay neutral. Reads are guarded so actors created before
    // this field existed (no system.forcePresence) still render a full neutral scale.
    const fp = data.data.forcePresence || {};
    const fpMax = Number(fp.max) || 10;
    let fpDark = Math.max(0, Math.min(Number(fp.dark) || 0, fpMax));
    let fpLight = Math.max(0, Math.min(Number(fp.light) || 0, fpMax));
    if (fpDark + fpLight > fpMax) {
      fpLight = fpMax - fpDark;
    }
    data.forcePresence = {
      dark: fpDark,
      light: fpLight,
      max: fpMax,
      points: Array.from({ length: fpMax }, (_, i) => {
        if (i < fpDark) return "dark";
        if (i >= fpMax - fpLight) return "light";
        return "neutral";
      }),
    };

    // Gate the Force Presence scale, Tranquility, and Conflict boxes on the character having a
    // Maximum Force Rating of at least 1. We read forcePool.max (and the active-effect-adjusted
    // value) rather than the available pool, so the boxes persist even when every Force die is
    // committed (committing changes forcePool.value, not forcePool.max).
    const forcePool = data.data?.stats?.forcePool || {};
    const maxForceRating = Math.max(Number(forcePool.max) || 0, Number(forcePool.adjusted) || 0);
    data.hasForceRating = maxForceRating >= 1;
    data.talentList = this.actor.talentList;
    data.rollData = this.actor.getRollData.bind(this.actor);

    data.token = this.token;
    // Present items in their persisted "sort" order (falling back to name) so that
    // user-defined drag-and-drop ordering of the inventory is honored on the sheet.
    data.items = this.actor.items.contents
      .slice()
      .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));

    if (options?.action === "update" && this.object.compendium) {
      data.item = foundry.utils.mergeObject(data.actor, options.data);
    }

    data.dtypes = ["String", "Number", "Boolean"];
    for (let attr of Object.values(data.data.attributes)) {
      attr.isCheckbox = attr.dtype === "Boolean";
    }
    data.FFG = CONFIG.FFG;

    let autoSoakCalculation = true;

    if (typeof this.actor.flags?.starwarsffg?.config?.enableAutoSoakCalculation === "undefined") {
      autoSoakCalculation = game.settings.get("starwarsffg", "enableSoakCalc");
    } else {
      autoSoakCalculation = this.actor.flags?.starwarsffg?.config?.enableAutoSoakCalculation;
    }

    data.settings = {
      enableSoakCalculation: autoSoakCalculation,
      enableCriticalInjuries: this.actor.flags?.starwarsffg?.config?.enableCriticalInjuries,
    };

    // Establish sheet width and height using either saved persistent values or default values defined in swffg-config.js
    this.position.width = this.sheetWidth || CONFIG.FFG.sheets.defaultWidth[this.actor.type];
    this.position.height = this.sheetHeight || CONFIG.FFG.sheets.defaultHeight[this.actor.type];

    switch (this.actor.type) {
      case "character":
      case "nemesis":
      case "rival":
        if (data.limited) {
          this.position.height = 165;
        }
        // we need to update all specialization talents with the latest talent information
        if (!this.actor.flags.starwarsffg?.loaded && this.actor.type !== "rival") {
          // TODO: is this actually needed?
          await this._updateSpecialization(data);
          await this.object._prepareCharacterData(data);
        }

        // Build display data for every configured currency denomination. Values over 999 get
        // grouping separators (matching the legacy credits box); the strip-back-to-integer happens
        // in ActorHelpers.updateActor on save. `name` maps data.* -> system.* via migrateDataToSystem.
        const currencyConfig = CONFIG.FFG?.currencies || {};
        data.currencies = Object.entries(currencyConfig).map(([key, cfg]) => {
          let value = Number(foundry.utils.getProperty(data.data, `currency.${key}`)) || 0;
          let display = value;
          if (value > 999) {
            display = value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
          }
          const labelKey = cfg.label || key;
          return {
            key,
            name: `data.currency.${key}`,
            label: game.i18n.has(labelKey) ? game.i18n.localize(labelKey) : labelKey,
            value: display,
          };
        });
        data.data.enrichedBio = await foundry.applications.ux.TextEditor.enrichHTML(this.actor.system.biography, {secrets: !data.limited});
        data.data.general.enrichedNotes = await foundry.applications.ux.TextEditor.enrichHTML(this.actor.system.general?.notes) || "";
        data.data.general.enrichedFeatures = await foundry.applications.ux.TextEditor.enrichHTML(this.actor.system.general?.features) || "";
        data.maxAttribute = game.settings.get("starwarsffg", "maxAttribute");
        data.obligationItems = {
          obligations: data.items.filter(i => i.system?.type === "obligation"),
          duties: data.items.filter(i => i.system?.type === "duty"),
          moralities: data.items.filter(i => i.system?.type === "morality"),
        };
        break;
      case "vehicle":
        data.data.enrichedBio = await foundry.applications.ux.TextEditor.enrichHTML(this.actor.system.biography);
        // add the crew to the items of the vehicle
        data.crew = [];
        // look up the flag data
        const crew = this.actor.getFlag('starwarsffg', 'crew');
        if (crew) {
          for (let i = 0; i < crew.length; i++) {
            try {
              // iterate over the crew members in the flag data
              const actor = game.actors.get(crew[i].actor_id);
              // pull the image from the actor to display it
              const img = actor?.img || 'icons/svg/mystery-man.svg';

              // add them to the items, so we can render them on the sheet
              let roll;
              if (actor) {
                if (crew[i].role !== "Pilot") {
                  roll = build_crew_roll(this.actor.id, crew[i].actor_id, crew[i].role);
                } else {
                  roll = (await buildPilotRoll(this.actor.id, crew[i].actor_id, 0)).renderPreview().innerHTML;
                }
              } else {
                deregister_crew(this.actor, crew[i].actor_id, crew[i].role);
              }
              if (!roll) {
                roll = 'N/A';
              }
              data.crew.push({
                'type': 'shipcrew',
                'id': crew[i].actor_id,
                'name': crew[i].actor_name,
                'role': crew[i].role,
                'img': img,
                'roll': roll,
                'link': crew[i]?.link,
              });
            } catch (e) {
              data.crew.push({
                'type': 'shipcrew',
                'id': crew[i].actor_id,
                'name': crew[i].actor_name,
                'role': crew[i].role,
                'img': '',
                'roll': '(broken role)',
                'link': '',
              });
            }
          }
        }
      default:
    }

    if (this.actor.type !== "vehicle" && this.actor.type !== "homestead") {
      // Filter out skills that are not custom (manually added) or part of the current system skill list
      Object.keys(data.data.skills)
      .filter(s => !data.data.skills[s].custom && !CONFIG.FFG.skills[s])
      .forEach(s => delete data.data.skills[s]);

      data.data.skilllist = this._createSkillColumns(data);
    }

    if (this.actor.flags?.starwarsffg?.xpLog) {
      data.xpLog = this.object.getFlag("starwarsffg", "xpLog") || [];
    }

    data.actor.items = ActorSheetFFG.sortForActorSheet(data.actor.items);
    const editModeEnabled = this.object.getFlag("starwarsffg", "config.enableEditMode");
    const editModeActor = this.object.getFlag("starwarsffg", "config.editModeActor");
    data.disabled = !(editModeEnabled && editModeActor === game.user.id);

    data.modTypeSelected = "all"; // TODO: should this be something else?
    data.modifierTypes = CONFIG.FFG.allowableModifierTypes;
    data.modifierChoices = CONFIG.FFG.allowableModifierChoices;

    // Include active effects. `effects` is derived data attached in _prepareSharedData,
    // so it lives on the prepared system copy (data.data), not the toObject serialization.
    data.effects = (data.data.effects || []).map(EffectHelpers.transformEffects);

    // Build the (optional) manual talent organization into collapsible tabs
    data.talentOrg = TalentOrganization.buildGroups(this.actor, data.talentList);

    // Build the (optional) manual gear organization into collapsible tabs
    data.gearOrg = GearOrganization.buildGroups(this.actor, data.items.filter((i) => i.type === "gear"));

    // Same for the Combat tab's weapons list
    data.weaponOrg = WeaponOrganization.buildGroups(this.actor, data.items.filter((i) => i.type === "weapon"));

    // Same for the Abilities list (Talents tab)
    data.abilityOrg = AbilityOrganization.buildGroups(this.actor, data.items.filter((i) => i.type === "ability"));

    // Languages known by the actor (chosen from the GM-configured master list). Stored as a flag.
    data.languages = this.actor.getFlag("starwarsffg", "languages") || [];

    // Only surface the weapon Quantity column when at least one weapon is actually a stack -
    // either explicitly flagged stackable (grenades, charges, etc.) or simply holding more than
    // one. This keeps the common single-weapon loadout uncluttered.
    data.showWeaponQuantity = data.items.some(
      (i) =>
        i.type === "weapon" &&
        (i.flags?.starwarsffg?.config?.enableQuantity === true || Number(i.system?.quantity?.value) > 1)
    );

    // Same treatment for vehicle weapons (missiles, torpedoes, and other limited-count mounts).
    data.showShipWeaponQuantity = data.items.some(
      (i) =>
        i.type === "shipweapon" &&
        (i.flags?.starwarsffg?.config?.enableQuantity === true || Number(i.system?.quantity?.value) > 1)
    );

    // Damage tracks for the wounds/strain header blocks (ffg-vital-block.html;
    // hull trauma / system strain on vehicles): fill percentage plus a colour
    // that escalates green -> amber -> red as current approaches the threshold.
    data.vitalTracks = {};
    for (const stat of ["wounds", "strain", "hullTrauma", "systemStrain"]) {
      const s = data.data?.stats?.[stat];
      if (!s || s.max === undefined) continue;
      const ratio = (Number(s.max) || 0) > 0 ? (Number(s.value) || 0) / Number(s.max) : 0;
      data.vitalTracks[stat] = {
        pct: Math.max(0, Math.min(100, Math.round(ratio * 100))),
        color: ratio >= 0.8 ? "#a51f17" : ratio >= 0.5 ? "#c8902e" : "#3f7d3a",
      };
    }

    // Force pool visibility for the Skills-tab Force chip — same unset-means-on
    // semantics as the header's force power pill row.
    const forcePoolFlag = this.actor.flags?.starwarsffg?.config?.enableForcePool;
    data.forcePoolEnabled = forcePoolFlag === undefined || forcePoolFlag === true;

    // Per-actor collapsed state of the identity header (species/career/spec/force pills).
    data.headerCollapsed = !!this.actor.getFlag("starwarsffg", "sheetHeaderCollapsed");

    return data;
  }

  /**
   * Sorts actor items by name so that they are presented in a constant order
   * @param items
   * @returns {*}
   */
  static sortForActorSheet(items) {
    return items.sort(function(a, b) {
       return a.name.localeCompare(b.name);
    });
  }

  /* -------------------------------------------- */

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    // convert jquery element to HTMLElement for usage with Foundry calls
    const htmlElement = html.get(0);

    // Activate tabs
    let tabs = html.find(".tabs");
    let initial = this._sheetTab;
    new foundry.applications.ux.Tabs(tabs, {
      initial: initial,
      callback: (clicked) => {
        this._sheetTab = clicked.data("tab");
      },
    });

    html.find(".alt-tab").click((ev) => {
      const item = $(ev.currentTarget);
      this._tabs[0].activate(item.data("tab"));
    });

    html.find(".popout-editor").on("mouseover", (event) => {
      $(event.currentTarget).find(".popout-editor-button").show();
    });
    html.find(".popout-editor").on("mouseout", (event) => {
      $(event.currentTarget).find(".popout-editor-button").hide();
    });
    html.find(".popout-editor .popout-editor-button").on("click", this._onPopoutEditor.bind(this));

    // Force Presence scale: left emblem adds a Dark Side Balance Point, right emblem adds a Light
    // Side Balance Point. Right-click removes one from the corresponding side. Bound via delegation
    // on the sheet root so the controls work reliably regardless of tab/render timing.
    html.on("click", ".force-presence-dark", this._onForcePresenceAdjust.bind(this, "dark", 1));
    html.on("click", ".force-presence-light", this._onForcePresenceAdjust.bind(this, "light", 1));
    html.on("contextmenu", ".force-presence-dark", this._onForcePresenceAdjust.bind(this, "dark", -1));
    html.on("contextmenu", ".force-presence-light", this._onForcePresenceAdjust.bind(this, "light", -1));

    // Setup dice pool image and hide filtered skills
    html.find(".skill").each(async (_, elem) => {
      await DiceHelpers.addSkillDicePool(await this.getData({}), elem);
      const filters = this._filters.skills;
    });

    // Collapsible identity header (species/career/spec/force pills). Flip the
    // class live and swap the button label/icon for instant feedback, then
    // persist the per-actor flag WITHOUT a re-render (the class already
    // reflects the new state, so a re-render would only cause a flash).
    // Registered above the editable gate so viewers get a session-local toggle;
    // their flag write fails silently.
    html.find(".ffg2-hcollapse-btn").click(async (ev) => {
      ev.preventDefault();
      const form = $(ev.currentTarget).closest("form.character");
      if (!form.length) return;
      const collapsed = form.toggleClass("ffg2-hdr-collapsed").hasClass("ffg2-hdr-collapsed");
      const btn = $(ev.currentTarget);
      const label = game.i18n.localize(collapsed ? "SWFFG.HeaderExpand" : "SWFFG.HeaderCollapse");
      btn.attr("title", label);
      btn.find(".ffg2-hcollapse-label").text(label);
      btn.find("i").attr("class", collapsed ? "fas fa-caret-down" : "fas fa-caret-up");
      try {
        await this.actor.update({ "flags.starwarsffg.sheetHeaderCollapsed": collapsed }, { render: false });
      } catch (e) { /* non-owners keep the local toggle only */ }
    });

    // Everything below here is only needed if the sheet is editable
    if (!this.isEditable) return;

    if (Hooks.events.preCreateItem === undefined) {
      Hooks.on("preCreateItem", (item, createData, options, userId) => {
        // Save persistent sheet height and width for future use.
        this.sheetWidth = this.position.width;
        this.sheetHeight = this.position.height;

        // Check that we are dealing with an Embedded Document
        if (item.isEmbedded && item.parent.documentName === "Actor") {
          const actor = item.actor
          // we only allow one species and one career, find any other species and remove them.
          if (item.type === "species" || item.type === "career") {
            if (["character", "nemesis", "rival"].includes(actor.type)) {
              const itemToDelete = actor.items.filter((i) => (i.type === item.type) && (i.id !== item.id));
              itemToDelete.forEach((i) => {
                actor.items.get(i.id).delete();
              });
            } else if (actor.type === "minion") {
              ui.notifications.warn(`Item type '${item.type}' cannot be added to 'minion' actor types.`);
              return false;
            }
          }

          // Critical Damage can only be added to "vehicle" actors and Critical Injury can only be added to "character" actors.
          if (item.type === "criticaldamage" && actor.type !== "vehicle") {
            ui.notifications.warn("Critical Damage can only be added to 'vehicle' actor types.");
            return false;
          }
          if (item.type === "criticalinjury" && !["character", "nemesis", "rival"].includes(actor.type)) {
            ui.notifications.warn("Critical Injuries can only be added to 'character' actor types.");
            return false;
          }

          // Prevent adding of character data type items to vehicles
          if (["career", "forcepower", "talent", "signatureability", "specialization", "species", "ability"].includes(item.type.toString()) && actor.type === "vehicle") {
            ui.notifications.warn(`Item type '${item.type}' cannot be added to 'vehicle' actor types.`);
            return false;
          }
        }
      });
    }

    if (Hooks.events.preDeleteItem === undefined) {
      Hooks.on("preDeleteItem", (item, createData, options, userId) => {
        // Save persistent sheet height and width for future use.
        this.sheetWidth = this.position.width;
        this.sheetHeight = this.position.height;
      });
    }

    if (Hooks.events.preUpdateItem === undefined) {
      Hooks.on("preUpdateItem", (item, createData, options, userId) => {
        // Save persistent sheet height and width for future use.
        this.sheetWidth = this.position.width;
        this.sheetHeight = this.position.height;
      });
    }

    let contextMenuOptions = [
      {
        name: game.i18n.localize("SWFFG.SkillChangeCharacteristicContextItem"),
        icon: '<i class="fas fa-wrench"></i>',
        callback: (li) => {
          this._onChangeSkillCharacteristic(li);
        },
      },
      {
        name: game.i18n.localize("SWFFG.SkillAddAsInitiative"),
        icon: '<i class="fas fa-cog"></i>',
        callback: (li) => {
          this._onInitiativeSkill(li);
        },
      },
      {
        name: game.i18n.localize("SWFFG.SkillRemoveContextItem"),
        icon: '<i class="fas fa-times"></i>',
        callback: async (li) => {
          await this._onRemoveSkill(li);
        },
      },
    ];

    if (this.actor.type === "character") {
      contextMenuOptions.push(
        {
          name: game.i18n.localize("SWFFG.Actors.Sheets.Purchase.SkillRank.ContextMenuText"),
          icon: '<i class="fa-regular fa-circle-up"></i>',
          callback: (li) => {
            if(!this.actor.verifyEditModeIsNotEnabled()) return false;
            this._buySkillRank(li);
          },
        },
      );
    }

    const skillContextMenu = new foundry.applications.ux.ContextMenu(
        htmlElement,
        ".skillsGrid .skill",
        contextMenuOptions,
      // fixed:true positions the menu relative to the viewport instead of injecting it
      // into the .skill target, so it is not clipped by the scrollable `.tab`/`.sheet-body`
      // (overflow:auto) container when a skill near the bottom of the sheet is right-clicked.
      // Because fixed menus are attached outside the sheet's DOM, neither the UI module's
      // styling nor the sheet's theme-light override reaches them and they fall back to the
      // bare (light) default. We tag this one menu with a marker class so the system
      // stylesheet can re-theme it. The tag is applied on the next animation frame because
      // onOpen can fire before the fixed menu element is injected into the DOM.
      {
        jQuery: false,
        fixed: true,
        onOpen: () => {
          requestAnimationFrame(() => {
            (skillContextMenu.element ?? document.getElementById("context-menu"))
              ?.classList.add("ffg-skill-context-menu");
          });
        },
      },
    );

    html.find(".skill-purchase").click(async (ev) => {
      const target = $(ev.currentTarget).parents().filter("[data-ability]");
      await this._buySkillRank(target);
    });

    html.find(".xp-adjustment").click(async (ev) => {
      await this._xpAdjustment(ev);
    });

    html.find(".xp-export").click(async (ev) => {
      await this._xpExport(ev);
    });

    html.find(".xp-import").click(async (ev) => {
      await this._xpImport(ev);
    });

    html.find(".minion-control").click(async (ev) => {
      await this._handleKillMinion(ev);
    });

    new foundry.applications.ux.ContextMenu(htmlElement, "div.skillsHeader", [
      {
        name: game.i18n.localize("SWFFG.SkillAddContextItem"),
        icon: '<i class="fas fa-plus-circle"></i>',
        callback: (li) => {
          this._onCreateSkill(li);
        },
      },
    ], {jQuery: false});

    html.find(".ffg-purchase").click(async (ev) => {
      await this._buyCore(ev)
    });

    // Refund from the XP log. Bind the refund link itself (not the whole row) so clicking a
    // talent/Force-power entry that has no refund link can never fire with an undefined id.
    html.find("a.xp.refund").click(async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const el = $(ev.currentTarget);
      const aeId = el.data("id");
      const kind = el.data("refund-kind");
      if (aeId !== undefined && aeId !== null && aeId !== "") {
        // Active-effect-backed purchase (skills, characteristics).
        await this._refundPurchase(aeId, "purchase");
      } else if (kind === "tree") {
        await this._refundTreeFromLog(el.data("refund-item"), String(el.data("refund-node")), el.data("refund-type"));
      } else if (kind === "forcepower-base") {
        const name = el.data("refund-name");
        const item = this.actor.items.find((i) => i.type === "forcepower" && i.name === name);
        if (item) {
          await this._refundForcePower(item.id);
        } else {
          ui.notifications.warn(game.i18n.localize("SWFFG.Actors.Sheets.Refund.NoOwner"));
        }
      } else if (kind === "signatureability-base") {
        const name = el.data("refund-name");
        const item = this.actor.items.find((i) => i.type === "signatureability" && i.name === name);
        if (item) {
          await this._refundSignatureAbility(item.id);
        } else {
          ui.notifications.warn(game.i18n.localize("SWFFG.Actors.Sheets.Refund.NoOwner"));
        }
      }
    });

    // Send Item Details to chat.

    const sendToChatContextItem = {
      name: game.i18n.localize("SWFFG.SendToChat"),
      icon: '<i class="far fa-comment"></i>',
      callback: (el) => {
        let itemId = el.getAttribute("data-item-id");
        this._itemDetailsToChat(itemId);
      },
    };

    const rollForceToChatContextItem = {
      name: game.i18n.localize("SWFFG.SendForceRollToChat"),
      icon: '<i class="fas fa-dice-d20"></i>',
      callback: async (el) => {
        let itemId = el.getAttribute("data-item-id");
        let item = this.actor.items.get(itemId);
        if (!item) {
          item = game.items.get(itemId);
        }
        if (!item) {
          item = await ImportHelpers.findCompendiumEntityById("Item", itemId);
        }
        const forcedice = this.actor.system.stats.forcePool.max - this.actor.system.stats.forcePool.value;
        if (forcedice > 0) {
          let sheet = await this.getData();
          const dicePool = new DicePoolFFG({
            force: forcedice,
          });
          DiceHelpers.displayRollDialog(sheet, dicePool, `${game.i18n.localize("SWFFG.Rolling")} ${item.name}`, item.name, item);
        } else {
          ui.notifications.info(game.i18n.localize("SWFFG.Roll.ForcePowers.NoDice"));
        }
      },
    };

    new foundry.applications.ux.ContextMenu(htmlElement, "li.item:not(.forcepower)", [sendToChatContextItem], {jQuery: false});
    new foundry.applications.ux.ContextMenu(htmlElement, "li.item.forcepower", [sendToChatContextItem, rollForceToChatContextItem], {jQuery: false});
    new foundry.applications.ux.ContextMenu(htmlElement, "div.item", [sendToChatContextItem], {jQuery: false});

    if (["nemesis", "rival"].includes(this.actor.type)) {
      this.sheetoptions = new ActorOptions(this, html);
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
      this.sheetoptions.register("enableStimpacks", {
        name: game.i18n.localize("SWFFG.EnableStimpacks"),
        hint: game.i18n.localize("SWFFG.EnableStimpacksHint"),
        type: "Boolean",
        default: true,
      });
      this.sheetoptions.register("enableRepairPatches", {
        name: game.i18n.localize("SWFFG.EnableRepairPatches"),
        hint: game.i18n.localize("SWFFG.EnableRepairPatchesHint"),
        type: "Boolean",
        default: false,
      });
    }
    if (this.actor.type === "character") {
      this.sheetoptions = new ActorOptions(this, html);
      this.sheetoptions.register("enableAutoSoakCalculation", {
        name: game.i18n.localize("SWFFG.EnableSoakCalc"),
        hint: game.i18n.localize("SWFFG.EnableSoakCalcHint"),
        type: "Boolean",
        default: true,
      });
      this.sheetoptions.register("medicalItemName", {
        name: game.i18n.localize("SWFFG.MedicalItemName"),
        hint: game.i18n.localize("SWFFG.MedicalItemNameHint"),
        type: "String",
        default: game.settings.get("starwarsffg", "medItemName"),
      });
      this.sheetoptions.register("enableStimpacks", {
        name: game.i18n.localize("SWFFG.EnableStimpacks"),
        hint: game.i18n.localize("SWFFG.EnableStimpacksHint"),
        type: "Boolean",
        default: true,
      });
      this.sheetoptions.register("enableRepairPatches", {
        name: game.i18n.localize("SWFFG.EnableRepairPatches"),
        hint: game.i18n.localize("SWFFG.EnableRepairPatchesHint"),
        type: "Boolean",
        default: false,
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

    if (this.actor.type === "minion") {
      this.sheetoptions = new ActorOptions(this, html);
      this.sheetoptions.register("enableAutoSoakCalculation", {
        name: game.i18n.localize("SWFFG.EnableSoakCalc"),
        hint: game.i18n.localize("SWFFG.EnableSoakCalcHint"),
        type: "Boolean",
        default: true,
      });
      this.sheetoptions.register("enableCriticalInjuries", {
        name: game.i18n.localize("SWFFG.EnableCriticalInjuries"),
        hint: game.i18n.localize("SWFFG.EnableCriticalInjuriesHint"),
        type: "Boolean",
        default: false,
      });
      this.sheetoptions.register("talentSorting", {
        name: game.i18n.localize("SWFFG.EnableSortTalentsByActivation"),
        hint: game.i18n.localize("SWFFG.EnableSortTalentsByActivationHint"),
        type: "Array",
        default: 0,
        options: [game.i18n.localize("SWFFG.UseGlobalSetting"), game.i18n.localize("SWFFG.OptionValueYes"), game.i18n.localize("SWFFG.OptionValueNo")],
      });
    }

    if (this.actor.type === "vehicle") {
      this.sheetoptions = new ActorOptions(this, html);
      this.sheetoptions.register("enableHyperdrive", {
        name: game.i18n.localize("SWFFG.EnableHyperdrive"),
        hint: game.i18n.localize("SWFFG.EnableHyperdriveHint"),
        type: "Boolean",
        default: true,
      });
      this.sheetoptions.register("enableSensors", {
        name: game.i18n.localize("SWFFG.EnableSensors"),
        hint: game.i18n.localize("SWFFG.EnableSensorsHint"),
        type: "Boolean",
        default: true,
      });
    }

    if (this.actor.type !== "homestead") {
      this.sheetoptions.register("enableEditMode", {
        name: game.i18n.localize("SWFFG.EnableEditMode"),
        hint: game.i18n.localize("SWFFG.EnableEditModeHint"),
        type: "Boolean",
        default: false,
      });
    }

    // activate source and tag controls for actors
    html.find(".source-control").click(async (ev) => {
      await this._handleSourceControl(ev);
    });
    html.find(".tag-control").click(async (ev) => {
      await this._handleTagControl(ev);
    });

    // Stimpack / emergency-repair-patch box. Plus applies a use and heals (stimpacks decay
    // 5/4/3/2/1 -> 0; patches are a flat 3, no decay) and posts to chat. Minus only decrements
    // the counter -- it does not restore wounds or post to chat. The two counters
    // (system.stats.medical.uses vs .patchUses) are tracked independently so using one never
    // affects the other's escalation. The clicked box's kind is read from the
    // data-medical-kind attribute set in ffg-healingitem.html.
    html.find(".medical").click(async (ev) => {
      const kind = $(ev.currentTarget).closest("[data-medical-kind]").data("medicalKind") || "stim";
      const isPatch = kind === "patch";
      const usesPath = isPatch ? "system.stats.medical.patchUses" : "system.stats.medical.uses";
      const prevUses = foundry.utils.getProperty(this.object, usesPath) ?? 0;
      const currentWounds = this.object.system?.stats?.wounds?.value ?? 0;
      const stimName = this.object?.flags?.starwarsffg?.config?.medicalItemName || game.i18n.localize("SWFFG.DefaultMedicalItemName");
      const label = isPatch ? game.i18n.localize("SWFFG.DefaultPatchItemName") : stimName;
      const isPlus = ev.currentTarget.className.includes("fa-plus-circle");

      let updateData = {};
      let msg_content;

      if (isPlus) {
        // Uses cap at 5. The fifth use still heals (stim 1, patch 3); the sixth and beyond
        // do nothing and heal nothing.
        if (prevUses >= 5) {
          return;
        }
        // Apply a use: heal escalating (stim) or flat 3 (patch).
        const newUses = prevUses + 1;
        const heal = isPatch ? 3 : Math.max(5 - prevUses, 0);
        const newWounds = Math.max(currentWounds - heal, 0);
        foundry.utils.setProperty(updateData, usesPath, newUses);
        foundry.utils.setProperty(updateData, "system.stats.wounds.value", newWounds);
        msg_content = `<i>${game.i18n.localize("SWFFG.MedicalItemUse")} ${label} #${newUses} (${heal})</i>`;
      } else {
        // Minus only decrements the counter: it does not restore wounds or post to chat.
        if (prevUses <= 0) {
          return;
        }
        foundry.utils.setProperty(updateData, usesPath, prevUses - 1);
        await this.object.update(updateData);
        return;
      }

      ChatMessage.create({
        speaker: { alias: this.object.name },
        content: msg_content,
      });

      await this.object.update(updateData);
    });

    html.find(".resetMedical").click(async (ev) => {
      const kind = $(ev.currentTarget).closest("[data-medical-kind]").data("medicalKind") || "stim";
      const usesPath = kind === "patch" ? "system.stats.medical.patchUses" : "system.stats.medical.uses";
      const stimName = this.object?.flags?.starwarsffg?.config?.medicalItemName || game.i18n.localize("SWFFG.DefaultMedicalItemName");
      const label = kind === "patch" ? game.i18n.localize("SWFFG.DefaultPatchItemName") : stimName;

      // Rest: a full recover resets BOTH healing counters, clears strain, and heals 1 wound.
      const doRest = () => {
        let updateData = {};
        foundry.utils.setProperty(updateData, `system.stats.medical.uses`, 0);
        foundry.utils.setProperty(updateData, `system.stats.medical.patchUses`, 0);
        foundry.utils.setProperty(updateData, `system.stats.strain.value`, 0);
        foundry.utils.setProperty(updateData, `system.stats.wounds.value`, Math.max(0, this.object.system.stats.wounds.value - 1));
        this.object.update(updateData);
        ChatMessage.create({
          speaker: { alias: this.object.name },
          content: `<i>${game.i18n.localize("SWFFG.MedicalItemRest")}</i>`,
        });
      };

      // Reset: clear only this box's counter (leaves wounds/strain untouched).
      const doReset = () => {
        let updateData = {};
        foundry.utils.setProperty(updateData, usesPath, 0);
        this.object.update(updateData);
        ChatMessage.create({
          speaker: { alias: this.object.name },
          content: `<i>${game.i18n.localize("SWFFG.MedicalItemResetStart")} ${label} ${game.i18n.localize("SWFFG.MedicalItemResetEnd")}</i>`,
        });
      };

      const action = game.settings.get("starwarsffg", "HealingItemAction");
      if (action === '0') {
          // prompt: ask the user whether to rest or reset
          new Dialog(
              {
                  title: game.i18n.localize("SWFFG.MedicalItemNameUseTitle"),
                  buttons: {
                      done: {
                          icon: '<i class="fas fa-hourglass"></i>',
                          label: game.i18n.localize("SWFFG.MedicalItemNameUseRest"),
                          callback: () => doRest(),
                      },
                      cancel: {
                          icon: '<i class="fas fa-recycle"></i>',
                          label: game.i18n.localize("SWFFG.MedicalItemNameUseReset"),
                          callback: () => doReset(),
                      },
                  },
              },
              {
                  classes: ["dialog", "starwarsffg"],
              }
          ).render(true);
      } else if (action === '1') {
        doRest();
      } else if (action === '2') {
        doReset();
      }
    });

    // Wounds / strain steppers (the -/+ buttons on the header vital blocks).
    // Floored at 0 but NOT capped at the threshold — current wounds/strain may
    // exceed the threshold (that's the incapacitated state), so the only bound
    // is the lower one.
    html.find(".ffg2-step").click(async (ev) => {
      ev.preventDefault();
      const stat = ev.currentTarget.dataset.stat;
      const dir = Number(ev.currentTarget.dataset.dir) || 0;
      const s = this.actor?.system?.stats?.[stat];
      if (!s) return;
      const val = Math.max(0, (Number(s.value) || 0) + dir);
      await this.actor.update({ [`system.stats.${stat}.value`]: val });
    });

    // Force chip steppers: adjust the committed Force dice (forcePool.value),
    // clamped to [0, forcePool.max]. data-path/data-max keep the handler generic.
    html.find(".ffg2-ratio-step").click(async (ev) => {
      ev.preventDefault();
      const dir = Number(ev.currentTarget.dataset.dir) || 0;
      const path = ev.currentTarget.dataset.path;
      if (!path) return;
      const max = Number(ev.currentTarget.dataset.max);
      const cur = Number(foundry.utils.getProperty(this.actor, path)) || 0;
      let val = Math.max(0, cur + dir);
      if (Number.isFinite(max)) val = Math.min(max, val);
      if (val === cur) return;
      await this.actor.update({ [path]: val });
    });

    // Clicking the Force chip label rolls the actor's available (uncommitted)
    // Force dice — the same pool a Force power roll uses, with nothing else in it.
    html.find(".ffg2-force-roll").click(async (ev) => {
      ev.preventDefault();
      const pool = this.actor.system?.stats?.forcePool || {};
      const forcedice = (Number(pool.max) || 0) - (Number(pool.value) || 0);
      if (forcedice > 0) {
        const sheet = await this.getData();
        const dicePool = new DicePoolFFG({ force: forcedice });
        const label = game.i18n.localize("SWFFG.Force");
        await DiceHelpers.displayRollDialog(sheet, dicePool, `${game.i18n.localize("SWFFG.Rolling")} ${label}`, label);
      } else {
        ui.notifications.info(game.i18n.localize("SWFFG.Roll.ForcePowers.NoDice"));
      }
    });

    // Toggle item equipped
    html.find(".items .item a.toggle-equipped").click((ev) => {
      if(!this.actor.verifyEditModeIsNotEnabled()) {
        return;
      }

      const li = $(ev.currentTarget);
      const item = this.actor.items.get(li.data("itemId"));
      if (item) {
        item.update({ ["system.equippable.equipped"]: !item.system.equippable.equipped });
      }
    });

    // Toggle item details
    html.find(".items .item, .header-description-block .item, .injuries .item").click(async (ev) => {
      if (!$(ev.target).hasClass("fa-trash") && !$(ev.target).hasClass("fas") && !$(ev.target).hasClass("rollable")) {
        const li = $(ev.currentTarget);
        if (ev?.originalEvent?.target && !$(ev?.originalEvent?.target).hasClass("item-pill")) {
          let itemId = li.data("itemId");
          let item = this.actor.items.get(itemId);

          if (!item) {
            item = game.items.get(itemId);
          }
          if (!item) {
            item = await ImportHelpers.findCompendiumEntityById("Item", itemId);
            if (!item) {
              const talentItemData = this.actor?.talentList?.find(talent => talent.itemId === itemId);
              if (talentItemData) {
                item = await ImportHelpers.findCompendiumEntityByName("Item", talentItemData.name);
              }
            }
          }
          if (item?.sheet) {
            if (item?.type == "species" || item?.type == "career" || item?.type == "specialization" || item?.type == "forcepower" || item?.type == "signatureability") item.sheet.render(true);
            else this._itemDisplayDetails(item, ev);
          }
        }
        if (ev?.originalEvent?.target && $(ev?.originalEvent?.target).hasClass("item-pill")) {
          event.preventDefault();
          event.stopPropagation();
          const li = $(ev.originalEvent.target);
          const itemType = li.attr("data-item-embed-type");
          let itemData = {};
          const newEmbed = li.attr("data-item-embed");

          if (newEmbed === "true" && itemType === "itemmodifier") {
            itemData = {
              img: li.attr('data-item-embed-img'),
              name: li.attr('data-item-embed-name'),
              type: li.attr('data-item-embed-type'),
              system: {
                description: unescape(li.attr('data-item-embed-description')),
                attributes: JSON.parse(li.attr('data-item-embed-modifiers')),
                rank: li.attr('data-item-embed-rank'),
                rank_current: li.attr('data-item-embed-rank'),
              },
              ownership: {
                default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER,
              }
            };
            const tempItem = await new Item(itemData, { temporary: true });
            tempItem.sheet.render(true);
          } else {
            CONFIG.logger.debug(`Unknown item type: ${itemType}, or lacking new embed system`);
            let itemId = li.dataset.itemId;
            let modifierType = li.dataset.modifierType;
            let modifierId = li.dataset.modifierId;

            await EmbeddedItemHelpers.displayOwnedItemItemModifiersAsJournal(itemId, modifierType, modifierId, this.actor.id, this.actor.compendium);
          }
        };
      }
    });

    // Toggle Force Power details
    html.find(".force-power").click(async (ev) => {
      ev.stopPropagation();
      if (!$(ev.target).hasClass("fa-trash") && !$(ev.target).hasClass("fas") && !$(ev.target).hasClass("rollable")) {
        const li = $(ev.currentTarget);
        const itemId = li.data("itemId");
        const item = this.actor.items.get(itemId);
        const desc = li.data("desc");

        if (item?.sheet) {
          if (item?.type === "forcepower") {
            await this._forcePowerDisplayDetails(desc, ev);
          }
        }
      }
    });

    // Toggle Signature Ability details
    html.find(".signature-ability").click(async (ev) => {
      ev.stopPropagation();
      if (!$(ev.target).hasClass("fa-trash") && !$(ev.target).hasClass("fas") && !$(ev.target).hasClass("rollable")) {
        const li = $(ev.currentTarget);
        const itemId = li.data("itemId");
        const item = this.actor.items.get(itemId);
        const desc = li.data("desc");

        if (item?.sheet) {
          if (item?.type === "signatureability") {
            await this._forcePowerDisplayDetails(desc, ev);
          }
        }
      }
    });

    // Add Inventory Item
    html.find(".item-add").click((ev) => {
      if(!this.actor.verifyEditModeIsNotEnabled()) {
        return;
      }

      let itemType = "";
      switch (ev.currentTarget.classList[1]) {
        case "armour":
          itemType = game.i18n.localize("TYPES.Item.armour");
          break;
        case "weapon":
          itemType = game.i18n.localize("TYPES.Item.weapon");
          break;
        case "shipattachment":
          itemType = game.i18n.localize("TYPES.Item.shipattachment");
          break;
        case "shipweapon":
          itemType = game.i18n.localize("TYPES.Item.shipweapon");
          break;

        default:
          itemType = game.i18n.localize("TYPES.Item.gear");
          break;
      }

      let itemdata = {
        name: itemType,
        type: ev.currentTarget.classList[1]
      };

      this.actor.createEmbeddedDocuments("Item", [itemdata]);
    });

    // Delete Inventory Item
    html.find(".item-delete").click(async (ev) => {
      if(!this.actor.verifyEditModeIsNotEnabled()) {
        return;
      }

      const li = $(ev.currentTarget).parents(".item");
      const item = this.actor.items.get(li.data("itemId"));
      if (!item) return;

      // Optional confirmation so an accidental click doesn't instantly destroy an inventory item.
      if (game.settings.get("starwarsffg", "confirmItemDelete")) {
        const confirmed = await Dialog.confirm({
          title: game.i18n.localize("SWFFG.DeleteItem.Title"),
          content: `<p>${game.i18n.format("SWFFG.DeleteItem.Content", { name: Handlebars.escapeExpression(item.name) })}</p>`,
          yes: () => true,
          no: () => false,
          defaultYes: false,
          options: { classes: ["dialog", "starwarsffg"] },
        });
        if (!confirmed) return;
      }

      await item.delete();
      li.slideUp(200, () => this.render(false));
    });

    // Edit Inventory Item
    html.find(".item-edit").click(async (ev) => {
      if(!this.actor.verifyEditModeIsNotEnabled()) {
        return;
      }

      const li = $(ev.currentTarget).parents(".item");
      let itemId = li.data("itemId");
      let item = this.actor.items.get(itemId);
      if (!item) {
        item = game.items.get(itemId);

        if (!item) {
          item = await ImportHelpers.findCompendiumEntityById("Item", itemId);
        }
      }
      if (item?.sheet) {
        item.sheet.render(true);
      }
    });

    // Roll Force Power
    html.find(".item-fp").click(async (ev) => {
      const li = $(ev.currentTarget).parents(".item");
      let itemId = li.data("itemId");
      let item = this.actor.items.get(itemId);
      if (!item) {
        item = game.items.get(itemId);
      }
      if (!item) {
        item = await ImportHelpers.findCompendiumEntityById("Item", itemId);
      }
      const forcedice = this.actor.system.stats.forcePool.max - this.actor.system.stats.forcePool.value;
      if (forcedice > 0) {
        let sheet = await this.getData();
        const dicePool = new DicePoolFFG({
          force: forcedice,
        });
        DiceHelpers.displayRollDialog(sheet, dicePool, `${game.i18n.localize("SWFFG.Rolling")} ${item.name}`, item.name, item);
      } else {
        ui.notifications.info(game.i18n.localize("SWFFG.Roll.ForcePowers.NoDice"));
      }
    });

    // Refund a base Force power (the power item itself), refunding the XP paid and removing it.
    html.find(".item-refund-fp").click(async (ev) => {
      if (!this.actor.verifyEditModeIsNotEnabled()) return;
      const li = $(ev.currentTarget).parents(".item");
      await this._refundForcePower(li.data("itemId"));
    });

    // Refund a base signature ability (the item itself), refunding the XP paid and removing it.
    html.find(".item-refund-sa").click(async (ev) => {
      if (!this.actor.verifyEditModeIsNotEnabled()) return;
      const li = $(ev.currentTarget).parents(".item");
      await this._refundSignatureAbility(li.data("itemId"));
    });

    // Delete Crew
    html.find(".crew-delete").click(async (ev) => {
      const crew_member_id = $(ev.currentTarget).parents(".item").data("actor-id");
      const crew_role = $(ev.currentTarget).parents(".item").data("role-name");
      const actor = this.actor;

      deregister_crew(actor, crew_member_id, crew_role);
    });

    // Edit Crew
    html.find(".crew-edit").click(async (ev) => {
      if(!this.actor.verifyEditModeIsNotEnabled()) {
        return;
      }
      const crew_member_id = $(ev.currentTarget).parents(".item").data("actor-id");
      const crew_member = game.actors.get(crew_member_id);
      const registeredRoles = game.settings.get('starwarsffg', 'arrayCrewRoles');
      const actor = this.actor;
      const vehicleRoles = actor.getFlag('starwarsffg', 'crew');

      const crewMemberRoles = vehicleRoles.filter(role => role.actor_id === crew_member_id);
      const rolesInUse = crewMemberRoles.map(role => role.role);

      const content = await foundry.applications.handlebars.renderTemplate(
        "systems/starwarsffg/templates/dialogs/ffg-crew-change.html",
        {
          actor: crew_member,
          roles: registeredRoles,
          rolesInUse: rolesInUse,
        }
      );

      new Dialog(
        {
          title: game.i18n.localize("SWFFG.Crew.Title"),
          content: content,
          buttons: {
            confirm: {
              label: game.i18n.localize("SWFFG.Crew.Role.Update"),
              callback: async (html) => {
                if(!this.actor.verifyEditModeIsNotEnabled()) {
                  return;
                }
                const newRoles = html.find('[name="select-many-things"]').val();
                await updateRoles(actor, crew_member_id, newRoles);
              }
            }
          }
        },
      ).render(true);
    });

    // === Talent organization: manual sort + custom collapsible tabs ===
    html.find(".talent-org-toggle").on("click", async (ev) => {
      ev.preventDefault();
      await TalentOrganization.setEnabled(this.actor, !TalentOrganization.isEnabled(this.actor));
    });

    html.find(".talent-org-add-tab").on("click", async (ev) => {
      ev.preventDefault();
      await TalentOrganization.addTab(this.actor);
    });

    html.find(".talent-tab-collapse").on("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const tabId = $(ev.currentTarget).closest(".talent-tab-header").data("tabId");
      if (!tabId) return;
      await TalentOrganization.toggleCollapse(this.actor, tabId);
    });

    html.find(".talent-tab-delete").on("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const tabId = $(ev.currentTarget).data("tabId");
      const confirmed = await Dialog.confirm({
        title: game.i18n.localize("SWFFG.TalentOrganization.DeleteTabConfirmTitle"),
        content: `<p>${game.i18n.localize("SWFFG.TalentOrganization.DeleteTabConfirm")}</p>`,
        defaultYes: false,
      });
      if (!confirmed) return;
      await TalentOrganization.deleteTab(this.actor, tabId);
    });

    html.find(".talent-tab-name-input")
      .on("click", (ev) => ev.stopPropagation())
      .on("change", async (ev) => {
        const tabId = $(ev.currentTarget).data("tabId");
        await TalentOrganization.renameTab(this.actor, tabId, ev.currentTarget.value);
      });

    html.find(".talent-org-item").on("dragstart", (ev) => {
      ev.originalEvent.dataTransfer.effectAllowed = "move";
      ev.originalEvent.dataTransfer.setData("text/plain", JSON.stringify({ ffgTalentOrg: true, talentKey: ev.currentTarget.dataset.talentKey }));
      $(ev.currentTarget).addClass("dragging");
    });
    html.find(".talent-org-item").on("dragend", (ev) => $(ev.currentTarget).removeClass("dragging"));

    // dragging a tab (by its handle) reorders tabs
    html.find(".talent-tab-drag-handle").on("dragstart", (ev) => {
      ev.stopPropagation();
      ev.originalEvent.dataTransfer.effectAllowed = "move";
      ev.originalEvent.dataTransfer.setData("text/plain", JSON.stringify({ ffgTabOrg: true, tabId: ev.currentTarget.dataset.tabId }));
    });

    const talentDropTargets = ".talent-org-list, .talent-org-item, .talent-tab-header, .talent-org-dropzone";
    html.find(talentDropTargets).on("dragover", (ev) => {
      ev.preventDefault();
      ev.originalEvent.dataTransfer.dropEffect = "move";
    });
    html.find(talentDropTargets).on("drop", async (ev) => {
      let data;
      try {
        data = JSON.parse(ev.originalEvent.dataTransfer.getData("text/plain"));
      } catch (err) {
        return;
      }

      // Only intercept our own internal reorder drags (a talent row moved between tabs, or a tab
      // header reordered). Any other drop - e.g. a talent dragged onto the sheet from a compendium
      // or the items sidebar - must fall through to the sheet's native item-drop handler so the
      // item actually gets added. We therefore must NOT preventDefault/stopPropagation for foreign
      // drops; doing so unconditionally previously swallowed the event and blocked adding talents
      // whenever the talent list was in tabs mode.
      if (!data?.ffgTalentOrg && !data?.ffgTabOrg) return;

      ev.preventDefault();
      ev.stopPropagation();

      const targetEl = ev.currentTarget;
      const targetTabId = targetEl.dataset.tabId;
      if (!targetTabId) return;

      // reordering a tab: only meaningful when dropped onto a tab header
      if (data?.ffgTabOrg && data.tabId) {
        if (!targetEl.classList.contains("talent-tab-header")) return;
        if (data.tabId === targetTabId) return;
        await TalentOrganization.moveTab(this.actor, data.tabId, targetTabId);
        return;
      }

      if (!data?.ffgTalentOrg || !data.talentKey) return;

      // when dropped on a row, place before/after based on vertical position
      let beforeKey = null;
      if (targetEl.classList.contains("talent-org-item")) {
        const rect = targetEl.getBoundingClientRect();
        const after = (ev.originalEvent.clientY - rect.top) > (rect.height / 2);
        if (!after) {
          beforeKey = targetEl.dataset.talentKey;
        } else {
          const next = targetEl.nextElementSibling;
          if (next && next.classList.contains("talent-org-item")) beforeKey = next.dataset.talentKey;
        }
      }
      await TalentOrganization.moveTalent(this.actor, this.actor.talentList, data.talentKey, targetTabId, beforeKey);
    });

    // === Gear/Weapon organization: manual sort + custom collapsible tabs ===
    // The Gear list (Gear tab) and the Weapons list (Combat tab) share one set
    // of listeners and DOM classes (.gear-org-* / .gear-tab-*); each element
    // carries data-org-type ("gear" default, or "weapon") which resolves the
    // helper class and item list to operate on.
    const ORG_TYPES = {
      gear: { Org: GearOrganization, itemType: "gear" },
      weapon: { Org: WeaponOrganization, itemType: "weapon" },
      ability: { Org: AbilityOrganization, itemType: "ability" },
    };
    // Current item list, ordered the same way getData() presents items, used when re-sorting.
    const getOrgList = (itemType) => this.actor.items.contents
      .filter((i) => i.type === itemType)
      .slice()
      .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
    // Resolve the org config from an element (falling back to the nearest tagged ancestor).
    const orgOf = (el) => ORG_TYPES[el.dataset.orgType || el.closest("[data-org-type]")?.dataset.orgType || "gear"];

    html.find(".gear-org-toggle").on("click", async (ev) => {
      ev.preventDefault();
      const { Org } = orgOf(ev.currentTarget);
      await Org.setEnabled(this.actor, !Org.isEnabled(this.actor));
    });

    html.find(".gear-org-add-tab").on("click", async (ev) => {
      ev.preventDefault();
      await orgOf(ev.currentTarget).Org.addTab(this.actor);
    });

    html.find(".gear-tab-collapse").on("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const header = $(ev.currentTarget).closest(".gear-tab-header");
      const tabId = header.data("tabId");
      if (!tabId) return;
      await orgOf(header[0]).Org.toggleCollapse(this.actor, tabId);
    });

    html.find(".gear-tab-delete").on("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const tabId = $(ev.currentTarget).data("tabId");
      const { Org } = orgOf(ev.currentTarget);
      const confirmed = await Dialog.confirm({
        title: game.i18n.localize(`${Org.LOC}.DeleteTabConfirmTitle`),
        content: `<p>${game.i18n.localize(`${Org.LOC}.DeleteTabConfirm`)}</p>`,
        defaultYes: false,
      });
      if (!confirmed) return;
      await Org.deleteTab(this.actor, tabId);
    });

    html.find(".gear-tab-name-input")
      .on("click", (ev) => ev.stopPropagation())
      .on("change", async (ev) => {
        const tabId = $(ev.currentTarget).data("tabId");
        await orgOf(ev.currentTarget).Org.renameTab(this.actor, tabId, ev.currentTarget.value);
      });

    html.find(".gear-org-item").on("dragstart", (ev) => {
      ev.stopPropagation();
      ev.originalEvent.dataTransfer.effectAllowed = "move";
      // Tabs-mode rows live in .gear-org-list, so the sheet's DragDrop handler
      // (dragSelector ".items-list .item") never fires for them and the drag used
      // to carry ONLY the internal reorder token — making the row invisible to
      // every external drop target (other actor sheets, module dropzones such as
      // swffg-netrunning's cyberdeck/ice-node drops). Mirror the flat list's
      // "Transfer" envelope alongside the reorder fields so tabs mode drags
      // behave identically to flat mode. The internal gear-org drop handler keys
      // off ffgGearOrg and ignores the extra fields.
      const item = this.actor.items.get(ev.currentTarget.dataset.itemId);
      const dragData = {
        ffgGearOrg: true,
        gearKey: ev.currentTarget.dataset.gearKey,
        orgType: ev.currentTarget.dataset.orgType || "gear",
      };
      if (item) {
        dragData.type = "Transfer";
        dragData.actorId = this.actor.id;
        dragData.data = item;
        // useful for other modules, e.g., item piles
        dragData.nativeData = item.toDragData();
        if (this.actor.isToken) dragData.tokenId = this.actor.token.id;
      }
      ev.originalEvent.dataTransfer.setData("text/plain", JSON.stringify(dragData));
      $(ev.currentTarget).addClass("dragging");
    });
    html.find(".gear-org-item").on("dragend", (ev) => $(ev.currentTarget).removeClass("dragging"));

    // dragging a tab (by its handle) reorders tabs
    html.find(".gear-tab-drag-handle").on("dragstart", (ev) => {
      ev.stopPropagation();
      ev.originalEvent.dataTransfer.effectAllowed = "move";
      const header = ev.currentTarget.closest(".gear-tab-header");
      ev.originalEvent.dataTransfer.setData("text/plain", JSON.stringify({
        ffgGearTabOrg: true,
        tabId: ev.currentTarget.dataset.tabId,
        orgType: header?.dataset.orgType || "gear",
      }));
    });

    const gearDropTargets = ".gear-org-list, .gear-org-item, .gear-tab-header, .gear-org-dropzone";
    html.find(gearDropTargets).on("dragover", (ev) => {
      ev.preventDefault();
      ev.originalEvent.dataTransfer.dropEffect = "move";
    });
    html.find(gearDropTargets).on("drop", async (ev) => {
      let data;
      try {
        data = JSON.parse(ev.originalEvent.dataTransfer.getData("text/plain"));
      } catch (err) {
        return;
      }

      // Same rule as the talent list above: only intercept our own internal reorder drags. An item
      // dragged onto the sheet from a compendium/sidebar must fall through to the native
      // item-drop handler, so don't preventDefault/stopPropagation for foreign drops.
      if (!data?.ffgGearOrg && !data?.ffgGearTabOrg) return;

      // A gear-org row dragged from ANOTHER actor's tabs-mode list carries ffgGearOrg too (plus a
      // Transfer envelope). Reordering only makes sense within the originating actor, so let
      // cross-actor drops bubble up to _onTransferItemDrop and transfer the item instead.
      if (data?.actorId && data.actorId !== this.actor.id) return;

      // Weapon rows only reorder within weapon tabs and gear within gear tabs — a
      // mismatched drop (e.g. weapon dragged over the Gear list) is not ours to handle.
      const targetEl = ev.currentTarget;
      const targetOrgType = targetEl.dataset.orgType || "gear";
      if ((data.orgType || "gear") !== targetOrgType) return;

      ev.preventDefault();
      ev.stopPropagation();

      const targetTabId = targetEl.dataset.tabId;
      if (!targetTabId) return;

      const { Org, itemType } = ORG_TYPES[targetOrgType];

      // reordering a tab: only meaningful when dropped onto a tab header
      if (data?.ffgGearTabOrg && data.tabId) {
        if (!targetEl.classList.contains("gear-tab-header")) return;
        if (data.tabId === targetTabId) return;
        await Org.moveTab(this.actor, data.tabId, targetTabId);
        return;
      }

      if (!data?.ffgGearOrg || !data.gearKey) return;

      // when dropped on a row, place before/after based on vertical position
      let beforeKey = null;
      if (targetEl.classList.contains("gear-org-item")) {
        const rect = targetEl.getBoundingClientRect();
        const after = (ev.originalEvent.clientY - rect.top) > (rect.height / 2);
        if (!after) {
          beforeKey = targetEl.dataset.gearKey;
        } else {
          const next = targetEl.nextElementSibling;
          if (next && next.classList.contains("gear-org-item")) beforeKey = next.dataset.gearKey;
        }
      }
      await Org.moveGear(this.actor, getOrgList(itemType), data.gearKey, targetTabId, beforeKey);
    });

    html.find(".item-info").click((ev) => {
      if(!this.actor.verifyEditModeIsNotEnabled()) {
        return;
      }
      ev.stopPropagation();
      const li = $(ev.currentTarget).parents(".item");
      const itemId = li.data("itemId");
      const itemName = li.data("itemName");

      const item = this.actor.talentList.find((talent) => {
        if (itemId) return talent.itemId === itemId;
        return talent.name === itemName;
      });

      const title = `${game.i18n.localize("SWFFG.TalentSource")} ${item.name}`;

      new Dialog(
        {
          title: title,
          content: {
            source: item.source,
          },
          buttons: {
            done: {
              icon: '<i class="fas fa-check"></i>',
              label: game.i18n.localize("SWFFG.ButtonAccept"),
              callback: (html) => {
                if(!this.actor.verifyEditModeIsNotEnabled()) {
                  return;
                }
                const talentsToRemove = $(html).find("input[type='checkbox']:checked");
                CONFIG.logger.debug(`Removing ${talentsToRemove.length} talents`);

                for (let i = 0; i < talentsToRemove.length; i += 1) {
                  const id = $(talentsToRemove[i]).val();
                  this.actor.items.get(id)?.delete();
                }
              },
            },
            cancel: {
              icon: '<i class="fas fa-times"></i>',
              label: game.i18n.localize("SWFFG.Cancel"),
            },
          },
        },
        {
          classes: ["dialog", "starwarsffg"],
          template: "systems/starwarsffg/templates/actors/dialogs/ffg-talent-selector.html",
        }
      ).render(true);
    });

    // Edit Gear Quantities

    html.find(".item-quantity .quantity.increase").click(async (ev) => {
      ev.stopPropagation();
      const li = $(ev.currentTarget).parents(".item");
      let itemId = li.data("itemId");
      let item = this.actor.items.get(itemId);
      if (!item) {
        item = game.items.get(itemId);

        if (!item) {
          item = await ImportHelpers.findCompendiumEntityById("Item", itemId);
        }
      }
      item.update({ ["system.quantity.value"]: item.system.quantity.value + 1 });
    });

    html.find(".item-quantity .quantity.decrease").click(async (ev) => {
      ev.stopPropagation();
      const li = $(ev.currentTarget).parents(".item");
      let itemId = li.data("itemId");
      let item = this.actor.items.get(itemId);
      if (!item) {
        item = game.items.get(itemId);

        if (!item) {
          item = await ImportHelpers.findCompendiumEntityById("Item", itemId);
        }
      }
      let count = item.system.quantity.value - 1 > 0 ? item.system.quantity.value - 1 : 0;
      item.update({ ["system.quantity.value"]: count });
    });

    // Split a stack into a second sibling stack on this same actor (e.g. 7 -> 4 + 3).
    html.find(".item-split").on("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const itemId = $(ev.currentTarget).parents(".item").data("itemId");
      await StackHelpers.promptSplit(this.actor, itemId);
    });

    // Give an item to another character (player-to-player trade, no GM action required).
    html.find(".item-give").on("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const itemId = $(ev.currentTarget).parents(".item").data("itemId");
      await StackHelpers.promptTrade(this.actor, itemId);
    });

    // Take a (partial) amount out of ship/homestead cargo into one of your characters.
    html.find(".item-withdraw").on("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const itemId = $(ev.currentTarget).parents(".item").data("itemId");
      await StackHelpers.promptWithdraw(this.actor, itemId);
    });

    // Cybernetics cap manual adjustment (+/-). The cap defaults to Brawn; this stores a signed
    // offset so the GM can account for species, implants, talents, etc. without per-source modifiers.
    html.find(".cybernetics-cap.increase").on("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const current = parseInt(this.actor.getFlag("starwarsffg", "config.cyberneticsCapAdjustment"), 10);
      const adjustment = Number.isFinite(current) ? current : 0;
      await this.actor.setFlag("starwarsffg", "config.cyberneticsCapAdjustment", adjustment + 1);
    });

    html.find(".cybernetics-cap.decrease").on("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // don't let the effective cap drop below zero
      if ((this.actor.system?.stats?.cybernetics?.max ?? 0) <= 0) return;
      const current = parseInt(this.actor.getFlag("starwarsffg", "config.cyberneticsCapAdjustment"), 10);
      const adjustment = Number.isFinite(current) ? current : 0;
      await this.actor.setFlag("starwarsffg", "config.cyberneticsCapAdjustment", adjustment - 1);
    });

    // Languages (Basic Information tab): click the title to post all known languages to chat.
    html.find(".languages-roll-all").on("click", async (ev) => {
      ev.preventDefault();
      const languages = this.actor.getFlag("starwarsffg", "languages") || [];
      const body = languages.length
        ? `<ul>${languages.map((l) => `<li>${Handlebars.escapeExpression(l)}</li>`).join("")}</ul>`
        : `<p>${game.i18n.localize("SWFFG.Languages.ChatNone")}</p>`;
      const content = `<div class="starwarsffg language-chat"><h3>${game.i18n.localize("SWFFG.Languages.Title")}</h3>${body}</div>`;
      await ChatMessage.create({
        user: game.user.id,
        type: CONST.CHAT_MESSAGE_STYLES.OTHER,
        content,
        speaker: {
          actor: this.actor.id,
          token: this.actor.token,
          alias: this.actor.name,
        },
      });
    });

    html.find(".language-add").on("click", async (ev) => {
      ev.preventDefault();
      const all = game.settings.get("starwarsffg", "arrayLanguages") || [];
      const known = this.actor.getFlag("starwarsffg", "languages") || [];
      const available = (Array.isArray(all) ? all : []).filter((l) => !known.includes(l));

      const OTHER = "__other__";
      const otherLabel = game.i18n.localize("SWFFG.Languages.Other");
      const listOptions = available.map((l) => `<option value="${l}">${l}</option>`).join("");
      const options = `${listOptions}<option value="${OTHER}">${otherLabel}</option>`;
      const content = `<form>
        <div class="form-group">
          <label>${game.i18n.localize("SWFFG.Languages.Title")}</label>
          <select name="language" style="width: 100%;">${options}</select>
        </div>
        <div class="form-group language-custom-group" style="display: none;">
          <label>${game.i18n.localize("SWFFG.Languages.Custom")}</label>
          <input type="text" name="custom" style="width: 100%;" />
        </div>
      </form>`;
      new Dialog({
        title: game.i18n.localize("SWFFG.Languages.Add"),
        content,
        buttons: {
          add: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("SWFFG.Languages.Add"),
            callback: async (dlg) => {
              const selected = dlg.find('select[name="language"]').val();
              let value = selected;
              if (selected === OTHER) {
                value = (dlg.find('input[name="custom"]').val() || "").trim();
              }
              if (!value) return;
              const current = this.actor.getFlag("starwarsffg", "languages") || [];
              // case-insensitive dedupe so a custom entry can't duplicate a known language
              if (current.some((l) => l.toLocaleLowerCase() === value.toLocaleLowerCase())) return;
              const updated = [...current, value].sort((a, b) => a.localeCompare(b));
              await this.actor.setFlag("starwarsffg", "languages", updated);
            },
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("SWFFG.Cancel"),
          },
        },
        default: "add",
        render: (dlg) => {
          const select = dlg.find('select[name="language"]');
          const customGroup = dlg.find(".language-custom-group");
          const toggle = () => {
            if (select.val() === OTHER) {
              customGroup.show();
              customGroup.find("input").trigger("focus");
            } else {
              customGroup.hide();
            }
          };
          select.on("change", toggle);
          // with no list languages left, "Other…" is the only option, so start on the custom field
          if (select.find("option").length === 1) select.val(OTHER);
          toggle();
        },
      }).render(true);
    });

    html.find(".language-remove").on("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const language = $(ev.currentTarget).data("language");
      const current = this.actor.getFlag("starwarsffg", "languages") || [];
      await this.actor.setFlag("starwarsffg", "languages", current.filter((l) => l !== language));
    });

    // Roll Skill
    html
      .find(".roll-button")
      .on("click", async (event) => {
        event.stopPropagation();
        let upgradeType = null;
        if (event.ctrlKey && !event.shiftKey) {
          upgradeType = "ability";
        } else if (!event.ctrlKey && event.shiftKey) {
          upgradeType = "difficulty";
        }
        await DiceHelpers.rollSkill(this, event, upgradeType);
      });

    // Use medical/repair item
    html
      .find(".item-medical")
      .on("click", async (event) => {
        event.stopPropagation();

        // Get current item's quantity
        const li = $(event.currentTarget).parents(".item");
        const itemId = li.data("itemId");
        const item = this.actor.items.get(itemId);
        const medicalType = item?.flags?.starwarsffg?.config?.medicalType;
        const isPatch = medicalType == 2;
        // Respect the per-actor box toggles (Sheet Options): if the matching healing box
        // is disabled, the item can't be used from the inventory list either. Stimpacks
        // default enabled (only an explicit `false` blocks them); repair patches default
        // disabled (they require an explicit `true`).
        const stimEnabled = this.actor.flags?.starwarsffg?.config?.enableStimpacks !== false;
        const patchEnabled = this.actor.flags?.starwarsffg?.config?.enableRepairPatches === true;
        if ((medicalType == 1 && !stimEnabled) || (isPatch && !patchEnabled)) {
          const stimName = this.actor?.flags?.starwarsffg?.config?.medicalItemName || game.i18n.localize("SWFFG.DefaultMedicalItemName");
          const disabledLabel = isPatch ? game.i18n.localize("SWFFG.DefaultPatchItemName") : stimName;
          ui.notifications.warn(game.i18n.format("SWFFG.MedicalItemDisabled", { name: disabledLabel }));
          return;
        }
        // Medical items are always consumed on use, so there must be at least one to use.
        if (item && item.system.quantity.value > 0) {
          // Stimpacks and emergency repair patches track their uses independently, so
          // using a patch must not advance (decay) the stimpack counter, and vice versa.
          const usesPath = isPatch ? "system.stats.medical.patchUses" : "system.stats.medical.uses";
          const prevUses = foundry.utils.getProperty(this.actor, usesPath) ?? 0;

          // Uses cap at 5; the sixth and beyond don't heal and aren't consumed.
          if (prevUses >= 5) {
            const stimName = this.actor?.flags?.starwarsffg?.config?.medicalItemName || game.i18n.localize("SWFFG.DefaultMedicalItemName");
            const maxedLabel = isPatch ? game.i18n.localize("SWFFG.DefaultPatchItemName") : stimName;
            ui.notifications.info(game.i18n.format("SWFFG.MedicalItemMaxed", { name: maxedLabel }));
            return;
          }

          // Always consume one; delete the item when the last is used.
          const count = item.system.quantity.value - 1;
          if (count <= 0) {
            await item.delete();
          } else {
            await item.update({["system.quantity.value"]: count});
          }
          const newUses = prevUses + 1;
          const currentWounds = this.actor.system?.stats?.wounds?.value ?? 0;
          let woundsHealing = 0;
          if (medicalType == 1) { // stimpack: heal decays 5/4/3/2/1 by prior uses
            woundsHealing = Math.max(5 - prevUses, 0);
          }
          else if (isPatch) { // emergency repair patch: flat 3, no decay
            woundsHealing = 3;
          }
          const newWounds = Math.max(currentWounds - woundsHealing, 0);
          await this.actor.update({
            [usesPath]: newUses,
            ["system.stats.wounds.value"]: newWounds,
          });
          const stimName = this.actor?.flags?.starwarsffg?.config?.medicalItemName || game.i18n.localize("SWFFG.DefaultMedicalItemName");
          const itemName = isPatch ? game.i18n.localize("SWFFG.DefaultPatchItemName") : stimName;
          ChatMessage.create({
            speaker: { alias: this.actor.name },
            content: `<i>${game.i18n.localize("SWFFG.MedicalItemUse")} ${itemName} #${newUses} (${woundsHealing})</i>`,
          });
        }
      });

    // Roll crew
    html.find(".roll-button-crew").children().on("click", async (event) => {
      const roles = $(event.currentTarget).parents(".item").data("itemId").split('-');
      const crew_id = roles[1];
      const crew_role = roles[2];
      const ship = this.actor;

      if (crew_role === 'Pilot') {
        await handlePilotCheck(ship, crew_id);
        return;
      }

      // look up the sheet for passing to the roller
      const crew_member = game.actors.get(crew_id);
      if (crew_member === undefined) {
        ui.notifications.warn(game.i18n.localize("SWFFG.Crew.Actor.Removed"));
        deregister_crew(ship, crew_id, crew_role);
        return;
      }
      const crewSheet = game.actors.get(crew_id)?.sheet;
      const starting_pool = {'difficulty': 2};

      const registeredRoles = await game.settings.get('starwarsffg', 'arrayCrewRoles');
      // look up the defined metadata for the assigned role
      const role_info = registeredRoles.filter(i => i.role_name === crew_role);
      // validate the role still exists in our settings
      if (role_info.length === 0) {
        ui.notifications.warn(game.i18n.localize("SWFFG.Crew.Role.Removed"));
        return;
      }
      // validate that it's a valid role
      if (role_info[0].role_skill === undefined) {
        ui.notifications.warn(game.i18n.localize("SWFFG.Crew.Role.Invalid"));
        return;
      }
      // check if the pool uses handling
      if (role_info[0].use_handling) {
        const handling = ship?.system?.stats?.handling?.value;
        // add modifiers from the vehicle handling
        if (handling > 0) {
          starting_pool['boost'] = handling;
        } else if (handling < 0) {
          starting_pool['setback'] = handling * -1;
        }
      }
      // create chat card data
      const card_data = {
        "crew": {
          "name": ship.name,
          "img": ship.img,
          "crew_card": true,
          "role": role_info[0].role_name,
        }
      };
      // create the starting pool
      let pool = new DicePoolFFG(starting_pool);
      if (role_info[0].use_weapons) {
        // build the dialog to select which weapon to use
        const weapons = {};
        const raw_weapons = this.actor.items.filter(i => i.type === 'shipweapon');

        for (let i = 0; i < raw_weapons.length; i++) {
          weapons['weapon ' + i] = {
            icon: `<img src="${raw_weapons[i].img}" style="max-width: 24px; max-height: 24px">`,
            label: raw_weapons[i].name,
            callback: async (html) => {
              const skill = raw_weapons[i].system.skill.value;
              let pool = new DicePoolFFG({'difficulty': 2});
              pool = get_dice_pool(crew_id, skill, pool);
              pool = await DiceHelpers.getModifiers(pool, raw_weapons[i]);
              await DiceHelpers.displayRollDialog(
                crewSheet,
                pool,
                `${game.i18n.localize("SWFFG.Rolling")} ${skill}`,
                skill,
                foundry.utils.mergeObject(raw_weapons[i], card_data)
              );
            }
          }
        }

        // actually show the dialog
        await new Dialog(
          {
            title: game.i18n.localize("SWFFG.Crew.Roles.Gunner.Title"),
            content: `<p>${game.i18n.localize("SWFFG.Crew.Roles.Gunner.Description")}</p>`,
            buttons: weapons,
          },
        ).render(true);
      } else {
        // update the pool with actor information
        pool = get_dice_pool(crew_id, role_info[0].role_skill, pool);
        // open the roll dialog (skill name is already localized)
        await DiceHelpers.displayRollDialog(
          crewSheet,
          pool,
          `${game.i18n.localize("SWFFG.Rolling")} ${role_info[0].role_skill}`,
          `${role_info[0].role_skill}`,
          card_data
        );
      }
    });

    // roll vehicle weapon by crew member
    html.find(".roll-button-weapon").on("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ship = this.actor;
      const weaponId = $(event.currentTarget).data("item-id");
      const weapon = ship.items.get(weaponId);
      // validate the weapon still exists
      if (!weapon) {
        ui.notifications.warn(game.i18n.localize("SWFFG.Crew.Weapon.Removed"));
        return;
      }
      // shipweapon items carry no skill field; default vehicle weapon rolls to Gunnery
      // (the FFG-standard vehicle weapon skill) so a gunner's roll resolves to a real skill.
      const weaponSkill = weapon.system.skill?.value || "Gunnery";
      const crew = await ship.getFlag("starwarsffg", "crew");
      const skillRoles = game.settings.get("starwarsffg", "arrayCrewRoles").filter(role => role.role_skill === weaponSkill);
      // validate the vehicle has a crew and there is a role that matches the weapon skill
      if (!crew || crew.length === 0) {
        CONFIG.logger.warn("Could not find crew for vehicle or could not find relevant skill; presenting default roller");
        return await DiceHelpers.rollSkill(this, event, null);
      }
      const crewGunners = crew.filter(member => skillRoles.some(role => role.role_name === member.role));
      if (crewGunners.length === 0) {
        CONFIG.logger.warn("Could not find crew for this skill type; presenting default roller");
        return await DiceHelpers.rollSkill(this, event, null);
      } else if (crewGunners.length > 1) {
        // create a dialog to ask the user which crew member should use the weapon
        // build the dialog to select which gunner to use
        const crewMembers = {};
        for (let i = 0; i < crewGunners.length; i++) {
          const actor = game.actors.get(crewGunners[i].actor_id);
          const img = actor?.img ? actor.img : "icons/svg/mystery-man.svg";
          crewMembers['crew ' + i] = {
            icon: `<img src="${img}" style="max-width: 24px; max-height: 24px">`,
            label: crewGunners[i].actor_name,
            callback: async (html) => {
              await this.vehicleCrewGunneryRoll(weapon, weaponSkill, crewGunners[i]);
            }
          }
        }
        // actually show the dialog
        await new Dialog(
          {
            title: game.i18n.localize("SWFFG.Crew.Roles.Weapon.Title"),
            content: `<p>${game.i18n.localize("SWFFG.Crew.Roles.Weapon.Description")}</p>`,
            buttons: crewMembers,
          },
        ).render(true);
      } else {
        await this.vehicleCrewGunneryRoll(weapon, weaponSkill, crewGunners[0]);
      }
    });

    // Roll from [ROLL][/ROLL] tag.
    html.find(".rollSkillDirect").on("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      let data = event.currentTarget.dataset;
      if (data) {
        let sheet = await this.getData();
        let skill = sheet.data.skills[data["skill"]];
        let characteristic = sheet.data.characteristics[skill.characteristic];
        let difficulty = data["difficulty"];
        await DiceHelpers.rollSkillDirect(skill, characteristic, difficulty, sheet);
      }
    });

    // Add or Remove Attribute
    html.find(".attributes").on("click", ".attribute-control", ModifierHelpers.onClickAttributeControl.bind(this));

    // transfer items between owned actor objects
    const dragDrop = new foundry.applications.ux.DragDrop({
      dragSelector: ".items-list .item",
      dropSelector: ".sheet-body",
      permissions: { dragstart: this._canDragStart.bind(this), drop: this._canDragDrop.bind(this) },
      callbacks: { dragstart: this._onTransferItemDragStart.bind(this), drop: this._onTransferItemDrop.bind(this) },
    });

    dragDrop.bind(html[0]);

    const dragDrop1 = new foundry.applications.ux.DragDrop({
      dragSelector: ".skill",
      dropSelector: ".macro",
      permissions: { dragstart: this._canDragStart.bind(this), drop: this._canDragDrop.bind(this) },
      callbacks: { dragstart: this._onSkillDragStart.bind(this) },
    });

    dragDrop1.bind(html[0]);

    html.find("input[type='text'][data-dtype='Number'][min][max]").on("change", (event) => {
      const a = event.currentTarget;
      const min = parseInt($(a).attr("min"), 10);
      const max = parseInt($(a).attr("max"), 10);
      const value = parseInt($(a).val(), 10) || min;

      if (value > max) {
        $(a).val(max);
      }
    });

    html.find("input[type='text'][data-dtype='Number'][pattern]").on("change", (event) => {
      const a = event.currentTarget;
      const value = $(a).val() || "2";
      const pattern = new RegExp($(a).attr("pattern"));

      if (!value.match(pattern)) {
        $(a).val("2");
      }
    });

    html.find(".edit-item").on("click", async (event) => {
      event.preventDefault();
      const a = event.currentTarget;
      const itemId = a.dataset["id"];
      let item = this.actor.items.get(itemId);
      if (!item) {
        return ui.notifications.warn("Unable to locate item on actor!");
      }
      if (item?.sheet) {
        item.sheet.render(true);
      }
    });

    html.find(".add-obligation").on("click", async (event) => {
      event.preventDefault();
      const itemData = {
        name: "new Obligation",
        type: "obligation",
        system: {
          type: "obligation",
          description: "Newly-created obligation",
          magnitude: 0,
        },
      };
      await this.actor.createEmbeddedDocuments("Item", [itemData]);
    });

    html.find(".add-motivation").on("click", async (event) => {
      event.preventDefault();
      const itemData = {
        name: "new Motivation",
        type: "motivation",
        system: {
          type: "Ambition",
          description: "Newly-created motivation",
        },
      };
      await this.actor.createEmbeddedDocuments("Item", [itemData]);
    });

    html.find(".add-background").on("click", async (event) => {
      event.preventDefault();
      const itemData = {
        name: "new Background",
        type: "background",
        system: {
          type: "hook",
          description: "Newly-created background",
        },
      };
      await this.actor.createEmbeddedDocuments("Item", [itemData]);
    });

    html.find(".remove-item").on("click", async (event) => {
      event.preventDefault();
      const a = event.currentTarget;
      const id = a.dataset["id"];
      const item = this.object.items.find(i => i.id === id);
      if (!item) {
        return ui.notifications.warn("Unable to remove item: cannot find it!");
      }
      await this.object.deleteEmbeddedDocuments("Item", [id]);
    });

    html.find(".add-duty").on("click", async (event) => {
      event.preventDefault();
      const a = event.currentTarget;
      const form = this.form;

      const nk = randomID();
      let newKey = document.createElement("div");
      newKey.innerHTML = `<input type="text" name="data.dutylist.${nk}.type" value="" style="display:none;"/><input class="attribute-value" type="text" name="data.dutylist.${nk}.magnitude" value="0" data-dtype="Number" placeholder="0"/>`;
      form.appendChild(newKey);
      await this._onSubmit(event);
    });

    html.find(".remove-duty").on("click", async (event) => {
      event.preventDefault();
      const a = event.currentTarget;
      const id = a.dataset["id"];
      this.object.update({ "system.dutylist": { ["-=" + id]: null } });
    });

    html.find(".force-conflict .enable-dice-pool").on("click", async (event) => {
      event.preventDefault();
      await this.actor.setFlag('starwarsffg', 'config', {enableForcePool: true});
    });

    html.find(".force-conflict .remove-force-powers").on("click", async (event) => {
      event.preventDefault();
      const itemsToDelete = this.actor.items.filter((i) => (i.type === "forcepower"));
      itemsToDelete.forEach((i) => {
          this.actor.items.get(i.id).delete();
      });
    });

    html.find(".effect-row").on("click", async (event) => {
      event.preventDefault();
      let effectRow = html.find(`#${event.currentTarget.id}`);
      effectRow.toggleClass("expanded");
      if (effectRow.hasClass("expanded")) {
        html.find(`#${event.currentTarget.id} .expand-icon`).text("-");
      } else {
        html.find(`#${event.currentTarget.id} .expand-icon`).text("+");
      }
      html.find(`.change-row.${event.currentTarget.id}`).toggleClass("hidden");
    });
  }

  /**
   * Display the roll dialog for a crew member rolling a ship weapon
   * @param weapon - weapon item
   * @param weaponSkill - skill used by the weapon
   * @param selectedGunner - the crew member rolling the weapon (from the crew, not the actual actor)
   * @returns {Promise<void>}
   */
  async vehicleCrewGunneryRoll(weapon, weaponSkill, selectedGunner) {
    const starting_pool = {'difficulty': 2};
    const ship = this.actor;
    const crewSheet = game.actors.get(selectedGunner.actor_id)?.sheet;
    // create chat card data
    const card_data = {
      "crew": {
        "name": ship.name,
        "img": ship.img,
        "crew_card": true,
        "role": selectedGunner.role,
      }
    }
    // create the starting pool
    let pool = new DicePoolFFG(starting_pool);
    // update the pool with actor data
    pool = get_dice_pool(selectedGunner.actor_id, weaponSkill, pool);
    // generic dice/roll/result modifiers carried by the weapon and its attachments
    pool = await DiceHelpers.getModifiers(pool, weapon);
    // skill-targeted modifiers on the weapon and its attachments (e.g. a targeting array installed on
    // the weapon granting "Skill Add Upgrade: Gunnery"). getModifiers only handles the generic Dice/Roll
    // /Result modtypes, so these skill-scoped ones are gathered separately.
    pool = DiceHelpers.applySkillModifiers(pool, weaponSkill, weapon);
    // vehicle-wide ship attachments (e.g. a targeting array installed on the hull rather than on the
    // weapon) also benefit the gunner. The gunner is a separate actor, so the vehicle's attachment
    // modifiers never reach them via the actor's own skills - gather them here. Only attachments
    // flagged as installed/equipped apply, so spare/uninstalled attachments kept on the vehicle don't
    // contribute (toggle installed via the ship-attachment list on the vehicle sheet).
    for (const shipAttachment of ship.items.filter((i) => i.type === "shipattachment")) {
      if (!shipAttachment.system?.equippable?.equipped) continue;
      // generic modifiers: base mods on the attachment plus its active optional modifications
      pool = await ModifierHelpers.getDicePoolModifiers(pool, shipAttachment, []);
      for (const modifier of (shipAttachment.system?.itemmodifier ?? []).filter((m) => m?.system?.active)) {
        pool = await ModifierHelpers.getDicePoolModifiers(pool, modifier, []);
      }
      // skill-targeted modifiers (recurses into the attachment's own mods/sub-attachments)
      pool = DiceHelpers.applySkillModifiers(pool, weaponSkill, shipAttachment);
    }
    // display the roll dialog
    await DiceHelpers.displayRollDialog(
      crewSheet,
      pool,
      `${game.i18n.localize("SWFFG.Rolling")} ${weaponSkill}`,
      weaponSkill,
      foundry.utils.mergeObject(weapon, card_data)
    );
  }

  /**
   * Display details of an item.
   * @private
   */
  async _itemDisplayDetails(item, event) {
    event.preventDefault();
    let li = $(event.currentTarget);
    const itemDetails = await item.getItemDetails();

    // Toggle summary
    if (li.hasClass("expanded")) {
      let details = li.children(".item-details");
      details.slideUp(200, () => details.remove());
    } else {
      let div = $(`<div class="item-details">${await PopoutEditor.renderDiceImages(itemDetails.description, this.actor)}</div>`);
      let props = $(`<div class="item-properties"></div>`);
      itemDetails.properties.forEach((p) => props.append(`<span class="tag">${p}</span>`));
      div.append(props);
      li.append(div.hide());
      div.slideDown(200);
      // item card tooltips
      li.find(".hover-tooltip").on("mouseover", (event) => {
        itemPillHover(event);
      });
    }
    li.toggleClass("expanded");
  }

  /**
   * Display details of a Force Power.
   * @private
   */
  async _forcePowerDisplayDetails(desc, event) {
    event.preventDefault();
    let li = $(event.currentTarget);

    // Toggle summary
    if (li.hasClass("expanded")) {
      let details = li.children(".item-details");
      details.slideUp(200, () => details.remove());
    } else {
      let div = $(`<div class="item-details">${await foundry.applications.ux.TextEditor.enrichHTML(desc)}</div>`);
      li.append(div.hide());
      div.slideDown(200);
    }
    li.toggleClass("expanded");
  }

  /**
   * Send details of an item to chat.
   * @private
   */
  async _itemDetailsToChat(itemId) {
    let item = this.actor.items.get(itemId);
    if (!item) {
      item = game.items.get(itemId);
    }
    if (!item) {
      item = await ImportHelpers.findCompendiumEntityById("Item", itemId);
      if (!item) {
        const talentItemData = this.actor?.talentList.find(talent => talent.itemId === itemId);
        if (talentItemData) {
          item = await ImportHelpers.findCompendiumEntityByName("Item", talentItemData.name);
        }
      }
    }

    let itemDetails = await item?.getItemDetails();

    if (!itemDetails) {
      // this is likely a talent from a specialization, which otherwise returns null
      const talentData = this.actor.talentList.find(i => i.itemId === itemId);
      itemDetails = {
        prettyDesc: talentData?.enrichedDescription,
      };
      item = {
        name: talentData.name,
        img: "icons/svg/mystery-man.svg",
        type: "talent",
        system: {
          activation: {
            value: talentData.activation,
          },
          ranks: {
            ranked: talentData.isRanked,
            current: talentData.rank,
          },
          isForceTalent: talentData.isForceTalent,
          isConflictTalent: talentData.isConflictTalent,
        }
      };
    }

    if (item.type === "talent" && itemDetails.description) {
      // getItemDetails() resolves itemDetails.description to the long description when one
      // has been entered and falls back to the short description otherwise. Render it through
      // renderDiceImages so dice symbols display, matching what the sheet shows.
      // (Talents sourced from a specialization take the fallback above and have no
      // itemDetails.description, so the guard preserves their pre-set prettyDesc.)
      itemDetails.prettyDesc = await PopoutEditor.renderDiceImages(itemDetails.description, this.actor);
    }

    const template = "systems/starwarsffg/templates/chat/item-card.html";
    const html = await foundry.applications.handlebars.renderTemplate(template, { itemDetails, item });

    const messageData = {
      user: game.user.id,
      type: CONST.CHAT_MESSAGE_STYLES.OTHER,
      content: html,
      speaker: {
        actor: this.actor.id,
        token: this.actor.token,
        alias: this.actor.name,
      },
    };
    ChatMessage.create(messageData);
  }

  /**
   * Send details of a force power to chat.
   * @private
   */
  async _forcePowerDetailsToChat(itemId, desc, name) {
    let item = this.actor.items.get(itemId);
    if (!item) {
      item = game.items.get(itemId);
    }
    if (!item) {
      item = await ImportHelpers.findCompendiumEntityById("Item", itemId);
    }

    const itemDetails = { "desc": desc, "name": name };
    const template = "systems/starwarsffg/templates/chat/force-power-card.html";
    const html = await foundry.applications.handlebars.renderTemplate(template, { itemDetails, item });

    const messageData = {
      user: game.user.id,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER,
      content: html,
      speaker: {
        actor: this.actor.id,
        token: this.actor.token,
        alias: this.actor.name,
      },
    };
    ChatMessage.create(messageData);
  }

  /**
   * Change skill characteristic
   * @param  {object} a - Event object
   */
  _onChangeSkillCharacteristic(a) {
    //const a = event.currentTarget;
    const characteristic = $(a).data("characteristic");
    const ability = $(a).data("ability");
    let label = ability;
    if (CONFIG.FFG.skills[ability]?.label) {
      label = CONFIG.FFG.skills[ability].label;
    }

    new Dialog(
      {
        title: `${game.i18n.localize("SWFFG.SkillCharacteristicDialogTitle")} ${game.i18n.localize(label)}`,
        content: {
          options: CONFIG.FFG.characteristics,
          char: characteristic,
        },
        buttons: {
          one: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("SWFFG.ButtonAccept"),
            callback: (html) => {
              let newCharacteristic = $(html).find("input[type='radio']:checked").val();

              CONFIG.logger.debug(`Updating ${ability} Characteristic from ${characteristic} to ${newCharacteristic}`);

              let updateData = {};
              setProperty(updateData, `system.skills.${ability}.characteristic`, newCharacteristic);

              this.object.update(updateData);
            },
          },
          two: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("SWFFG.Cancel"),
          },
        },
      },
      {
        classes: ["dialog", "starwarsffg"],
        template: "systems/starwarsffg/templates/actors/dialogs/ffg-skill-characteristic-selector.html",
      }
    ).render(true);
  }

  /**
   * Create new one-off skill for this actor
   * @param  {object} a - Event object
   */
  _onCreateSkill(a) {
    const group = $(a).parent().data("type");

    new Dialog(
      {
        title: `${game.i18n.localize("SWFFG.SkillAddDialogTitle")}`,
        content: {
          options: CONFIG.FFG.characteristics,
        },
        buttons: {
          one: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("SWFFG.ButtonAccept"),
            callback: (html) => {
              const name = $(html).find("input[name='name']").val();
              const characteristic = $(html).find("select[name='characteristic']").val();

              let newSkill = {
                value: name,
                careerskill: false,
                characteristic,
                groupskill: false,
                label: name,
                max: game.settings.get("starwarsffg", "maxSkill"),
                rank: 0,
                type: group,
                custom: true,
                nontheme: true,
              };

              if (name.trim().length > 0) {
                CONFIG.logger.debug(`Creating new skill ${name} (${characteristic})`);
                let updateData = {};
                foundry.utils.setProperty(updateData, `system.skills.${name}`, newSkill);

                this.object.update(updateData);
              }
            },
          },
          two: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("SWFFG.Cancel"),
          },
        },
      },
      {
        classes: ["dialog", "starwarsffg"],
        template: "systems/starwarsffg/templates/actors/dialogs/ffg-skill-new.html",
      }
    ).render(true);
  }

  /**
   * Handle the right click -> buy skill rank event
   * @param a - Event object
   * @returns {Promise<void>}
   * @private
   */
  async _buySkillRank(a) {
    const skill = $(a).data("ability");
    const curRank = this.object.system.skills[skill].rank;
    const availableXP = this.object.system.experience.available;
    const totalXP = this.object.system.experience.total;
    const careerSkill = this.object.system.skills[skill].careerskill;
    const cost = careerSkill ? (curRank + 1) * 5 : (curRank + 1) * 5 + 5;

    if (cost > availableXP) {
      ui.notifications.warn(game.i18n.localize("SWFFG.Actors.Sheets.Purchase.NotEnoughXP"));
      return;
    }
    const dialog = new Dialog(
      {
        title: game.i18n.localize("SWFFG.Actors.Sheets.Purchase.SkillRank.ConfirmTitle"),
        content: game.i18n.format("SWFFG.Actors.Sheets.Purchase.SkillRank.Text", {cost: cost, skill: skill, old: curRank, new: curRank + 1}),
        buttons: {
          done: {
            icon: '<i class="fa-regular fa-circle-up"></i>',
            label: game.i18n.localize("SWFFG.Actors.Sheets.Purchase.ConfirmPurchase"),
            callback: async (that) => {
              if(!this.actor.verifyEditModeIsNotEnabled()) return;

              const id = await this._spendXp(`system.skills.${skill}.rank`, 1, cost);
              await xpLogSpend(game.actors.get(this.object.id), `skill rank ${skill} ${curRank} --> ${curRank + 1}`, cost, availableXP - cost, totalXP, id);
            },
          },
          cancel: {
            icon: '<i class="fas fa-cancel"></i>',
            label: game.i18n.localize("SWFFG.Actors.Sheets.Purchase.CancelPurchase"),
          },
        },
      },
      {
        classes: ["dialog", "starwarsffg"],
      }
    ).render(true);
  }

  /**
   * Creates an Active Effect for a purchased upgrade (e.g., a skill rank)
   * Using this function allows the XP log to undo purchased upgrades
   * @param boughtPath - the path to the attribute being modified by the purchase
   * @param boughtValue - the amount to change the attribute by
   * @param spentXP - the amount of XP this purchase costs
   * @returns {Promise<string>} - the ID of the Active Effect created for this purchase
   */
  async _spendXp(boughtPath, boughtValue, spentXP) {
    const spentId = foundry.utils.randomID();
    const effects = {
      name: `purchased-${spentId}`,
      changes: [
        {
          key: boughtPath,
          mode: CONST.ACTIVE_EFFECT_MODES.ADD,
          value: boughtValue,
        },
        {
          key: "system.experience.available",
          mode: CONST.ACTIVE_EFFECT_MODES.ADD,
          value: spentXP * -1,
        }
      ],
    };

    // Brawn increases Soak, Wound Threshold, and Encumbrance Threshold.
    // (This path builds AE changes by hand instead of going through explodeMod.)
    if (boughtPath === "system.characteristics.Brawn.value") {
      effects.changes.push({
        key: "system.stats.soak.value",
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: boughtValue,
      });
      effects.changes.push({
        key: "system.stats.wounds.max",
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: boughtValue,
      });
      effects.changes.push({
        key: "system.stats.encumbrance.max",
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: boughtValue,
      });
    }

    // Willpower increases Strain Threshold.
    if (boughtPath === "system.characteristics.Willpower.value") {
      effects.changes.push({
        key: "system.stats.strain.max",
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: boughtValue,
      });
    }
    await this.object.createEmbeddedDocuments("ActiveEffect", [effects]);
    return spentId;
  }

  /**
   * Locates and deletes the Active Effect for a purchased upgrade (e.g., a skill rank)
   * Using this function deletes the AE and generates a lot event for the refund. It does not notify the GM
   * @param purchaseId - ID of the Active Effect created for the purchase. Tracked in the log, if you need to find it
   * @param mode - the mode of operation: a purchase or an adjustment
   * @returns {Promise<void>}
   */
  async _refundPurchase(purchaseId, mode) {
    if (purchaseId === undefined || purchaseId === null || purchaseId === "") {
      // Nothing to do (e.g. an entry without an associated Active Effect). Refund routing for
      // talents and Force powers is handled separately via their refund metadata.
      return;
    }
    CONFIG.logger.debug(`refunding ${mode} for ${purchaseId}`);
    const purchasedEffect = this.object.getEmbeddedCollection("ActiveEffect").find(ae => ae.name.includes(purchaseId));
    if (purchasedEffect) {
      const dialog = new Dialog(
        {
          title: game.i18n.localize("SWFFG.Actors.Sheets.Refund.DialogTitle"),
          content: game.i18n.localize("SWFFG.Actors.Sheets.Refund.Text"),
          buttons: {
            done: {
              icon: '<i class="fa-solid fa-check"></i>',
              label: game.i18n.localize("SWFFG.Actors.Sheets.Refund.Confirm"),
              callback: async (that) => {
                if(!this.actor.verifyEditModeIsNotEnabled()) return;

                await this.object.deleteEmbeddedDocuments("ActiveEffect", [purchasedEffect.id]);
                CONFIG.logger.debug("deleted AE, updating log");
                let logEntries = this.object.getFlag("starwarsffg", "xpLog") || [];
                let cost = 0;
                let description = 'unknown';
                for (const entry of logEntries) {
                  if (entry.id === purchaseId) {
                    cost = entry.xp.cost;
                    description = entry.description;
                    entry.id = undefined;  // denotes that there is no an AE for the purchase
                  }
                }
                const date = new Date().toISOString().slice(0, 10);
                logEntries.unshift({
                  action: 'refunded',
                  id: undefined,
                  xp: {
                    cost: cost,
                    available: this.object.system.experience.available,
                    total: this.object.system.experience.total,
                  },
                  date: date,
                  description: description,
                });
                await this.object.setFlag("starwarsffg", "xpLog", logEntries);
                CONFIG.logger.debug(`completed refund for ${purchaseId}!`);
              },
            },
            cancel: {
              icon: '<i class="fas fa-cancel"></i>',
              label: game.i18n.localize("SWFFG.Actors.Sheets.Refund.Cancel"),
            },
          },
        },
        {
          classes: ["dialog", "starwarsffg"],
        }
      ).render(true);
    } else {
      CONFIG.logger.warn(`Could not locate purchase with ID ${purchaseId}`);
    }
  }

  /**
   * Refund a learned specialization talent or Force power upgrade from the XP log. Mirrors the
   * tree-node refund available on the item sheet, including the connectivity guard: the refund is
   * blocked if it would orphan any other learned node from the tree's entry.
   *
   * @param {string} itemId  The id of the specialization / Force power item on this actor.
   * @param {string} nodeId  The talent/upgrade key (e.g. "talent7" / "upgrade5").
   * @param {string} type    "specialization" or "forcepower".
   */
  async _refundTreeFromLog(itemId, nodeId, type) {
    const item = this.actor.items.get(itemId);
    if (!item) {
      ui.notifications.warn(game.i18n.localize("SWFFG.Actors.Sheets.Refund.NoOwner"));
      return;
    }
    const collection = type === "specialization" ? "talents" : "upgrades";
    const nodes = item.system?.[collection] || {};
    const node = nodes[nodeId];
    if (!node || !(node.islearned === true || node.islearned === "true")) {
      // Already refunded / not currently learned.
      return;
    }

    // Connectivity guard: do not allow a refund that would orphan another learned node.
    const impact = TalentTree.refundImpact(nodes, nodeId, type);
    if (impact.orphaned) {
      const orphanNames = impact.orphans.map((k) => nodes[k]?.name).filter((n) => n);
      ui.notifications.warn(
        game.i18n.format("SWFFG.Actors.Sheets.Refund.WouldOrphan", { talents: orphanNames.join(", ") })
      );
      return;
    }

    // Locate the originating XP-log entry so we refund exactly what was paid (0 if it was free).
    const log = this.actor.getFlag("starwarsffg", "xpLog") || [];
    const match = log.find((e) =>
      e.action === "purchased" && !e.refunded && e.refund && e.refund.kind === "tree" &&
      e.refund.itemId === itemId && String(e.refund.nodeId) === String(nodeId)
    );
    const refundAmount = match ? (parseInt(match.xp.cost, 10) || 0) : 0;

    new Dialog(
      {
        title: game.i18n.localize("SWFFG.Actors.Sheets.Refund.DialogTitle"),
        content: game.i18n.format("SWFFG.Actors.Sheets.Refund.ConfirmText", { talent: node.name, cost: refundAmount }),
        buttons: {
          done: {
            icon: '<i class="fa-solid fa-check"></i>',
            label: game.i18n.localize("SWFFG.Actors.Sheets.Refund.Confirm"),
            callback: async () => {
              if (!this.actor.verifyEditModeIsNotEnabled()) return;

              const AEState = await ActorHelpers.beginEditMode(this.actor, true);
              await item.update({ system: { [collection]: { [nodeId]: { islearned: false } } } });
              if (refundAmount > 0) {
                const newAvailable = this.actor.system.experience.available + refundAmount;
                await this.actor.update({ system: { experience: { available: newAvailable } } });
                if (match) match.refunded = true;
                log.unshift({
                  action: "refunded",
                  id: undefined,
                  xp: {
                    cost: refundAmount,
                    available: this.actor.system.experience.available,
                    total: this.actor.system.experience.total,
                  },
                  date: new Date().toISOString().slice(0, 10),
                  description: match ? match.description : node.name,
                });
                await this.actor.setFlag("starwarsffg", "xpLog", log);
              }
              await ActorHelpers.endEditMode(this.actor, AEState, true);
              // Re-sync the modifier AEs to the node's now-unlearned state. endEditMode restores every
              // AE to its pre-refund (enabled) state, so a stat-granting talent/upgrade (e.g. Toughened,
              // Grit) would otherwise keep applying after the node is unlearned. This mirrors the learn
              // path, which syncs AE status on submit.
              await ItemHelpers.syncAEStatus(item, item.getEmbeddedCollection("ActiveEffect"));
              // If a copy of an unranked talent in another tree was suspended as a duplicate of the
              // node just refunded, re-syncing every tree lets that copy take over as the modifier
              // source (and re-checks duplicates generally).
              if (item.type === "specialization") {
                await ItemHelpers.syncActorTreeAEs(this.actor);
              }
              this.render(false);
            },
          },
          cancel: {
            icon: '<i class="fas fa-cancel"></i>',
            label: game.i18n.localize("SWFFG.Actors.Sheets.Refund.Cancel"),
          },
        },
      },
      {
        classes: ["dialog", "starwarsffg"],
      }
    ).render(true);
  }

  /**
   * Refund a base Force power (the power item itself). Refunds the XP that was paid for the base
   * power (handling the mentor discount and free grants), records it in the XP log, and removes the
   * power. The refund is blocked while any of the power's upgrades are still learned, since every
   * upgrade is reliant on being connected to the basic power.
   *
   * @param {string} itemId  The id of the forcepower item on this actor.
   */
  async _refundForcePower(itemId) {
    const item = this.actor.items.get(itemId);
    if (!item || item.type !== "forcepower") return;

    const isLearned = (v) => v === true || v === "true";

    // Connectivity guard: all upgrades hang off the basic power, so refunding it while any upgrade
    // is still learned would orphan those upgrades. Require they be refunded first.
    const upgrades = item.system?.upgrades || {};
    const learnedUpgradeNames = Object.values(upgrades)
      .filter((u) => u && isLearned(u.islearned) && u.visible !== false && u.visible !== "false" && u.name)
      .map((u) => u.name);
    if (learnedUpgradeNames.length > 0) {
      ui.notifications.warn(
        game.i18n.format("SWFFG.Actors.Sheets.Refund.WouldOrphan", { talents: learnedUpgradeNames.join(", ") })
      );
      return;
    }

    // Find the XP-log entry that paid for this base power (drag-and-drop purchase). The description
    // is `<localized drag-and-drop> forcepower <name>` with an optional mentor-discount suffix.
    const log = this.actor.getFlag("starwarsffg", "xpLog") || [];
    const match = log.find((e) =>
      e.action === "purchased" &&
      !e.refunded &&
      typeof e.description === "string" &&
      e.description.includes(`forcepower ${item.name}`)
    );
    const refundAmount = match ? (parseInt(match.xp.cost, 10) || 0) : 0;

    new Dialog(
      {
        title: game.i18n.localize("SWFFG.Actors.Sheets.Refund.DialogTitle"),
        content: game.i18n.format("SWFFG.Actors.Sheets.Refund.ConfirmText", { talent: item.name, cost: refundAmount }),
        buttons: {
          done: {
            icon: '<i class="fa-solid fa-check"></i>',
            label: game.i18n.localize("SWFFG.Actors.Sheets.Refund.Confirm"),
            callback: async () => {
              if (!this.actor.verifyEditModeIsNotEnabled()) return;

              const AEState = await ActorHelpers.beginEditMode(this.actor, true);
              if (refundAmount > 0) {
                const newAvailable = this.actor.system.experience.available + refundAmount;
                await this.actor.update({ system: { experience: { available: newAvailable } } });
                if (match) match.refunded = true;
                log.unshift({
                  action: "refunded",
                  id: undefined,
                  xp: {
                    cost: refundAmount,
                    available: this.actor.system.experience.available,
                    total: this.actor.system.experience.total,
                  },
                  date: new Date().toISOString().slice(0, 10),
                  description: match ? match.description : `forcepower ${item.name}`,
                });
                await this.actor.setFlag("starwarsffg", "xpLog", log);
              }
              await ActorHelpers.endEditMode(this.actor, AEState, true);
              // Removing the base power removes the power entirely (it is the root of the tree).
              await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
              this.render(false);
            },
          },
          cancel: {
            icon: '<i class="fas fa-cancel"></i>',
            label: game.i18n.localize("SWFFG.Actors.Sheets.Refund.Cancel"),
          },
        },
      },
      {
        classes: ["dialog", "starwarsffg"],
      }
    ).render(true);
  }

  /**
   * Refund a base signature ability (the ability item itself). Refunds the XP that was paid for the
   * base ability (handling free grants), records it in the XP log, and removes the ability. The
   * refund is blocked while any of the ability's upgrades are still learned, since every upgrade is
   * reliant on being connected (directly or transitively) to the base ability.
   *
   * @param {string} itemId  The id of the signatureability item on this actor.
   */
  async _refundSignatureAbility(itemId) {
    const item = this.actor.items.get(itemId);
    if (!item || item.type !== "signatureability") return;

    const isLearned = (v) => v === true || v === "true";

    // Connectivity guard: every upgrade hangs off the base ability, so refunding it while any
    // upgrade is still learned would orphan those upgrades. Require they be refunded first.
    const upgrades = item.system?.upgrades || {};
    const learnedUpgradeNames = Object.values(upgrades)
      .filter((u) => u && isLearned(u.islearned) && u.visible !== false && u.visible !== "false" && u.name)
      .map((u) => u.name);
    if (learnedUpgradeNames.length > 0) {
      ui.notifications.warn(
        game.i18n.format("SWFFG.Actors.Sheets.Refund.WouldOrphan", { talents: learnedUpgradeNames.join(", ") })
      );
      return;
    }

    // Find the XP-log entry that paid for this base ability (drag-and-drop purchase). The
    // description is `<localized drag-and-drop> signatureability <name>`.
    const log = this.actor.getFlag("starwarsffg", "xpLog") || [];
    const match = log.find((e) =>
      e.action === "purchased" &&
      !e.refunded &&
      typeof e.description === "string" &&
      e.description.includes(`signatureability ${item.name}`)
    );
    const refundAmount = match ? (parseInt(match.xp.cost, 10) || 0) : 0;

    new Dialog(
      {
        title: game.i18n.localize("SWFFG.Actors.Sheets.Refund.DialogTitle"),
        content: game.i18n.format("SWFFG.Actors.Sheets.Refund.ConfirmText", { talent: item.name, cost: refundAmount }),
        buttons: {
          done: {
            icon: '<i class="fa-solid fa-check"></i>',
            label: game.i18n.localize("SWFFG.Actors.Sheets.Refund.Confirm"),
            callback: async () => {
              if (!this.actor.verifyEditModeIsNotEnabled()) return;

              const AEState = await ActorHelpers.beginEditMode(this.actor, true);
              if (refundAmount > 0) {
                const newAvailable = this.actor.system.experience.available + refundAmount;
                await this.actor.update({ system: { experience: { available: newAvailable } } });
                if (match) match.refunded = true;
                log.unshift({
                  action: "refunded",
                  id: undefined,
                  xp: {
                    cost: refundAmount,
                    available: this.actor.system.experience.available,
                    total: this.actor.system.experience.total,
                  },
                  date: new Date().toISOString().slice(0, 10),
                  description: match ? match.description : `signatureability ${item.name}`,
                });
                await this.actor.setFlag("starwarsffg", "xpLog", log);
              }
              await ActorHelpers.endEditMode(this.actor, AEState, true);
              // Removing the base ability removes the ability entirely (it is the root of the tree).
              await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
              this.render(false);
            },
          },
          cancel: {
            icon: '<i class="fas fa-cancel"></i>',
            label: game.i18n.localize("SWFFG.Actors.Sheets.Refund.Cancel"),
          },
        },
      },
      {
        classes: ["dialog", "starwarsffg"],
      }
    ).render(true);
  }

  /**
   * Remove skill from skill list
   * @param  {object} a - Event object
   */
  async _onRemoveSkill(a) {
    const ability = $(a).data("ability");
    const isCustom = $(a).data("custom");
    if (!isCustom) {
      ui.notifications.info("You can only remove custom skills");
      return;
    }
    await this.object.update({ [`system.skills.-=${ability}`]: null });
  }

  /**
   * Set skill as a skill available in the initiative dialog
   * @param  {object} a - Event object
   */
  _onInitiativeSkill(a) {
    const skill = $(a).data("ability");
    let updateData = {};

    let useSkillForInitiative = false;
    if (!this.object.system.skills[skill]?.useForInitiative) {
      useSkillForInitiative = true;
    }

    foundry.utils.setProperty(updateData, `system.skills.${skill}.useForInitiative`, useSkillForInitiative);
    this.object.update(updateData);
  }

  /**
   * Listen for click events on a filter control to modify the selected filter option.
   * @param {MouseEvent} event    The originating left click event
   * @private
   */
  async _onClickFilterControl(event) {
    event.preventDefault();
    const a = event.currentTarget;
    const filters = this._filters.skills;
    var filter = a.id;
    $(a).prop("checked", true);
    filters.filter = filter;
    await this._onSubmit(event);
  }
  /* -------------------------------------------- */

  /** @override */
  async _updateObject(event, formData) {
    const actorUpdate = ActorHelpers.updateActor.bind(this);
    // Save persistent sheet height and width for future use.
    this.sheetWidth = this.position.width;
    this.sheetHeight = this.position.height;

    await actorUpdate(event, formData);
  }

  /**
   * Drag Event function for creating Hotbar macros for skill rolls
   * @param  {} event
   */
  _onSkillDragStart(event) {
    const li = event.currentTarget;

    $(event.currentTarget).attr("data-item-actorid", this.actor.id);
    const skill = li.dataset.ability;
    const characteristic = li.dataset.characteristic;

    if (skill && characteristic) {
      const dragData = {
        type: "CreateMacro",
        actorId: this.actor.id,
        data: {
          skill,
          characteristic,
          type: "skill",
        },
      };
      event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
      return true;
    }
    return false;
  }

  /**
   * Drag Event function for transferring items between owned actors
   * @param  {Object} event
   */
  _onTransferItemDragStart(event) {
    const li = event.currentTarget;

    $(event.currentTarget).attr("data-item-actorid", this.actor.id);

    const item = this.actor.items.get(li.dataset.itemId);

    // The transfer drag selector (".items-list .item") also matches rows that are not owned
    // items on this actor - e.g. talents granted by a specialization or composite crew rows.
    // Those have nothing to transfer or sort, so bail out instead of dereferencing undefined.
    if (!item) return false;

    // limit transfer on personal weapons/armour/gear
    if (["weapon", "armour", "gear"].includes(item.type)) {
      const dragData = {
        type: "Transfer",
        actorId: this.actor.id,
        data: item,
        // useful for other modules, e.g., item piles
        nativeData: item.toDragData(),
      };
      if (this.actor.isToken) dragData.tokenId = this.actor.token.id;
      event.dataTransfer.setData("text/plain", JSON.stringify(dragData));

      // Build a clean drag image: a clone of the row without the (absolutely-positioned,
      // hover-visible) restricted/info tooltips, which otherwise bloat the default drag ghost
      // so it appears to contain many rows.
      try {
        const ghost = li.cloneNode(true);
        ghost.querySelectorAll(".tooltip2, .tooltip").forEach((t) => t.remove());
        ghost.style.position = "absolute";
        ghost.style.top = "-2000px";
        ghost.style.left = "0";
        ghost.style.width = `${li.offsetWidth}px`;
        ghost.style.pointerEvents = "none";
        document.body.appendChild(ghost);
        event.dataTransfer.setDragImage(ghost, 10, 10);
        setTimeout(() => ghost.remove(), 0);
      } catch (err) {
        // non-fatal: fall back to the browser default drag image
      }
    } else {
      return false;
    }
  }

  _canDragStart(selector) {
    return this.options.editable && this.actor.isOwner;
  }

  _canDragDrop(selector) {
    return true;
  }

  /**
   * Drop Event function for transferring items between actors
   *
   * @param  {Object} event
   */
  async _onTransferItemDrop(event) {
    // Try to extract the data
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
      if (data.type !== "Transfer") return;
    } catch (err) {
      return false;
    }

    if (data.data) {
      let sameActor = data.actorId === this.actor.id;
      if (!sameActor) {
        try {
          this.actor.createEmbeddedDocuments("Item", [foundry.utils.duplicate(data.data)]); // Create a new Item
          let token;
          if (game.scenes.current) {
            token = game.scenes.current.tokens.get(data?.tokenId);
            if (token) {
              // Delete originating item from other _token_
              token.actor.items.get(data.data._id)?.delete();
              return;
            }
          }
          const actor = game.actors.get(data.actorId);
          await actor.items.get(data.data._id)?.delete(); // Delete originating item from other actor
        } catch (err) {
          CONFIG.logger.error(`Error transferring item between actors.`, err);
        }
      } else {
        // Dropped back onto the same actor: reorder the inventory item rather than no-op.
        return this._onSortInventoryItem(event, data.data);
      }
    }

    await this._suspendActiveEffects(await fromUuid(data.uuid));
  }

  /**
   * Reorder an inventory item within the same actor based on where it was dropped.
   * Reordering is constrained to items of the same type (weapons, armour, and gear are
   * rendered as separate lists), and persisted via the document "sort" field which the
   * sheet now renders in order.
   * @param {DragEvent} event - the drop event
   * @param {Object} itemData - the dragged item's data (must include _id)
   * @returns {Promise<Document[]>|undefined}
   * @private
   */
  async _onSortInventoryItem(event, itemData) {
    if (!this.actor.verifyEditModeIsNotEnabled()) return;

    const source = this.actor.items.get(itemData?._id);
    if (!source) return;

    // Resolve the row the item was dropped onto
    const dropTarget = event?.target?.closest?.("li.item[data-item-id]");
    const targetId = dropTarget?.dataset?.itemId;
    const target = targetId ? this.actor.items.get(targetId) : null;

    // Nothing to do if dropped on itself, on empty space, or onto a different item type
    if (!target || target.id === source.id || target.type !== source.type) return;

    // Decide whether to drop before or after the target based on where in the row the
    // pointer landed: top half inserts before, bottom half inserts after. This keeps
    // dragging up and down symmetric and makes the last slot reachable (falls back to
    // "insert before" if the pointer position can't be determined).
    let insertAfter = false;
    const rect = dropTarget.getBoundingClientRect?.();
    if (rect && typeof event?.clientY === "number") {
      insertAfter = (event.clientY - rect.top) > (rect.height / 2);
    }

    // Current display order for this item type (matches getData ordering)
    const ordered = this.actor.items
      .filter((i) => i.type === source.type)
      .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));

    // Remove the source and re-insert it relative to the drop target
    const reordered = ordered.filter((i) => i.id !== source.id);
    const targetIndex = reordered.findIndex((i) => i.id === target.id);
    reordered.splice(targetIndex + (insertAfter ? 1 : 0), 0, source);

    // Re-number sort values with spacing so subsequent inserts have room
    const density = CONST.SORT_INTEGER_DENSITY ?? 100000;
    const updates = reordered.map((item, index) => ({ _id: item.id, sort: (index + 1) * density }));
    return this.actor.updateEmbeddedDocuments("Item", updates);
  }

  /**
   * ActiveEffects are transferred to actors by default. In some cases, we don't want them transferred.
   * Suspend anything we don't want (for example, item attachment AEs shouldn't be transferred to an actor because they're holding it)
   * @param droppedItem - the fromUuid item dropped onto this object
   * @returns {Promise<void>}
   * @private
   */
  async _suspendActiveEffects(droppedItem) {
    // Note: this function is currently placeholder. I may implement it - if we get better support for holding attachments
    return;
    const droppedType = droppedItem.type;
    const myType = this.object.type;
    const toSuspend = [];

    if (["itemattachment", "itemmodifier"].includes(droppedType)) {
      CONFIG.logger.info(`Suspending AEs for drag-and-drop of ${droppedType} -> ${myType}`);
      for (const activeEffect of droppedItem.effects) {
        toSuspend.push(activeEffect);
      }
      await this.object.createEmbeddedDocuments("ActiveEffect", toSuspend);
    }
  }

  /**
   * Update specialization talents
   * @param  {Object} data
   */
  async _updateSpecialization(data) {
    CONFIG.logger.debug(`Running Actor initial load`);
    if (this.actor.flags.starwarsffg === undefined) {
        this.actor.flags.starwarsffg = {};
    }
    this.actor.flags.starwarsffg.loaded = true;

    const specializations = this.actor.items.filter((item) => {
      return item.type === "specialization";
    });

    CONFIG.logger.debug(`_updateSpecialization(): data.talentList before we start:`);
    CONFIG.logger.debug(data.talentList.slice());

    // start the talent list only with talents that did not come from a specialization
    const globalTalentList = data.talentList.filter(i => i.source.filter(s => s.type === "talent").length > 0)

    for await (const spec of specializations) {
      CONFIG.logger.debug(`_updateSpecialization(): starting work on ${spec.name}`);

      if (spec?.talentList && spec.talentList.length > 0) {
        spec.talentList.forEach((talent) => {
          const item = talent;
          item.firstSpecialization = spec.id;

          if (item.isRanked) {
            item.rank = typeof talent.rank === "number" ? talent.rank : 1;
          } else {
            item.rank = "N/A";
          }

          let index = globalTalentList.findIndex((obj) => {
            return obj.name === item.name;
          });

          if (index < 0 || !item.isRanked) {
            globalTalentList.push(item);
          } else {
            globalTalentList[index].rank += talent.rank;
          }
        });
      }
      CONFIG.logger.debug(`_updateSpecialization(): globalTalentList after current specialization:`);
      CONFIG.logger.debug(globalTalentList.slice());
    }

    data.talentList = globalTalentList;

    CONFIG.logger.debug(`_updateSpecialization(): data.talentList after update:`);
    CONFIG.logger.debug(data.talentList.slice());
  }

  /**
   * Open dialog for popout editor
   * @param  {Object} event
   */
  _onPopoutEditor(event) {
    event.preventDefault();
    const a = event.currentTarget.parentElement;
    const label = a.dataset.label;
    const key = a.dataset.target;

    const parent = $(a.parentElement);
    const parentPosition = $(parent).offset();

    const windowHeight = parseInt($(parent).height(), 10) + 100 < 200 ? 200 : parseInt($(parent).height(), 10) + 100;
    const windowWidth = parseInt($(parent).width(), 10) < 320 ? 320 : parseInt($(parent).width(), 10);
    const windowLeft = parseInt(parentPosition.left, 10);
    const windowTop = parseInt(parentPosition.top, 10);

    const title = a.dataset.label ? `Editor for ${this.object.name}: ${label}` : `Editor for ${this.object.name}`;

    new PopoutEditor(this.object, {
      name: key,
      title: title,
      height: windowHeight,
      width: windowWidth,
      left: windowLeft,
      top: windowTop,
    }).render(true);
  }

  /**
   * Adjust the Force Presence balance-point scale. Dark points are tracked from the left edge and
   * light points from the right. Clicking a button adds a point on that side: it converts a neutral
   * point if one exists, otherwise (when the scale is full) it converts one point from the opposite
   * side, shifting the balance. Right-click removes a point from that side, returning it to neutral.
   * All paths keep dark + light within the configured maximum.
   * @param {"dark"|"light"} side - which end of the scale the pressed button represents
   * @param {number} delta - +1 for a left-click (add), -1 for a right-click (remove)
   * @param {Event} event - the originating click/contextmenu event
   */
  async _onForcePresenceAdjust(side, delta, event) {
    event.preventDefault();
    const fp = this.actor.system.forcePresence || {};
    const max = Number(fp.max) || 10;
    let dark = Math.max(0, Math.min(Number(fp.dark) || 0, max));
    let light = Math.max(0, Math.min(Number(fp.light) || 0, max));
    if (dark + light > max) {
      light = max - dark;
    }
    const neutral = max - dark - light;

    if (delta > 0) {
      // Add a point on the pressed side. Prefer flipping a neutral point; if none remain, flip one
      // point from the opposite side instead. If the whole scale already belongs to this side, the
      // click is a no-op.
      if (side === "dark") {
        if (neutral > 0) {
          dark += 1;
        } else if (light > 0) {
          light -= 1;
          dark += 1;
        } else {
          return;
        }
      } else {
        if (neutral > 0) {
          light += 1;
        } else if (dark > 0) {
          dark -= 1;
          light += 1;
        } else {
          return;
        }
      }
    } else {
      // Right-click: return a point on the pressed side to neutral.
      if (side === "dark" && dark > 0) {
        dark -= 1;
      } else if (side === "light" && light > 0) {
        light -= 1;
      } else {
        return;
      }
    }

    await this.actor.update({
      system: { forcePresence: { dark, light, max } },
    });

    await this._reconcileMysticAlignmentEffects(dark, light);
  }

  /**
   * Create or remove the Mystic Alignment threshold Active Effects to match the current balance
   * point counts. At 7+ Dark Side points the character gains a "Dark Side Alignment" effect
   * (strain threshold -2, wound threshold +2); at 7+ Light Side points a "Light Side Alignment"
   * effect (strain threshold +2). Effects are identified by a flag, so renaming them won't break
   * reconciliation, and they're toggleable/visible on the actor's Effects tab like any other AE.
   * @param {number} dark - current dark side balance point count
   * @param {number} light - current light side balance point count
   */
  async _reconcileMysticAlignmentEffects(dark, light) {
    const want = { dark: dark >= 7, light: light >= 7 };

    const have = {};
    for (const effect of this.actor.effects) {
      const tag = effect.getFlag("starwarsffg", "mysticAlignment");
      if (tag) {
        have[tag] = effect;
      }
    }

    // Only target thresholds this actor actually has. Rivals, for example, have a wound threshold
    // but no strain threshold, so the strain change is omitted for them (and a Light Side effect
    // that would end up with no changes is skipped entirely).
    const hasStrain = !!this.actor.system?.stats?.strain;
    const hasWounds = !!this.actor.system?.stats?.wounds;
    const ADD = CONST.ACTIVE_EFFECT_MODES.ADD;

    const darkChanges = [];
    if (hasStrain) darkChanges.push({ key: "system.stats.strain.max", mode: ADD, value: -2 });
    if (hasWounds) darkChanges.push({ key: "system.stats.wounds.max", mode: ADD, value: 2 });

    const lightChanges = [];
    if (hasStrain) lightChanges.push({ key: "system.stats.strain.max", mode: ADD, value: 2 });

    const definitions = {
      dark: {
        name: game.i18n.localize("SWFFG.MysticAlignmentDarkEffect"),
        img: "systems/starwarsffg/images/dice/starwars/darkside.png",
        changes: darkChanges,
        flags: { starwarsffg: { mysticAlignment: "dark" } },
      },
      light: {
        name: game.i18n.localize("SWFFG.MysticAlignmentLightEffect"),
        img: "systems/starwarsffg/images/dice/starwars/lightside.png",
        changes: lightChanges,
        flags: { starwarsffg: { mysticAlignment: "light" } },
      },
    };

    const toCreate = [];
    const toDelete = [];
    for (const side of ["dark", "light"]) {
      // Only want an effect if the threshold is reached AND it would actually modify something.
      const wanted = want[side] && definitions[side].changes.length > 0;
      if (wanted && !have[side]) {
        toCreate.push(definitions[side]);
      } else if (!wanted && have[side]) {
        toDelete.push(have[side].id);
      }
    }

    if (toDelete.length) {
      await this.actor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
    }
    if (toCreate.length) {
      await this.actor.createEmbeddedDocuments("ActiveEffect", toCreate);
    }
  }

  /**
   * Creates two even columns of skills for display while also sorting them.
   * @param  {Object} data
   */
  _createSkillColumns(data) {
    const numberSkills = Object.values(data.data.skills).length;
    const totalRows = numberSkills + Object.values(data.data.skilltypes).length;

    let colRowCount = Math.ceil(totalRows / 2.0);

    const cols = [[], []];

    let currentColumn = 0;
    let rowsLeft = colRowCount;

    data.data.skilltypes.forEach((type) => {
      // filter and sort skills for current skill category
      let sortFunction = (a, b) => {
        if (a.toLowerCase() > b.toLowerCase()) return 1;
        if (a.toLowerCase() < b.toLowerCase()) return -1;
        return 0;
      };
      if (game.settings.get("starwarsffg", "skillSorting")) {
        sortFunction = (a, b) => {
          return data.data.skills[a].label.localeCompare(data.data.skills[b].label, game.i18n.lang);
        };
      }

      const skills = Object.keys(data.data.skills)
        .filter((s) => data.data.skills[s].type === type.type)
        .sort(sortFunction);

      // if the skill list is larger that the column row count then take into account the added header row.
      if (skills.length >= colRowCount) {
        if (skills.length - colRowCount > 2) {
          colRowCount = Math.ceil((totalRows + 1) / 2.0);
          rowsLeft = colRowCount;
        } else {
          colRowCount = skills.length + 1;
          rowsLeft = colRowCount;
        }
      }

      cols[currentColumn].push({ id: "header", ...type });
      rowsLeft -= 1;
      skills.forEach((s, index) => {
        cols[currentColumn].push({ name: s, ...data.data.skills[s] });
        rowsLeft -= 1;
        if (rowsLeft <= 0 && currentColumn === 0) {
          currentColumn += 1;
          rowsLeft = colRowCount;

          if (index + 1 < skills.length) {
            cols[currentColumn].push({ id: "header", ...type });
            rowsLeft -= 1;
          }
        }
      });
    });

    return cols;
  }

  async _buyCore(event) {
    if(!this.actor.verifyEditModeIsNotEnabled()) return;

    const action = $(event.target).data("buy-action");
    const template = "systems/starwarsffg/templates/dialogs/ffg-confirm-purchase.html";
    let content;
    const availableXP = this.object.system.experience.available;
    const totalXP = this.object.system.experience.total;
    let itemType;
    const groups = [];
    if (action === "specialization") {
      const inCareer = this.object.items.find(i => i.type === "career")?.system?.specializations;
      if (!inCareer) {
        ui.notifications.warn("Could not locate any specializations in your career! Please define them first");
        return;
      }
      const inCareerNames = Object.values(inCareer).map(i => i.name);
      const sources = game.settings.get("starwarsffg", "specializationCompendiums").split(",");
      let outCareer = [];
      let universal = [];
      for (const source of sources) {
        const pack = game.packs.get(source);
        if (!pack) {
          continue;
        }
        const items = await pack.getDocuments();
        for (const item of items) {
          if (!inCareerNames.includes(item.name) && item.system.universal) {
            universal.push({
              name: item.name,
              id: item.id,
              source: item.uuid,
            });
          } else if (!inCareerNames.includes(item.name)) {
            outCareer.push({
              name: item.name,
              id: item.id,
              source: item.uuid,
            });
          }
        }
      }
      outCareer = sortDataBy(outCareer, "name");
      universal = sortDataBy(universal, "name");
      const baseCost = (this.object.items.filter(i => i.type === "specialization").length + 1) * 10;
      if (baseCost > availableXP) {
        ui.notifications.warn(game.i18n.localize("SWFFG.Actors.Sheets.Purchase.NotEnoughXP"));
        return;
      }
      itemType =  game.i18n.localize("TYPES.Item.specialization");
      groups.push("Universal");
      groups.push("In Career");
      groups.push("Out of Career");
      content = await foundry.applications.handlebars.renderTemplate(template, { inCareer, outCareer, universal, baseCost, increasedCost: baseCost, itemType: itemType, itemCategory: "specialization", groups: groups });
    } else if (action === "signatureability") {
      const sources = game.settings.get("starwarsffg", "signatureAbilityCompendiums").split(",");
      const rawSelectableItems =  this.object.items.find(i => i.type === "career").system.signatureabilities;
      const sigAbilityNames = Object.values(rawSelectableItems).map(i => i.name);
      let selectableItems = [];
      // pull items out of the world
      for (const itemId of Object.keys(rawSelectableItems)) {
        const item = rawSelectableItems[itemId];
        let retrievedItem = game.items.get(item.id);
        if (retrievedItem) {
          selectableItems.push({
            name: retrievedItem.name,
            id: retrievedItem.id,
            source: retrievedItem.uuid,
            cost: parseInt(retrievedItem.system.base_cost),
          });
        }
      }
      // pull items out of compendiums
      for (const source of sources) {
        const pack = game.packs.get(source);
        if (!pack) {
          continue;
        }
        const items = await pack.getDocuments();
        for (const item of items) {
          if (sigAbilityNames.includes(item.name)) {
            selectableItems.push({
              name: item.name,
              id: item.id,
              source: item.uuid,
              cost: parseInt(item.system.base_cost),
            });
          }
        }
      }
      if (selectableItems.length === 0) {
        ui.notifications.warn(game.i18n.localize("SWFFG.Actors.Sheets.Purchase.SA.NotSet"));
        return;
      }
      // filter purchasable signature abilities to those where the required specialization upgrades have been purchased
      // filter specializations to those within the career
      const career = this.object.items.find(i => i.type === "career");
      if (!career) {
        ui.notifications.warn(game.i18n.localize("SWFFG.Actors.Sheets.Purchase.CareerNotSet"));
        return;
      }
      const permittedSpecializations = Object.values(career.system.specializations).map(i => i.name);
      const matchingSpecializations = this.object.items.filter(i => i.type === "specialization" && permittedSpecializations.includes(i.name));
      if (!matchingSpecializations) {
        ui.notifications.warn(game.i18n.localize("SWFFG.Actors.Sheets.Purchase.Career.Specializations.NotSet"));
        return;
      }
      // loop through signature abilities and build a map of required upgrades
      let newSelectableItems = [];
      for (const selectableItem of selectableItems) {
        const fullItem = fromUuidSync(selectableItem.source);
        // check if any specializations match the required upgrades, discarding them if they do not
        let match;
        for (const specialization of matchingSpecializations) {
          match = true;
          for (let i = 0; i < 4; i++) {
            // if the upgrade is required, and we don't have it learned, this is not a match
            if (fullItem.system.uplink_nodes[`uplink${i}`] && !specialization.system.talents[`talent${i + 16}`].islearned) {
              match = false;
              break;
            }
          }
          if (match) {
            // if any specialization matches the required upgrades, do not check further specializations
            newSelectableItems.push(selectableItem);
            break;
          }
        }
      }
      if (newSelectableItems.length === 0) {
        ui.notifications.warn(game.i18n.localize("SWFFG.Actors.Sheets.Purchase.SA.NoMatch"));
        return;
      }

      // update the list with the filtered list
      selectableItems = newSelectableItems;

      selectableItems = sortDataBy(selectableItems, "name");
      itemType = game.i18n.localize("TYPES.Item.signatureability");
      content = await foundry.applications.handlebars.renderTemplate(template, { selectableItems, itemType: itemType, itemCategory: "signatureability" });
    } else if (action === "forcepower") {
      const sources = game.settings.get("starwarsffg", "forcePowerCompendiums").split(",");
      let selectableItems = [];
      const worldItems = game.items.filter(i => i.type === "forcepower");
      for (const worldItem of worldItems) {
        selectableItems.push({
          name: worldItem.name,
          id: worldItem.id,
          source: worldItem.uuid,
          cost: worldItem.system.base_cost,
          requiredForceRating: parseInt(worldItem.system.required_force_rating),
        });
        addIfNotExist(groups, parseInt(worldItem.system.required_force_rating));
      }
      for (const source of sources) {
        const pack = game.packs.get(source);
        if (!pack) {
          continue;
        }
        const items = await pack.getDocuments();
        for (const item of items) {
          selectableItems.push({
            name: item.name,
            id: item.id,
            source: item.uuid,
            cost: item.system.base_cost,
            requiredForceRating: parseInt(item.system.required_force_rating),
          });
          addIfNotExist(groups, parseInt(item.system.required_force_rating));
        }
      }
      selectableItems = sortDataBy(selectableItems, "name");
      itemType = game.i18n.localize("TYPES.Item.forcepower");
      groups.sort();
      content = await foundry.applications.handlebars.renderTemplate(template, { selectableItems, itemType: itemType, itemCategory: "forcepower", groups: groups });
    } else if (action === "talent") {
      const purchasedItems = this.object.talentList;
      const sources = game.settings.get("starwarsffg", "talentCompendiums").split(",");
      let selectableItems = [];
      const worldItems = game.items.filter(i => i.type === "talent");
      let worldItemsPack = [];
      for (const worldItem of worldItems) {
        const purchasedItem = purchasedItems.find((pItem) => pItem.name === worldItem.name)
        if(!purchasedItem || purchasedItem.isRanked) {
          worldItemsPack.push({
            name: worldItem.name,
            id: worldItem.id,
            source: worldItem.uuid,
            cost: purchasedItem?.isRanked ? worldItem.system.tier * 5 + 5 * purchasedItem.rank: worldItem.system.tier * 5,
          });
        }
      }
      worldItemsPack = sortDataBy(worldItemsPack, "name");
      selectableItems.push({pack: game.i18n.localize("SWFFG.Actors.Sheets.Purchase.Talent.WorldItemsGroup"), items: worldItemsPack});

      for (const source of sources) {
        const pack = game.packs.get(source);
        if (!pack) {
          continue;
        }
        let packItems = [];
        const items = await pack.getDocuments();
        for (const item of items) {
          const purchasedItem = purchasedItems.find((pItem) => pItem.name === item.name)
          if(!purchasedItem || purchasedItem.isRanked) {
            packItems.push({
              name: item.name,
              id: item.id,
              source: item.uuid,
              cost: purchasedItem?.isRanked ? item.system.tier * 5 + 5 * purchasedItem.rank: item.system.tier * 5,
            });
          }
        }
        packItems = sortDataBy(packItems, "name");
        selectableItems.push({pack: pack.metadata.label, items: packItems});
      }
      itemType = game.i18n.localize("TYPES.Item.talent");
      content = await foundry.applications.handlebars.renderTemplate(template, { selectableItems, itemType: itemType, itemCategory: "talent" });
    } else if (action === "characteristic") {
      const characteristic = $(event.target).data("buy-characteristic");
      await this._buyCharacteristicRank(characteristic);
      return;
    } else if (action === "skill") {
      await this._buySkillRank(event.target.parentElement.parentElement.parentElement);
      return;
    } else {
      CONFIG.logger.debug(`Refusing purchase action ${action} since it is not registered`);
      return;
    }

    const dialog = new Dialog(
    {
        title: game.i18n.format("SWFFG.Actors.Sheets.Purchase.DialogTitle", {itemType: itemType}),
        content: content,
        buttons: {
          done: {
            icon: '<i class="fa-regular fa-circle-up"></i>',
            label: game.i18n.localize("SWFFG.Actors.Sheets.Purchase.ConfirmPurchase"),
            callback: async (that) => {
              if(!this.actor.verifyEditModeIsNotEnabled()) return;

              const cost = $("#ffgPurchase option:selected", that).data("cost");
              const selected_id = $("#ffgPurchase option:selected", that).data("id");
              const selected_source = $("#ffgPurchase option:selected", that).data("source");
              if (cost > availableXP) {
                ui.notifications.warn(game.i18n.localize("SWFFG.Actors.Sheets.Purchase.NotEnoughXP"));
                return;
              }
              let purchasedItem = game.items.get(selected_id);
              if (!purchasedItem) {
                purchasedItem = await fromUuid(selected_source);
              }
              if (purchasedItem.type === "forcepower") {
                const currentForceRating = parseInt(this.actor.system.stats.forcePool.max);
                const requiredForceRating = parseInt(purchasedItem.system.required_force_rating);
                if (currentForceRating < requiredForceRating) {
                  ui.notifications.warn(game.i18n.format("SWFFG.Actors.Sheets.Purchase.FP.FRTooLow", {forceRating: currentForceRating, requiredForceRating: requiredForceRating}));
                  return;
                }
              }
              await this.object.createEmbeddedDocuments("Item", [purchasedItem]);
              const AEState = await ActorHelpers.beginEditMode(this.actor, true);
              const updatedAvailableXP = this.actor.system.experience.available;
              // this does not use _spendXp as it's granting items, which AEs cannot reasonably do
              await this.object.update({
                system: {
                  experience: {
                    available: updatedAvailableXP - cost,
                  },
                },
              });
              await xpLogSpend(game.actors.get(this.object.id), `new ${action} ${purchasedItem.name}`, cost, availableXP - cost, totalXP, undefined);
              await ActorHelpers.endEditMode(this.actor, AEState, true);
            },
          },
          cancel: {
            icon: '<i class="fas fa-cancel"></i>',
            label: game.i18n.localize("SWFFG.Actors.Sheets.Purchase.CancelPurchase"),
          },
        },
      },
      {
        classes: ["dialog", "starwarsffg"],
      }
    ).render(true);
  }

  async _buyCharacteristicRank(characteristic) {
    // this is the current value of the characteristic (including Active Effects)
    const characteristicValue = this.actor.system.characteristics[characteristic].value;
    // this is the value without items that modify it
    const characteristicWithoutAEs =  this.object.toObject().system.characteristics[characteristic].value;

    if (characteristicValue >= game.settings.get("starwarsffg", "maxAttribute")) {
      ui.notifications.warn(game.i18n.localize("SWFFG.Actors.Sheets.Purchase.Characteristic.Max"));
      return;
    }
    const availableXP = this.actor.system.experience.available;
    const totalXP = this.actor.system.experience.total;
    const cost = (characteristicValue + 1) * 10;
    if (cost > availableXP) {
      ui.notifications.warn(game.i18n.localize("SWFFG.Actors.Sheets.Purchase.NotEnoughXP"));
      return;
    }
    const dialog = new Dialog(
      {
        title: game.i18n.format("SWFFG.Actors.Sheets.Purchase.Characteristic.ConfirmTitle", {characteristic: characteristic}),
        content: game.i18n.format("SWFFG.Actors.Sheets.Purchase.Characteristic.ConfirmText", {cost: cost, level: characteristicValue + 1, characteristic: characteristic}),
        buttons: {
          done: {
            icon: '<i class="fa-regular fa-circle-up"></i>',
            label: game.i18n.localize("SWFFG.Actors.Sheets.Purchase.ConfirmPurchase"),
            callback: async (that) => {
              if(!this.actor.verifyEditModeIsNotEnabled()) return;

              const statusId = await this._spendXp(`system.characteristics.${characteristic}.value`, 1, cost);
              await xpLogSpend(game.actors.get(this.object.id), `characteristic ${characteristic} level ${characteristicValue} --> ${characteristicValue + 1}`, cost, availableXP - cost, totalXP, statusId);
              await this.render(true);
            },
          },
          cancel: {
            icon: '<i class="fas fa-cancel"></i>',
            label: game.i18n.localize("SWFFG.Actors.Sheets.Purchase.CancelPurchase"),
          },
        },
      },
      {
        classes: ["dialog", "starwarsffg"],
      }
    ).render(true);
  }

  /**
   * Handle clicking the kill minion button
   * @param event
   * @returns {Promise<void>}
   * @private
   */
  async _handleKillMinion(event) {
    event.stopPropagation();
    const target = $(event.currentTarget);
    const minionHealth = this.actor.system.unit_wounds.value;
    const currentHealth = this.actor.system.stats.wounds.value;
    if (target.hasClass("kill-minion")) {
      let damageAmount = minionHealth - (currentHealth % minionHealth) + 1;
      await this.actor.update({'system.stats.wounds.value': currentHealth + damageAmount});
    } else if (target.hasClass("kill-group")) {
      await this.actor.update({'system.stats.wounds.value': this.actor.system.stats.wounds.max + 1});
    }
  }

  async _xpAdjustment(event) {
    event.preventDefault();
    event.stopPropagation();

    const content = `
    <label for="adjustAmount">${game.i18n.localize("SWFFG.XP.Adjust.Window.Amount")}</label>
    <input type="number" id="adjustAmount" name="adjustAmount" value="0" />
    <label for="adjustReason">${game.i18n.localize("SWFFG.XP.Adjust.Window.Reason")}</label>
    <input type="text" id="adjustReason" name="adjustReason" value="${game.i18n.localize("SWFFG.XP.Adjust.Window.Default")}" />
    <label for="adjustTarget">${game.i18n.localize("SWFFG.XP.Adjust.Window.Target")}</label>
    <select id="adjustTarget" name="adjustTarget">
      <option value="both" selected>${game.i18n.localize("SWFFG.XP.Adjust.Window.TargetBoth")}</option>
      <option value="available">${game.i18n.localize("SWFFG.XP.Adjust.Window.TargetAvailable")}</option>
      <option value="total">${game.i18n.localize("SWFFG.XP.Adjust.Window.TargetTotal")}</option>
    </select>
    `;

    let d = new Dialog({
      title: game.i18n.localize("SWFFG.XP.Adjust.Window.Title"),
      content: content,
      buttons: {
        one: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("SWFFG.XP.Adjust.Confirm"),
          callback: async () => {
            const availableXPToLog = foundry.utils.deepClone(parseInt(this.actor.system.experience.available));
            const adjustAmount = parseInt($("#adjustAmount").val());
            const adjustReason = foundry.utils.deepClone($("#adjustReason").val());
            // Which value(s) to change: "both" (default), "available" only, or "total" only.
            // Adjusting one independently lets a GM rectify a desynced available/total pair.
            const adjustTarget = $("#adjustTarget").val() || "both";
            const AEState = await ActorHelpers.beginEditMode(this.actor, true);
            const startingAvailableXP =  foundry.utils.deepClone(parseInt(this.actor.system.experience.available));
            const totalXP =  foundry.utils.deepClone(parseInt(this.actor.system.experience.total));
            const updatedAvailableXP = adjustTarget === "total" ? startingAvailableXP : startingAvailableXP + adjustAmount;
            const updatedTotalXP = adjustTarget === "available" ? totalXP : totalXP + adjustAmount;
            await this.actor.update({ 'system.experience.available': updatedAvailableXP, 'system.experience.total': updatedTotalXP });
            // Log the EFFECTIVE available (what the bar shows, after purchase active effects), not the
            // edit-mode base read above with effects suspended. Only add the delta when available is targeted.
            const availableDelta = adjustTarget === "total" ? 0 : adjustAmount;
            await xpLogEarn(
              this.object,
              adjustAmount,
              availableXPToLog + availableDelta,
              updatedTotalXP,
              adjustReason,
              "Self"
            );
            await ActorHelpers.endEditMode(this.actor, AEState, true);
          },
        },
        two: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel",
        },
      },
      default: "one",
    });
    d.render(true);
  }

  async _xpExport(event) {
    event.preventDefault();
    event.stopPropagation();
    const existingLog = this.actor.getFlag("starwarsffg", "xpLog");
    const downloadLog = [];
    for (const entry of existingLog) {
      if (Object.keys(entry).includes("id")) {
        delete entry.id;
      }
      downloadLog.push(entry);
    }
    const blob = new Blob([JSON.stringify(downloadLog)], {type: "text/plain"});
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `${this.actor.name}-xpLog.txt`;
    link.click();
    URL.revokeObjectURL(blobUrl);
  }

  async _xpImport(event) {
    event.preventDefault();
    event.stopPropagation();

    const content = `
    <label for="adjustAmount">${game.i18n.localize("SWFFG.XP.Import.Title")}</label>
    <div>
      <input type="file" name="xpLogFile" id="xpLogFile" accept=".txt" />
    </div>
    `;

    let d = new Dialog({
      title: game.i18n.localize("SWFFG.XP.Import.Title"),
      content: content,
      buttons: {
        one: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("SWFFG.XP.Import.Title"),
          callback: async () => {
            const fileElement = $("#xpLogFile");
            const file = fileElement[0].files?.[0];
            const reader = new FileReader();
            reader.readAsText(file, 'UTF-8');
            reader.onload = async ({ target }) => {
              const parsedLog = JSON.parse(target.result);
              CONFIG.logger.debug(`Loading processed XP log: ${JSON.stringify(parsedLog)}`);
              await this.actor.setFlag("starwarsffg", "xpLog", parsedLog);
            }
            reader.onerror = function() {
              ui.notifications.error("Failed to load file contents");
            }
          },
        },
        two: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel",
        },
      },
      default: "one",
    });
    d.render(true);
  }

  debounceRender = foundry.utils.debounce(
    (force, options) => {
      super.render(force, options);
    },
    100,
    {
      leading: true,
      maxWait: 100,
    },
  );

  /** @override **/
  render(force, options) {
    this.debounceRender(force, options);
  }

  /** @override **/
  async _onSubmit(event) {
    const formValid = event?.target?.form?.reportValidity();
    if (formValid === false) {
      return;
    }
    return await super._onSubmit(event);
  }

  /**
   * Handle adding a source to vehicles
   * @param event
   * @returns {Promise<void>}
   * @private
   */
  async _handleSourceControl(event) {
    event.preventDefault();
    event.stopPropagation();
    const action = $(event.currentTarget).data("action");
    const sourceIndex = $(event.currentTarget).data("index");
    if (action === "add") {
      const addSource = new Dialog({
        title: game.i18n.localize("SWFFG.Meta.Sources.AddSource.Title"),
        content: `
          <p>${game.i18n.localize("SWFFG.Meta.Sources.AddSource.Book")} :</p>
          <input type="text" id="book" name="book" value="Force and Destiny Core Rulebook" autofocus>
          <p>${game.i18n.localize("SWFFG.Meta.Sources.AddSource.Page")}:</p>
          <input type="number" id="page" name="page" value="0">
        `,
        buttons: {
          submit: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("SWFFG.Meta.Sources.AddSource.Submit"),
            callback: async (obj, event) => {
              const jObj = $(obj);
              const bookName = jObj.find("#book").val();
              const pageNum = jObj.find("#page").val();
              await this.object.update({"system.metadata.sources": [...this.object.system.metadata.sources, `${bookName} pg. ${pageNum}`]});
            },
          },
          cancel: {
            icon: '<i class="fas fa-x"></i>',
            label: game.i18n.localize("SWFFG.Meta.Sources.AddSource.Cancel"),
          },
        },
        default: "submit",
      });
      addSource.render(true, {focus: true, classes: ["app", "window-app", "dialog", "themed", "theme-light", "starwarsffg-dialog"]});
    } else if (action === "remove") {
      const sources = foundry.utils.deepClone(this.object.system.metadata.sources);
      sources.splice(sourceIndex, 1);
      await this.object.update({"system.metadata.sources": sources});
    }
    this.render(true);
  }

  /**
   * Handle adding a tag to actors
   * @param event
   * @returns {Promise<void>}
   * @private
   */
  async _handleTagControl(event) {
    event.preventDefault();
    event.stopPropagation();
    const action = $(event.currentTarget).data("action");
    const tagIndex = $(event.currentTarget).data("index");
    if (action === "add") {
      const addTag = new Dialog({
        title: game.i18n.localize("SWFFG.Meta.Tags.AddTag.Title"),
        content: `
          <p>${game.i18n.localize("SWFFG.Meta.Tags.AddTag.Tag")} :</p>
          <input type="text" id="tag" name="tag" value="" autofocus>
        `,
        buttons: {
          submit: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("SWFFG.Meta.Tags.AddTag.Submit"),
            callback: async (obj, event) => {
              const jObj = $(obj);
              const tag = jObj.find("#tag").val();
              const updatedTags = this.object.system.metadata.tags || [];
              updatedTags.push(tag);
              await this.object.update({"system.metadata.tags": updatedTags});
            }
          },
          cancel: {
            icon: '<i class="fas fa-x"></i>',
            label: game.i18n.localize("SWFFG.Meta.Tags.AddTag.Cancel"),
          },
        },
        default: "submit",
      });
      addTag.render(true, {focus: true, classes: ["app", "window-app", "dialog", "themed", "theme-light", "starwarsffg-dialog"]});
    } else if (action === "remove") {
      const tags = foundry.utils.deepClone(this.object.system.metadata.tags);
      tags.splice(tagIndex, 1);
      await this.object.update({"system.metadata.tags": tags});
    }
    this.render(true);
  }
}

/**
 * Sort an array of dicts by a key. Totally not AI generated. But it works :)
 * @param data
 * @param byKey
 * @returns {*}
 */
export function sortDataBy(data, byKey) {
 return data.sort((a, b) => {
    if (a[byKey] < b[byKey]) {
      return -1;
    }
    if (a[byKey] > b[byKey]) {
      return 1;
    }
    return 0;
 });
}

/**
 * Add an element to an array only if it isn't already present in that array
 * @param array
 * @param element
 * @returns {*}
 */
export function addIfNotExist(array, element) {
  let index = array.indexOf(element);
  // Check if the object with the specified property value exists in the array
  if (index === -1) {
    // If not found, push a new object with the desired properties
    array.push(element);
  }
  return array;
}
