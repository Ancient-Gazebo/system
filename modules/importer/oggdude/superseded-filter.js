import ImportHelpers from "../import-helpers.js";

/**
 * Works out which specialization and Force power files in an OggDude export have been superseded
 * by a replacement in the same export, so the importer can skip them.
 *
 * OggDude will not let you delete a stock record, only shadow it with a new one, so a dataset that
 * has been reworked exports both copies and the importer faithfully imports both. Every record in a
 * DataCustom export carries a <Custom> element saying where it came from:
 *
 *   AddedItem   - a record the dataset author created. Never dropped.
 *   CustomItem  - a stock record that was edited.
 *   DescOnly    - a stock record where only the description was edited.
 *
 * Being stock is not on its own a reason to drop a record: plenty of stock specializations have no
 * replacement yet. A specialization is dropped only when all three of these hold:
 *
 *   1. it is stock, and
 *   2. no Career in the export still lists its <Key> - the career has been repointed at the
 *      replacement, and
 *   3. it is not <Universal>true</Universal> - universal specializations belong to no career, so
 *      rule 2 could never clear them.
 *
 * That makes the filter a no-op on an unmodified dataset, where every stock specialization is still
 * on a career.
 *
 * Force powers are attached to no career, so rule 2 has nothing to work with; a stock power is
 * dropped when an authored power exists whose name matches once "(Respec)" and whitespace are
 * removed. Where a replacement was renamed past recognition, ALWAYS_DROP names it by key.
 *
 * Talents and signature abilities are deliberately never filtered - they are not duplicated this
 * way, and the surviving trees reference stock talents by key.
 */
export default class SupersededFilter {
  /** <Custom> values that mark a record as stock rather than authored. */
  static STOCK = ["CustomItem", "DescOnly"];

  /**
   * Keys dropped regardless of the rules above, for replacements that were renamed rather than
   * suffixed, so no name match can find them.
   */
  static ALWAYS_DROP = [
    "WARFOR", // Warde's Foresight -> replaced by Insight (Respec)
    "IMBUE",  // Imbue -> merged into Imbue/Exhaust (Respec), so the names no longer match
  ];

  /**
   * Collapse a record name so a replacement matches the record it replaces:
   * "Ebb / Flow (Respec)" and "Ebb/Flow" both become "ebb/flow".
   * @param {string} name
   * @returns {string}
   */
  static normalize(name) {
    return (name ?? "")
      .replace(/\(respec[^)]*\)/gi, "")
      .replace(/\s+/g, "")
      .toLowerCase();
  }

  /**
   * Read one direct child element of the document root. querySelector alone is not enough: a
   * specialization's career skills and talent rows are full of <Key> elements too, and the record's
   * own key has to win.
   * @param {Document} doc
   * @param {string} root - expected root element name
   * @param {string} child - child element to read
   * @returns {string|undefined}
   */
  static childText(doc, root, child) {
    return doc.querySelector(`${root} > ${child}`)?.textContent?.trim();
  }

  static async parse(zip, name) {
    return ImportHelpers.stringToXml(await zip.file(name).async("text"));
  }

  static files(zip, pathFragment) {
    return Object.values(zip.files).filter((file) =>
      !file.dir && file.name.includes(pathFragment) && file.name.split(".").pop().toLowerCase() === "xml"
    );
  }

  /**
   * @param {object} zip - the loaded JSZip archive
   * @returns {Promise<Set<string>>} zip entry names the importers should skip
   */
  static async compute(zip) {
    const excluded = new Set();

    // Which specializations are still reachable from a career?
    const referenced = new Set();
    for (const file of this.files(zip, "/Careers/")) {
      try {
        const doc = await this.parse(zip, file.name);
        for (const key of doc.querySelectorAll("Career > Specializations > Key")) {
          referenced.add(key.textContent.trim());
        }
      } catch (err) {
        CONFIG.logger.warn(`Superseded filter: could not read career ${file.name}`, err);
      }
    }

    for (const file of this.files(zip, "/Specializations/")) {
      try {
        const doc = await this.parse(zip, file.name);
        const key = this.childText(doc, "Specialization", "Key");
        if (this.ALWAYS_DROP.includes(key)) {
          excluded.add(file.name);
          continue;
        }
        if (!this.STOCK.includes(this.childText(doc, "Specialization", "Custom"))) continue;
        if (referenced.has(key)) continue;
        if (this.childText(doc, "Specialization", "Universal") === "true") continue;
        excluded.add(file.name);
      } catch (err) {
        CONFIG.logger.warn(`Superseded filter: could not read specialization ${file.name}`, err);
      }
    }

    // Force powers get two passes: collect every power first, so the stock ones can be tested
    // against the names of the authored ones.
    const powers = [];
    for (const file of this.files(zip, "/Force Powers/")) {
      try {
        const doc = await this.parse(zip, file.name);
        powers.push({
          name: file.name,
          key: this.childText(doc, "ForcePower", "Key"),
          title: this.childText(doc, "ForcePower", "Name"),
          custom: this.childText(doc, "ForcePower", "Custom"),
        });
      } catch (err) {
        CONFIG.logger.warn(`Superseded filter: could not read Force power ${file.name}`, err);
      }
    }

    const replaced = new Set(
      powers.filter((p) => !this.STOCK.includes(p.custom)).map((p) => this.normalize(p.title))
    );
    for (const power of powers) {
      if (this.ALWAYS_DROP.includes(power.key)) {
        excluded.add(power.name);
      } else if (this.STOCK.includes(power.custom) && replaced.has(this.normalize(power.title))) {
        excluded.add(power.name);
      }
    }

    return excluded;
  }
}
