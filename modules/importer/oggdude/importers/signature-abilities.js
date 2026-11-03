import ImportHelpers from "../../import-helpers.js";
import { markDeleted } from "../../../helpers/career-relink.js";

export default class SignatureAbilities {
  static getMetaData() {
    return {
      displayName: 'Signature Abilities',
      className: "SignatureAbility",
      itemName: "signatureability",
      localizationName: "TYPES.Item.signatureability",
      fileNames: ["SigAbilityNodes.xml"],
      filesAreDir: false,
      phase: 8,
    };
  }

  /** <Custom> values, ranked by how much of the record the data set's author wrote. */
  static AUTHORED = { AddedItem: 3, CustomItem: 2, DescOnly: 1 };

  /**
   * One file per signature ability key. An export can carry two records with the same key (the
   * stock ability and a reworked copy, or an earlier draft left behind under its old name), and the
   * compendium keeps one entry per key, so whichever was imported last won: zip order put the stock
   * "Fated Duel.xml" after "Fated Duel (reSpecialized) 1.0.xml", and the stock version replaced the
   * rework. Keep the most authored record, then the newest file.
   */
  static async pickFiles(zip, files) {
    const chosen = new Map();
    for (const file of files) {
      let key = file.name;
      let rank = 0;
      try {
        const doc = ImportHelpers.stringToXml(await zip.file(file.name).async("text"));
        key = doc.querySelector("SigAbility > Key")?.textContent?.trim() || file.name;
        rank = SignatureAbilities.AUTHORED[doc.querySelector("SigAbility > Custom")?.textContent?.trim()] ?? 0;
      } catch (err) {
        CONFIG.logger.warn(`Could not read signature ability ${file.name}`, err);
      }
      const date = file.date?.getTime?.() ?? 0;
      const best = chosen.get(key);
      if (best) {
        const replace = rank > best.rank || (rank === best.rank && date >= best.date);
        CONFIG.logger.debug(`Signature abilities ${best.file.name} and ${file.name} share the key ${key}; importing ${replace ? file.name : best.file.name}`);
        if (!replace) continue;
      }
      chosen.set(key, { file, rank, date });
    }
    return [...chosen.values()].map((c) => c.file);
  }

  /**
   * Give each imported career exactly the signature abilities this data set assigns it. Links used
   * to be added one ability at a time and never removed, so a career kept an ability the data set
   * had replaced or moved; and when the careers were updated in place by the same import, the
   * career came back from the import cache as plain data with no update(), so nothing was linked.
   * A link to an ability outside the imported compendium (dragged on by hand) is left alone.
   * @param {object} careerLinks - career key -> {abilityId: {name, source, id}}
   * @param {CompendiumCollection} sigPack - the imported signature ability compendium
   */
  static async linkCareers(careerLinks, sigPack) {
    const careerPack = game.packs.get("world.oggdudecareers");
    if (!careerPack || careerPack.locked) return;
    const managed = `Compendium.${sigPack.collection}.`;
    for (const career of await careerPack.getDocuments()) {
      if (career.type !== "career") continue;
      const wanted = careerLinks[career.flags?.starwarsffg?.ffgimportid] ?? {};
      const current = career.system.signatureabilities ?? {};
      const update = {};
      for (const [id, link] of Object.entries(current)) {
        if (!wanted[id] && (!link?.source || link.source.startsWith(managed))) markDeleted(update, id);
      }
      for (const [id, link] of Object.entries(wanted)) {
        const old = current[id];
        if (old?.name !== link.name || old?.source !== link.source || old?.id !== link.id) update[id] = link;
      }
      if (!Object.keys(update).length) continue;
      try {
        await career.update({ system: { signatureabilities: update } });
      } catch (err) {
        CONFIG.logger.error(`Could not link signature abilities to career ${career.name}`, err);
      }
    }
  }

  static async Import(xml, zip) {
    const base = JXON.xmlToJs(xml);
    let items = base?.SigAbilityNodes?.SigAbilityNode;

    if (items?.length) {
      const files = await SignatureAbilities.pickFiles(zip, Object.values(zip.files).filter((file) => {
        return !file.dir && file.name.split(".").pop() === "xml" && file.name.includes("/SigAbilities/");
      }));

      let totalCount = files.length;
      let currentCount = 0;
      // career key -> the abilities this data set gives it, written once every file is in
      const careerLinks = {};

      $(".import-progress.signatureability").toggleClass("import-hidden");
      let pack = await ImportHelpers.getCompendiumPack("Item", `oggdude.SignatureAbilities`);
      CONFIG.logger.debug(`Starting Oggdude Signature Ability (${files.length}) Import`);

      await ImportHelpers.asyncForEach(files, async (file) => {
        try {
          const zipData = await zip.file(file.name).async("text");
          const xmlData = ImportHelpers.stringToXml(zipData);
          const signatureAbility = JXON.xmlToJs(xmlData);
          const item = signatureAbility.SigAbility;

          let data = ImportHelpers.prepareBaseObject(item, "signatureability");

          // The large box at the top of the tree is the base ability, and the item's description is
          // what it shows. OggDude keeps the base ability's text on the first row's node; the
          // record's own <Description> is usually the ability's opening story, which the box showed
          // in place of the rules. Use the record's text only when the node is missing or empty.
          const baseKey = [[item.AbilityRows?.AbilityRow].flat()[0]?.Abilities?.Key].flat()[0];
          const baseNode = items.find((a) => a.Key === baseKey);
          item.Description = ImportHelpers.cleanDescription(baseNode?.Description || item.Description);

          data.data = {
            description: item.Description,
            attributes: {},
            upgrades: {},
            base_cost: 0,
            uplink_nodes: {
              uplink0: false,
              uplink1: false,
              uplink2: false,
              uplink3: false,
            },
            metadata: {
              tags: [
                "signatureability",
              ],
              sources: ImportHelpers.getSourcesAsArray(item?.Sources ?? item?.Source),
            },
          };

          //data.data.description += ImportHelpers.getSources(item.Sources ?? item.Source);
          item.AbilityRows.AbilityRow.forEach((row, i) => {
            try {
              if (i === 0) {
                try {
                  data.data.base_cost = row.Costs.Cost[0];
                } catch (err) {
                  data.data.base_cost = 0;
                }
              }
              else {
                // skip the first row because it is the large primary ability box
                row.Abilities.Key.forEach((keyName, index) => {
                  let rowAbility = {};

                  let rowAbilityData = items.find((a) => {
                    return a.Key === keyName;
                  });

                  rowAbility.name = rowAbilityData.Name;
                  rowAbility.description = rowAbilityData.Description;
                  rowAbility.visible = true;
                  rowAbility.attributes = {};

                  if (row.Directions.Direction[index].Up) {
                    rowAbility["links-top-1"] = true;
                  }

                  switch (row.AbilitySpan.Span[index]) {
                    case "1":
                      rowAbility.size = "single";
                      break;
                    case "2":
                      rowAbility.size = "double";
                      if (index < 3 && row.Directions.Direction[index + 1].Up) {
                        rowAbility["links-top-2"] = true;
                      }
                      break;
                    case "3":
                      rowAbility.size = "triple";
                      if (index < 2 && row.Directions.Direction[index + 1].Up) {
                        rowAbility["links-top-2"] = true;
                      }
                      if (index < 2 && row.Directions.Direction[index + 2].Up) {
                        rowAbility["links-top-3"] = true;
                      }
                      break;
                    case "4":
                      rowAbility.size = "full";
                      if (index < 1 && row.Directions.Direction[index + 1].Up) {
                        rowAbility["links-top-2"] = true;
                      }
                      if (index < 1 && row.Directions.Direction[index + 2].Up) {
                        rowAbility["links-top-3"] = true;
                      }
                      if (index < 1 && row.Directions.Direction[index + 3].Up) {
                        rowAbility["links-top-4"] = true;
                      }
                      break;
                    default:
                      rowAbility.size = "single";
                      rowAbility.visible = false;
                  }

                  if (row.Directions.Direction[index].Right) {
                    rowAbility["links-right"] = true;
                  }

                  const talentKey = `upgrade${(i - 1) * 4 + index}`;
                  data.data.upgrades[talentKey] = rowAbility;
                });
              }
            } catch (err) {
              CONFIG.logger.error(`Error importing record : `, data.name);
            }
          });

          // populate tags
          try {
            if (Array.isArray(item.Categories.Category)) {
              for (const tag of item.Categories.Category) {
                data.data.metadata.tags.push(tag.toLowerCase());
              }
            } else {
              data.data.metadata.tags.push(item.Categories.Category.toLowerCase());
            }
          } catch (err) {
            CONFIG.logger.debug(`No categories found for item ${item.Key}`);
          }
          if (item?.Type) {
            // the "type" can be useful as a tag as well
            data.data.metadata.tags.push(item.Type.toLowerCase());
          }

          let imgPath = await ImportHelpers.getImageFilename(zip, "SigAbilities", "", data.flags.starwarsffg.ffgimportid);
          if (imgPath) {
            data.img = await ImportHelpers.importImage(imgPath.name, zip, pack);
          } else {
            data.img = `icons/svg/aura.svg`;
          }

          item.MatchingNodes.Node.forEach((row, i) => {
            data.data.uplink_nodes[`uplink${i}`] = row !== "false";
          });

          const sigAbility = await ImportHelpers.addImportItemToCompendium("Item", data, pack);
          currentCount += 1;
          // `Key` is a string for one career and an array for several; Object.values() of the
          // latter handed the whole array over as a single career key.
          for (const careerKey of [item?.Careers?.Key].flat().filter(Boolean)) {
            careerLinks[careerKey] ??= {};
            careerLinks[careerKey][sigAbility._id] = {
              name: data.name,
              source: sigAbility.uuid ?? pack.getUuid(sigAbility._id),
              id: sigAbility._id,
            };
          }

          $(".signatureability .import-progress-bar")
            .width(`${Math.trunc((currentCount / totalCount) * 100)}%`)
            .html(`<span>${Math.trunc((currentCount / totalCount) * 100)}%</span>`);
        } catch (err) {
          CONFIG.logger.error(`Error importing record : `, err);
        }
      });

      await SignatureAbilities.linkCareers(careerLinks, pack);
      CONFIG.logger.debug(`Completed Oggdude Signature Ability (${files.length}) Import`);
    }
  }
}
