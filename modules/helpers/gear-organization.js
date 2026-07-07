/**
 * Helper for organizing gear (the "Gear" list on the Gear & Equipment tab) into user-defined,
 * collapsible tabs with manual ordering. Mirrors the talent organization helper, but operates on
 * owned gear items. Because gear items are real owned documents, the stable key is simply the
 * item id.
 *
 * Flag shape (actor.flags.starwarsffg.gearOrganization):
 * {
 *   enabled: boolean,                                  // manual organization on/off
 *   defaultCollapsed: boolean,                         // collapsed state of the default group
 *   tabs: [{ id: string, name: string, collapsed: bool }],
 *   assignments: { [gearKey]: { tab: string|null, sort: number } }
 * }
 */
export default class GearOrganization {
  static FLAG = "gearOrganization";
  static LOC = "SWFFG.GearOrganization";
  static DEFAULT_TAB = "__default__";
  static SORT_STEP = 1000;

  /**
   * Stable identifier for a gear item. Gear are real owned items, so the document id is used
   * (falling back to name if an id is somehow unavailable).
   */
  static gearKey(item) {
    if (!item) return "";
    return String(item._id || item.id || item.name || "");
  }

  /** Return a normalized organization object (never null). */
  static get(actor) {
    const raw = actor?.getFlag?.("starwarsffg", this.FLAG) || {};
    return {
      enabled: !!raw.enabled,
      defaultCollapsed: !!raw.defaultCollapsed,
      tabs: Array.isArray(raw.tabs) ? raw.tabs.map((t) => ({
        id: t.id,
        name: t.name ?? "",
        collapsed: !!t.collapsed,
      })) : [],
      assignments: (raw.assignments && typeof raw.assignments === "object") ? foundry.utils.deepClone(raw.assignments) : {},
    };
  }

  static async save(actor, org) {
    return actor.setFlag("starwarsffg", this.FLAG, org);
  }

  static isEnabled(actor) {
    return this.get(actor).enabled;
  }

  /**
   * Build the grouped, ordered structure used by the template.
   * @param {Actor} actor
   * @param {Array} gearList - the list of gear items to display (owned items of type "gear")
   * @returns {{enabled: boolean, groups: Array}} groups whose `items` are the gear documents in order
   */
  static buildGroups(actor, gearList) {
    const org = this.get(actor);
    const list = Array.isArray(gearList) ? gearList : [];

    if (!org.enabled) {
      return { enabled: false, groups: [] };
    }

    // valid tab ids (plus the implicit default)
    const validTabIds = new Set([this.DEFAULT_TAB, ...org.tabs.map((t) => t.id)]);

    // bucket gear by their assigned tab (unknown/missing -> default)
    const buckets = {};
    buckets[this.DEFAULT_TAB] = [];
    for (const tab of org.tabs) buckets[tab.id] = [];

    list.forEach((item, index) => {
      const key = this.gearKey(item);
      const assignment = org.assignments[key];
      let tabId = assignment?.tab;
      if (!tabId || !validTabIds.has(tabId)) tabId = this.DEFAULT_TAB;
      const sort = Number.isFinite(assignment?.sort) ? assignment.sort : (index + 1) * this.SORT_STEP;
      buckets[tabId].push({ doc: item, _sort: sort, _index: index });
    });

    // sort each bucket then unwrap back to the gear documents (so the template renders them as before)
    const sortBucket = (arr) => arr.sort((a, b) => (a._sort - b._sort) || (a._index - b._index)).map((e) => e.doc);

    const groups = [];
    // default group always first
    groups.push({
      id: this.DEFAULT_TAB,
      name: game.i18n.localize(`${this.LOC}.DefaultTab`),
      collapsed: org.defaultCollapsed,
      isDefault: true,
      items: sortBucket(buckets[this.DEFAULT_TAB]),
    });
    // then user tabs in their defined order
    for (const tab of org.tabs) {
      groups.push({
        id: tab.id,
        name: tab.name,
        collapsed: tab.collapsed,
        isDefault: false,
        items: sortBucket(buckets[tab.id]),
      });
    }

    return { enabled: true, groups };
  }

  static async setEnabled(actor, enabled) {
    const org = this.get(actor);
    org.enabled = !!enabled;
    return this.save(actor, org);
  }

  static async addTab(actor, name) {
    const org = this.get(actor);
    org.enabled = true;
    org.tabs.push({
      id: `tab_${foundry.utils.randomID()}`,
      name: name || game.i18n.localize(`${this.LOC}.NewTab`),
      collapsed: false,
    });
    return this.save(actor, org);
  }

  static async renameTab(actor, tabId, name) {
    const org = this.get(actor);
    const tab = org.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    tab.name = name;
    return this.save(actor, org);
  }

  static async toggleCollapse(actor, tabId) {
    const org = this.get(actor);
    if (tabId === this.DEFAULT_TAB) {
      org.defaultCollapsed = !org.defaultCollapsed;
      return this.save(actor, org);
    }
    const tab = org.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    tab.collapsed = !tab.collapsed;
    return this.save(actor, org);
  }

  /**
   * Reorder a tab, placing it before `beforeTabId` (or at the end if null). Dropping before the
   * implicit default tab places it first among the user tabs.
   */
  static async moveTab(actor, tabId, beforeTabId = null) {
    const org = this.get(actor);
    const idx = org.tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return;
    const [tab] = org.tabs.splice(idx, 1);
    let insertIndex = org.tabs.length;
    if (beforeTabId && beforeTabId !== this.DEFAULT_TAB) {
      const bi = org.tabs.findIndex((t) => t.id === beforeTabId);
      if (bi >= 0) insertIndex = bi;
    } else if (beforeTabId === this.DEFAULT_TAB) {
      insertIndex = 0;
    }
    org.tabs.splice(insertIndex, 0, tab);
    return this.save(actor, org);
  }

  static async deleteTab(actor, tabId) {
    const org = this.get(actor);
    org.tabs = org.tabs.filter((t) => t.id !== tabId);
    // any gear assigned to the removed tab falls back to the default group
    for (const key of Object.keys(org.assignments)) {
      if (org.assignments[key]?.tab === tabId) {
        org.assignments[key].tab = this.DEFAULT_TAB;
      }
    }
    return this.save(actor, org);
  }

  /**
   * Move a gear item into a tab, positioned before `beforeKey` (or at the end if null).
   * Re-numbers sort values for every item in the destination tab so ordering is stable.
   * @param {Actor} actor
   * @param {Array} gearList - the current gear list (for current ordering)
   * @param {string} movedKey
   * @param {string} targetTabId
   * @param {string|null} beforeKey - gearKey of the row to insert before, or null for end
   */
  static async moveGear(actor, gearList, movedKey, targetTabId, beforeKey = null) {
    const org = this.get(actor);
    org.enabled = true;
    const validTabIds = new Set([this.DEFAULT_TAB, ...org.tabs.map((t) => t.id)]);
    if (!validTabIds.has(targetTabId)) targetTabId = this.DEFAULT_TAB;

    // current ordering of the destination tab (using the same logic as buildGroups)
    const built = this.buildGroups(actor, gearList);
    const targetGroup = built.groups.find((g) => g.id === targetTabId);
    let orderedKeys = targetGroup ? targetGroup.items.map((it) => this.gearKey(it)) : [];

    // remove the moved item if it is already in this tab, then insert at the target spot
    orderedKeys = orderedKeys.filter((k) => k !== movedKey);
    let insertIndex = orderedKeys.length;
    if (beforeKey) {
      const idx = orderedKeys.indexOf(beforeKey);
      if (idx >= 0) insertIndex = idx;
    }
    orderedKeys.splice(insertIndex, 0, movedKey);

    // persist explicit tab + sort for everything now in the destination tab
    orderedKeys.forEach((key, index) => {
      org.assignments[key] = { tab: targetTabId, sort: (index + 1) * this.SORT_STEP };
    });

    return this.save(actor, org);
  }
}
