import ImportHelpers from "../../import-helpers.js";
import { OGGDUDE_DESCRIPTORS } from "../item-descriptors-data.js";

export default class ItemAttachments {
  static getMetaData() {
    return {
      displayName: 'Item Attachments',
      className: "ItemAttachments",
      itemName: "itemattachment",
      localizationName: "SWFFG.Labels.ItemAttachments",
      fileNames: ["ItemAttachments.xml"],
      filesAreDir: false,
      phase: 3,
    };
  }

  /**
   * Normalize a modifier entry (which may be a plain object or a temporary Item document) into a
   * plain object suitable for storage in an attachment's itemmodifier array, and set its active state.
   * Converting documents to plain objects here is also what prevents the whole attachment record from
   * failing to import: processModsData builds free-text mods as live Item documents, and saving an
   * attachment whose itemmodifier array contains document instances throws.
   * @param entry  a modifier produced by ImportHelpers.processModsData
   * @param active whether the modification should be applied immediately (base mod) or wait (optional)
   * @returns {object}
   */
  static normalizeModifier(entry, active) {
    const obj = (entry && typeof entry.toObject === "function") ? entry.toObject() : foundry.utils.duplicate(entry);
    if (!obj.system) obj.system = {};
    obj.system.active = active;
    // Quality clones already carry the correct (per-rank) rank from processModsData; only supply a
    // default when one is missing, so we never accidentally multiply a quality's value.
    if (obj.system.rank === undefined || obj.system.rank === null) obj.system.rank = 1;
    if (!obj.type) obj.type = "itemmodifier";
    // a fresh id per copy keeps duplicated options independent
    obj._id = foundry.utils.randomID();
    return obj;
  }

  /**
   * Wrap a flat attributes object (a characteristic / skill / die / stat / dice modifier) into a
   * single inactive itemmodifier so the option applies via getCalculatedValueFromItems once installed.
   * rank is fixed at 1: the magnitude is already folded into each attribute value.
   * @param attributes  the {key: {mod, modtype, value}} object
   * @param description any descriptive text for the option
   * @param sourceMod   the raw <Mod>/<Quality> node (used for a readable name)
   * @param counter     fallback index for naming
   * @returns {object}
   */
  static wrapAttributes(attributes, description, sourceMod, counter) {
    const firstAttr = Object.values(attributes)[0] ?? {};
    const labelled = firstAttr.mod
      ? `${firstAttr.mod.charAt(0).toUpperCase()}${firstAttr.mod.slice(1)}`
      : "Modification";
    const valueText = (firstAttr.value !== undefined && firstAttr.value !== true)
      ? ` ${parseInt(firstAttr.value, 10) >= 0 ? "+" : ""}${firstAttr.value}`
      : "";
    const fallbackName = `${labelled}${valueText}`.trim();
    const name = (typeof sourceMod?.MiscDesc === "string" && sourceMod.MiscDesc.trim())
      ? sourceMod.MiscDesc.trim()
      : (fallbackName || `Modification ${counter}`);
    return {
      name,
      type: "itemmodifier",
      _id: foundry.utils.randomID(),
      system: {
        description: description || "",
        attributes: foundry.utils.duplicate(attributes),
        type: "all",
        rank: 1,
        active: false,
        // stat/die options aren't qualities; keep them out of the summarized qualities list
        showInQualities: false,
      },
    };
  }

  /**
   * Map a standard OggDude stat-add descriptor key (e.g. DAMADD) to a system stat attribute. These
   * keys reference ItemDescriptors that carry no machine-readable effect (just templated text like
   * "Damage +[CO]"), so neither processModsData nor the descriptor import can synthesise the effect -
   * the magnitude lives on the attachment <Mod>'s Count. We therefore translate the well-known keys
   * here. modtype follows the attachment's type so the value is read by the right consumer
   * (Weapon/Armor/Vehicle Stat). Returns null for unknown keys.
   * @param key  the OggDude <Key>
   * @param type the attachment's resolved type (weapon/armour/vehicle/...)
   * @returns {{mod: string, modtype: string, sign: number}|null}
   */
  static statKeyToAttribute(key, type) {
    const W = "Weapon Stat", A = "Armor Stat", V = "Vehicle Stat";
    const byType = type === "armour" ? A : (type === "vehicle" ? V : W);
    const MAP = {
      // weapon
      DAMADD:   { mod: "damage",      modtype: W, sign: 1 },
      DAMSUB:   { mod: "damage",      modtype: W, sign: -1 },
      CRITADD:  { mod: "critical",    modtype: W, sign: 1 },
      CRITSUB:  { mod: "critical",    modtype: W, sign: -1 },
      RANGEADD: { mod: "range",       modtype: W, sign: 1 },
      RANGESUB: { mod: "range",       modtype: W, sign: -1 },
      // armour
      SOAKADD:  { mod: "soak",        modtype: A, sign: 1 },
      SOAKSUB:  { mod: "soak",        modtype: A, sign: -1 },
      ARMORADD: { mod: "soak",        modtype: A, sign: 1 },
      DEFADD:   { mod: "defence",     modtype: A, sign: 1 },
      DEFENSIVE:{ mod: "defence",     modtype: A, sign: 1 },
      // shared stats (modtype follows the attachment type)
      HPADD:    { mod: "hardpoints",  modtype: byType, sign: 1 },
      HPSUB:    { mod: "hardpoints",  modtype: byType, sign: -1 },
      ENCADD:   { mod: "encumbrance", modtype: byType, sign: 1 },
      ENCSUB:   { mod: "encumbrance", modtype: byType, sign: -1 },
    };
    return MAP[key] ?? null;
  }

  /**
   * Per-rank dice/result effect for the handful of keys the system applies mechanically via
   * attributes (mirrors ImportHelpers.processDiceMods, but value is per-rank so it scales with rank).
   * @param key OggDude key
   * @returns {{mod: string, modtype: string, value: number}|null}
   */
  static diceKeyEffect(key) {
    const M = {
      ACCURATE:    { mod: "Add Boost",          modtype: "Roll Modifiers" },
      BOOSTADD:    { mod: "Add Boost",          modtype: "Roll Modifiers" },
      INACCURATE:  { mod: "Add Setback",        modtype: "Roll Modifiers" },
      SETBACKADD:  { mod: "Add Setback",        modtype: "Roll Modifiers" },
      SETBACKSUB:  { mod: "Remove Setback",     modtype: "Roll Modifiers" },
      SUCCADD:     { mod: "Add Success",        modtype: "Result Modifiers" },
      THRADD:      { mod: "Add Threat",         modtype: "Result Modifiers" },
      ADVADD:      { mod: "Add Advantage",      modtype: "Result Modifiers" },
      UPGRADEDIFF: { mod: "Upgrade Difficulty", modtype: "Dice Modifiers" },
    };
    const e = M[key];
    return e ? { mod: e.mod, modtype: e.modtype, value: 1 } : null;
  }

  /**
   * Render a descriptor's rank-aware text, substituting the count into the OggDude {0} template.
   */
  static renderDescriptorText(desc, count) {
    if (desc?.t) return desc.t.replace("{0}", count);
    return desc?.n ?? "";
  }

  /**
   * Resolve an OggDude key against the bundled ItemDescriptors data (which ships with OggDude itself
   * and is never part of a dataset export, so we can't depend on the user importing it). This is what
   * turns DAMADD into a real damage modifier and ACCURATE/PIERCE into their named qualities without
   * any descriptor import. Resolution:
   *  - named quality (IsQuality) -> a named itemmodifier carrying any per-rank dice/stat effect we know
   *  - stat-add key (DAMADD, ...)  -> a stat attribute scaled by count
   *  - dice-add key (BOOSTADD, ...) -> a dice attribute scaled by count
   *  - any other descriptor / unknown key -> a visible named mod (informational), never mis-converted
   * @param key            OggDude <Key>
   * @param count          the <Count> (rank / magnitude)
   * @param attachmentType the attachment's resolved type, for choosing the stat modtype
   * @returns {{attributes: object, itemmodifiers: object[], description: string}}
   */
  static resolveDescriptorKey(key, count, attachmentType) {
    const out = { attributes: {}, itemmodifiers: [], description: "" };
    const desc = OGGDUDE_DESCRIPTORS[key];
    const stat = ItemAttachments.statKeyToAttribute(key, attachmentType);
    const dice = ItemAttachments.diceKeyEffect(key);

    if (desc && desc.q) {
      // a named weapon/armour quality (Accurate, Pierce, Vicious, ...). Most qualities have no
      // attribute-based effect (they are tracked by name); a few add dice/stat, applied per-rank.
      const attrs = {};
      if (dice) attrs[foundry.utils.randomID()] = { ...dice };
      else if (stat) attrs[foundry.utils.randomID()] = { mod: stat.mod, modtype: stat.modtype, value: stat.sign };
      out.itemmodifiers.push({
        name: desc.n,
        type: "itemmodifier",
        _id: foundry.utils.randomID(),
        system: {
          description: ItemAttachments.renderDescriptorText(desc, count),
          attributes: attrs,
          type: "all",
          rank: count,
          showInQualities: true,
        },
      });
      return out;
    }

    if (stat) {
      out.attributes[foundry.utils.randomID()] = { mod: stat.mod, modtype: stat.modtype, value: stat.sign * count };
      return out;
    }
    if (dice) {
      out.attributes[foundry.utils.randomID()] = { mod: dice.mod, modtype: dice.modtype, value: dice.value * count };
      return out;
    }

    // a descriptor with no machine-readable effect (special rules like Holster/Mount) or an unknown
    // key: keep it as a visible, named modification so nothing is dropped or mis-converted.
    const name = desc ? desc.n : key;
    const text = desc ? ItemAttachments.renderDescriptorText(desc, count) : "";
    out.itemmodifiers.push({
      name,
      type: "itemmodifier",
      _id: foundry.utils.randomID(),
      system: { description: text, attributes: {}, type: "all", rank: count, showInQualities: false },
    });
    out.description += `<div>${text || name}</div>`;
    return out;
  }

  /**
   * Resolve a single <Mod>/<Quality> node into its constituent pieces. The order is deliberate:
   *  1. processModsData - resolves anything backed by an imported descriptor compendium (if the user
   *     did import descriptors), plus characteristic/skill/die modifiers and free-text mods.
   *  2. resolveDescriptorKey - for any remaining keyed mod, resolve against the bundled OggDude
   *     descriptor data: stat keys (DAMADD) become stat effects, qualities (ACCURATE/PIERCE) become
   *     named qualities, and special/unknown keys become visible named mods. This replaces the old
   *     processDiceMods fallback that mis-converted "Accurate" into "Add Boost" and dropped the rest.
   * @param oneMod         a single modifier node
   * @param attachmentType the attachment's resolved type, used to pick the stat modtype
   * @returns {Promise<{attributes: object, itemmodifiers: object[], description: string}>}
   */
  static async buildOneMod(oneMod, attachmentType) {
    const out = { attributes: {}, itemmodifiers: [], description: "" };

    // If this is a keyed mod we recognise from the bundled OggDude descriptor data, resolve it
    // directly. This both gives the correct named quality / stat effect and skips the shared
    // processModsData compendium lookup, which would otherwise log a spurious "<KEY> not found"
    // warning for every descriptor key (since the descriptor compendium is never populated). The
    // bundled set deliberately excludes characteristic and skill keys, so those still fall through
    // to processModsData below for proper handling.
    if (oneMod?.Key && OGGDUDE_DESCRIPTORS[oneMod.Key]) {
      const count = oneMod?.Count ? parseInt(oneMod.Count, 10) : 1;
      const resolved = ItemAttachments.resolveDescriptorKey(oneMod.Key, count, attachmentType);
      out.itemmodifiers.push(...resolved.itemmodifiers);
      Object.assign(out.attributes, resolved.attributes);
      if (resolved.description) out.description += resolved.description;
      return out;
    }

    const single = await ImportHelpers.processModsData({ Mod: oneMod });
    if (single?.itemmodifier?.length) out.itemmodifiers.push(...single.itemmodifier);
    if (single?.attributes) Object.assign(out.attributes, single.attributes);
    if (single?.description) out.description += single.description;

    if (!out.itemmodifiers.length && !Object.keys(out.attributes).length && oneMod?.Key) {
      // a keyed mod that isn't characteristic/skill/compendium-backed and isn't in the bundled data
      // (e.g. a brand-new custom key) - keep it visible as a named placeholder.
      const count = oneMod?.Count ? parseInt(oneMod.Count, 10) : 1;
      const resolved = ItemAttachments.resolveDescriptorKey(oneMod.Key, count, attachmentType);
      out.itemmodifiers.push(...resolved.itemmodifiers);
      Object.assign(out.attributes, resolved.attributes);
      if (resolved.description) out.description += resolved.description;
    }
    return out;
  }

  /**
   * Process a <BaseMods> / <Qualities> block into always-on effects for the attachment's own
   * attributes (the editor's "Base Mods" tab). Stat/skill/characteristic/die modifiers contribute
   * their attributes directly; quality references are decomposed into their underlying effect
   * attributes (scaled by rank) so the quality still applies even though base mods are stored as
   * plain attributes rather than named itemmodifiers. Every mod is handled in its own try/catch so a
   * single bad entry can never abort the import. Base mods are intentionally NOT added to
   * system.itemmodifier, which is reserved for the optional/toggleable modifications list.
   * @param block the raw <BaseMods>/<Qualities> node
   * @returns {Promise<{attributes: object, description: string}>}
   */
  static async processBaseModBlock(block, attachmentType) {
    const result = { attributes: {}, description: "" };
    const raw = block?.Mod ?? block?.Quality;
    if (!raw) return result;
    const mods = Array.isArray(raw) ? raw : [raw];
    for (const oneMod of mods) {
      try {
        const built = await ItemAttachments.buildOneMod(oneMod, attachmentType);
        // direct stat/skill/characteristic/die effects -> always-on attributes
        for (const value of Object.values(built.attributes)) {
          result.attributes[foundry.utils.randomID()] = foundry.utils.duplicate(value);
        }
        // quality references -> decompose their effect attributes so the quality still applies
        for (const entry of built.itemmodifiers) {
          const plain = (entry && typeof entry.toObject === "function") ? entry.toObject() : foundry.utils.duplicate(entry);
          const rank = parseInt(plain?.system?.rank, 10) || 1;
          for (const value of Object.values(plain?.system?.attributes ?? {})) {
            const copy = foundry.utils.duplicate(value);
            const numeric = parseInt(copy.value, 10);
            if (!Number.isNaN(numeric)) copy.value = numeric * rank;
            result.attributes[foundry.utils.randomID()] = copy;
          }
        }
        // buildOneMod's description already documents named qualities and free-text mods, which keeps
        // rules-text qualities (no mechanical attributes) from being silently lost.
        if (built.description) result.description += built.description;
      } catch (err) {
        CONFIG.logger.warn(`Skipping an unparseable base modification while importing attachment`, err);
      }
    }
    return result;
  }

  /**
   * Process an <AddedMods> block into the attachment's optional modifications list (the editor's
   * "Modifications" tab -> system.itemmodifier). Each <Mod> becomes one inactive, toggleable
   * itemmodifier: quality references keep their name, stat/die/dice effects are wrapped so they apply
   * once installed. Count is expanded so duplicate options (e.g. two "+1 Damage" mods) import as
   * separate toggles rather than one stacked option. Per-mod try/catch keeps one bad entry from
   * aborting the import.
   * @param block the raw <AddedMods> node
   * @returns {Promise<{itemmodifiers: object[]}>}
   */
  static async processOptionalModBlock(block, attachmentType) {
    const result = { itemmodifiers: [] };
    const raw = block?.Mod ?? block?.Quality;
    if (!raw) return result;
    const mods = Array.isArray(raw) ? raw : [raw];
    let counter = 0;
    for (const oneMod of mods) {
      counter += 1;
      try {
        const count = Math.max(1, oneMod?.Count ? parseInt(oneMod.Count, 10) : 1);
        // process a single unit so each emitted option carries a value of 1
        const unit = { ...oneMod, Count: "1" };
        const built = await ItemAttachments.buildOneMod(unit, attachmentType);
        const hasAttributes = Object.keys(built.attributes).length > 0;

        for (let i = 0; i < count; i += 1) {
          for (const entry of built.itemmodifiers) {
            result.itemmodifiers.push(ItemAttachments.normalizeModifier(entry, false));
          }
          if (hasAttributes) {
            result.itemmodifiers.push(ItemAttachments.wrapAttributes(built.attributes, built.description, oneMod, counter));
          }
        }
      } catch (err) {
        CONFIG.logger.warn(`Skipping an unparseable optional modification while importing attachment`, err);
      }
    }
    return result;
  }

  static async Import(xml) {
    const base = JXON.xmlToJs(xml);
    let items = base?.ItemAttachments?.ItemAttachment;
    if (items) {
      let totalCount = items.length;
      let currentCount = 0;
      const packMap = {
        "armor": await ImportHelpers.getCompendiumPack("Item", "oggdude.ArmorAttachments"),
        "weapon": await ImportHelpers.getCompendiumPack("Item", "oggdude.WeaponAttachments"),
        "all": await ImportHelpers.getCompendiumPack("Item", "oggdude.GenericAttachments"),
        "gear": await ImportHelpers.getCompendiumPack("Item", "oggdude.GenericAttachments"),
        "vehicle": await ImportHelpers.getCompendiumPack("Item", "oggdude.VehicleAttachments"),
        "mount": await ImportHelpers.getCompendiumPack("Item", "oggdude.VehicleAttachments"),
      };
      let pack;
      CONFIG.logger.debug(`Starting Oggdude Item Attachments Import`);
      $(".import-progress.itemattachment").toggleClass("import-hidden");

      await ImportHelpers.asyncForEach(items, async (item) => {
        try {
          let data;
          if (Array.isArray(item.Type)) item.Type = item.Type[0];
          // Some attachments ship without a <Type>; default them to a generic item attachment rather
          // than throwing on item.Type.toLowerCase() (which aborted that record's import).
          if (item?.Type?.toLowerCase() === "vehicle") {
            data = ImportHelpers.prepareBaseObject(item, "shipattachment");
          } else {
            data = ImportHelpers.prepareBaseObject(item, "itemattachment");
          }

          if (item.Description && item.Description.split('\n').length > 0) {
            item.Description = item.Description.replace('\n\n', '\n').split('\n').slice(1).join('<br>');
          } else if (!item.Description) {
            item.Description = "";
          }

          data.img = `/systems/starwarsffg/images/mod-${item?.Type ? item.Type.toLowerCase() : "all"}.png`;
          data.data = {
            description: item.Description,
            attributes: {},
            price: {
              value: item.Price ? parseInt(item.Price, 10) : 0,
            },
            rarity: {
              value: item.Rarity ? parseInt(item.Rarity, 10) : 0,
            },
            hardpoints: {
              value: item.HP ? parseInt(item.HP, 10) : 0,
            },
            type: item.Type ? item.Type.toLowerCase() : "all",
            itemmodifier: [],
            metadata: {
              tags: [],
            },
          };

          if (item?.Type?.toLowerCase() === "vehicle") {
            data.data.metadata.tags.push("shipattachment");
          } else {
            data.data.metadata.tags.push("itemattachment");
          }

          // attempt to select the specific compendium for this type of attachment
          if (Object.keys(packMap).includes(data.data.type)) {
            pack = packMap[data.data.type];
          } else {
            // but fail back to the generic compendium
            pack = packMap["all"];
          }

          // oggdude use "armor", but the internal mod type is "armour"
          if (data?.data?.type === "armor") data.data.type = "armour"

          data.data.description += ImportHelpers.getSources(item?.Sources ?? item?.Source);

          // Base modifications (<BaseMods>) are always-on once the attachment is installed, so they
          // live on the attachment's own attributes (the "Base Mods" tab) - NOT in the optional list.
          // Quality references are decomposed into their effect attributes so the quality still
          // applies; their names/text are preserved in the base-mods description blurb.
          const baseMods = await ItemAttachments.processBaseModBlock(item?.BaseMods, data.data.type);
          data.data.attributes = { ...data.data.attributes, ...baseMods.attributes };
          if (baseMods.description) data.data.description += `<h3>Base Mods</h3>${baseMods.description}`;

          // A <Qualities> block (rare on attachments) is treated as always-on too.
          const qualityMods = await ItemAttachments.processBaseModBlock(item?.Qualities, data.data.type);
          data.data.attributes = { ...data.data.attributes, ...qualityMods.attributes };
          if (qualityMods.description) data.data.description += `<h3>Qualities</h3>${qualityMods.description}`;

          // Optional modifications (<AddedMods>) are the toggleable list shown in the "Modifications"
          // tab (system.itemmodifier). Each <Mod> is one inactive itemmodifier; Count is expanded so
          // duplicate options import as separate toggles. This is also where named optional qualities,
          // "active effect" stat/die options, and add-a-die options land - none of which imported
          // before - while base mods are kept out so the optional list is no longer polluted by them.
          const optionalMods = await ItemAttachments.processOptionalModBlock(item?.AddedMods, data.data.type);
          for (const entry of optionalMods.itemmodifiers) data.data.itemmodifier.push(entry);

          // populate tags
          try {
            if (Array.isArray(item.CategoryLimit.Category)) {
              for (const tag of item.CategoryLimit.Category) {
                data.data.metadata.tags.push(tag.toLowerCase());
              }
            } else {
              data.data.metadata.tags.push(item.CategoryLimit.Category.toLowerCase());
            }
          } catch (err) {
            CONFIG.logger.debug(`No categories found for item ${item.Key}`);
          }
          if (item?.Type) {
            // the "type" can be useful as a tag as well
            data.data.metadata.tags.push(item.Type.toLowerCase());
          }

          await ImportHelpers.addImportItemToCompendium("Item", data, pack);
          currentCount += 1;

          $(".itemattachment .import-progress-bar")
            .width(`${Math.trunc((currentCount / totalCount) * 100)}%`)
            .html(`<span>${Math.trunc((currentCount / totalCount) * 100)}%</span>`);
        } catch (err) {
          CONFIG.logger.error(`Error importing record : `, err);
        }
      });
    }
  }
}
